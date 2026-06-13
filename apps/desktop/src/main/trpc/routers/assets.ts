import path from "node:path";

import { clipboard, shell } from "electron";
import { TRPCError } from "@trpc/server";
import { and, eq, isNotNull } from "drizzle-orm";
import { z } from "zod";

import { schema } from "@post/db";
import { getDatabase } from "../../db";
import { chooseVaultFolder } from "../../indexer";
import {
  attachRelations,
  getAssetRows,
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

  list: publicProcedure
    .input(
      vaultInput
        .extend({
          tagId: z.string().optional(),
          statusFilter: z.enum(["inbox", "organized", "draft", "published", "archived"]).optional(),
          untagged: z.boolean().optional(),
        })
        .optional(),
    )
    .query(({ input }) => {
      const vault = getRequestedOrActiveVault(input?.vaultId);
      if (!vault) {
        return {
          vault: null,
          assets: [],
          tags: [],
          views: [],
          summary: getAssetSummary([]),
          conflictCount: 0,
        };
      }

      const rows = getAssetRows(vault.id);
      const allAssets = attachRelations(rows);
      startThumbnailPrewarm(vault);

      // Apply server-side filters; sidebar counts always use allAssets
      let filteredAssets = allAssets;
      if (input?.tagId) {
        filteredAssets = filteredAssets.filter((a) =>
          a.tags.some((t) => t.id === input.tagId),
        );
      }
      if (input?.statusFilter) {
        filteredAssets = filteredAssets.filter((a) => a.status === input.statusFilter);
      }
      if (input?.untagged) {
        filteredAssets = filteredAssets.filter((a) => a.tags.length === 0);
      }

      const conflictCount = getDatabase()
        .select()
        .from(schema.syncEvents)
        .where(and(eq(schema.syncEvents.vaultId, vault.id), eq(schema.syncEvents.eventType, "conflict")))
        .all().length;

      return {
        vault,
        assets: filteredAssets,
        tags: getSidebarTags(vault.id, allAssets),
        views: getSavedViews(vault.id, allAssets),
        summary: getAssetSummary(allAssets),
        conflictCount,
      };
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
