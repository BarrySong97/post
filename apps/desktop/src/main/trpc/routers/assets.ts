/**
 * @purpose Define main-process tRPC procedures for assets domain operations.
 * @role    IPC-facing application API layer called by renderer tRPC hooks.
 * @deps    trpc.ts base procedures, repositories/services, Drizzle schema types.
 * @gotcha  Validate inputs and keep side effects in repositories/services rather than renderer components.
 */

import path from "node:path";
import { performance } from "node:perf_hooks";

import { clipboard, shell } from "electron";
import { TRPCError } from "@trpc/server";
import { and, eq, isNotNull, isNull } from "drizzle-orm";

import {
  addTagToAsset,
  createSavedView,
  createTag,
  deleteSavedView,
  deleteTagAndCleanViews,
  removeTagFromAsset,
  reorderSavedViews,
  reorderTags,
  updateSavedView,
  updateTag,
} from "@post/domain";
import { schema } from "@post/db";
import {
  ASSET_LIST_DEFAULT_LIMIT,
  assetHydrateInputSchema,
  assetListInputSchema,
} from "@shared/contracts/assets/asset-list.contract";
import {
  assetByIdInputSchema,
  assetMarkdownContentInputSchema,
  copyAssetPathInputSchema,
  deleteAssetInputSchema,
  ensureThumbnailsInputSchema,
  importLocalFilesInputSchema,
  openAssetInEditorInputSchema,
  openFileInputSchema,
  openVaultLocationInputSchema,
} from "@shared/contracts/assets/asset-actions.contract";
import {
  addTagToAssetInputSchema,
  deleteTagInputSchema,
  removeTagFromAssetInputSchema,
  reorderTagsInputSchema,
  tagInputSchema,
  updateTagInputSchema,
} from "@shared/contracts/assets/tags/tag.contract";
import {
  deleteSavedViewInputSchema,
  reorderSavedViewsInputSchema,
  savedViewInputSchema,
  updateSavedViewInputSchema,
} from "@shared/contracts/assets/saved-views/saved-view.contract";
import { optionalVaultInputSchema } from "@shared/contracts/common/id.contract";
import {
  activateVaultInputSchema,
  importPathInputSchema,
  reconcileVaultInputSchema,
} from "@shared/contracts/vaults/vault.contract";
import { getDatabase } from "../../db";
import { chooseVaultFolder } from "../../indexer";
import {
  attachRelations,
  getAssetLayoutIndex,
  getAssetPage,
  getAssetRows,
  getAssetRowsByIds,
  getAssetSummary,
  getSavedViews,
  getSidebarTags,
} from "../../repositories/assets-repository";
import {
  getOrCreateVaultId,
  getRequestedOrActiveVault,
  getVaultOrThrow,
  listVaults,
} from "../../repositories/vaults-repository";
import { runThumbnailTask } from "../../thumbnail-tasks";
import { openVaultInEditor } from "../../services/editor-launch-service";
import { deleteAsset } from "../../services/asset-delete-service";
import { runIndexerTask } from "../../services/indexer-task-service";
import { readMarkdownContent } from "../../services/markdown-preview-service";
import { writeAssetProfileLog } from "../../services/asset-profile-log-service";
import { startThumbnailPrewarm } from "../../services/thumbnail-service";
import { importLocalFiles as importLocalFilesIntoVault } from "../../services/local-file-import-service";
import { resolveVaultFilePath } from "../../services/vault-file-service";
import { runDomain } from "../../domain-context";
import { publicProcedure, router } from "../trpc";

function getConflictCount(vaultId: string) {
  return getDatabase()
    .select()
    .from(schema.syncEvents)
    .where(and(eq(schema.syncEvents.vaultId, vaultId), eq(schema.syncEvents.eventType, "conflict")))
    .all().length;
}

function summarizeAssetListInput(input: {
  tagId?: string;
  tagIds?: string[];
  tagMatch?: string;
  statusFilter?: string;
  untagged?: boolean;
  typeFilters?: string[];
  timeFilter?: string;
  sourceTypes?: string[];
  sort?: string;
}) {
  return {
    tagCount: input.tagIds?.length ?? (input.tagId ? 1 : 0),
    tagMatch: input.tagMatch,
    statusFilter: input.statusFilter,
    untagged: input.untagged,
    typeCount: input.typeFilters?.length ?? 0,
    timeFilter: input.timeFilter,
    sourceCount: input.sourceTypes?.length ?? 0,
    sort: input.sort,
  };
}

