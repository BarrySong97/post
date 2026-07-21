/**
 * @purpose Register and serve post-file:// vault, thumbnail, and HEIC preview access.
 * @role    Presentation-layer Electron protocol adapter for renderer preview URLs.
 * @deps    Electron protocol APIs, database reads, thumbnail cache path helpers.
 * @gotcha  Always resolve paths under their owning vault/cache root before serving files.
 */

import { protocol } from "electron";
import path from "node:path";

import { schema } from "@post/db";
import { and, eq } from "drizzle-orm";

import { getDatabase } from "../../db";
import { getThumbnailCacheRoot } from "../../indexer";

export function registerPrivilegedProtocols(): void {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: "post-file",
      privileges: {
        standard: true,
        secure: true,
        corsEnabled: true,
      },
    },
  ]);
}

export function registerAssetProtocol(): void {
  protocol.registerFileProtocol("post-file", (request, callback) => {
    try {
      const url = new URL(request.url);
      if (url.hostname === "thumb") {
        const assetId = decodeURIComponent(url.pathname.replace(/^\/+/, "").split("/")[0] ?? "");
        const row = getDatabase()
          .select()
          .from(schema.imageCache)
          .where(and(eq(schema.imageCache.assetId, assetId), eq(schema.imageCache.status, "ready")))
          .get();

        if (!row?.thumbnailPath) {
          callback({ error: -6 });
          return;
        }

        const thumbnailRoot = path.resolve(getThumbnailCacheRoot());
        const absolutePath = path.resolve(row.thumbnailPath);
        if (
          absolutePath !== thumbnailRoot &&
          !absolutePath.startsWith(`${thumbnailRoot}${path.sep}`)
        ) {
          callback({ error: -10 });
          return;
        }

        callback({ path: absolutePath });
        return;
      }

      if (url.hostname === "preview") {
        const assetId = decodeURIComponent(url.pathname.replace(/^\/+/, "").split("/")[0] ?? "");
        const row = getDatabase()
          .select({ previewPath: schema.imageCache.previewPath })
          .from(schema.imageCache)
          .where(and(eq(schema.imageCache.assetId, assetId), eq(schema.imageCache.status, "ready")))
          .get();

        if (!row?.previewPath) {
          callback({ error: -6 });
          return;
        }

        const thumbnailRoot = path.resolve(getThumbnailCacheRoot());
        const absolutePath = path.resolve(row.previewPath);
        if (
          absolutePath !== thumbnailRoot &&
          !absolutePath.startsWith(`${thumbnailRoot}${path.sep}`)
        ) {
          callback({ error: -10 });
          return;
        }

        callback({ path: absolutePath });
        return;
      }

      if (url.hostname === "asset") {
        const assetId = decodeURIComponent(url.pathname.replace(/^\/+/, "").split("/")[0] ?? "");
        const row = getDatabase()
          .select({
            file: schema.assetFiles,
            vault: schema.vaults,
          })
          .from(schema.assetFiles)
          .innerJoin(schema.vaults, eq(schema.vaults.id, schema.assetFiles.vaultId))
          .where(eq(schema.assetFiles.assetId, assetId))
          .get();

        if (!row || !row.file.fileExists) {
          callback({ error: -6 });
          return;
        }

        const vaultRoot = path.resolve(row.vault.rootPath);
        const absolutePath = path.resolve(vaultRoot, row.file.relativePath);
        if (absolutePath !== vaultRoot && !absolutePath.startsWith(`${vaultRoot}${path.sep}`)) {
          callback({ error: -10 });
          return;
        }

        callback({ path: absolutePath });
        return;
      }

      if (url.hostname === "vault") {
        const parts = url.pathname.replace(/^\/+/, "").split("/");
        const vaultId = decodeURIComponent(parts[0] ?? "");
        const relPath = parts
          .slice(1)
          .map((part) => decodeURIComponent(part))
          .join(path.sep);

        const vault = getDatabase()
          .select({ rootPath: schema.vaults.rootPath })
          .from(schema.vaults)
          .where(eq(schema.vaults.id, vaultId))
          .get();

        if (!vault) {
          callback({ error: -6 });
          return;
        }

        const vaultRoot = path.resolve(vault.rootPath);
        const absolutePath = path.resolve(vaultRoot, relPath);
        if (absolutePath !== vaultRoot && !absolutePath.startsWith(`${vaultRoot}${path.sep}`)) {
          callback({ error: -10 });
          return;
        }

        callback({ path: absolutePath });
        return;
      }

      callback({ error: -6 });
    } catch (error) {
      console.error("Failed to serve asset file", error);
      callback({ error: -2 });
    }
  });
}
