/**
 * @purpose Save browser web/YouTube bookmarks as Vault .url pointers with database metadata.
 * @role    Main-process bookmark lookup, duplicate policy, cover caching, and transactional import service.
 * @deps    Node fs/path/crypto, Electron thumbnail cache, Drizzle schema, and active Vault repository.
 * @gotcha  .url files preserve only source identity; full bookmark metadata and notes live in SQLite.
 */

import { createHash, randomUUID } from "node:crypto";
import { mkdir, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import { and, asc, eq, isNull } from "drizzle-orm";

import { schema } from "@post/db";
import type { ExtensionBookmarkCapture, ExtensionBookmarkSaveMessage } from "../local-ipc-messages";
import { getDatabase } from "../db";
import { getThumbnailCacheRoot } from "../indexer";
import { getRequestedOrActiveVault } from "../repositories/vaults-repository";

const WEB_BOOKMARK_DIR = "assets/web-clips/pages";
const YOUTUBE_BOOKMARK_DIR = "assets/web-clips/youtube";
const MAX_COVER_BYTES = 15 * 1024 * 1024;
const BOOKMARK_SCHEMA_VERSION = 1;

type NormalizedCapture = ExtensionBookmarkCapture;

type ExistingBookmark = {
  assetId: string;
  title: string;
  relativePath: string;
  fileId: string;
  copyIndex: number;
  titleOverride: string | null;
  note: string | null;
};

type DownloadedCover = {
  bytes: Buffer;
  extension: "avif" | "gif" | "jpg" | "png" | "webp";
};

export type BookmarkDuplicate = {
  assetId: string;
  title: string;
  copyIndex: number;
};

export type SaveExtensionBookmarkResult = {
  assetId: string;
  title: string;
  relativePath: string;
  status: "created" | "updated";
  warnings: string[];
};

function nonEmpty(value: string | null | undefined) {
  return value?.trim() || undefined;
}

function assertHttpUrl(rawUrl: string, label: string) {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new Error(`${label} is invalid.`);
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error(`${label} must use http or https.`);
  }
  return url;
}

export function normalizeBookmarkCapture(capture: ExtensionBookmarkCapture): NormalizedCapture {
  const canonical = assertHttpUrl(capture.canonicalUrl, "Bookmark URL");
  canonical.hash = "";
  const pageUrl = assertHttpUrl(capture.pageUrl, "Page URL");
  const base = {
    ...capture,
    canonicalUrl: canonical.href,
    pageUrl: pageUrl.href,
    sourceTitle: nonEmpty(capture.sourceTitle),
    description: nonEmpty(capture.description),
    thumbnailUrl: capture.thumbnailUrl
      ? assertHttpUrl(capture.thumbnailUrl, "Thumbnail URL").href
      : undefined,
    language: nonEmpty(capture.language),
  };
  if (capture.kind === "web") {
    return { ...base, kind: "web", siteName: nonEmpty(capture.siteName) };
  }

  const videoId = nonEmpty(capture.videoId);
  if (!videoId || !/^[A-Za-z0-9_-]+$/.test(videoId)) {
    throw new Error("YouTube video ID is invalid.");
  }
  return {
    ...base,
    kind: "youtube",
    videoId,
    canonicalUrl: `https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}`,
    channelId: nonEmpty(capture.channelId),
    channelName: nonEmpty(capture.channelName),
    channelUrl: capture.channelUrl
      ? assertHttpUrl(capture.channelUrl, "YouTube channel URL").href
      : undefined,
    publishedAt: nonEmpty(capture.publishedAt),
    durationMs: capture.durationMs,
    liveStatus: capture.liveStatus ?? "unknown",
  };
}

export function internetShortcutContents(url: string) {
  return `[InternetShortcut]\nURL=${url}\n`;
}

export function bookmarkCaptureWarnings(capture: NormalizedCapture) {
  const warnings: string[] = [];
  if (!capture.sourceTitle) warnings.push("Source title was unavailable.");
  if (!capture.thumbnailUrl) warnings.push("Cover image was unavailable.");
  if (capture.kind === "youtube") {
    if (!capture.description) warnings.push("YouTube description was unavailable.");
    if (!capture.channelName) warnings.push("YouTube channel was unavailable.");
    if (!capture.publishedAt) warnings.push("YouTube publish date was unavailable.");
    if (capture.durationMs === undefined && capture.liveStatus !== "live") {
      warnings.push("YouTube duration was unavailable.");
    }
  }
  return warnings;
}

