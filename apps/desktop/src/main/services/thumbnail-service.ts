/**
 * @purpose Implement main-process thumbnail service behavior for desktop workflows.
 * @role    Native capability service called by tRPC routers, tasks, or Electron lifecycle code.
 * @deps    Electron main process APIs, filesystem/process utilities, repositories as needed.
 * @gotcha  Animation metadata and HEIC preview proxies participate in cache validity.
 */

import { existsSync } from "node:fs";

import { and, eq, inArray, isNull } from "drizzle-orm";

import { schema, type VaultRecord } from "@post/db";
import { backgroundTaskManager } from "../background-tasks";
import { getDatabase } from "../db";
import { runThumbnailTask } from "../thumbnail-tasks";

const THUMBNAIL_AUTO_PREWARM_COOLDOWN_MS = 5 * 60 * 1000;
const MEDIA_METADATA_VERSION = 1;

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
      kind: schema.assets.kind,
      extension: schema.assetFiles.extension,
      sizeBytes: schema.assetFiles.sizeBytes,
      mtimeMs: schema.assetFiles.mtimeMs,
      quickFingerprint: schema.assetFiles.quickFingerprint,
      cacheStatus: schema.imageCache.status,
      thumbnailPath: schema.imageCache.thumbnailPath,
      thumbnailFormat: schema.imageCache.thumbnailFormat,
      isAnimated: schema.imageCache.isAnimated,
      mediaMetadataVersion: schema.imageCache.mediaMetadataVersion,
      previewPath: schema.imageCache.previewPath,
      imageWidth: schema.imageCache.width,
      imageHeight: schema.imageCache.height,
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
    row.sourceQuickFingerprint === row.quickFingerprint &&
    row.mediaMetadataVersion === MEDIA_METADATA_VERSION &&
    row.isAnimated != null;

  if (row.cacheStatus === "failed") {
    return !sourceMatches || isRetryableThumbnailFailure(row.errorMessage);
  }

  const shouldUseOriginal =
    row.kind === "image" &&
    row.isAnimated !== true &&
    row.extension?.toLowerCase() !== "heic" &&
    row.imageWidth != null &&
    row.imageHeight != null &&
    Math.max(row.imageWidth, row.imageHeight) <= 720;
  if (shouldUseOriginal) {
    return !sourceMatches || row.thumbnailFormat !== "original";
  }

  const expectedFormat =
    row.kind === "image" && row.extension?.toLowerCase() === "png" ? "png" : "jpeg";
  return (
    !sourceMatches ||
    row.thumbnailFormat !== expectedFormat ||
    !row.thumbnailPath ||
    !existsSync(row.thumbnailPath) ||
    (process.platform === "darwin" &&
      row.extension?.toLowerCase() === "heic" &&
      (!row.previewPath || !existsSync(row.previewPath)))
  );
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
