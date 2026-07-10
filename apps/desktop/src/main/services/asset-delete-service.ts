/**
 * @purpose Delete an indexed asset without permanently erasing its source file.
 * @role    Main-process service that moves the vault file to the OS trash and soft-deletes its asset row.
 * @deps    Electron shell, Drizzle schema/query helpers, database access, and vault path resolution.
 * @gotcha  Move the file before updating SQLite so a trash failure leaves the asset visible and usable.
 */

import { access } from "node:fs/promises";

import { shell } from "electron";
import { and, eq, isNull } from "drizzle-orm";

import { schema } from "@post/db";
import { getDatabase } from "../db";
import { resolveVaultFilePath } from "./vault-file-service";

async function pathExists(absolutePath: string) {
  try {
    await access(absolutePath);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return false;
    }

    throw error;
  }
}

export async function deleteAsset(assetId: string) {
  const row = getDatabase()
    .select({
      id: schema.assets.id,
      title: schema.assets.title,
      relativePath: schema.assetFiles.relativePath,
      rootPath: schema.vaults.rootPath,
    })
    .from(schema.assets)
    .innerJoin(schema.assetFiles, eq(schema.assetFiles.assetId, schema.assets.id))
    .innerJoin(schema.vaults, eq(schema.vaults.id, schema.assets.vaultId))
    .where(and(eq(schema.assets.id, assetId), isNull(schema.assets.deletedAt)))
    .get();

  if (!row) {
    throw new Error("Asset not found.");
  }

  const absolutePath = resolveVaultFilePath(row.rootPath, row.relativePath);
  const movedToTrash = await pathExists(absolutePath);
  if (movedToTrash) {
    await shell.trashItem(absolutePath);
  }

  const now = new Date();
  getDatabase().transaction((tx) => {
    tx.update(schema.assets)
      .set({ deletedAt: now, updatedAt: now })
      .where(eq(schema.assets.id, row.id))
      .run();

    tx.update(schema.assetFiles)
      .set({ fileExists: false, missingSince: now })
      .where(eq(schema.assetFiles.assetId, row.id))
      .run();
  });

  return {
    id: row.id,
    title: row.title,
    relativePath: row.relativePath,
    movedToTrash,
  };
}