function parsePublishedAt(value: string | undefined) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function bookmarkTitle(capture: NormalizedCapture, titleOverride?: string | null) {
  return (
    nonEmpty(titleOverride) ??
    capture.sourceTitle ??
    (capture.kind === "youtube"
      ? `YouTube ${capture.videoId}`
      : new URL(capture.canonicalUrl).hostname.replace(/^www\./, ""))
  ).slice(0, 300);
}

function bookmarkStem(capture: NormalizedCapture) {
  if (capture.kind === "youtube") {
    return capture.videoId;
  }
  const host = new URL(capture.canonicalUrl).hostname.replace(/^www\./, "");
  const safeHost = host.replace(/[^A-Za-z0-9.-]+/g, "-").slice(0, 60) || "web";
  const hash = createHash("sha256").update(capture.canonicalUrl).digest("hex").slice(0, 12);
  return `${safeHost}-${hash}`;
}

function bookmarkRelativePath(capture: NormalizedCapture, copyIndex: number) {
  const suffix = copyIndex === 0 ? "" : `-${copyIndex + 1}`;
  return path.posix.join(
    capture.kind === "youtube" ? YOUTUBE_BOOKMARK_DIR : WEB_BOOKMARK_DIR,
    `${bookmarkStem(capture)}${suffix}.url`,
  );
}

function findExistingBookmarks(vaultId: string, capture: NormalizedCapture): ExistingBookmark[] {
  if (capture.kind === "youtube") {
    return getDatabase()
      .select({
        assetId: schema.assets.id,
        title: schema.assets.title,
        relativePath: schema.assetFiles.relativePath,
        fileId: schema.assetFiles.id,
        copyIndex: schema.youtubeCache.copyIndex,
        titleOverride: schema.youtubeCache.titleOverride,
        note: schema.youtubeCache.note,
      })
      .from(schema.youtubeCache)
      .innerJoin(schema.assets, eq(schema.assets.id, schema.youtubeCache.assetId))
      .innerJoin(schema.assetFiles, eq(schema.assetFiles.assetId, schema.assets.id))
      .where(
        and(
          eq(schema.youtubeCache.vaultId, vaultId),
          eq(schema.youtubeCache.videoId, capture.videoId),
          isNull(schema.assets.deletedAt),
          eq(schema.assetFiles.fileExists, true),
        ),
      )
      .orderBy(asc(schema.youtubeCache.copyIndex))
      .all();
  }

  return getDatabase()
    .select({
      assetId: schema.assets.id,
      title: schema.assets.title,
      relativePath: schema.assetFiles.relativePath,
      fileId: schema.assetFiles.id,
      copyIndex: schema.webCache.copyIndex,
      titleOverride: schema.webCache.titleOverride,
      note: schema.webCache.note,
    })
    .from(schema.webCache)
    .innerJoin(schema.assets, eq(schema.assets.id, schema.webCache.assetId))
    .innerJoin(schema.assetFiles, eq(schema.assetFiles.assetId, schema.assets.id))
    .where(
      and(
        eq(schema.webCache.vaultId, vaultId),
        eq(schema.webCache.url, capture.canonicalUrl),
        isNull(schema.assets.deletedAt),
        eq(schema.assetFiles.fileExists, true),
      ),
    )
    .orderBy(asc(schema.webCache.copyIndex))
    .all();
}

function nextCopyIndex(vaultId: string, capture: NormalizedCapture) {
  const rows =
    capture.kind === "youtube"
      ? getDatabase()
          .select({ copyIndex: schema.youtubeCache.copyIndex })
          .from(schema.youtubeCache)
          .where(
            and(
              eq(schema.youtubeCache.vaultId, vaultId),
              eq(schema.youtubeCache.videoId, capture.videoId),
            ),
          )
          .all()
      : getDatabase()
          .select({ copyIndex: schema.webCache.copyIndex })
          .from(schema.webCache)
          .where(
            and(
              eq(schema.webCache.vaultId, vaultId),
              eq(schema.webCache.url, capture.canonicalUrl),
            ),
          )
          .all();
  return rows.reduce((max, row) => Math.max(max, row.copyIndex), -1) + 1;
}

function validateTagIds(vaultId: string, tagIds: string[]) {
  const ids = [...new Set(tagIds)];
  if (ids.length === 0) return ids;
  const tags = getDatabase()
    .select({ id: schema.tags.id })
    .from(schema.tags)
    .where(eq(schema.tags.vaultId, vaultId))
    .all();
  const available = new Set(tags.map((tag) => tag.id));
  if (ids.some((id) => !available.has(id))) {
    throw new Error("One or more selected tags were not found in the active vault.");
  }
  return ids;
}

