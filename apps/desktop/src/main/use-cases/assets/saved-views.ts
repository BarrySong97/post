/**
 * @purpose Implement asset saved view management use cases.
 * @role    Application-layer workflows for saved view validation, persistence, and ordering.
 * @deps    Shared saved view contracts, SQLite schema, saved view filter codecs.
 * @gotcha  Saved view tag references must be validated against the owning vault before persistence.
 */

import { randomUUID } from "node:crypto";

import { TRPCError } from "@trpc/server";
import { and, asc, count, desc, eq, inArray } from "drizzle-orm";
import type { z } from "zod";

import { schema } from "@post/db";
import {
  DEFAULT_SAVED_VIEW_ICON,
  type SavedViewFiltersInput,
  type savedViewInputSchema,
  type updateSavedViewInputSchema,
  type reorderSavedViewsInputSchema,
} from "@shared/contracts/assets/saved-views/saved-view.contract";
import { getDatabase } from "../../db";
import {
  serializeSavedViewFilters,
  serializeSavedViewSort,
  type SavedViewFilters,
} from "../../repositories/assets-repository";
import { getRequestedOrActiveVault } from "../../repositories/vaults-repository";

type SavedViewInput = z.infer<typeof savedViewInputSchema>;
type UpdateSavedViewInput = z.infer<typeof updateSavedViewInputSchema>;
type ReorderSavedViewsInput = z.infer<typeof reorderSavedViewsInputSchema>;

function getActiveVaultOrThrow(vaultId?: string) {
  const vault = getRequestedOrActiveVault(vaultId);
  if (!vault) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "No active vault selected" });
  }

  return vault;
}

function normalizeSavedViewIcon(value: string | null | undefined) {
  const trimmed = value?.trim();
  return trimmed || DEFAULT_SAVED_VIEW_ICON;
}

function uniqueStrings<T extends string>(values: readonly T[]) {
  return Array.from(new Set(values));
}

function normalizeSavedViewFilters(
  vaultId: string,
  filters: SavedViewFiltersInput,
): SavedViewFilters {
  const tagIds = uniqueStrings(filters.tagIds);
  if (tagIds.length > 0) {
    const rows = getDatabase()
      .select({ id: schema.tags.id })
      .from(schema.tags)
      .where(and(eq(schema.tags.vaultId, vaultId), inArray(schema.tags.id, tagIds)))
      .all();
    const knownIds = new Set(rows.map((row) => row.id));
    const missingIds = tagIds.filter((tagId) => !knownIds.has(tagId));
    if (missingIds.length > 0) {
      throw new TRPCError({ code: "BAD_REQUEST", message: "Saved view references unknown tags" });
    }
  }

  return {
    match: filters.match,
    tagIds,
    types: uniqueStrings(filters.types),
    sources: uniqueStrings(filters.sources),
    time: filters.time,
    status: filters.status,
  };
}

function assertUniqueSavedViewName(vaultId: string, name: string, excludeId?: string) {
  const existing = getDatabase()
    .select({ id: schema.savedViews.id })
    .from(schema.savedViews)
    .where(and(eq(schema.savedViews.vaultId, vaultId), eq(schema.savedViews.name, name)))
    .get();
  if (existing && existing.id !== excludeId) {
    throw new TRPCError({ code: "CONFLICT", message: "View name already exists" });
  }
}

function getNextSavedViewSortOrder(vaultId: string) {
  const row = getDatabase()
    .select({ total: count() })
    .from(schema.savedViews)
    .where(eq(schema.savedViews.vaultId, vaultId))
    .get();
  return row?.total ?? 0;
}

function getSavedViewOrThrow(id: string) {
  const view = getDatabase()
    .select()
    .from(schema.savedViews)
    .where(eq(schema.savedViews.id, id))
    .get();
  if (!view) {
    throw new TRPCError({ code: "NOT_FOUND", message: "View not found" });
  }

  return view;
}

export function createSavedView(input: SavedViewInput) {
  const vault = getActiveVaultOrThrow(input.vaultId);
  assertUniqueSavedViewName(vault.id, input.name);
  const filters = normalizeSavedViewFilters(vault.id, input.filters);
  const now = new Date();

  return getDatabase()
    .insert(schema.savedViews)
    .values({
      id: randomUUID(),
      vaultId: vault.id,
      name: input.name,
      icon: normalizeSavedViewIcon(input.icon),
      filterJson: serializeSavedViewFilters(filters),
      sortJson: serializeSavedViewSort(input.sort),
      sortOrder: getNextSavedViewSortOrder(vault.id),
      createdAt: now,
      updatedAt: now,
    })
    .returning()
    .get();
}

export function updateSavedView(input: UpdateSavedViewInput) {
  const view = getSavedViewOrThrow(input.id);
  assertUniqueSavedViewName(view.vaultId, input.name, view.id);
  const filters = normalizeSavedViewFilters(view.vaultId, input.filters);

  const nextView = getDatabase()
    .update(schema.savedViews)
    .set({
      name: input.name,
      icon: normalizeSavedViewIcon(input.icon),
      filterJson: serializeSavedViewFilters(filters),
      sortJson: serializeSavedViewSort(input.sort),
      updatedAt: new Date(),
    })
    .where(eq(schema.savedViews.id, view.id))
    .returning()
    .get();

  if (!nextView) {
    throw new TRPCError({ code: "NOT_FOUND", message: "View not found" });
  }

  return nextView;
}

export function deleteSavedView(id: string) {
  const view = getDatabase()
    .delete(schema.savedViews)
    .where(eq(schema.savedViews.id, id))
    .returning({ id: schema.savedViews.id })
    .get();

  if (!view) {
    throw new TRPCError({ code: "NOT_FOUND", message: "View not found" });
  }

  return view;
}

export function reorderSavedViews(input: ReorderSavedViewsInput) {
  const vault = getActiveVaultOrThrow(input.vaultId);
  const currentRows = getDatabase()
    .select({ id: schema.savedViews.id })
    .from(schema.savedViews)
    .where(eq(schema.savedViews.vaultId, vault.id))
    .orderBy(asc(schema.savedViews.sortOrder), desc(schema.savedViews.updatedAt))
    .all();
  const knownIds = new Set(currentRows.map((row) => row.id));
  const requestedIds = uniqueStrings(input.orderedIds).filter((id) => knownIds.has(id));
  const remainingIds = currentRows.map((row) => row.id).filter((id) => !requestedIds.includes(id));
  const nextIds = [...requestedIds, ...remainingIds];

  for (const [sortOrder, id] of nextIds.entries()) {
    getDatabase()
      .update(schema.savedViews)
      .set({ sortOrder, updatedAt: new Date() })
      .where(eq(schema.savedViews.id, id))
      .run();
  }

  return { orderedIds: nextIds };
}
