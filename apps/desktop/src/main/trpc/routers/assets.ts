import { randomUUID } from "node:crypto";
import path from "node:path";

import { clipboard, shell } from "electron";
import { TRPCError } from "@trpc/server";
import { and, asc, count, desc, eq, inArray, isNotNull } from "drizzle-orm";
import { z } from "zod";

import { schema } from "@post/db";
import { getDatabase } from "../../db";
import { chooseVaultFolder } from "../../indexer";
import {
  attachRelations,
  getAssetPage,
  getAssetRows,
  getAssetSummary,
  getSavedViews,
  getSidebarTags,
  parseSavedViewFilters,
  serializeSavedViewFilters,
  serializeSavedViewSort,
  type SavedViewFilters,
} from "../../repositories/assets-repository";
import {
  getOrCreateVaultId,
  getRequestedOrActiveVault,
  getVaultOrThrow,
  listVaults,
} from "../../repositories/vaults-repository";
import { upsertTag } from "../../repositories/tags-repository";
import { runThumbnailTask } from "../../thumbnail-tasks";
import { openVaultInEditor } from "../../services/editor-launch-service";
import { runIndexerTask } from "../../services/indexer-task-service";
import { readMarkdownContent } from "../../services/markdown-preview-service";
import { startThumbnailPrewarm } from "../../services/thumbnail-service";
import { resolveVaultFilePath } from "../../services/vault-file-service";
import { publicProcedure, router } from "../trpc";

const vaultInput = z.object({
  vaultId: z.string().min(1).optional(),
});

const importPathInput = z.object({
  rootPath: z.string().min(1),
  name: z.string().trim().min(1).optional(),
});

const ASSET_LIST_DEFAULT_LIMIT = 80;
const ASSET_LIST_MAX_LIMIT = 160;
const TAG_NAME_MAX_LENGTH = 60;
const SAVED_VIEW_NAME_MAX_LENGTH = 80;

const assetListInput = vaultInput
  .extend({
    tagId: z.string().optional(),
    tagIds: z.array(z.string().min(1)).optional(),
    tagMatch: z.enum(["and", "or"]).optional(),
    statusFilter: z.enum(["inbox", "organized", "draft", "published", "archived"]).optional(),
    untagged: z.boolean().optional(),
    typeFilters: z.array(z.enum(["markdown", "image", "video", "link", "file"])).optional(),
    timeFilter: z.enum(["any", "today", "week", "m30"]).optional(),
    sourceTypes: z.array(z.enum(["vault", "external_file", "url"])).optional(),
    sort: z.enum(["updated_desc", "updated_asc", "created_desc", "created_asc"]).optional(),
    limit: z.number().int().min(1).max(ASSET_LIST_MAX_LIMIT).optional(),
    cursor: z.object({
      valueMs: z.number(),
      id: z.string().min(1),
    }).optional(),
  })
  .optional();

const assetListSortInput = z.enum(["updated_desc", "updated_asc", "created_desc", "created_asc"]);
const savedViewFiltersInput = z.object({
  match: z.enum(["and", "or"]).default("and"),
  tagIds: z.array(z.string().min(1)).default([]),
  types: z.array(z.enum(["markdown", "image", "video", "link", "file"])).default([]),
  sources: z.array(z.enum(["vault", "external_file", "url"])).default([]),
  time: z.enum(["any", "today", "week", "m30"]).default("any"),
  status: z.enum(["any", "inbox", "organized", "draft", "published", "archived"]).default("any"),
});

const savedViewInput = z.object({
  vaultId: z.string().min(1).optional(),
  name: z.string().trim().min(1).max(SAVED_VIEW_NAME_MAX_LENGTH),
  icon: z.string().trim().max(6).optional(),
  filters: savedViewFiltersInput,
  sort: assetListSortInput.default("updated_desc"),
});

const tagInput = z.object({
  vaultId: z.string().min(1).optional(),
  name: z.string().trim().min(1).max(TAG_NAME_MAX_LENGTH),
  color: z.string().trim().max(80).optional().nullable(),
});

function getConflictCount(vaultId: string) {
  return getDatabase()
    .select()
    .from(schema.syncEvents)
    .where(and(eq(schema.syncEvents.vaultId, vaultId), eq(schema.syncEvents.eventType, "conflict")))
    .all().length;
}

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

function normalizeSavedViewIcon(value: string | null | undefined) {
  const trimmed = value?.trim();
  return trimmed ? trimmed.slice(0, 6) : "#";
}

function uniqueStrings<T extends string>(values: readonly T[]) {
  return Array.from(new Set(values));
}