function coverExtension(contentType: string, rawUrl: string): DownloadedCover["extension"] | null {
  const normalized = contentType.split(";")[0]?.trim().toLowerCase();
  const byType: Record<string, DownloadedCover["extension"]> = {
    "image/avif": "avif",
    "image/gif": "gif",
    "image/jpeg": "jpg",
    "image/png": "png",
    "image/webp": "webp",
  };
  if (normalized && byType[normalized]) return byType[normalized];
  const extension = path.extname(new URL(rawUrl).pathname).slice(1).toLowerCase();
  return ["avif", "gif", "jpg", "jpeg", "png", "webp"].includes(extension)
    ? extension === "jpeg"
      ? "jpg"
      : (extension as DownloadedCover["extension"])
    : null;
}

async function downloadCover(rawUrl: string | undefined): Promise<DownloadedCover | null> {
  if (!rawUrl) return null;
  const response = await fetch(assertHttpUrl(rawUrl, "Thumbnail URL"), {
    redirect: "follow",
    headers: {
      Accept: "image/avif,image/webp,image/png,image/jpeg,image/gif,image/*;q=0.8",
      "User-Agent":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    },
  });
  if (!response.ok) throw new Error(`Cover download failed with HTTP ${response.status}.`);
  const length = Number(response.headers.get("content-length"));
  if (Number.isFinite(length) && length > MAX_COVER_BYTES) {
    throw new Error("Cover image exceeded the 15 MB limit.");
  }
  const extension = coverExtension(response.headers.get("content-type") ?? "", rawUrl);
  if (!extension) throw new Error("Cover URL did not return a supported image.");
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length > MAX_COVER_BYTES) throw new Error("Cover image exceeded the 15 MB limit.");
  return { bytes, extension };
}

async function writeCover(assetId: string, cover: DownloadedCover) {
  const root = getThumbnailCacheRoot();
  const absolutePath = path.join(root, `${assetId}.${cover.extension}`);
  const temporaryPath = `${absolutePath}.${randomUUID()}.tmp`;
  await writeFile(temporaryPath, cover.bytes);
  await rename(temporaryPath, absolutePath);
  return absolutePath;
}

function imageCacheValues(input: {
  assetId: string;
  vaultId: string;
  fileId: string;
  cover: DownloadedCover;
  thumbnailPath: string;
  capture: NormalizedCapture;
  now: Date;
}) {
  const youtube = input.capture.kind === "youtube";
  return {
    assetId: input.assetId,
    vaultId: input.vaultId,
    fileId: input.fileId,
    width: youtube ? 1280 : null,
    height: youtube ? 720 : null,
    thumbnailPath: input.thumbnailPath,
    thumbnailWidth: youtube ? 1280 : null,
    thumbnailHeight: youtube ? 720 : null,
    thumbnailSizeBytes: input.cover.bytes.length,
    thumbnailFormat: input.cover.extension,
    status: "ready" as const,
    errorMessage: null,
    generatedAt: input.now,
    updatedAt: input.now,
  };
}

export function lookupExtensionBookmarks(input: {
  capture: ExtensionBookmarkCapture;
  vaultId?: string;
}): BookmarkDuplicate[] {
  const vault = getRequestedOrActiveVault(input.vaultId);
  if (!vault) throw new Error("No active vault selected.");
  const capture = normalizeBookmarkCapture(input.capture);
  return findExistingBookmarks(vault.id, capture).map(({ assetId, title, copyIndex }) => ({
    assetId,
    title,
    copyIndex,
  }));
}

