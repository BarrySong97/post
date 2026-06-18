/**
 * @purpose Implement reusable image gallery organization workflows.
 * @role    Domain service for gallery CRUD, membership, ordering, cover, and caption operations.
 * @deps    Domain context/errors/assets helpers, @post/db schema, drizzle query helpers.
 * @gotcha  Galleries are relationship state; deleting one never deletes member assets or files.
 */

import { and, asc, eq, inArray, isNull } from "drizzle-orm";

import { schema, type AssetPrivacy, type AssetStatus } from "@post/db";

import { getImageAssetIdsOrThrow } from "../assets/index";
import type { DomainContext } from "../context";
import { DomainError } from "../errors";
import { normalizeOptionalText, uniqueStrings } from "../utils";
import { getActiveVaultOrThrow } from "../vaults/index";

export type GalleryCreateInput = {
  vaultId?: string;
  title: string;
  description?: string | null;
  assetIds: string[];
};

export type GalleryUpdateInput = {
  galleryId: string;
  title: string;
  description?: string | null;
  status: AssetStatus;
  privacy: AssetPrivacy;
};

export type GalleryAddItemsInput = {
  galleryId: string;
  assetIds: string[];
};

export type GalleryRemoveItemsInput = {
  galleryId: string;
  assetIds: string[];
};

export type GalleryReorderItemsInput = {
  galleryId: string;
  orderedAssetIds: string[];
};

export type GallerySetCoverInput = {
  galleryId: string;
  assetId: string;
};

export type GalleryUpdateCaptionInput = {
  galleryId: string;
  assetId: string;
  caption?: string | null;
};

export type GalleryMemberRow = {
  item: typeof schema.assetGalleryItems.$inferSelect;
  asset: typeof schema.assets.$inferSelect;
  file: typeof schema.assetFiles.$inferSelect;
  vault: typeof schema.vaults.$inferSelect;
  image: typeof schema.imageCache.$inferSelect | null;
  tags: Array<typeof schema.tags.$inferSelect>;
};

export type GalleryDetail = {
  gallery: typeof schema.assetGalleries.$inferSelect;
  members: GalleryMemberRow[];
};

function attachTagsToMembers(
  ctx: DomainContext,
  members: Array<Omit<GalleryMemberRow, "tags">>,
): GalleryMemberRow[] {
  const assetIds = members.map((member) => member.asset.id);
  if (assetIds.length === 0) {
    return members.map((member) => ({ ...member, tags: [] }));
  }

  const tagRows = ctx.db
    .select({
      assetId: schema.assetTags.assetId,
      tag: schema.tags,
    })
    .from(schema.assetTags)
    .innerJoin(schema.tags, eq(schema.tags.id, schema.assetTags.tagId))
    .where(inArray(schema.assetTags.assetId, assetIds))
    .all();
  const tagsByAsset = new Map<string, Array<typeof schema.tags.$inferSelect>>();

  for (const row of tagRows) {
    const tags = tagsByAsset.get(row.assetId) ?? [];
    tags.push(row.tag);
    tagsByAsset.set(row.assetId, tags);
  }

  return members.map((member) => ({
    ...member,
    tags: tagsByAsset.get(member.asset.id) ?? [],
  }));
}

export function getGalleryRecord(ctx: DomainContext, galleryId: string) {
  return (
    ctx.db
      .select()
      .from(schema.assetGalleries)
      .where(and(eq(schema.assetGalleries.id, galleryId), isNull(schema.assetGalleries.deletedAt)))
      .get() ?? null
  );
}

function getGalleryOrThrow(ctx: DomainContext, galleryId: string) {
  const gallery = getGalleryRecord(ctx, galleryId);
  if (!gallery) {
    throw new DomainError("GALLERY_NOT_FOUND", "Gallery not found", { status: "NOT_FOUND" });
  }

  return gallery;
}

