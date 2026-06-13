import { readFile } from "node:fs/promises";
import path from "node:path";

import { TRPCError } from "@trpc/server";
import { and, eq } from "drizzle-orm";

import { schema } from "@post/db";
import { getDatabase } from "../db";
import { getAssetRows } from "../repositories/assets-repository";
import { resolveVaultFilePath } from "./vault-file-service";

const MARKDOWN_CONTENT_MAX_BYTES = 5 * 1024 * 1024;

export async function readMarkdownContent(assetId: string) {
  const row = getAssetRows(undefined, assetId)[0];
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
}

function resolveObsidianEmbeds(content: string, vaultId: string, fileDir: string): string {
  const imageExts = new Set(["png", "jpg", "jpeg", "gif", "webp", "svg", "avif", "bmp"]);
  return content.replace(/!\[\[([^\]]+)\]\]/g, (match, inner: string) => {
    const name = inner.trim();
    const ext = name.split(".").pop()?.toLowerCase() ?? "";
    if (!imageExts.has(ext)) return match;

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