async function updateBookmark(input: {
  vaultId: string;
  rootPath: string;
  capture: NormalizedCapture;
  existing: ExistingBookmark;
  tagIds: string[];
  warnings: string[];
  cover: DownloadedCover | null;
}) {
  const { capture, existing } = input;
  const now = new Date();
  const shortcut = Buffer.from(internetShortcutContents(capture.canonicalUrl), "utf8");
  const absolutePath = path.join(input.rootPath, existing.relativePath);
  await writeFile(absolutePath, shortcut);
  const contentHash = createHash("sha256").update(shortcut).digest("hex");
  let thumbnailPath: string | null = null;
  if (input.cover) thumbnailPath = await writeCover(existing.assetId, input.cover);
  const title = bookmarkTitle(capture, existing.titleOverride);
  const captureStatus = input.warnings.length > 0 ? "partial" : "complete";

  getDatabase().transaction((tx) => {
    tx.update(schema.assets)
      .set({ title, description: capture.description ?? null, updatedAt: now, indexedAt: now })
      .where(eq(schema.assets.id, existing.assetId))
      .run();
    tx.update(schema.assetFiles)
      .set({
        sizeBytes: shortcut.length,
        mtimeMs: now,
        contentHash,
        quickFingerprint: contentHash.slice(0, 16),
        fileExists: true,
        missingSince: null,
        lastSeenAt: now,
      })
      .where(eq(schema.assetFiles.id, existing.fileId))
      .run();
    if (capture.kind === "youtube") {
      tx.update(schema.youtubeCache)
        .set({
          canonicalUrl: capture.canonicalUrl,
          sourceTitle: capture.sourceTitle ?? null,
          description: capture.description ?? null,
          channelId: capture.channelId ?? null,
          channelName: capture.channelName ?? null,
          channelUrl: capture.channelUrl ?? null,
          publishedAt: parsePublishedAt(capture.publishedAt),
          durationMs: capture.durationMs ?? null,
          thumbnailUrl: capture.thumbnailUrl ?? null,
          language: capture.language ?? null,
          liveStatus: capture.liveStatus ?? "unknown",
          captureStatus,
          warningsJson: JSON.stringify(input.warnings),
          capturedAt: new Date(capture.capturedAt),
          updatedAt: now,
        })
        .where(eq(schema.youtubeCache.assetId, existing.assetId))
        .run();
    } else {
      tx.update(schema.webCache)
        .set({
          url: capture.canonicalUrl,
          domain: new URL(capture.canonicalUrl).hostname.replace(/^www\./, ""),
          siteName: capture.siteName ?? null,
          sourceTitle: capture.sourceTitle ?? null,
          description: capture.description ?? null,
          thumbnailUrl: capture.thumbnailUrl ?? null,
          language: capture.language ?? null,
          captureStatus,
          warningsJson: JSON.stringify(input.warnings),
          capturedAt: new Date(capture.capturedAt),
          updatedAt: now,
        })
        .where(eq(schema.webCache.assetId, existing.assetId))
        .run();
    }
    for (const tagId of input.tagIds) {
      tx.insert(schema.assetTags)
        .values({ assetId: existing.assetId, tagId, createdAt: now })
        .onConflictDoNothing()
        .run();
    }
    if (input.cover && thumbnailPath) {
      const values = imageCacheValues({
        assetId: existing.assetId,
        vaultId: input.vaultId,
        fileId: existing.fileId,
        cover: input.cover,
        thumbnailPath,
        capture,
        now,
      });
      tx.insert(schema.imageCache)
        .values(values)
        .onConflictDoUpdate({ target: schema.imageCache.assetId, set: values })
        .run();
    }
  });

  return { assetId: existing.assetId, title, relativePath: existing.relativePath };
}