export function getGalleryMembers(ctx: DomainContext, galleryId: string): GalleryMemberRow[] {
  const rows = ctx.db
    .select({
      item: schema.assetGalleryItems,
      asset: schema.assets,
      file: schema.assetFiles,
      vault: schema.vaults,
      image: schema.imageCache,
    })
    .from(schema.assetGalleryItems)
    .innerJoin(schema.assets, eq(schema.assets.id, schema.assetGalleryItems.assetId))
    .innerJoin(schema.assetFiles, eq(schema.assetFiles.assetId, schema.assets.id))
    .innerJoin(schema.vaults, eq(schema.vaults.id, schema.assets.vaultId))
    .leftJoin(schema.imageCache, eq(schema.imageCache.assetId, schema.assets.id))
    .where(and(eq(schema.assetGalleryItems.galleryId, galleryId), isNull(schema.assets.deletedAt)))
    .orderBy(asc(schema.assetGalleryItems.sortOrder), asc(schema.assets.title))
    .all();

  return attachTagsToMembers(ctx, rows);
}

export function getGalleryDetail(ctx: DomainContext, galleryId: string): GalleryDetail | null {
  const gallery = getGalleryRecord(ctx, galleryId);
  if (!gallery) {
    return null;
  }

  return {
    gallery,
    members: getGalleryMembers(ctx, gallery.id),
  };
}

export function listGalleries(ctx: DomainContext, vaultId?: string): GalleryDetail[] {
  const vault = getActiveVaultOrThrow(ctx, vaultId);
  const galleries = ctx.db
    .select()
    .from(schema.assetGalleries)
    .where(
      and(eq(schema.assetGalleries.vaultId, vault.id), isNull(schema.assetGalleries.deletedAt)),
    )
    .orderBy(asc(schema.assetGalleries.sortOrder), asc(schema.assetGalleries.title))
    .all();

  return galleries.map((gallery) => ({
    gallery,
    members: getGalleryMembers(ctx, gallery.id),
  }));
}

function getAssetGalleryMemberships(ctx: DomainContext, assetIds: readonly string[]) {
  if (assetIds.length === 0) {
    return [];
  }

  return ctx.db
    .select()
    .from(schema.assetGalleryItems)
    .where(inArray(schema.assetGalleryItems.assetId, [...assetIds]))
    .all();
}

function getGalleryMemberIds(ctx: DomainContext, galleryId: string): string[] {
  return ctx.db
    .select({ assetId: schema.assetGalleryItems.assetId })
    .from(schema.assetGalleryItems)
    .where(eq(schema.assetGalleryItems.galleryId, galleryId))
    .all()
    .map((row) => row.assetId);
}

function assertAssetsNotInOtherGallery(
  ctx: DomainContext,
  assetIds: readonly string[],
  currentGalleryId?: string,
): void {
  const memberships = getAssetGalleryMemberships(ctx, assetIds).filter(
    (membership) => membership.galleryId !== currentGalleryId,
  );

  if (memberships.length > 0) {
    throw new DomainError(
      "GALLERY_ASSET_ALREADY_MEMBER",
      "One or more images already belong to a gallery",
      { status: "CONFLICT" },
    );
  }
}

function getFirstMemberAssetId(ctx: DomainContext, galleryId: string): string | undefined {
  return ctx.db
    .select({ assetId: schema.assetGalleryItems.assetId })
    .from(schema.assetGalleryItems)
    .where(eq(schema.assetGalleryItems.galleryId, galleryId))
    .orderBy(asc(schema.assetGalleryItems.sortOrder))
    .get()?.assetId;
}

