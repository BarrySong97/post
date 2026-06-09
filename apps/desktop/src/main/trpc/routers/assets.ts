import { randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

import { clipboard, shell } from "electron";
import { TRPCError } from "@trpc/server";
import { and, desc, eq, inArray, isNull, or } from "drizzle-orm";
import { z } from "zod";

import { schema } from "@post/db";
import { backgroundTaskManager, type BackgroundTaskType } from "../../background-tasks";
import { getDatabase } from "../../db";
import { chooseVaultFolder, type IndexerCommand, type IndexerEvent, runIndexer } from "../../indexer";
import { publicProcedure, router } from "../trpc";

const vaultInput = z.object({
  vaultId: z.string().min(1).optional(),
});

const importPathInput = z.object({
  rootPath: z.string().min(1),
  name: z.string().trim().min(1).optional(),
});

const THUMBNAIL_AUTO_PREWARM_COOLDOWN_MS = 5 * 60 * 1000;
const MARKDOWN_CONTENT_MAX_BYTES = 5 * 1024 * 1024;
const execFileAsync = promisify(execFile);

export const assetsRouter = router({
  vaults: publicProcedure.query(() => {
    return getDatabase().select().from(schema.vaults).orderBy(desc(schema.vaults.lastOpenedAt));
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

  list: publicProcedure.input(vaultInput.optional()).query(({ input }) => {
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
    const assets = attachRelations(rows);
    startThumbnailPrewarm(vault);
    const conflictCount = getDatabase()
      .select()
      .from(schema.syncEvents)
      .where(and(eq(schema.syncEvents.vaultId, vault.id), eq(schema.syncEvents.eventType, "conflict")))
      .all().length;

    return {
      vault,
      assets,
      tags: getSidebarTags(vault.id, assets),
      views: getSavedViews(vault.id),
      summary: getAssetSummary(assets),
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

  markdownContent: publicProcedure.input(z.object({ id: z.string().min(1) })).query(async ({ input }) => {
    const row = getAssetRows(undefined, input.id)[0];
    if (!row) {
      throw new TRPCError({ code: "NOT_FOUND", message: "Asset not found" });
    }

    if (row.asset.kind !== "markdown") {
      throw new TRPCError({ code: "BAD_REQUEST", message: "Asset is not a Markdown file" });
    }

    if (row.file.sizeBytes > MARKDOWN_CONTENT_MAX_BYTES) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "Markdown file is too large to preview",
      });
    }

    const absolutePath = resolveVaultFilePath(row.vault.rootPath, row.file.relativePath);

    try {
      const [rawContent, obsidianAttachmentPath] = await Promise.all([
        readFile(absolutePath, "utf8"),
        readObsidianAttachmentPath(row.vault.rootPath),
      ]);
      const fileDir = path.dirname(row.file.relativePath).replace(/^\.$/, "");
      const content = resolveObsidianEmbeds(rawContent, row.vault.id, fileDir);
      return {
        id: row.asset.id,
        vaultId: row.vault.id,
        fileDir,
        obsidianAttachmentPath,
        content,
        relativePath: row.file.relativePath,
        mtimeMs: row.file.mtimeMs,
      };
    } catch (error) {
      throw new TRPCError({
        code: "INTERNAL_SERVER_ERROR",
        message: error instanceof Error ? error.message : "Could not read Markdown file",
      });
    }
  }),

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

type VaultEditorTarget = "vscode" | "cursor" | "zed";

const VAULT_EDITOR_TARGETS = {
  vscode: {
    label: "VS Code",
    appName: "Visual Studio Code",
    commands: ["code"],
  },
  cursor: {
    label: "Cursor",
    appName: "Cursor",
    commands: ["cursor"],
  },
  zed: {
    label: "Zed",
    appName: "Zed",
    commands: ["zed", "zeditor"],
  },
} satisfies Record<VaultEditorTarget, { label: string; appName: string; commands: string[] }>;

async function openVaultInEditor(target: VaultEditorTarget, rootPath: string, filePath?: string) {
  const editor = VAULT_EDITOR_TARGETS[target];
  const errors: string[] = [];
  // When a specific file is given, pass both vault root and file path so the
  // editor opens the workspace root but focuses/selects the file.
  const args = filePath ? [rootPath, filePath] : [rootPath];

  for (const command of editor.commands) {
    try {
      await execFileAsync(command, args, { timeout: 5000 });
      return;
    } catch (error) {
      errors.push(`${command}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  try {
    // `open -a Editor /vault/root` — file path not supported via `open -a`, fall back to vault root only
    await execFileAsync("open", ["-a", editor.appName, rootPath], { timeout: 5000 });
    return;
  } catch (error) {
    errors.push(`open -a ${editor.appName}: ${error instanceof Error ? error.message : String(error)}`);
  }

  throw new TRPCError({
    code: "INTERNAL_SERVER_ERROR",
    message: `Could not open ${editor.label}. Install its CLI (${editor.commands.join(" or ")}) or the macOS app.`,
    cause: errors.join("\n"),
  });
}

function getOrCreateVaultId(rootPath: string, name?: string) {
  const existing = getDatabase().select().from(schema.vaults).where(eq(schema.vaults.rootPath, rootPath)).get();
  if (existing) {
    const now = new Date();
    getDatabase()
      .update(schema.vaults)
      .set({ lastOpenedAt: now, updatedAt: now })
      .where(eq(schema.vaults.id, existing.id))
      .run();

    return existing.id;
  }

  const now = new Date();
  const vaultId = randomUUID();
  getDatabase()
    .insert(schema.vaults)
    .values({
      id: vaultId,
      name: name ?? (path.basename(rootPath) || "Vault"),
      rootPath,
      createdAt: now,
      updatedAt: now,
      lastOpenedAt: now,
      syncStatus: "idle",
    })
    .run();

  return vaultId;
}

function upsertTag(vaultId: string, name: string, now: Date) {
  const existing = getDatabase()
    .select()
    .from(schema.tags)
    .where(and(eq(schema.tags.vaultId, vaultId), eq(schema.tags.name, name)))
    .get();
  if (existing) {
    return existing;
  }

  return getDatabase()
    .insert(schema.tags)
    .values({
      id: randomUUID(),
      vaultId,
      name,
      sortOrder: 0,
      createdAt: now,
      updatedAt: now,
    })
    .returning()
    .get();
}

function getRequestedOrActiveVault(vaultId: string | undefined) {
  if (vaultId) {
    return getVaultOrThrow(vaultId);
  }

  return getDatabase().select().from(schema.vaults).orderBy(desc(schema.vaults.lastOpenedAt)).get() ?? null;
}

function getVaultOrThrow(vaultId: string) {
  const vault = getDatabase().select().from(schema.vaults).where(eq(schema.vaults.id, vaultId)).get();
  if (!vault) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Vault not found" });
  }

  return vault;
}

function resolveObsidianEmbeds(content: string, vaultId: string, fileDir: string): string {
  const IMAGE_EXTS = new Set(["png", "jpg", "jpeg", "gif", "webp", "svg", "avif", "bmp"]);
  return content.replace(/!\[\[([^\]]+)\]\]/g, (match, inner: string) => {
    const name = inner.trim();
    const ext = name.split(".").pop()?.toLowerCase() ?? "";
    if (!IMAGE_EXTS.has(ext)) return match;

    const file = getDatabase()
      .select({ relativePath: schema.assetFiles.relativePath })
      .from(schema.assetFiles)
      .where(and(eq(schema.assetFiles.vaultId, vaultId), eq(schema.assetFiles.fileName, name)))
      .get();

    if (!file) return match;

    const fileParts = file.relativePath.split("/");
    const dirParts = fileDir ? fileDir.split("/") : [];
    let commonLen = 0;
    while (
      commonLen < dirParts.length &&
      commonLen < fileParts.length - 1 &&
      dirParts[commonLen] === fileParts[commonLen]
    ) {
      commonLen++;
    }
    const ups = dirParts.length - commonLen;
    const rel = [...Array(ups).fill(".."), ...fileParts.slice(commonLen)].join("/");
    return `![${name}](${rel})`;
  });
}

async function readObsidianAttachmentPath(vaultRoot: string): Promise<string | null> {
  try {
    const raw = await readFile(path.join(vaultRoot, ".obsidian", "app.json"), "utf8");
    const config = JSON.parse(raw) as Record<string, unknown>;
    return typeof config.attachmentFolderPath === "string" ? config.attachmentFolderPath : null;
  } catch {
    return null;
  }
}

function resolveVaultFilePath(rootPath: string, relativePath: string) {
  const resolvedRootPath = path.resolve(rootPath);
  const absolutePath = path.resolve(resolvedRootPath, relativePath);
  const relativeToRoot = path.relative(resolvedRootPath, absolutePath);

  if (relativeToRoot.startsWith("..") || path.isAbsolute(relativeToRoot)) {
    throw new TRPCError({ code: "FORBIDDEN", message: "Asset path is outside of the vault" });
  }

  return absolutePath;
}

type VaultRecord = ReturnType<typeof getVaultOrThrow>;

type RunIndexerTaskInput = {
  vaultId: string;
  rootPath: string;
  vaultName: string;
  title: string;
  assetIds?: string[];
  limit?: number;
};

function startThumbnailPrewarm(vault: VaultRecord, options: { force?: boolean } = {}) {
  if (backgroundTaskManager.hasActiveTask("thumbnails", vault.id)) {
    return;
  }

  if (!options.force && backgroundTaskManager.hasRecentCompletedTask(
    "thumbnails",
    vault.id,
    THUMBNAIL_AUTO_PREWARM_COOLDOWN_MS,
  )) {
    return;
  }

  void runThumbnailTask(vault).catch((error) => {
    console.error("Failed to prewarm thumbnails", error);
  });
}

function runThumbnailTask(
  vault: VaultRecord,
  input: { assetIds?: string[]; limit?: number } = {},
) {
  return runIndexerTask("thumbnails", "thumbnails", {
    vaultId: vault.id,
    rootPath: vault.rootPath,
    vaultName: vault.name,
    title: "Generating thumbnails",
    assetIds: input.assetIds,
    limit: input.limit,
  });
}

async function runIndexerTask(
  command: IndexerCommand,
  type: BackgroundTaskType,
  input: RunIndexerTaskInput,
) {
  const task = backgroundTaskManager.createTask({
    type,
    title: input.title,
    vaultId: input.vaultId,
    vaultName: input.vaultName,
  });
  const state = {
    filesSeen: 0,
    thumbnailRequested: 0,
    thumbnailReady: 0,
    thumbnailCached: 0,
    thumbnailFailed: 0,
  };

  backgroundTaskManager.startTask(task.id);

  try {
    const result = await runIndexer(
      command,
      {
        vaultId: input.vaultId,
        rootPath: input.rootPath,
        assetIds: input.assetIds,
        limit: input.limit,
      },
      {
        onEvent: (event) => {
          applyIndexerEventToTask(task.id, type, event, state);
        },
      },
    );
    backgroundTaskManager.completeTask(task.id, getTaskCompletionSummary(type, state, result.events));
    return result;
  } catch (error) {
    backgroundTaskManager.failTask(task.id, error);
    throw error;
  }
}

function applyIndexerEventToTask(
  taskId: string,
  type: BackgroundTaskType,
  event: IndexerEvent,
  state: {
    filesSeen: number;
    thumbnailRequested: number;
    thumbnailReady: number;
    thumbnailCached: number;
    thumbnailFailed: number;
  },
) {
  if (type === "indexing" || type === "reconcile") {
    if (typeof event.filesSeen === "number") {
      state.filesSeen = event.filesSeen;
      backgroundTaskManager.updateTask(taskId, {
        progress: {
          current: state.filesSeen,
          label: `${state.filesSeen} files`,
        },
      });
    }
    return;
  }

  if (type !== "thumbnails") {
    return;
  }

  if (event.type === "started" && typeof event.requested === "number") {
    state.thumbnailRequested = event.requested;
  }

  if (event.type === "thumbnail_ready") {
    state.thumbnailReady += 1;
  } else if (event.type === "thumbnail_cached") {
    state.thumbnailCached += 1;
  } else if (event.type === "thumbnail_failed") {
    state.thumbnailFailed += 1;
  } else if (event.type === "completed") {
    if (typeof event.ready === "number") {
      state.thumbnailReady = event.ready;
    }
    if (typeof event.cached === "number") {
      state.thumbnailCached = event.cached;
    }
    if (typeof event.failed === "number") {
      state.thumbnailFailed = event.failed;
    }
  }

  const current = state.thumbnailReady + state.thumbnailCached + state.thumbnailFailed;
  backgroundTaskManager.updateTask(taskId, {
    progress: {
      current,
      total: state.thumbnailRequested || undefined,
      label: state.thumbnailRequested > 0
        ? `${current} / ${state.thumbnailRequested}`
        : `${current} images`,
    },
  });
}

function getTaskCompletionSummary(
  type: BackgroundTaskType,
  state: {
    filesSeen: number;
    thumbnailRequested: number;
    thumbnailReady: number;
    thumbnailCached: number;
    thumbnailFailed: number;
  },
  events: IndexerEvent[],
) {
  if (type === "indexing") {
    const completed = findLastEvent(events, "completed");
    const filesSeen = typeof completed?.filesSeen === "number" ? completed.filesSeen : state.filesSeen;
    return `Indexed ${filesSeen} files`;
  }

  if (type === "reconcile") {
    const completed = findLastEvent(events, "completed");
    const filesSeen = typeof completed?.filesSeen === "number" ? completed.filesSeen : state.filesSeen;
    return `Reindexed ${filesSeen} files`;
  }

  const generated = state.thumbnailReady;
  if (state.thumbnailRequested === 0) {
    return "Thumbnails up to date";
  }

  if (state.thumbnailFailed > 0) {
    return `Generated ${generated} thumbnails · ${state.thumbnailFailed} failed`;
  }

  return `Thumbnails complete · ${generated} images`;
}

function findLastEvent(events: IndexerEvent[], eventType: string) {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    if (events[index]?.type === eventType) {
      return events[index];
    }
  }

  return undefined;
}

function getAssetRows(vaultId?: string, assetId?: string) {
  const filters = [
    vaultId ? eq(schema.assets.vaultId, vaultId) : undefined,
    assetId ? eq(schema.assets.id, assetId) : undefined,
    isNull(schema.assets.deletedAt),
    eq(schema.assetFiles.fileExists, true),
  ].filter((filter) => filter !== undefined);

  return getDatabase()
    .select({
      asset: schema.assets,
      file: schema.assetFiles,
      vault: schema.vaults,
      markdown: schema.markdownCache,
      image: schema.imageCache,
    })
    .from(schema.assets)
    .innerJoin(schema.assetFiles, eq(schema.assetFiles.assetId, schema.assets.id))
    .innerJoin(schema.vaults, eq(schema.vaults.id, schema.assets.vaultId))
    .leftJoin(schema.markdownCache, eq(schema.markdownCache.assetId, schema.assets.id))
    .leftJoin(schema.imageCache, eq(schema.imageCache.assetId, schema.assets.id))
    .where(and(...filters))
    .orderBy(desc(schema.assets.updatedAt))
    .all();
}

function attachRelations(rows: ReturnType<typeof getAssetRows>) {
  const assetIds = rows.map((row) => row.asset.id);
  if (assetIds.length === 0) {
    return [];
  }

  const tagRows = getDatabase()
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

  const linkRows = getDatabase()
    .select()
    .from(schema.assetLinks)
    .where(
      or(
        inArray(schema.assetLinks.sourceAssetId, assetIds),
        inArray(schema.assetLinks.targetAssetId, assetIds),
      ),
    )
    .all();
  const relatedByAsset = new Map<string, Set<string>>();

  for (const link of linkRows) {
    if (link.targetAssetId && assetIds.includes(link.sourceAssetId)) {
      const related = relatedByAsset.get(link.sourceAssetId) ?? new Set<string>();
      related.add(link.targetAssetId);
      relatedByAsset.set(link.sourceAssetId, related);
    }

    if (link.targetAssetId && assetIds.includes(link.targetAssetId)) {
      const related = relatedByAsset.get(link.targetAssetId) ?? new Set<string>();
      related.add(link.sourceAssetId);
      relatedByAsset.set(link.targetAssetId, related);
    }
  }

  return rows.map((row) => ({
    id: row.asset.id,
    vaultId: row.asset.vaultId,
    kind: row.asset.kind,
    status: row.asset.status,
    privacy: row.asset.privacy,
    title: row.markdown?.title ?? row.asset.title,
    description: row.asset.description,
    relativePath: row.file.relativePath,
    fileName: row.file.fileName,
    extension: row.file.extension,
    sizeBytes: row.file.sizeBytes,
    mtimeMs: row.file.mtimeMs,
    ctimeMs: row.file.ctimeMs,
    quickFingerprint: row.file.quickFingerprint,
    vaultRootPath: row.vault.rootPath,
    vaultName: row.vault.name,
    markdown: row.markdown,
    image: row.image,
    tags: tagsByAsset.get(row.asset.id) ?? [],
    relatedIds: Array.from(relatedByAsset.get(row.asset.id) ?? []),
  }));
}

type AssetListItem = ReturnType<typeof attachRelations>[number];

function getSidebarTags(vaultId: string, assets: AssetListItem[]) {
  const tagRows = getDatabase()
    .select()
    .from(schema.tags)
    .where(eq(schema.tags.vaultId, vaultId))
    .orderBy(schema.tags.sortOrder, schema.tags.name)
    .all();
  const counts = new Map<string, number>();

  for (const asset of assets) {
    for (const tag of asset.tags) {
      counts.set(tag.id, (counts.get(tag.id) ?? 0) + 1);
    }
  }

  return tagRows.map((tag) => ({
    id: tag.id,
    name: tag.name,
    color: tag.color,
    count: counts.get(tag.id) ?? 0,
  }));
}

function getSavedViews(vaultId: string) {
  return getDatabase()
    .select()
    .from(schema.savedViews)
    .where(eq(schema.savedViews.vaultId, vaultId))
    .orderBy(schema.savedViews.sortOrder, desc(schema.savedViews.updatedAt))
    .all()
    .map((view) => ({
      id: view.id,
      name: view.name,
      icon: view.icon,
      filterJson: view.filterJson,
      sortJson: view.sortJson,
      count: 0,
      conditions: parseSavedViewConditions(view.filterJson),
    }));
}

function parseSavedViewConditions(filterJson: string) {
  try {
    const value = JSON.parse(filterJson) as { conditions?: unknown };
    if (!Array.isArray(value.conditions)) {
      return [];
    }

    return value.conditions.filter((condition): condition is string => typeof condition === "string");
  } catch {
    return [];
  }
}

function getAssetSummary(assets: AssetListItem[]) {
  return {
    total: assets.length,
    inbox: assets.filter((asset) => asset.status === "inbox").length,
    organized: assets.filter((asset) => asset.status === "organized").length,
    draft: assets.filter((asset) => asset.status === "draft").length,
    published: assets.filter((asset) => asset.status === "published").length,
    archived: assets.filter((asset) => asset.status === "archived").length,
  };
}