async function createBookmark(input: {
  vaultId: string;
  rootPath: string;
  capture: NormalizedCapture;
  titleOverride?: string;
  note?: string;
  tagIds: string[];
  warnings: string[];
  cover: DownloadedCover | null;
}) {
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const copyIndex = nextCopyIndex(input.vaultId, input.capture);
    const relativePath = bookmarkRelativePath(input.capture, copyIndex);
    const absolutePath = path.join(input.rootPath, relativePath);
    const shortcut = Buffer.from(internetShortcutContents(input.capture.canonicalUrl), "utf8");
    const assetId = randomUUID();
    const fileId = randomUUID();
    let thumbnailPath: string | null = null;
    try {
      await mkdir(path.dirname(absolutePath), { recursive: true });
      await writeFile(absolutePath, shortcut, { flag: "wx" });
      if (input.cover) thumbnailPath = await writeCover(assetId, input.cover);
      const now = new Date();
      const titleOverride = nonEmpty(input.titleOverride)?.slice(0, 300);
      const note = nonEmpty(input.note)?.slice(0, 10_000);
      const title = bookmarkTitle(input.capture, titleOverride);
      const contentHash = createHash("sha256").update(shortcut).digest("hex");
      const captureStatus = input.warnings.length > 0 ? "partial" : "complete";

      getDatabase().transaction((tx) => {
        tx.insert(schema.assets)
          .values({
            id: assetId,
            vaultId: input.vaultId,
            kind: input.capture.kind,
            status: "inbox",
            privacy: "normal",
            title,
            description: input.capture.description ?? null,
            createdAt: now,
            updatedAt: now,
            indexedAt: now,
          })
          .run();
        tx.insert(schema.assetFiles)
          .values({
            id: fileId,
            assetId,
            vaultId: input.vaultId,
            relativePath,
            fileName: path.basename(relativePath),
            extension: "url",
            mimeType: "application/internet-shortcut",
            sizeBytes: shortcut.length,
            mtimeMs: now,
            ctimeMs: now,
            contentHash,
            quickFingerprint: contentHash.slice(0, 16),
            fileExists: true,
            firstSeenAt: now,
            lastSeenAt: now,
          })
          .run();
        if (input.capture.kind === "youtube") {
          tx.insert(schema.youtubeCache)
            .values({
              assetId,
              vaultId: input.vaultId,
              videoId: input.capture.videoId,
              canonicalUrl: input.capture.canonicalUrl,
              sourceTitle: input.capture.sourceTitle ?? null,
              titleOverride: titleOverride ?? null,
              description: input.capture.description ?? null,
              channelId: input.capture.channelId ?? null,
              channelName: input.capture.channelName ?? null,
              channelUrl: input.capture.channelUrl ?? null,
              publishedAt: parsePublishedAt(input.capture.publishedAt),
              durationMs: input.capture.durationMs ?? null,
              thumbnailUrl: input.capture.thumbnailUrl ?? null,
              language: input.capture.language ?? null,
              liveStatus: input.capture.liveStatus ?? "unknown",
              note: note ?? null,
              copyIndex,
              captureStatus,
              warningsJson: JSON.stringify(input.warnings),
              schemaVersion: BOOKMARK_SCHEMA_VERSION,
              capturedAt: new Date(input.capture.capturedAt),
              updatedAt: now,
            })
            .run();
        } else {
          tx.insert(schema.webCache)
            .values({
              assetId,
              vaultId: input.vaultId,
              url: input.capture.canonicalUrl,
              domain: new URL(input.capture.canonicalUrl).hostname.replace(/^www\./, ""),
              siteName: input.capture.siteName ?? null,
              sourceTitle: input.capture.sourceTitle ?? null,
              titleOverride: titleOverride ?? null,
              description: input.capture.description ?? null,
              thumbnailUrl: input.capture.thumbnailUrl ?? null,
              language: input.capture.language ?? null,
              note: note ?? null,
              copyIndex,
              captureStatus,
              warningsJson: JSON.stringify(input.warnings),
              schemaVersion: BOOKMARK_SCHEMA_VERSION,
              capturedAt: new Date(input.capture.capturedAt),
              updatedAt: now,
            })
            .run();
        }
        for (const tagId of input.tagIds) {
          tx.insert(schema.assetTags).values({ assetId, tagId, createdAt: now }).run();
        }
        if (input.cover && thumbnailPath) {
          tx.insert(schema.imageCache)
            .values(
              imageCacheValues({
                assetId,
                vaultId: input.vaultId,
                fileId,
                cover: input.cover,
                thumbnailPath,
                capture: input.capture,
                now,
              }),
            )
            .run();
        }
      });

      return { assetId, title, relativePath };
    } catch (error) {
      await rm(absolutePath, { force: true }).catch(() => undefined);
      if (thumbnailPath) await rm(thumbnailPath, { force: true }).catch(() => undefined);
      const code = (error as NodeJS.ErrnoException).code;
      const message = error instanceof Error ? error.message : "";
      if (code === "EEXIST" || message.includes("UNIQUE constraint failed")) continue;
      throw error;
    }
  }
  throw new Error("Could not allocate a unique bookmark copy.");
}

export async function saveExtensionBookmark(
  input: Pick<
    ExtensionBookmarkSaveMessage,
    "capture" | "titleOverride" | "note" | "tagIds" | "action" | "vaultId"
  >,
): Promise<SaveExtensionBookmarkResult> {
  const vault = getRequestedOrActiveVault(input.vaultId);
  if (!vault) throw new Error("No active vault selected.");
  const capture = normalizeBookmarkCapture(input.capture);
  const tagIds = validateTagIds(vault.id, input.tagIds);
  const warnings = bookmarkCaptureWarnings(capture);
  let cover: DownloadedCover | null = null;
  if (capture.thumbnailUrl) {
    try {
      cover = await downloadCover(capture.thumbnailUrl);
    } catch (error) {
      warnings.push(error instanceof Error ? error.message : "Cover download failed.");
    }
  }

  const existing = findExistingBookmarks(vault.id, capture);
  if (input.action === "update" && existing[0]) {
    const updated = await updateBookmark({
      vaultId: vault.id,
      rootPath: vault.rootPath,
      capture,
      existing: existing[0],
      tagIds,
      warnings,
      cover,
    });
    return { ...updated, status: "updated", warnings };
  }

  const created = await createBookmark({
    vaultId: vault.id,
    rootPath: vault.rootPath,
    capture,
    titleOverride: input.titleOverride,
    note: input.note,
    tagIds,
    warnings,
    cover,
  });
  return { ...created, status: "created", warnings };
}
