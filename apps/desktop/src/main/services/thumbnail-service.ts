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

function hasThumbnailWork(vault: VaultRecord) {
  const rows = getDatabase()
    .select({
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
    .where(and(
      eq(schema.assets.vaultId, vault.id),
      inArray(schema.assets.kind, ["image", "video"]),
      isNull(schema.assets.deletedAt),
      eq(schema.assetFiles.fileExists, true),
    ))
    .all();

  return rows.some((row) => {
    if (row.cacheStatus == null || row.cacheStatus === "pending") {
      return true;
    }

    const sourceMatches =
      row.sourceSizeBytes === row.sizeBytes
      && getTimestampMs(row.sourceMtimeMs) === getTimestampMs(row.mtimeMs)
      && row.sourceQuickFingerprint === row.quickFingerprint;

    if (row.cacheStatus === "failed") {
      return !sourceMatches || isRetryableThumbnailFailure(row.errorMessage);
    }

    return (
      !sourceMatches
      || !row.thumbnailPath
      || !existsSync(row.thumbnailPath)
    );
  });
}

function isRetryableThumbnailFailure(errorMessage: string | null) {
  const normalized = errorMessage?.toLowerCase() ?? "";
  return normalized.includes("ffmpeg") || normalized.includes("post_ffmpeg_path");
}

function getTimestampMs(value: Date | number | null) {
  if (value == null) {
    return null;
  }

  return value instanceof Date ? value.getTime() : value;
}