function repairGalleryAfterMembershipChange(ctx: DomainContext, galleryId: string) {
  const gallery = getGalleryRecord(ctx, galleryId);
  if (!gallery) {
    return null;
  }

  const memberIds = getGalleryMemberIds(ctx, gallery.id);
  const now = ctx.now();

  if (memberIds.length === 0) {
    ctx.db
      .update(schema.assetGalleries)
      .set({ deletedAt: now, updatedAt: now, coverAssetId: null })
      .where(eq(schema.assetGalleries.id, gallery.id))
      .run();
    return null;
  }

  if (!gallery.coverAssetId || !memberIds.includes(gallery.coverAssetId)) {
    ctx.db
      .update(schema.assetGalleries)
      .set({ coverAssetId: getFirstMemberAssetId(ctx, gallery.id) ?? null, updatedAt: now })
      .where(eq(schema.assetGalleries.id, gallery.id))
      .run();
  } else {
    ctx.db
      .update(schema.assetGalleries)
      .set({ updatedAt: now })
      .where(eq(schema.assetGalleries.id, gallery.id))
      .run();
  }

  return getGalleryDetail(ctx, gallery.id);
}

export function getGalleryById(ctx: DomainContext, galleryId: string): GalleryDetail {
  const detail = getGalleryDetail(ctx, galleryId);
  if (!detail) {
    throw new DomainError("GALLERY_NOT_FOUND", "Gallery not found", { status: "NOT_FOUND" });
  }

  const coverAssetId = detail.gallery.coverAssetId;
  if (
    detail.members.length === 0 ||
    !coverAssetId ||
    !detail.members.some((member) => member.asset.id === coverAssetId)
  ) {
    const repairedDetail = repairGalleryAfterMembershipChange(ctx, detail.gallery.id);
    if (!repairedDetail) {
      throw new DomainError("GALLERY_NOT_FOUND", "Gallery not found", { status: "NOT_FOUND" });
    }

    return repairedDetail;
  }

  return detail;
}