function normalizeSavedViewFilters(vaultId: string, filters: z.infer<typeof savedViewFiltersInput>): SavedViewFilters {
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

function getNextTagSortOrder(vaultId: string) {
  const row = getDatabase()
    .select({ total: count() })
    .from(schema.tags)
    .where(eq(schema.tags.vaultId, vaultId))
    .get();
  return row?.total ?? 0;
}

function getNextSavedViewSortOrder(vaultId: string) {
  const row = getDatabase()
    .select({ total: count() })
    .from(schema.savedViews)
    .where(eq(schema.savedViews.vaultId, vaultId))
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

function getSavedViewOrThrow(id: string) {
  const view = getDatabase().select().from(schema.savedViews).where(eq(schema.savedViews.id, id)).get();
  if (!view) {
    throw new TRPCError({ code: "NOT_FOUND", message: "View not found" });
  }

  return view;
}

function reorderTags(vaultId: string, orderedIds: readonly string[]) {
  const currentRows = getDatabase()
    .select({ id: schema.tags.id })
    .from(schema.tags)
    .where(eq(schema.tags.vaultId, vaultId))
    .orderBy(asc(schema.tags.sortOrder), asc(schema.tags.name))
    .all();
  const knownIds = new Set(currentRows.map((row) => row.id));
  const requestedIds = uniqueStrings(orderedIds).filter((id) => knownIds.has(id));
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

function reorderSavedViews(vaultId: string, orderedIds: readonly string[]) {
  const currentRows = getDatabase()
    .select({ id: schema.savedViews.id })
    .from(schema.savedViews)
    .where(eq(schema.savedViews.vaultId, vaultId))
    .orderBy(asc(schema.savedViews.sortOrder), desc(schema.savedViews.updatedAt))
    .all();
  const knownIds = new Set(currentRows.map((row) => row.id));
  const requestedIds = uniqueStrings(orderedIds).filter((id) => knownIds.has(id));
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

function deleteTagAndCleanViews(tagId: string) {
  const tag = getTagOrThrow(tagId);
  const db = getDatabase();
  const now = new Date();

  const affectedAssetCount = db
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
        filters.tagIds.length === 1
        && filters.types.length === 0
        && filters.sources.length === 0
        && filters.time === "any"
        && filters.status === "any";

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

export const assetsRouter = router({
  vaults: publicProcedure.query(() => {
    return listVaults();
  }),

  importPath: publicProcedure.input(importPathInput).mutation(async ({ input }) => {
    const vaultId = getOrCreateVaultId(input.rootPath, input.name);
    const result = await runIndexerTask("scan", "indexing", {
      vaultId,
      rootPath: input.rootPath,
      vaultName: input.name ?? (path.basename(input.rootPath) || "Vault"),
      title: "Indexing folder",
    });

    if (input.name) {
      getDatabase()
        .update(schema.vaults)
        .set({ name: input.name, updatedAt: new Date() })
        .where(eq(schema.vaults.id, vaultId))
        .run();
    }

    const vault = getVaultOrThrow(vaultId);
    startThumbnailPrewarm(vault, { force: true });

    return {
      vaultId,
      rootPath: input.rootPath,
      events: result.events,
    };
  }),

  selectFolderAndScan: publicProcedure.mutation(async () => {
    const rootPath = await chooseVaultFolder();
    if (!rootPath) {
      return { canceled: true as const };
    }

    const vaultId = getOrCreateVaultId(rootPath);
    const vault = getVaultOrThrow(vaultId);
    const result = await runIndexerTask("scan", "indexing", {
      vaultId,
      rootPath,
      vaultName: vault.name,
      title: "Indexing folder",
    });
    startThumbnailPrewarm(vault, { force: true });

    return {
      canceled: false as const,
      vaultId,
      rootPath,
      events: result.events,
    };
  }),

  activateVault: publicProcedure
    .input(z.object({ vaultId: z.string().min(1) }))
    .mutation(({ input }) => {
      const vault = getVaultOrThrow(input.vaultId);
      const now = new Date();

      getDatabase()
        .update(schema.vaults)
        .set({ lastOpenedAt: now, updatedAt: now })
        .where(eq(schema.vaults.id, vault.id))
        .run();

      return {
        vaultId: vault.id,
        rootPath: vault.rootPath,
      };
    }),

  reconcile: publicProcedure
    .input(z.object({ vaultId: z.string().min(1) }))
    .mutation(async ({ input }) => {
      const vault = getVaultOrThrow(input.vaultId);
      const result = await runIndexerTask("reconcile", "reconcile", {
        vaultId: vault.id,
        rootPath: vault.rootPath,
        vaultName: vault.name,
        title: "Reindexing folder",
      });
      startThumbnailPrewarm(vault, { force: true });

      return {
        vaultId: vault.id,
        rootPath: vault.rootPath,
        events: result.events,
      };
    }),

  sidebarMeta: publicProcedure.input(vaultInput.optional()).query(({ input }) => {
    const vault = getRequestedOrActiveVault(input?.vaultId);
    if (!vault) {
      return {
        vault: null,
        tags: [],
        views: [],
        summary: getAssetSummary(),
        sourceOptions: [],
        conflictCount: 0,
      };
    }

    startThumbnailPrewarm(vault);
    const summary = getAssetSummary(vault.id);

    return {
      vault,
      tags: getSidebarTags(vault.id),
      views: getSavedViews(vault.id),
      summary,
      sourceOptions: summary.total > 0 ? ["资产库"] : [],
      conflictCount: getConflictCount(vault.id),
    };
  }),

  list: publicProcedure
    .input(assetListInput)
    .query(({ input }) => {
      const vault = getRequestedOrActiveVault(input?.vaultId);
      if (!vault) {
        return {
          items: [],
          total: 0,
          nextCursor: null,
        };
      }

      startThumbnailPrewarm(vault);
      return getAssetPage({
        vaultId: vault.id,
        tagIds: input?.tagIds ?? (input?.tagId ? [input.tagId] : undefined),
        tagMatch: input?.tagMatch,
        statusFilter: input?.statusFilter,
        untagged: input?.untagged,
        typeFilters: input?.typeFilters,
        timeFilter: input?.timeFilter,
        sourceTypes: input?.sourceTypes,
        sort: input?.sort,
        cursor: input?.cursor,
        limit: input?.limit ?? ASSET_LIST_DEFAULT_LIMIT,
      });
    }),

  byId: publicProcedure.input(z.object({ id: z.string().min(1) })).query(({ input }) => {
    const rows = getAssetRows(undefined, input.id);
    const asset = attachRelations(rows)[0];

    if (!asset) {
      throw new TRPCError({ code: "NOT_FOUND", message: "Asset not found" });
    }

    return asset;
  }),

  graphData: publicProcedure
    .input(vaultInput.optional())
    .query(({ input }) => {
      const vault = getRequestedOrActiveVault(input?.vaultId);
      if (!vault) return { nodes: [], edges: [] };

      const db = getDatabase();

      const assetRows = db
        .select({
          id: schema.assets.id,
          kind: schema.assets.kind,
          status: schema.assets.status,
          title: schema.assets.title,
          fileName: schema.assetFiles.fileName,
          markdownTitle: schema.markdownCache.title,
        })
        .from(schema.assets)
        .innerJoin(schema.assetFiles, eq(schema.assetFiles.assetId, schema.assets.id))
        .leftJoin(schema.markdownCache, eq(schema.markdownCache.assetId, schema.assets.id))
        .where(eq(schema.assets.vaultId, vault.id))
        .all();

      const nodes = assetRows.map((r) => ({
        id: r.id,
        title: r.markdownTitle ?? r.title ?? r.fileName,
        kind: r.kind,
        status: r.status,
      }));

      const linkRows = db
        .select({
          sourceAssetId: schema.assetLinks.sourceAssetId,
          targetAssetId: schema.assetLinks.targetAssetId,
          relationType: schema.assetLinks.relationType,
        })
        .from(schema.assetLinks)
        .where(
          and(
            eq(schema.assetLinks.vaultId, vault.id),
            eq(schema.assetLinks.resolvedStatus, "resolved"),
            isNotNull(schema.assetLinks.targetAssetId),
          ),
        )
        .all();

      const edges = linkRows
        .filter((l) => l.targetAssetId != null)
        .map((l) => ({
          source: l.sourceAssetId,
          target: l.targetAssetId!,
          relationType: l.relationType,
        }));

      return { nodes, edges };
    }),

  markdownContent: publicProcedure.input(z.object({ id: z.string().min(1) })).query(({ input }) =>
    readMarkdownContent(input.id),
  ),

  openFile: publicProcedure.input(z.object({ id: z.string().min(1) })).mutation(async ({ input }) => {
    const row = getAssetRows(undefined, input.id)[0];
    if (!row) {
      throw new TRPCError({ code: "NOT_FOUND", message: "Asset not found" });
    }

    const absolutePath = resolveVaultFilePath(row.vault.rootPath, row.file.relativePath);
    const error = await shell.openPath(absolutePath);
    if (error) {
      throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: error });
    }

    return { absolutePath };
  }),

  openVaultLocation: publicProcedure
    .input(z.object({ target: z.enum(["vscode", "cursor", "zed", "finder"]) }))
    .mutation(async ({ input }) => {
      const vault = getRequestedOrActiveVault(undefined);
      if (!vault) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "No active vault selected" });
      }

      if (input.target === "finder") {
        const error = await shell.openPath(vault.rootPath);
        if (error) {
          throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: error });
        }

        return { rootPath: vault.rootPath, target: input.target };
      }

      await openVaultInEditor(input.target, vault.rootPath);

      return { rootPath: vault.rootPath, target: input.target };
    }),

  openAssetInEditor: publicProcedure
    .input(z.object({ id: z.string().min(1), target: z.enum(["vscode", "cursor", "zed"]) }))
    .mutation(async ({ input }) => {
      const row = getAssetRows(undefined, input.id)[0];
      if (!row) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Asset not found" });
      }

      const filePath = resolveVaultFilePath(row.vault.rootPath, row.file.relativePath);
      // Open vault as workspace root + focus the specific file (e.g. `code /vault /vault/file.md`)
      await openVaultInEditor(input.target, row.vault.rootPath, filePath);

      return { filePath, target: input.target };
    }),

  copyAssetPath: publicProcedure
    .input(z.object({ id: z.string().min(1) }))
    .mutation(({ input }) => {
      const row = getAssetRows(undefined, input.id)[0];
      if (!row) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Asset not found" });
      }
      const filePath = resolveVaultFilePath(row.vault.rootPath, row.file.relativePath);
      clipboard.writeText(filePath);
      return { path: filePath };
    }),

  ensureThumbnails: publicProcedure
    .input(
      z.object({
        vaultId: z.string().min(1).optional(),
        assetIds: z.array(z.string().min(1)).max(80).default([]),
      }),
    )
    .mutation(async ({ input }) => {
      if (input.assetIds.length === 0) {
        return { events: [], requested: 0 };
      }

      const vault = getRequestedOrActiveVault(input.vaultId);
      if (!vault) {
        return { events: [], requested: 0 };
      }

      const result = await runThumbnailTask(vault, input.assetIds.length > 0
        ? { assetIds: input.assetIds, limit: input.assetIds.length }
        : undefined);

      return {
        events: result.events,
        requested: input.assetIds.length,
      };
    }),

  createTag: publicProcedure.input(tagInput).mutation(({ input }) => {
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
  }),

  updateTag: publicProcedure
    .input(tagInput.extend({ id: z.string().min(1) }))
    .mutation(({ input }) => {
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
    }),

  deleteTag: publicProcedure.input(z.object({ id: z.string().min(1) })).mutation(({ input }) => {
    return deleteTagAndCleanViews(input.id);
  }),

  reorderTags: publicProcedure
    .input(z.object({ vaultId: z.string().min(1).optional(), orderedIds: z.array(z.string().min(1)) }))
    .mutation(({ input }) => {
      const vault = getActiveVaultOrThrow(input.vaultId);
      return reorderTags(vault.id, input.orderedIds);
    }),

  createSavedView: publicProcedure.input(savedViewInput).mutation(({ input }) => {
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
  }),

  updateSavedView: publicProcedure
    .input(savedViewInput.extend({ id: z.string().min(1) }))
    .mutation(({ input }) => {
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
    }),

  deleteSavedView: publicProcedure.input(z.object({ id: z.string().min(1) })).mutation(({ input }) => {
    const view = getDatabase()
      .delete(schema.savedViews)
      .where(eq(schema.savedViews.id, input.id))
      .returning({ id: schema.savedViews.id })
      .get();

    if (!view) {
      throw new TRPCError({ code: "NOT_FOUND", message: "View not found" });
    }

    return view;
  }),

  reorderSavedViews: publicProcedure
    .input(z.object({ vaultId: z.string().min(1).optional(), orderedIds: z.array(z.string().min(1)) }))
    .mutation(({ input }) => {
      const vault = getActiveVaultOrThrow(input.vaultId);
      return reorderSavedViews(vault.id, input.orderedIds);
    }),

  addTag: publicProcedure
    .input(z.object({ assetId: z.string().min(1), name: z.string().trim().min(1).max(60) }))
    .mutation(({ input }) => {
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
    }),

  removeTag: publicProcedure
    .input(z.object({ assetId: z.string().min(1), tagId: z.string().min(1) }))
    .mutation(({ input }) => {
      getDatabase()
        .delete(schema.assetTags)
        .where(and(eq(schema.assetTags.assetId, input.assetId), eq(schema.assetTags.tagId, input.tagId)))
        .run();

      return { assetId: input.assetId, tagId: input.tagId };
    }),

});
