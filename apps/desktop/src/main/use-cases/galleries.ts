/**
 * @purpose Implement image gallery management use cases.
 * @role    Application-layer workflows for gallery creation, membership, ordering, and cover repair.
 * @deps    Shared gallery contracts, SQLite schema, gallery repositories, vault repository.
 * @gotcha  A gallery is not an asset; enforce image-only, single-gallery membership here.
 */

import { randomUUID } from "node:crypto";

import { TRPCError } from "@trpc/server";
import { and, asc, eq, inArray, isNull } from "drizzle-orm";
import type { z } from "zod";

import { schema } from "@post/db";
import type {
  galleryAddItemsInputSchema,
  galleryCreateInputSchema,
  galleryRemoveItemsInputSchema,
  galleryReorderItemsInputSchema,
  gallerySetCoverInputSchema,
  galleryUpdateCaptionInputSchema,
  galleryUpdateInputSchema,
} from "@shared/contracts/galleries/gallery.contract";
import { getDatabase } from "../db";
import {
  getAssetGalleryMemberships,
  getGalleryDetail,
  getGalleryMemberIds,
  getGalleryRecord,
} from "../repositories/galleries-repository";
import { getRequestedOrActiveVault } from "../repositories/vaults-repository";

type GalleryCreateInput = z.infer<typeof galleryCreateInputSchema>;
type GalleryUpdateInput = z.infer<typeof galleryUpdateInputSchema>;
type GalleryAddItemsInput = z.infer<typeof galleryAddItemsInputSchema>;
type GalleryRemoveItemsInput = z.infer<typeof galleryRemoveItemsInputSchema>;
type GalleryReorderItemsInput = z.infer<typeof galleryReorderItemsInputSchema>;
type GallerySetCoverInput = z.infer<typeof gallerySetCoverInputSchema>;
type GalleryUpdateCaptionInput = z.infer<typeof galleryUpdateCaptionInputSchema>;

function getActiveVaultOrThrow(vaultId?: string) {
  const vault = getRequestedOrActiveVault(vaultId);
  if (!vault) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "No active vault selected" });
  }

  return vault;
}

function uniqueStrings<T extends string>(values: readonly T[]) {
  return Array.from(new Set(values));
}

function normalizeOptionalText(value: string | null | undefined) {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function getGalleryOrThrow(galleryId: string) {
  const gallery = getGalleryRecord(galleryId);
  if (!gallery) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Gallery not found" });
  }

  return gallery;
}

function getImageAssetsOrThrow(vaultId: string, assetIds: readonly string[]) {
  const uniqueAssetIds = uniqueStrings(assetIds);
  const rows = getDatabase()
    .select({
      id: schema.assets.id,
      kind: schema.assets.kind,
      vaultId: schema.assets.vaultId,
    })
    .from(schema.assets)
    .where(
      and(
        eq(schema.assets.vaultId, vaultId),
        inArray(schema.assets.id, uniqueAssetIds),
        isNull(schema.assets.deletedAt),
      ),
    )
    .all();
  const rowsById = new Map(rows.map((row) => [row.id, row]));

  for (const assetId of uniqueAssetIds) {
    const row = rowsById.get(assetId);
    if (!row) {
      throw new TRPCError({ code: "BAD_REQUEST", message: "Gallery references unknown assets" });
    }

    if (row.kind !== "image") {
      throw new TRPCError({ code: "BAD_REQUEST", message: "Gallery members must be images" });
    }
  }

  return uniqueAssetIds;
}

function assertAssetsNotInOtherGallery(assetIds: readonly string[], currentGalleryId?: string) {
  const memberships = getAssetGalleryMemberships(assetIds).filter(
    (membership) => membership.galleryId !== currentGalleryId,
  );

  if (memberships.length > 0) {
    throw new TRPCError({
      code: "CONFLICT",
      message: "One or more images already belong to a gallery",
    });
  }
}