export const assetsRouter = router({
  vaults: publicProcedure.query(() => {
    return listVaults();
  }),

  importPath: publicProcedure.input(importPathInputSchema).mutation(async ({ input }) => {
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

  activateVault: publicProcedure.input(activateVaultInputSchema).mutation(({ input }) => {
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

  importLocalFiles: publicProcedure
    .input(importLocalFilesInputSchema)
    .mutation(async ({ input }) => {
      return importLocalFilesIntoVault(input);
    }),

  reconcile: publicProcedure.input(reconcileVaultInputSchema).mutation(async ({ input }) => {
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

  sidebarMeta: publicProcedure.input(optionalVaultInputSchema.optional()).query(({ input }) => {
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

  layoutIndex: publicProcedure.input(assetListInputSchema).query(({ input }) => {
    const vault = getRequestedOrActiveVault(input?.vaultId);
    if (!vault) {
      writeAssetProfileLog("main", "assets.layoutIndex.noVault");
      return {
        items: [],
        total: 0,
      };
    }

    startThumbnailPrewarm(vault);
    const startedAt = performance.now();
    const result = getAssetLayoutIndex({
      vaultId: vault.id,
      tagIds: input?.tagIds ?? (input?.tagId ? [input.tagId] : undefined),
      tagMatch: input?.tagMatch,
      statusFilter: input?.statusFilter,
      untagged: input?.untagged,
      typeFilters: input?.typeFilters,
      timeFilter: input?.timeFilter,
      sourceTypes: input?.sourceTypes,
      sort: input?.sort,
    });
    writeAssetProfileLog("main", "assets.layoutIndex", {
      durationMs: performance.now() - startedAt,
      items: result.items.length,
      total: result.total,
      vaultId: vault.id,
      filters: summarizeAssetListInput(input ?? {}),
    });
    return result;
  }),

  hydrate: publicProcedure.input(assetHydrateInputSchema).query(({ input }) => {
    const startedAt = performance.now();
    const items = getAssetRowsByIds(input.ids);
    writeAssetProfileLog("main", "assets.hydrate", {
      durationMs: performance.now() - startedAt,
      requested: input.ids.length,
      returned: items.length,
    });
    return {
      items,
    };
  }),

  list: publicProcedure.input(assetListInputSchema).query(({ input }) => {
    const vault = getRequestedOrActiveVault(input?.vaultId);
    if (!vault) {
      return {
        items: [],
        total: 0,
        nextCursor: null,
      };
    }

    startThumbnailPrewarm(vault);
    const startedAt = performance.now();
    const result = getAssetPage({
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
    writeAssetProfileLog("main", "assets.list", {
      durationMs: performance.now() - startedAt,
      items: result.items.length,
      total: result.total,
      hasNext: result.nextCursor !== null,
      vaultId: vault.id,
      filters: summarizeAssetListInput(input ?? {}),
    });
    return result;
  }),

  byId: publicProcedure.input(assetByIdInputSchema).query(({ input }) => {
    const rows = getAssetRows(undefined, input.id);
    const asset = attachRelations(rows)[0];

    if (!asset) {
      throw new TRPCError({ code: "NOT_FOUND", message: "Asset not found" });
    }

    return asset;
  }),

  deleteAsset: publicProcedure
    .input(deleteAssetInputSchema)
    .mutation(({ input }) => deleteAsset(input.id)),

  graphData: publicProcedure.input(optionalVaultInputSchema.optional()).query(({ input }) => {
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
      .where(and(eq(schema.assets.vaultId, vault.id), isNull(schema.assets.deletedAt)))
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

  markdownContent: publicProcedure
    .input(assetMarkdownContentInputSchema)
    .query(({ input }) => readMarkdownContent(input.id)),

  openFile: publicProcedure.input(openFileInputSchema).mutation(async ({ input }) => {
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
    .input(openVaultLocationInputSchema)
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
    .input(openAssetInEditorInputSchema)
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

  copyAssetPath: publicProcedure.input(copyAssetPathInputSchema).mutation(({ input }) => {
    const row = getAssetRows(undefined, input.id)[0];
    if (!row) {
      throw new TRPCError({ code: "NOT_FOUND", message: "Asset not found" });
    }
    const filePath = resolveVaultFilePath(row.vault.rootPath, row.file.relativePath);
    clipboard.writeText(filePath);
    return { path: filePath };
  }),

  ensureThumbnails: publicProcedure
    .input(ensureThumbnailsInputSchema)
    .mutation(async ({ input }) => {
      if (input.assetIds.length === 0) {
        return { events: [], requested: 0 };
      }

      const vault = getRequestedOrActiveVault(input.vaultId);
      if (!vault) {
        return { events: [], requested: 0 };
      }

      const result = await runThumbnailTask(
        vault,
        input.assetIds.length > 0
          ? { assetIds: input.assetIds, limit: input.assetIds.length }
          : undefined,
      );

      return {
        events: result.events,
        requested: input.assetIds.length,
      };
    }),

  createTag: publicProcedure.input(tagInputSchema).mutation(({ input }) => {
    return runDomain((ctx) => createTag(ctx, input));
  }),

  updateTag: publicProcedure.input(updateTagInputSchema).mutation(({ input }) => {
    return runDomain((ctx) => updateTag(ctx, input));
  }),

  deleteTag: publicProcedure.input(deleteTagInputSchema).mutation(({ input }) => {
    return runDomain((ctx) => deleteTagAndCleanViews(ctx, input.id));
  }),

  reorderTags: publicProcedure.input(reorderTagsInputSchema).mutation(({ input }) => {
    return runDomain((ctx) => reorderTags(ctx, input));
  }),

  createSavedView: publicProcedure.input(savedViewInputSchema).mutation(({ input }) => {
    return runDomain((ctx) => createSavedView(ctx, input));
  }),

  updateSavedView: publicProcedure.input(updateSavedViewInputSchema).mutation(({ input }) => {
    return runDomain((ctx) => updateSavedView(ctx, input));
  }),

  deleteSavedView: publicProcedure.input(deleteSavedViewInputSchema).mutation(({ input }) => {
    return runDomain((ctx) => deleteSavedView(ctx, input.id));
  }),

  reorderSavedViews: publicProcedure.input(reorderSavedViewsInputSchema).mutation(({ input }) => {
    return runDomain((ctx) => reorderSavedViews(ctx, input));
  }),

  addTag: publicProcedure.input(addTagToAssetInputSchema).mutation(({ input }) => {
    return runDomain((ctx) => addTagToAsset(ctx, input));
  }),

  removeTag: publicProcedure.input(removeTagFromAssetInputSchema).mutation(({ input }) => {
    return runDomain((ctx) => removeTagFromAsset(ctx, input));
  }),
});
