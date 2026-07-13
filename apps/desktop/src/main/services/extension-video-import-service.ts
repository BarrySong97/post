/**
 * @purpose Import browser-selected Twitter/X video URLs into the active Post vault.
 * @role    Main-process service for downloading or muxing video bytes and creating video assets.
 * @deps    Node fs/path/crypto, @post/db schema, Drizzle helpers, main database and vault repositories.
 * @gotcha  Resolve full X playback variants before observed requests; captured MP4 requests may be DASH fragments.
 */

import { randomUUID, createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { and, eq } from "drizzle-orm";
import { app } from "electron";

import { schema, type TagRecord } from "@post/db";
import { backgroundTaskManager } from "../background-tasks";
import { getDatabase } from "../db";
import { getRequestedOrActiveVault } from "../repositories/vaults-repository";
import { runThumbnailTask } from "../thumbnail-tasks";
import { resolveTwitterVideoVariants } from "./twitter-video-resolver";

const WEB_CLIP_VIDEO_DIR = "assets/web-clips/videos";
const MAX_VIDEO_BYTES = 100 * 1024 * 1024;

export type SaveExtensionVideoInput = {
  srcUrl?: string;
  candidateUrls?: string[];
  pageUrl?: string;
  pageTitle?: string;
  tweetId?: string;
  tweetUrl?: string;
  tagId?: string;
  vaultId?: string;
  destinationDir?: string;
  fileStem?: string;
  hiddenTask?: boolean;
};

export type SaveExtensionVideoResult = {
  assetId: string;
  fileId: string;
  tagId: string | null;
  vaultId: string;
  relativePath: string;
  title: string;
};

type DownloadProgress = {
  current: number;
  total?: number;
  label?: string;
};

type DownloadProgressHandler = (progress: DownloadProgress) => void;

function formatMegabytes(bytes: number) {
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function formatDownloadProgress(progress: DownloadProgress) {
  if (progress.label) {
    return progress.label;
  }

  if (progress.total && progress.total > 0) {
    return `${formatMegabytes(progress.current)} / ${formatMegabytes(progress.total)}`;
  }

  return formatMegabytes(progress.current);
}

function assertHttpUrl(rawUrl: string): URL {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new Error("Video URL is invalid.");
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("Only direct http and https video URLs can be imported.");
  }

  return url;
}

function isMp4Url(url: URL) {
  return url.pathname.toLowerCase().includes(".mp4");
}

function isHlsUrl(url: URL) {
  return url.pathname.toLowerCase().includes(".m3u8");
}

function resolveFfmpegPath() {
  const binaryName = process.platform === "win32" ? "ffmpeg.exe" : "ffmpeg";
  const candidates = [
    process.env.POST_FFMPEG_PATH,
    app.isPackaged ? path.join(process.resourcesPath, "ffmpeg", binaryName) : undefined,
    path.resolve(process.cwd(), "resources", "ffmpeg", binaryName),
    path.resolve(process.cwd(), "apps", "desktop", "resources", "ffmpeg", binaryName),
    app.isPackaged ? undefined : "ffmpeg",
  ].filter((candidate): candidate is string => Boolean(candidate));

  return candidates.find((candidate) => candidate === "ffmpeg" || existsSync(candidate));
}

function normalizeFileStem(value: string): string {
  const stem = value
    .normalize("NFKD")
    .replace(/[^\w.-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);

  return stem || "video";
}

function titleFromInput(input: SaveExtensionVideoInput, url: URL): string {
  const pageTitle = input.pageTitle?.trim();
  if (pageTitle) {
    return pageTitle.slice(0, 140);
  }

  if (input.tweetId) {
    return `Twitter video ${input.tweetId}`;
  }

  const decodedBaseName = decodeURIComponent(path.basename(url.pathname) || "video");
  return decodedBaseName.replace(/\.[a-z0-9]+$/i, "").slice(0, 140) || "Video";
}

function subjectNameFromVideoInput(input: SaveExtensionVideoInput): string {
  const pageTitle = input.pageTitle?.trim();
  if (pageTitle) {
    return pageTitle.slice(0, 140);
  }

  if (input.tweetId) {
    return `Twitter video ${input.tweetId}`;
  }

  if (input.srcUrl) {
    try {
      const url = new URL(input.srcUrl);
      const decodedBaseName = decodeURIComponent(path.basename(url.pathname) || "video");
      return decodedBaseName.replace(/\.[a-z0-9]+$/i, "").slice(0, 140) || "Video";
    } catch {
      // Fall through.
    }
  }

  return "Video";
}

async function getCandidateUrls(input: SaveExtensionVideoInput) {
  const resolvedVariants = await resolveTwitterVideoVariants(input.tweetId);
  return Array.from(
    new Set([
      ...resolvedVariants.map((variant) => variant.url),
      input.srcUrl,
      ...(input.candidateUrls ?? []),
    ]),
  ).filter((url): url is string => typeof url === "string" && url.length > 0);
}

async function readResponseBytes(
  response: Response,
  maxBytes: number,
  onProgress: DownloadProgressHandler,
) {
  const contentLength = Number(response.headers.get("content-length"));
  const total = Number.isFinite(contentLength) && contentLength > 0 ? contentLength : undefined;
  if (total && total > maxBytes) {
    throw new Error("Video is larger than the 100 MB import limit.");
  }

  if (!response.body) {
    const bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.length > maxBytes) {
      throw new Error("Video is larger than the 100 MB import limit.");
    }

    onProgress({ current: bytes.length, total });
    return bytes;
  }

  const reader = response.body.getReader();
  const chunks: Buffer[] = [];
  let received = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }

    const chunk = Buffer.from(value);
    received += chunk.length;
    if (received > maxBytes) {
      throw new Error("Video is larger than the 100 MB import limit.");
    }

    chunks.push(chunk);
    onProgress({ current: received, total });
  }

  return Buffer.concat(chunks, received);
}

