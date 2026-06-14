/**
 * @purpose Centralize SQLite reads and writes for vaults data.
 * @role    Main-process persistence boundary between tRPC routers/services and Drizzle tables.
 * @deps    @post/db schema, drizzle-orm query helpers, main db connection utilities.
 * @gotcha  Keep query result shapes stable for routers and renderer models that consume them.
 */

import { randomUUID } from "node:crypto";
import path from "node:path";

import { TRPCError } from "@trpc/server";
import { desc, eq } from "drizzle-orm";

import { schema, type VaultRecord } from "@post/db";
import { getDatabase } from "../db";

export function listVaults() {
  return getDatabase().select().from(schema.vaults).orderBy(desc(schema.vaults.lastOpenedAt));
}

export function getOrCreateVaultId(rootPath: string, name?: string) {
  const existing = getDatabase()
    .select()
    .from(schema.vaults)
    .where(eq(schema.vaults.rootPath, rootPath))
    .get();
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

export function getRequestedOrActiveVault(vaultId: string | undefined) {
  if (vaultId) {
    return getVaultOrThrow(vaultId);
  }

  return (
    getDatabase().select().from(schema.vaults).orderBy(desc(schema.vaults.lastOpenedAt)).get() ??
    null
  );
}

export function getVaultOrThrow(vaultId: string): VaultRecord {
  const vault = getDatabase()
    .select()
    .from(schema.vaults)
    .where(eq(schema.vaults.id, vaultId))
    .get();
  if (!vault) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Vault not found" });
  }

  return vault;
}
