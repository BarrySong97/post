/**
 * @purpose Implement asset tag management use cases.
 * @role    Application-layer workflows for creating, updating, deleting, reordering, and assigning tags.
 * @deps    Shared tag contracts, SQLite repositories/helpers, saved view filter serialization.
 * @gotcha  Deleting a tag also cleans saved views that reference the tag.
 */

import { randomUUID } from "node:crypto";

import { TRPCError } from "@trpc/server";
import { and, asc, count, eq } from "drizzle-orm";
import type { z } from "zod";

import { schema } from "@post/db";
import type {
  addTagToAssetInputSchema,
  reorderTagsInputSchema,
  tagInputSchema,
  updateTagInputSchema,
  removeTagFromAssetInputSchema,
} from "@shared/contracts/assets/tags/tag.contract";
import { getDatabase } from "../../db";
import {
  getAssetRows,
  parseSavedViewFilters,
  serializeSavedViewFilters,
} from "../../repositories/assets-repository";
import { upsertTag } from "../../repositories/tags-repository";
import { getRequestedOrActiveVault } from "../../repositories/vaults-repository";

type TagInput = z.infer<typeof tagInputSchema>;
type UpdateTagInput = z.infer<typeof updateTagInputSchema>;
type ReorderTagsInput = z.infer<typeof reorderTagsInputSchema>;
type AddTagToAssetInput = z.infer<typeof addTagToAssetInputSchema>;
type RemoveTagFromAssetInput = z.infer<typeof removeTagFromAssetInputSchema>;

function getActiveVaultOrThrow(vaultId?: string) {
  const vault = getRequestedOrActiveVault(vaultId);
  if (!vault) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "No active vault selected" });
  }

  return vault;
}

function normalizeNullableText(value: string | null | undefined) {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function uniqueStrings<T extends string>(values: readonly T[]) {
  return Array.from(new Set(values));
}

function assertUniqueTagName(vaultId: string, name: string, excludeId?: string) {
  const existing = getDatabase()
    .select({ id: schema.tags.id })
    .from(schema.tags)
    .where(and(eq(schema.tags.vaultId, vaultId), eq(schema.tags.name, name)))
    .get();
  if (existing && existing.id !== excludeId) {
    throw new TRPCError({ code: "CONFLICT", message: "Tag name already exists" });
  }
}

function getNextTagSortOrder(vaultId: string) {
  const row = getDatabase()
    .select({ total: count() })
    .from(schema.tags)
    .where(eq(schema.tags.vaultId, vaultId))
    .get();
  return row?.total ?? 0;
}

function getTagOrThrow(id: string) {
  const tag = getDatabase().select().from(schema.tags).where(eq(schema.tags.id, id)).get();
  if (!tag) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Tag not found" });
  }

  return tag;
}

export function createTag(input: TagInput) {
  const vault = getActiveVaultOrThrow(input.vaultId);
  assertUniqueTagName(vault.id, input.name);
  const now = new Date();

  return getDatabase()
    .insert(schema.tags)
    .values({
      id: randomUUID(),
      vaultId: vault.id,
      name: input.name,
      color: normalizeNullableText(input.color),
      sortOrder: getNextTagSortOrder(vault.id),
      createdAt: now,
      updatedAt: now,
    })
    .returning()
    .get();
}

export function updateTag(input: UpdateTagInput) {
  const tag = getTagOrThrow(input.id);
  assertUniqueTagName(tag.vaultId, input.name, tag.id);

  const nextTag = getDatabase()
    .update(schema.tags)
    .set({
      name: input.name,
      color: normalizeNullableText(input.color),
      updatedAt: new Date(),
    })
    .where(eq(schema.tags.id, tag.id))
    .returning()
    .get();

  if (!nextTag) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Tag not found" });
  }

  return nextTag;
}

export function deleteTagAndCleanViews(tagId: string) {
  const tag = getTagOrThrow(tagId);
  const db = getDatabase();
  const now = new Date();

  const affectedAssetCount =
    db
      .select({ total: count() })
      .from(schema.assetTags)
      .where(eq(schema.assetTags.tagId, tag.id))
      .get()?.total ?? 0;

  const viewRows = db
    .select()
    .from(schema.savedViews)
    .where(eq(schema.savedViews.vaultId, tag.vaultId))
    .all();
  const updatedViews: Array<{ id: string; name: string }> = [];
  const deletedViews: Array<{ id: string; name: string }> = [];

  db.transaction((tx) => {
    for (const view of viewRows) {
      const filters = parseSavedViewFilters(view.filterJson);
      if (!filters.tagIds.includes(tag.id)) {
        continue;
      }

      const nextFilters = {
        ...filters,
        tagIds: filters.tagIds.filter((id) => id !== tag.id),
      };
      const hasOnlyDeletedTag =
        filters.tagIds.length === 1 &&
        filters.types.length === 0 &&
        filters.sources.length === 0 &&
        filters.time === "any" &&
        filters.status === "any";

      if (hasOnlyDeletedTag) {
        tx.delete(schema.savedViews).where(eq(schema.savedViews.id, view.id)).run();
        deletedViews.push({ id: view.id, name: view.name });
      } else {
        tx.update(schema.savedViews)
          .set({ filterJson: serializeSavedViewFilters(nextFilters), updatedAt: now })
          .where(eq(schema.savedViews.id, view.id))
          .run();
        updatedViews.push({ id: view.id, name: view.name });
      }
    }

    tx.delete(schema.tags).where(eq(schema.tags.id, tag.id)).run();
  });

  return {
    id: tag.id,
    name: tag.name,
    affectedAssetCount,
    updatedViews,
    deletedViews,
  };
}

export function reorderTags(input: ReorderTagsInput) {
  const vault = getActiveVaultOrThrow(input.vaultId);
  const currentRows = getDatabase()
    .select({ id: schema.tags.id })
    .from(schema.tags)
    .where(eq(schema.tags.vaultId, vault.id))
    .orderBy(asc(schema.tags.sortOrder), asc(schema.tags.name))
    .all();
  const knownIds = new Set(currentRows.map((row) => row.id));
  const requestedIds = uniqueStrings(input.orderedIds).filter((id) => knownIds.has(id));
  const remainingIds = currentRows.map((row) => row.id).filter((id) => !requestedIds.includes(id));
  const nextIds = [...requestedIds, ...remainingIds];

  for (const [sortOrder, id] of nextIds.entries()) {
    getDatabase()
      .update(schema.tags)
      .set({ sortOrder, updatedAt: new Date() })
      .where(eq(schema.tags.id, id))
      .run();
  }

  return { orderedIds: nextIds };
}

export function addTagToAsset(input: AddTagToAssetInput) {
  const row = getAssetRows(undefined, input.assetId)[0];
  if (!row) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Asset not found" });
  }

  const now = new Date();
  const tag = upsertTag(row.asset.vaultId, input.name, now);
  getDatabase()
    .insert(schema.assetTags)
    .values({ assetId: input.assetId, tagId: tag.id, createdAt: now })
    .onConflictDoNothing()
    .run();

  return tag;
}

export function removeTagFromAsset(input: RemoveTagFromAssetInput) {
  getDatabase()
    .delete(schema.assetTags)
    .where(
      and(eq(schema.assetTags.assetId, input.assetId), eq(schema.assetTags.tagId, input.tagId)),
    )
    .run();

  return { assetId: input.assetId, tagId: input.tagId };
}
