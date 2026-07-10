/**
 * @purpose Implement main-process thumbnail service behavior for desktop workflows.
 * @role    Native capability service called by tRPC routers, tasks, or Electron lifecycle code.
 * @deps    Electron main process APIs, filesystem/process utilities, repositories as needed.
 * @gotcha  Keep native side effects out of renderer code and return preload-safe data shapes.
 */

import { existsSync } from "node:fs";

import { and, eq, inArray, isNull } from "drizzle-orm";

import { schema, type VaultRecord } from "@post/db";
import { backgroundTaskManager } from "../background-tasks";
import { getDatabase } from "../db";
import { runThumbnailTask } from "../thumbnail-tasks";

const THUMBNAIL_AUTO_PREWARM_COOLDOWN_MS = 5 * 60 * 1000;

export function startThumbnailPrewarm(vault: VaultRecord, options: { force?: boolean } = {}) {
  if (backgroundTaskManager.hasActiveTask("thumbnails", vault.id)) {
    return;
  }

  const recentlyCompleted = backgroundTaskManager.hasRecentCompletedTask(
    "thumbnails",
    vault.id,
    THUMBNAIL_AUTO_PREWARM_COOLDOWN_MS,
  );

  if (!options.force && recentlyCompleted && !hasThumbnailWork(vault)) {
    return;
  }

  void runThumbnailTask(vault).catch((error) => {
    console.error("Failed to prewarm thumbnails", error);
  });
}

export function filterThumbnailAssetIdsNeedingWork(vault: { id: string }, assetIds: string[]) {
  if (assetIds.length === 0) {
    return [];
  }

  const requestedIds = new Set(assetIds);
  return getThumbnailRows(vault, assetIds)
    .filter(thumbnailRowNeedsWork)
    .map((row) => row.assetId)
    .filter((assetId) => requestedIds.has(assetId));
}

function hasThumbnailWork(vault: VaultRecord) {
  return getThumbnailRows(vault).some(thumbnailRowNeedsWork);
}

function getThumbnailRows(vault: { id: string }, assetIds?: string[]) {
  const rows = getDatabase()
    .select({
      assetId: schema.assets.id,
      sizeBytes: schema.assetFiles.sizeBytes,
      mtimeMs: schema.assetFiles.mtimeMs,
      quickFingerprint: schema.assetFiles.quickFingerprint,
      cacheStatus: schema.imageCache.status,
      thumbnailPath: schema.imageCache.thumbnailPath,
      errorMessage: schema.imageCache.errorMessage,
      sourceSizeBytes: schema.imageCache.sourceSizeBytes,
      sourceMtimeMs: schema.imageCache.sourceMtimeMs,
      sourceQuickFingerprint: schema.imageCache.sourceQuickFingerprint,
    })
    .from(schema.assets)
    .innerJoin(schema.assetFiles, eq(schema.assetFiles.assetId, schema.assets.id))
    .leftJoin(schema.imageCache, eq(schema.imageCache.assetId, schema.assets.id))
    .where(
      and(
        eq(schema.assets.vaultId, vault.id),
        inArray(schema.assets.kind, ["image", "video"]),
        isNull(schema.assets.deletedAt),
        eq(schema.assetFiles.fileExists, true),
        ...(assetIds ? [inArray(schema.assets.id, assetIds)] : []),
      ),
    )
    .all();

  return rows;
}

type ThumbnailRow = ReturnType<typeof getThumbnailRows>[number];

function thumbnailRowNeedsWork(row: ThumbnailRow) {
  if (row.cacheStatus == null || row.cacheStatus === "pending") {
    return true;
  }

  const sourceMatches =
    row.sourceSizeBytes === row.sizeBytes &&
    getTimestampMs(row.sourceMtimeMs) === getTimestampMs(row.mtimeMs) &&
    row.sourceQuickFingerprint === row.quickFingerprint;

  if (row.cacheStatus === "failed") {
    return !sourceMatches || isRetryableThumbnailFailure(row.errorMessage);
  }

  return !sourceMatches || !row.thumbnailPath || !existsSync(row.thumbnailPath);
}

function isRetryableThumbnailFailure(errorMessage: string | null) {
  const normalized = errorMessage?.toLowerCase() ?? "";
  return normalized.includes("ffmpeg executable unavailable");
}

function getTimestampMs(value: Date | number | null) {
  if (value == null) {
    return null;
  }

  return value instanceof Date ? value.getTime() : value;
}
