/**
 * @purpose Define main-process tRPC procedures for watcher domain operations.
 * @role    IPC-facing application API layer called by renderer tRPC hooks.
 * @deps    trpc.ts base procedures, repositories/services, Drizzle schema types.
 * @gotcha  Validate inputs and keep side effects in repositories/services rather than renderer components.
 */

import { TRPCError } from "@trpc/server";
import { and, eq } from "drizzle-orm";
import { z } from "zod";

import { schema } from "@post/db";
import { getDatabase } from "../../db";
import { vaultWatcherManager } from "../../vault-watcher-manager";
import { publicProcedure, router } from "../trpc";

const setScopeInput = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("idle"),
  }),
  z.object({
    type: z.literal("vault"),
    vaultId: z.string().min(1),
  }),
  z.object({
    type: z.literal("note"),
    assetId: z.string().min(1),
  }),
]);

export const watcherRouter = router({
  setScope: publicProcedure.input(setScopeInput).mutation(({ input }) => {
    if (input.type === "idle") {
      return vaultWatcherManager.setScope({ type: "idle" });
    }

    if (input.type === "vault") {
      const vault = getVaultOrThrow(input.vaultId);
      return vaultWatcherManager.setScope({
        type: "vault",
        vaultId: vault.id,
        rootPath: vault.rootPath,
        vaultName: vault.name,
      });
    }

    const row = getDatabase()
      .select({
        asset: schema.assets,
        file: schema.assetFiles,
        vault: schema.vaults,
      })
      .from(schema.assets)
      .innerJoin(schema.assetFiles, eq(schema.assetFiles.assetId, schema.assets.id))
      .innerJoin(schema.vaults, eq(schema.vaults.id, schema.assets.vaultId))
      .where(and(eq(schema.assets.id, input.assetId), eq(schema.assetFiles.fileExists, true)))
      .get();

    if (!row) {
      throw new TRPCError({ code: "NOT_FOUND", message: "Asset not found" });
    }

    return vaultWatcherManager.setScope({
      type: "note",
      vaultId: row.vault.id,
      rootPath: row.vault.rootPath,
      vaultName: row.vault.name,
      assetId: row.asset.id,
      relativePath: row.file.relativePath,
    });
  }),

  audit: publicProcedure.mutation(() => {
    return vaultWatcherManager.audit();
  }),

  snapshot: publicProcedure.query(() => {
    return vaultWatcherManager.getSnapshot();
  }),
});

function getVaultOrThrow(vaultId: string) {
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
