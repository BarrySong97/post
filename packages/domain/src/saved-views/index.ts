/**
 * @purpose Implement reusable saved-view organization workflows.
 * @role    Domain service for saved-view CRUD and ordering operations.
 * @deps    Domain context/errors, filters codec, @post/db schema, drizzle query helpers.
 * @gotcha  Saved-view tag references must belong to the owning vault.
 */

import { and, asc, count, desc, eq, inArray } from "drizzle-orm";

import { schema, type SavedViewRecord } from "@post/db";

import type { DomainContext } from "../context";
import { DomainError } from "../errors";
import { uniqueStrings } from "../utils";
import { getActiveVaultOrThrow } from "../vaults/index";
import {
  type AssetListSort,
  type SavedViewFilters,
  normalizeSavedViewFilters,
  parseSavedViewFilters,
  parseSavedViewSort,
  serializeSavedViewFilters,
  serializeSavedViewSort,
} from "./filters";

export { parseSavedViewFilters, parseSavedViewSort, serializeSavedViewFilters };
export type { AssetListSort, SavedViewFilters };

const DEFAULT_SAVED_VIEW_ICON = "lucide:folder-kanban";

export type SavedViewInput = {
  vaultId?: string;
  name: string;
  icon?: string | null;
  filters?: Partial<SavedViewFilters>;
  sort?: AssetListSort;
};

export type UpdateSavedViewInput = SavedViewInput & {
  id: string;
};

export type ReorderSavedViewsInput = {
  vaultId?: string;
  orderedIds: string[];
};

export function listSavedViews(ctx: DomainContext, vaultId?: string): SavedViewRecord[] {
  const vault = getActiveVaultOrThrow(ctx, vaultId);
  return ctx.db
    .select()
    .from(schema.savedViews)
    .where(eq(schema.savedViews.vaultId, vault.id))
    .orderBy(asc(schema.savedViews.sortOrder), desc(schema.savedViews.updatedAt))
    .all();
}

export function getSavedViewOrThrow(ctx: DomainContext, id: string): SavedViewRecord {
  const view = ctx.db.select().from(schema.savedViews).where(eq(schema.savedViews.id, id)).get();
  if (!view) {
    throw new DomainError("VIEW_NOT_FOUND", "View not found", { status: "NOT_FOUND" });
  }

  return view;
}

function normalizeSavedViewIcon(value: string | null | undefined): string {
  const trimmed = value?.trim();
  return trimmed || DEFAULT_SAVED_VIEW_ICON;
}

function normalizeAndValidateSavedViewFilters(
  ctx: DomainContext,
  vaultId: string,
  filters: Partial<SavedViewFilters> | undefined,
): SavedViewFilters {
  const normalized = normalizeSavedViewFilters(filters);
  const tagIds = uniqueStrings(normalized.tagIds);
  if (tagIds.length > 0) {
    const rows = ctx.db
      .select({ id: schema.tags.id })
      .from(schema.tags)
      .where(and(eq(schema.tags.vaultId, vaultId), inArray(schema.tags.id, tagIds)))
      .all();
    const knownIds = new Set(rows.map((row) => row.id));
    const missingIds = tagIds.filter((tagId) => !knownIds.has(tagId));
    if (missingIds.length > 0) {
      throw new DomainError("VIEW_UNKNOWN_TAG", "Saved view references unknown tags", {
        details: { missingIds },
      });
    }
  }

  return { ...normalized, tagIds };
}

function assertUniqueSavedViewName(
  ctx: DomainContext,
  vaultId: string,
  name: string,
  excludeId?: string,
): void {
  const existing = ctx.db
    .select({ id: schema.savedViews.id })
    .from(schema.savedViews)
    .where(and(eq(schema.savedViews.vaultId, vaultId), eq(schema.savedViews.name, name)))
    .get();
  if (existing && existing.id !== excludeId) {
    throw new DomainError("VIEW_NAME_EXISTS", "View name already exists", { status: "CONFLICT" });
  }
}

function getNextSavedViewSortOrder(ctx: DomainContext, vaultId: string): number {
  const row = ctx.db
    .select({ total: count() })
    .from(schema.savedViews)
    .where(eq(schema.savedViews.vaultId, vaultId))
    .get();
  return row?.total ?? 0;
}

export function createSavedView(ctx: DomainContext, input: SavedViewInput): SavedViewRecord {
  const vault = getActiveVaultOrThrow(ctx, input.vaultId);
  assertUniqueSavedViewName(ctx, vault.id, input.name);
  const filters = normalizeAndValidateSavedViewFilters(ctx, vault.id, input.filters);
  const now = ctx.now();

  return ctx.db
    .insert(schema.savedViews)
    .values({
      id: ctx.id(),
      vaultId: vault.id,
      name: input.name,
      icon: normalizeSavedViewIcon(input.icon),
      filterJson: serializeSavedViewFilters(filters),
      sortJson: serializeSavedViewSort(input.sort ?? "added_desc"),
      sortOrder: getNextSavedViewSortOrder(ctx, vault.id),
      createdAt: now,
      updatedAt: now,
    })
    .returning()
    .get();
}

export function updateSavedView(ctx: DomainContext, input: UpdateSavedViewInput): SavedViewRecord {
  const view = getSavedViewOrThrow(ctx, input.id);
  assertUniqueSavedViewName(ctx, view.vaultId, input.name, view.id);
  const filters = normalizeAndValidateSavedViewFilters(ctx, view.vaultId, input.filters);

  const nextView = ctx.db
    .update(schema.savedViews)
    .set({
      name: input.name,
      icon: normalizeSavedViewIcon(input.icon),
      filterJson: serializeSavedViewFilters(filters),
      sortJson: serializeSavedViewSort(input.sort ?? parseSavedViewSort(view.sortJson)),
      updatedAt: ctx.now(),
    })
    .where(eq(schema.savedViews.id, view.id))
    .returning()
    .get();

  if (!nextView) {
    throw new DomainError("VIEW_NOT_FOUND", "View not found", { status: "NOT_FOUND" });
  }

  return nextView;
}

export function deleteSavedView(ctx: DomainContext, id: string): { id: string } {
  const view = ctx.db
    .delete(schema.savedViews)
    .where(eq(schema.savedViews.id, id))
    .returning({ id: schema.savedViews.id })
    .get();

  if (!view) {
    throw new DomainError("VIEW_NOT_FOUND", "View not found", { status: "NOT_FOUND" });
  }

  return view;
}

export function reorderSavedViews(ctx: DomainContext, input: ReorderSavedViewsInput) {
  const vault = getActiveVaultOrThrow(ctx, input.vaultId);
  const currentRows = ctx.db
    .select({ id: schema.savedViews.id })
    .from(schema.savedViews)
    .where(eq(schema.savedViews.vaultId, vault.id))
    .orderBy(asc(schema.savedViews.sortOrder), desc(schema.savedViews.updatedAt))
    .all();
  const knownIds = new Set(currentRows.map((row) => row.id));
  const requestedIds = uniqueStrings(input.orderedIds).filter((id) => knownIds.has(id));
  const remainingIds = currentRows.map((row) => row.id).filter((id) => !requestedIds.includes(id));
  const nextIds = [...requestedIds, ...remainingIds];
  const now = ctx.now();

  for (const [sortOrder, id] of nextIds.entries()) {
    ctx.db
      .update(schema.savedViews)
      .set({ sortOrder, updatedAt: now })
      .where(eq(schema.savedViews.id, id))
      .run();
  }

  return { orderedIds: nextIds };
}