export function createGallery(ctx: DomainContext, input: GalleryCreateInput): GalleryDetail {
  const vault = getActiveVaultOrThrow(ctx, input.vaultId);
  const assetIds = getImageAssetIdsOrThrow(ctx, vault.id, input.assetIds);
  assertAssetsNotInOtherGallery(ctx, assetIds);

  const now = ctx.now();
  const galleryId = ctx.id();

  ctx.db.transaction((tx) => {
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

  return getGalleryById(ctx, galleryId);
}

export function updateGallery(ctx: DomainContext, input: GalleryUpdateInput): GalleryDetail {
  const gallery = getGalleryOrThrow(ctx, input.galleryId);
  ctx.db
    .update(schema.assetGalleries)
    .set({
      title: input.title,
      description: normalizeOptionalText(input.description),
      status: input.status,
      privacy: input.privacy,
      updatedAt: ctx.now(),
    })
    .where(eq(schema.assetGalleries.id, gallery.id))
    .run();

  return getGalleryById(ctx, gallery.id);
}

export function deleteGallery(ctx: DomainContext, galleryId: string): { id: string } {
  const gallery = getGalleryOrThrow(ctx, galleryId);
  ctx.db.delete(schema.assetGalleries).where(eq(schema.assetGalleries.id, gallery.id)).run();

  return { id: gallery.id };
}

export function addGalleryItems(ctx: DomainContext, input: GalleryAddItemsInput): GalleryDetail {
  const gallery = getGalleryOrThrow(ctx, input.galleryId);
  const assetIds = getImageAssetIdsOrThrow(ctx, gallery.vaultId, input.assetIds);
  assertAssetsNotInOtherGallery(ctx, assetIds, gallery.id);
  const existingIds = new Set(getGalleryMemberIds(ctx, gallery.id));
  const nextIds = assetIds.filter((assetId) => !existingIds.has(assetId));
  if (nextIds.length === 0) {
    return getGalleryById(ctx, gallery.id);
  }

  const currentSortRows = ctx.db
    .select({ sortOrder: schema.assetGalleryItems.sortOrder })
    .from(schema.assetGalleryItems)
    .where(eq(schema.assetGalleryItems.galleryId, gallery.id))
    .orderBy(asc(schema.assetGalleryItems.sortOrder))
    .all();
  const currentMaxSort = currentSortRows.at(-1)?.sortOrder ?? -1;
  const now = ctx.now();

  for (const [index, assetId] of nextIds.entries()) {
    ctx.db
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

  const repaired = repairGalleryAfterMembershipChange(ctx, gallery.id);
  if (!repaired) {
    throw new DomainError("GALLERY_NOT_FOUND", "Gallery not found", { status: "NOT_FOUND" });
  }

  return repaired;
}

export function removeGalleryItems(
  ctx: DomainContext,
  input: GalleryRemoveItemsInput,
): GalleryDetail | null {
  const gallery = getGalleryOrThrow(ctx, input.galleryId);
  const assetIds = uniqueStrings(input.assetIds);
  if (assetIds.length === 0) {
    return getGalleryById(ctx, gallery.id);
  }

  ctx.db
    .delete(schema.assetGalleryItems)
    .where(
      and(
        eq(schema.assetGalleryItems.galleryId, gallery.id),
        inArray(schema.assetGalleryItems.assetId, assetIds),
      ),
    )
    .run();

  return repairGalleryAfterMembershipChange(ctx, gallery.id);
}

export function reorderGalleryItems(
  ctx: DomainContext,
  input: GalleryReorderItemsInput,
): GalleryDetail {
  const gallery = getGalleryOrThrow(ctx, input.galleryId);
  const currentIds = getGalleryMemberIds(ctx, gallery.id);
  const knownIds = new Set(currentIds);
  const requestedIds = uniqueStrings(input.orderedAssetIds).filter((id) => knownIds.has(id));
  const remainingIds = currentIds.filter((id) => !requestedIds.includes(id));
  const nextIds = [...requestedIds, ...remainingIds];

  ctx.db.transaction((tx) => {
    for (const [sortOrder, assetId] of nextIds.entries()) {
      tx.update(schema.assetGalleryItems)
        .set({ sortOrder })
        .where(
          and(
            eq(schema.assetGalleryItems.galleryId, gallery.id),
            eq(schema.assetGalleryItems.assetId, assetId),
          ),
        )
        .run();
    }

    tx.update(schema.assetGalleries)
      .set({ updatedAt: ctx.now() })
      .where(eq(schema.assetGalleries.id, gallery.id))
      .run();
  });

  return getGalleryById(ctx, gallery.id);
}

export function setGalleryCover(ctx: DomainContext, input: GallerySetCoverInput): GalleryDetail {
  const gallery = getGalleryOrThrow(ctx, input.galleryId);
  const memberIds = getGalleryMemberIds(ctx, gallery.id);
  if (!memberIds.includes(input.assetId)) {
    throw new DomainError("GALLERY_COVER_NOT_MEMBER", "Gallery cover must be a member");
  }

  ctx.db
    .update(schema.assetGalleries)
    .set({ coverAssetId: input.assetId, updatedAt: ctx.now() })
    .where(eq(schema.assetGalleries.id, gallery.id))
    .run();

  return getGalleryById(ctx, gallery.id);
}

export function updateGalleryItemCaption(
  ctx: DomainContext,
  input: GalleryUpdateCaptionInput,
): GalleryDetail {
  const gallery = getGalleryOrThrow(ctx, input.galleryId);
  ctx.db
    .update(schema.assetGalleryItems)
    .set({ caption: normalizeOptionalText(input.caption) })
    .where(
      and(
        eq(schema.assetGalleryItems.galleryId, gallery.id),
        eq(schema.assetGalleryItems.assetId, input.assetId),
      ),
    )
    .run();

  ctx.db
    .update(schema.assetGalleries)
    .set({ updatedAt: ctx.now() })
    .where(eq(schema.assetGalleries.id, gallery.id))
    .run();

  return getGalleryById(ctx, gallery.id);
}
