/**
 * @purpose Import browser-selected image URLs into the active Post vault from the extension bridge.
 * @role    Main-process service for downloading image bytes, writing vault files, and creating asset rows.
 * @deps    Node fs/path/crypto, @post/db schema, Drizzle helpers, main database and vault repositories.
 * @gotcha  Extension imports accept only http(s) image URLs and write into assets/web-clips/.
 */

import { randomUUID, createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { and, eq } from "drizzle-orm";

import { schema, type TagRecord } from "@post/db";
import { getDatabase } from "../db";
import { getRequestedOrActiveVault } from "../repositories/vaults-repository";
import { enqueueThumbnails } from "./thumbnail-queue";

const WEB_CLIP_DIR = "assets/web-clips";
const MAX_IMAGE_BYTES = 25 * 1024 * 1024;

const MIME_EXTENSION: Record<string, string> = {
  "image/avif": "avif",
  "image/gif": "gif",
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/svg+xml": "svg",
  "image/webp": "webp",
};

export type SaveExtensionImageInput = {
  srcUrl: string;
  pageUrl?: string;
  pageTitle?: string;
  tagId?: string;
  vaultId?: string;
  destinationDir?: string;
  fileStem?: string;
};

export type SaveExtensionImageResult = {
  assetId: string;
  fileId: string;
  tagId: string | null;
  vaultId: string;
  relativePath: string;
  title: string;
};

function assertHttpUrl(rawUrl: string): URL {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new Error("Image URL is invalid.");
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("Only http and https image URLs can be imported.");
  }

  return url;
}

function normalizeFileStem(value: string): string {
  const stem = value
    .normalize("NFKD")
    .replace(/[^\w.-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);

  return stem || "image";
}

function titleFromInput(input: SaveExtensionImageInput, url: URL): string {
  const pageTitle = input.pageTitle?.trim();
  if (pageTitle) {
    return pageTitle.slice(0, 140);
  }

  const decodedBaseName = decodeURIComponent(path.basename(url.pathname) || "image");
  return decodedBaseName.replace(/\.[a-z0-9]+$/i, "").slice(0, 140) || "Image";
}

function extensionFromUrl(url: URL): string | null {
  const ext = path.extname(url.pathname).replace(".", "").toLowerCase();
  if (Object.values(MIME_EXTENSION).includes(ext)) {
    return ext;
  }

  return null;
}

async function fetchImage(input: SaveExtensionImageInput) {
  const url = assertHttpUrl(input.srcUrl);
  const headers: HeadersInit = {
    Accept: "image/avif,image/webp,image/png,image/svg+xml,image/jpeg,image/gif,image/*;q=0.8",
    "User-Agent":
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  };
  if (input.pageUrl) {
    headers.Referer = input.pageUrl;
  }

  const response = await fetch(url, {
    redirect: "follow",
    headers,
  });

  if (!response.ok) {
    throw new Error(`Image download failed with HTTP ${response.status}.`);
  }

  const contentType = response.headers.get("content-type")?.split(";")[0]?.toLowerCase() ?? "";
  const extension = MIME_EXTENSION[contentType] ?? extensionFromUrl(url);
  if (!extension) {
    throw new Error("Downloaded URL did not return a supported image type.");
  }

  const contentLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(contentLength) && contentLength > MAX_IMAGE_BYTES) {
    throw new Error("Image is larger than the 25 MB import limit.");
  }

  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length > MAX_IMAGE_BYTES) {
    throw new Error("Image is larger than the 25 MB import limit.");
  }

  return { bytes, extension, mimeType: contentType || `image/${extension}`, url };
}

export async function writeImageFileToUniquePath(
  rootPath: string,
  destinationDir: string,
  stem: string,
  extension: string,
  bytes: Buffer,
  isReserved: (relativePath: string) => boolean = () => false,
): Promise<string> {
  await mkdir(path.join(rootPath, destinationDir), { recursive: true });

  let index = 0;
  while (true) {
    const suffix = index === 0 ? "" : `-${index + 1}`;
    const relativePath = path.posix.join(destinationDir, `${stem}${suffix}.${extension}`);
    const absolutePath = path.join(rootPath, relativePath);

    // Soft-deleted/missing asset-file rows still own their vault-relative path. Reusing one
    // lets the watcher restore the old asset around newly downloaded bytes, so skip it even
    // when the physical file has already moved to Trash.
    if (isReserved(relativePath)) {
      index += 1;
      continue;
    }

    try {
      // Exclusive creation makes name allocation atomic. Parallel extension imports from the
      // same page commonly share a title/stem; losers retry the next suffix instead of failing.
      await writeFile(absolutePath, bytes, { flag: "wx" });
      return relativePath;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") {
        throw error;
      }
    }

    index += 1;
  }
}

function isAssetFilePathReserved(vaultId: string, relativePath: string): boolean {
  return Boolean(
    getDatabase()
      .select({ id: schema.assetFiles.id })
      .from(schema.assetFiles)
      .where(
        and(
          eq(schema.assetFiles.vaultId, vaultId),
          eq(schema.assetFiles.relativePath, relativePath),
        ),
      )
      .get(),
  );
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

function findExistingImageByHash(vaultId: string, contentHash: string) {
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
      ),
    )
    .get();
}

export async function saveExtensionImage(
  input: SaveExtensionImageInput,
): Promise<SaveExtensionImageResult> {
  const vault = getRequestedOrActiveVault(input.vaultId);
  if (!vault) {
    throw new Error("No active vault selected.");
  }

  const tag = resolveTag(input.tagId, vault.id);
  const image = await fetchImage(input);
  const now = new Date();
  const title = titleFromInput(input, image.url);
  const contentHash = createHash("sha256").update(image.bytes).digest("hex");
  const existing = findExistingImageByHash(vault.id, contentHash);

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
  const relativePath = await writeImageFileToUniquePath(
    vault.rootPath,
    input.destinationDir ?? WEB_CLIP_DIR,
    stem,
    image.extension,
    image.bytes,
    (candidate) => isAssetFilePathReserved(vault.id, candidate),
  );

  const assetId = randomUUID();
  const fileId = randomUUID();

  getDatabase().transaction((tx) => {
    tx.insert(schema.assets)
      .values({
        id: assetId,
        vaultId: vault.id,
        kind: "image",
        status: "inbox",
        privacy: "normal",
        title,
        description: input.pageUrl ? `Clipped from ${input.pageUrl}` : null,
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
        extension: image.extension,
        mimeType: image.mimeType,
        sizeBytes: image.bytes.length,
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
        sourceSizeBytes: image.bytes.length,
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

  enqueueThumbnails(vault, [assetId]);

  return {
    assetId,
    fileId,
    tagId: tag?.id ?? null,
    vaultId: vault.id,
    relativePath,
    title,
  };
}