async function fetchVideo(input: SaveExtensionVideoInput, onProgress: DownloadProgressHandler) {
  const candidates = await getCandidateUrls(input);
  if (candidates.length === 0) {
    throw new Error("No downloadable MP4 or HLS video URL was found.");
  }

  const errors: string[] = [];
  for (const rawCandidate of candidates) {
    try {
      const url = assertHttpUrl(rawCandidate);
      if (isHlsUrl(url)) {
        return await fetchHlsVideo(input, url, onProgress);
      }

      if (!isMp4Url(url)) {
        throw new Error("Candidate was not an MP4 or HLS URL.");
      }

      const headers: HeadersInit = {
        Accept: "video/mp4,video/*;q=0.8,*/*;q=0.5",
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
      };
      if (input.pageUrl) {
        headers.Referer = input.pageUrl;
      }

      const response = await fetch(url, { redirect: "follow", headers });
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const contentType = response.headers.get("content-type")?.split(";")[0]?.toLowerCase() ?? "";
      if (
        contentType &&
        contentType !== "video/mp4" &&
        contentType !== "application/octet-stream"
      ) {
        throw new Error(`Unsupported content type ${contentType}`);
      }

      const bytes = await readResponseBytes(response, MAX_VIDEO_BYTES, onProgress);
      await validateDownloadedMp4(bytes);

      return { bytes, extension: "mp4", mimeType: contentType || "video/mp4", url };
    } catch (error) {
      errors.push(error instanceof Error ? error.message : String(error));
    }
  }

  throw new Error(`No downloadable MP4 or HLS video URL worked. ${errors[0] ?? ""}`.trim());
}