function getFirstMemberAssetId(galleryId: string) {
  return getDatabase()
    .select({ assetId: schema.assetGalleryItems.assetId })
    .from(schema.assetGalleryItems)
    .where(eq(schema.assetGalleryItems.galleryId, galleryId))
    .orderBy(asc(schema.assetGalleryItems.sortOrder))
    .get()?.assetId;
}

function repairGalleryAfterMembershipChange(galleryId: string) {
  const gallery = getGalleryRecord(galleryId);
  if (!gallery) {
    return null;
  }

  const memberIds = getGalleryMemberIds(gallery.id);
  const now = new Date();

  if (memberIds.length === 0) {
    getDatabase()
      .update(schema.assetGalleries)
      .set({ deletedAt: now, updatedAt: now, coverAssetId: null })
      .where(eq(schema.assetGalleries.id, gallery.id))
      .run();
    return null;
  }

  if (!gallery.coverAssetId || !memberIds.includes(gallery.coverAssetId)) {
    getDatabase()
      .update(schema.assetGalleries)
      .set({ coverAssetId: getFirstMemberAssetId(gallery.id) ?? null, updatedAt: now })
      .where(eq(schema.assetGalleries.id, gallery.id))
      .run();
  } else {
    getDatabase()
      .update(schema.assetGalleries)
      .set({ updatedAt: now })
      .where(eq(schema.assetGalleries.id, gallery.id))
      .run();
  }

  return getGalleryDetail(gallery.id);
}

export function getGalleryById(galleryId: string) {
  const detail = getGalleryDetail(galleryId);
  if (!detail) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Gallery not found" });
  }

  const coverAssetId = detail.gallery.coverAssetId;
  if (
    detail.members.length === 0 ||
    !coverAssetId ||
    !detail.members.some((member) => member.asset.id === coverAssetId)
  ) {
    const repairedDetail = repairGalleryAfterMembershipChange(detail.gallery.id);
    if (!repairedDetail) {
      throw new TRPCError({ code: "NOT_FOUND", message: "Gallery not found" });
    }

    return repairedDetail;
  }

  return detail;
}

export function createGallery(input: GalleryCreateInput) {
  const vault = getActiveVaultOrThrow(input.vaultId);
  const assetIds = getImageAssetsOrThrow(vault.id, input.assetIds);
  assertAssetsNotInOtherGallery(assetIds);

  const now = new Date();
  const galleryId = randomUUID();

  getDatabase().transaction((tx) => {
    tx.insert(schema.assetGalleries)
      .values({
        id: galleryId,
        vaultId: vault.id,
        title: input.title,
        description: normalizeOptionalText(input.description),
        coverAssetId: assetIds[0] ?? null,
        status: "inbox",
        privacy: "normal",
        createdAt: now,
        updatedAt: now,
      })
      .run();

    for (const [sortOrder, assetId] of assetIds.entries()) {
      tx.insert(schema.assetGalleryItems)
        .values({
          galleryId,
          assetId,
          vaultId: vault.id,
          sortOrder,
          createdAt: now,
        })
        .run();
    }
  });

  return getGalleryById(galleryId);
}

export function updateGallery(input: GalleryUpdateInput) {
  const gallery = getGalleryOrThrow(input.galleryId);
  getDatabase()
    .update(schema.assetGalleries)
    .set({
      title: input.title,
      description: normalizeOptionalText(input.description),
      status: input.status,
      privacy: input.privacy,
      updatedAt: new Date(),
    })
    .where(eq(schema.assetGalleries.id, gallery.id))
    .run();

  return getGalleryById(gallery.id);
}

export function deleteGallery(galleryId: string) {
  const gallery = getGalleryOrThrow(galleryId);
  getDatabase().delete(schema.assetGalleries).where(eq(schema.assetGalleries.id, gallery.id)).run();

  return { id: gallery.id };
}

