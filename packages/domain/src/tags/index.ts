/**
 * @purpose Implement reusable tag and asset-tag organization workflows.
 * @role    Domain service for tag CRUD, ordering, and asset binding operations.
 * @deps    Domain context/errors, assets/vault helpers, @post/db schema, drizzle query helpers.
 * @gotcha  Deleting a tag must clean saved views that reference it.
 */

import { and, asc, count, eq } from "drizzle-orm";

import { schema, type TagRecord } from "@post/db";

import { getAssetOrThrow } from "../assets/index";
import type { DomainContext } from "../context";
import { DomainError } from "../errors";
import { parseSavedViewFilters, serializeSavedViewFilters } from "../saved-views/filters";
import { normalizeOptionalText, uniqueStrings } from "../utils";
import { getActiveVaultOrThrow } from "../vaults/index";

export type TagInput = {
  vaultId?: string;
  name: string;
  color?: string | null;
};

export type UpdateTagInput = TagInput & {
  id: string;
};

export type ReorderTagsInput = {
  vaultId?: string;
  orderedIds: string[];
};

export function listTags(ctx: DomainContext, vaultId?: string): TagRecord[] {
  const vault = getActiveVaultOrThrow(ctx, vaultId);
  return ctx.db
    .select()
    .from(schema.tags)
    .where(eq(schema.tags.vaultId, vault.id))
    .orderBy(asc(schema.tags.sortOrder), asc(schema.tags.name))
    .all();
}

export function getTagOrThrow(ctx: DomainContext, tagId: string): TagRecord {
  const tag = ctx.db.select().from(schema.tags).where(eq(schema.tags.id, tagId)).get();
  if (!tag) {
    throw new DomainError("TAG_NOT_FOUND", "Tag not found", { status: "NOT_FOUND" });
  }

  return tag;
}

function assertUniqueTagName(
  ctx: DomainContext,
  vaultId: string,
  name: string,
  excludeId?: string,
): void {
  const existing = ctx.db
    .select({ id: schema.tags.id })
    .from(schema.tags)
    .where(and(eq(schema.tags.vaultId, vaultId), eq(schema.tags.name, name)))
    .get();
  if (existing && existing.id !== excludeId) {
    throw new DomainError("TAG_NAME_EXISTS", "Tag name already exists", { status: "CONFLICT" });
  }
}

function getNextTagSortOrder(ctx: DomainContext, vaultId: string): number {
  const row = ctx.db
    .select({ total: count() })
    .from(schema.tags)
    .where(eq(schema.tags.vaultId, vaultId))
    .get();
  return row?.total ?? 0;
}

export function upsertTag(ctx: DomainContext, vaultId: string, name: string, now: Date): TagRecord {
  const existing = ctx.db
    .select()
    .from(schema.tags)
    .where(and(eq(schema.tags.vaultId, vaultId), eq(schema.tags.name, name)))
    .get();
  if (existing) {
    return existing;
  }

  return ctx.db
    .insert(schema.tags)
    .values({
      id: ctx.id(),
      vaultId,
      name,
      sortOrder: getNextTagSortOrder(ctx, vaultId),
      createdAt: now,
      updatedAt: now,
    })
    .returning()
    .get();
}

export function createTag(ctx: DomainContext, input: TagInput): TagRecord {
  const vault = getActiveVaultOrThrow(ctx, input.vaultId);
  assertUniqueTagName(ctx, vault.id, input.name);
  const now = ctx.now();

  return ctx.db
    .insert(schema.tags)
    .values({
      id: ctx.id(),
      vaultId: vault.id,
      name: input.name,
      color: normalizeOptionalText(input.color),
      sortOrder: getNextTagSortOrder(ctx, vault.id),
      createdAt: now,
      updatedAt: now,
    })
    .returning()
    .get();
}

export function updateTag(ctx: DomainContext, input: UpdateTagInput): TagRecord {
  const tag = getTagOrThrow(ctx, input.id);
  assertUniqueTagName(ctx, tag.vaultId, input.name, tag.id);

  const nextTag = ctx.db
    .update(schema.tags)
    .set({
      name: input.name,
      color: normalizeOptionalText(input.color),
      updatedAt: ctx.now(),
    })
    .where(eq(schema.tags.id, tag.id))
    .returning()
    .get();

  if (!nextTag) {
    throw new DomainError("TAG_NOT_FOUND", "Tag not found", { status: "NOT_FOUND" });
  }

  return nextTag;
}

export function deleteTagAndCleanViews(ctx: DomainContext, tagId: string) {
  const tag = getTagOrThrow(ctx, tagId);
  const now = ctx.now();

  const affectedAssetCount =
    ctx.db
      .select({ total: count() })
      .from(schema.assetTags)
      .where(eq(schema.assetTags.tagId, tag.id))
      .get()?.total ?? 0;

  const viewRows = ctx.db
    .select()
    .from(schema.savedViews)
    .where(eq(schema.savedViews.vaultId, tag.vaultId))
    .all();
  const updatedViews: Array<{ id: string; name: string }> = [];
  const deletedViews: Array<{ id: string; name: string }> = [];

  ctx.db.transaction((tx) => {
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

export function reorderTags(ctx: DomainContext, input: ReorderTagsInput) {
  const vault = getActiveVaultOrThrow(ctx, input.vaultId);
  const currentRows = ctx.db
    .select({ id: schema.tags.id })
    .from(schema.tags)
    .where(eq(schema.tags.vaultId, vault.id))
    .orderBy(asc(schema.tags.sortOrder), asc(schema.tags.name))
    .all();
  const knownIds = new Set(currentRows.map((row) => row.id));
  const requestedIds = uniqueStrings(input.orderedIds).filter((id) => knownIds.has(id));
  const remainingIds = currentRows.map((row) => row.id).filter((id) => !requestedIds.includes(id));
  const nextIds = [...requestedIds, ...remainingIds];
  const now = ctx.now();

  for (const [sortOrder, id] of nextIds.entries()) {
    ctx.db
      .update(schema.tags)
      .set({ sortOrder, updatedAt: now })
      .where(eq(schema.tags.id, id))
      .run();
  }

  return { orderedIds: nextIds };
}

export function addTagToAsset(ctx: DomainContext, input: { assetId: string; name: string }) {
  const row = getAssetOrThrow(ctx, input.assetId);
  const now = ctx.now();
  const tag = upsertTag(ctx, row.asset.vaultId, input.name, now);
  ctx.db
    .insert(schema.assetTags)
    .values({ assetId: input.assetId, tagId: tag.id, createdAt: now })
    .onConflictDoNothing()
    .run();

  return tag;
}

export function removeTagFromAsset(ctx: DomainContext, input: { assetId: string; tagId: string }) {
  ctx.db
    .delete(schema.assetTags)
    .where(
      and(eq(schema.assetTags.assetId, input.assetId), eq(schema.assetTags.tagId, input.tagId)),
    )
    .run();

  return { assetId: input.assetId, tagId: input.tagId };
}