async function validateDownloadedMp4(bytes: Buffer) {
  const ffmpegPath = resolveFfmpegPath();
  if (!ffmpegPath) {
    throw new Error("Downloaded MP4 requires ffmpeg validation, but no ffmpeg binary was found.");
  }

  const tempDir = await mkdtemp(path.join(tmpdir(), "post-extension-mp4-"));
  const inputPath = path.join(tempDir, "candidate.mp4");
  try {
    await writeFile(inputPath, bytes);
    await validateVideoWithFfmpeg(ffmpegPath, inputPath);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

async function fetchHlsVideo(
  input: SaveExtensionVideoInput,
  url: URL,
  onProgress: DownloadProgressHandler,
) {
  const ffmpegPath = resolveFfmpegPath();
  if (!ffmpegPath) {
    throw new Error("HLS video requires ffmpeg, but no ffmpeg binary was found.");
  }

  onProgress({ current: 0, label: "处理 HLS 视频" });
  const tempDir = await mkdtemp(path.join(tmpdir(), "post-extension-video-"));
  const outputPath = path.join(tempDir, "video.mp4");

  try {
    await runFfmpegHlsDownload(ffmpegPath, url.href, outputPath, input);
    await validateVideoWithFfmpeg(ffmpegPath, outputPath);
    const outputStat = await stat(outputPath);
    if (outputStat.size > MAX_VIDEO_BYTES) {
      throw new Error("Video is larger than the 100 MB import limit.");
    }

    const bytes = await readFile(outputPath);
    onProgress({ current: bytes.length, total: bytes.length });
    return { bytes, extension: "mp4", mimeType: "video/mp4", url };
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

function validateVideoWithFfmpeg(ffmpegPath: string, inputPath: string) {
  const args = [
    "-hide_banner",
    "-loglevel",
    "error",
    "-i",
    inputPath,
    "-map",
    "0:v:0",
    "-frames:v",
    "1",
    "-f",
    "null",
    "-",
  ];

  return new Promise<void>((resolve, reject) => {
    const child = spawn(ffmpegPath, args, { windowsHide: true });
    let stderr = "";

    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString("utf8");
    });

    child.once("error", reject);
    child.once("close", (code) => {
      if (code === 0) {
        resolve();
        return;
      }

      reject(new Error(`Downloaded video was not readable. ${stderr.trim()}`.trim()));
    });
  });
}

function runFfmpegHlsDownload(
  ffmpegPath: string,
  inputUrl: string,
  outputPath: string,
  input: SaveExtensionVideoInput,
) {
  const headerLines = [
    "User-Agent: Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    input.pageUrl ? `Referer: ${input.pageUrl}` : undefined,
  ].filter((line): line is string => Boolean(line));

  const args = [
    "-hide_banner",
    "-loglevel",
    "error",
    "-y",
    "-headers",
    `${headerLines.join("\r\n")}\r\n`,
    "-i",
    inputUrl,
    "-c",
    "copy",
    "-bsf:a",
    "aac_adtstoasc",
    outputPath,
  ];

  return new Promise<void>((resolve, reject) => {
    const child = spawn(ffmpegPath, args, { windowsHide: true });
    let stderr = "";

    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString("utf8");
    });

    child.once("error", reject);
    child.once("close", (code) => {
      if (code === 0) {
        resolve();
        return;
      }

      reject(new Error(`ffmpeg failed to import HLS video. ${stderr.trim()}`.trim()));
    });
  });
}

async function pathExists(absolutePath: string): Promise<boolean> {
  try {
    await stat(absolutePath);
    return true;
  } catch {
    return false;
  }
}

async function chooseRelativePath(
  rootPath: string,
  destinationDir: string,
  stem: string,
  extension: string,
): Promise<string> {
  let index = 0;
  while (true) {
    const suffix = index === 0 ? "" : `-${index + 1}`;
    const relativePath = path.posix.join(destinationDir, `${stem}${suffix}.${extension}`);
    const absolutePath = path.join(rootPath, relativePath);
    if (!(await pathExists(absolutePath))) {
      return relativePath;
    }

    index += 1;
  }
}

// Resolve an optional tag: null when none was chosen (asset lands untagged in Inbox);
// throws only when a tag was requested but does not exist in the vault.
function resolveTag(tagId: string | undefined, vaultId: string): TagRecord | null {
  if (!tagId) {
    return null;
  }

  const tag = getDatabase()
    .select()
    .from(schema.tags)
    .where(and(eq(schema.tags.id, tagId), eq(schema.tags.vaultId, vaultId)))
    .get();

  if (!tag) {
    throw new Error("Selected tag was not found in the active vault.");
  }

  return tag;
}

function findExistingVideoByHash(vaultId: string, contentHash: string) {
  return getDatabase()
    .select({
      asset: schema.assets,
      file: schema.assetFiles,
    })
    .from(schema.assetFiles)
    .innerJoin(schema.assets, eq(schema.assets.id, schema.assetFiles.assetId))
    .where(
      and(
        eq(schema.assetFiles.vaultId, vaultId),
        eq(schema.assetFiles.contentHash, contentHash),
        eq(schema.assetFiles.fileExists, true),
        eq(schema.assets.kind, "video"),
      ),
    )
    .get();
}