export function addGalleryItems(input: GalleryAddItemsInput) {
  const gallery = getGalleryOrThrow(input.galleryId);
  const assetIds = getImageAssetsOrThrow(gallery.vaultId, input.assetIds);
  assertAssetsNotInOtherGallery(assetIds, gallery.id);
  const existingIds = new Set(getGalleryMemberIds(gallery.id));
  const nextIds = assetIds.filter((assetId) => !existingIds.has(assetId));
  if (nextIds.length === 0) {
    return getGalleryById(gallery.id);
  }

  const currentMaxSort =
    getDatabase()
      .select({ sortOrder: schema.assetGalleryItems.sortOrder })
      .from(schema.assetGalleryItems)
      .where(eq(schema.assetGalleryItems.galleryId, gallery.id))
      .orderBy(asc(schema.assetGalleryItems.sortOrder))
      .all()
      .at(-1)?.sortOrder ?? -1;
  const now = new Date();

  for (const [index, assetId] of nextIds.entries()) {
    getDatabase()
      .insert(schema.assetGalleryItems)
      .values({
        galleryId: gallery.id,
        assetId,
        vaultId: gallery.vaultId,
        sortOrder: currentMaxSort + index + 1,
        createdAt: now,
      })
      .run();
  }

  return repairGalleryAfterMembershipChange(gallery.id);
}

export function removeGalleryItems(input: GalleryRemoveItemsInput) {
  const gallery = getGalleryOrThrow(input.galleryId);
  const assetIds = uniqueStrings(input.assetIds);

  getDatabase()
    .delete(schema.assetGalleryItems)
    .where(
      and(
        eq(schema.assetGalleryItems.galleryId, gallery.id),
        inArray(schema.assetGalleryItems.assetId, assetIds),
      ),
    )
    .run();

  return repairGalleryAfterMembershipChange(gallery.id);
}

export function reorderGalleryItems(input: GalleryReorderItemsInput) {
  const gallery = getGalleryOrThrow(input.galleryId);
  const currentIds = getGalleryMemberIds(gallery.id);
  const currentSet = new Set(currentIds);
  const requestedIds = uniqueStrings(input.orderedAssetIds).filter((assetId) =>
    currentSet.has(assetId),
  );
  const remainingIds = currentIds.filter((assetId) => !requestedIds.includes(assetId));
  const nextIds = [...requestedIds, ...remainingIds];
  const now = new Date();

  for (const [sortOrder, assetId] of nextIds.entries()) {
    getDatabase()
      .update(schema.assetGalleryItems)
      .set({ sortOrder })
      .where(
        and(
          eq(schema.assetGalleryItems.galleryId, gallery.id),
          eq(schema.assetGalleryItems.assetId, assetId),
        ),
      )
      .run();
  }

  getDatabase()
    .update(schema.assetGalleries)
    .set({ updatedAt: now })
    .where(eq(schema.assetGalleries.id, gallery.id))
    .run();

  return getGalleryById(gallery.id);
}

export function setGalleryCover(input: GallerySetCoverInput) {
  const gallery = getGalleryOrThrow(input.galleryId);
  if (!getGalleryMemberIds(gallery.id).includes(input.assetId)) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "Cover must be a gallery member" });
  }

  getDatabase()
    .update(schema.assetGalleries)
    .set({ coverAssetId: input.assetId, updatedAt: new Date() })
    .where(eq(schema.assetGalleries.id, gallery.id))
    .run();

  return getGalleryById(gallery.id);
}

export function updateGalleryItemCaption(input: GalleryUpdateCaptionInput) {
  const gallery = getGalleryOrThrow(input.galleryId);
  getDatabase()
    .update(schema.assetGalleryItems)
    .set({ caption: normalizeOptionalText(input.caption) })
    .where(
      and(
        eq(schema.assetGalleryItems.galleryId, gallery.id),
        eq(schema.assetGalleryItems.assetId, input.assetId),
      ),
    )
    .run();

  getDatabase()
    .update(schema.assetGalleries)
    .set({ updatedAt: new Date() })
    .where(eq(schema.assetGalleries.id, gallery.id))
    .run();

  return getGalleryById(gallery.id);
}