export async function saveExtensionVideo(
  input: SaveExtensionVideoInput,
): Promise<SaveExtensionVideoResult> {
  const vault = getRequestedOrActiveVault(input.vaultId);
  if (!vault) {
    throw new Error("No active vault selected.");
  }

  const subjectName = subjectNameFromVideoInput(input);
  const task = backgroundTaskManager.createTask({
    type: "import",
    title: "Importing video",
    vaultId: vault.id,
    vaultName: vault.name,
    subject: { names: [subjectName], count: 1 },
    progress: { current: 0, label: "准备下载" },
    hidden: input.hiddenTask,
  });

  backgroundTaskManager.startTask(task.id);

  try {
    const tag = resolveTag(input.tagId, vault.id);
    const video = await fetchVideo(input, (progress) => {
      backgroundTaskManager.updateTask(task.id, {
        progress: {
          current: progress.current,
          total: progress.total,
          label: formatDownloadProgress(progress),
        },
      });
    });

    const now = new Date();
    const title = titleFromInput(input, video.url);
    const contentHash = createHash("sha256").update(video.bytes).digest("hex");
    const existing = findExistingVideoByHash(vault.id, contentHash);

    if (existing) {
      if (tag) {
        getDatabase()
          .insert(schema.assetTags)
          .values({ assetId: existing.asset.id, tagId: tag.id, createdAt: now })
          .onConflictDoNothing()
          .run();
      }

      getDatabase()
        .update(schema.assets)
        .set({ updatedAt: now })
        .where(eq(schema.assets.id, existing.asset.id))
        .run();

      backgroundTaskManager.completeTask(task.id, `Imported ${existing.asset.title}`);

      return {
        assetId: existing.asset.id,
        fileId: existing.file.id,
        tagId: tag?.id ?? null,
        vaultId: vault.id,
        relativePath: existing.file.relativePath,
        title: existing.asset.title,
      };
    }

    const stem = input.fileStem
      ? normalizeFileStem(input.fileStem)
      : `${new Date().toISOString().slice(0, 10)}-${normalizeFileStem(title)}`;
    const relativePath = await chooseRelativePath(
      vault.rootPath,
      input.destinationDir ?? WEB_CLIP_VIDEO_DIR,
      stem,
      video.extension,
    );
    const absolutePath = path.join(vault.rootPath, relativePath);

    await mkdir(path.dirname(absolutePath), { recursive: true });
    await writeFile(absolutePath, video.bytes, { flag: "wx" });

    const assetId = randomUUID();
    const fileId = randomUUID();
    const description = input.tweetUrl ?? input.pageUrl;

    getDatabase().transaction((tx) => {
      tx.insert(schema.assets)
        .values({
          id: assetId,
          vaultId: vault.id,
          kind: "video",
          status: "inbox",
          privacy: "normal",
          title,
          description: description ? `Clipped from ${description}` : null,
          createdAt: now,
          updatedAt: now,
          indexedAt: now,
        })
        .run();

      tx.insert(schema.assetFiles)
        .values({
          id: fileId,
          assetId,
          vaultId: vault.id,
          relativePath,
          fileName: path.basename(relativePath),
          extension: video.extension,
          mimeType: video.mimeType,
          sizeBytes: video.bytes.length,
          mtimeMs: now,
          ctimeMs: now,
          contentHash,
          quickFingerprint: contentHash.slice(0, 16),
          fileExists: true,
          firstSeenAt: now,
          lastSeenAt: now,
        })
        .run();

      tx.insert(schema.imageCache)
        .values({
          assetId,
          vaultId: vault.id,
          fileId,
          sourceSizeBytes: video.bytes.length,
          sourceMtimeMs: now,
          sourceQuickFingerprint: contentHash.slice(0, 16),
          status: "pending",
          updatedAt: now,
        })
        .onConflictDoNothing()
        .run();

      if (tag) {
        tx.insert(schema.assetTags).values({ assetId, tagId: tag.id, createdAt: now }).run();
      }
    });

    backgroundTaskManager.updateTask(task.id, {
      progress: { current: 1, total: 1, label: "生成视频缩略图" },
    });
    await runThumbnailTask(vault, { assetIds: [assetId], limit: 1, hidden: true }).catch(
      (error) => {
        console.error("Failed to generate imported video thumbnail", error);
      },
    );

    backgroundTaskManager.completeTask(task.id, `Imported ${title}`);

    return {
      assetId,
      fileId,
      tagId: tag?.id ?? null,
      vaultId: vault.id,
      relativePath,
      title,
    };
  } catch (error) {
    backgroundTaskManager.failTask(task.id, error);
    throw error;
  }
}
