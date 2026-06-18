/**
 * @purpose Implement reusable vault lookup helpers for Post domain callers.
 * @role    Domain persistence helpers shared by desktop and CLI workflows.
 * @deps    Domain context/errors, @post/db schema, drizzle query helpers.
 * @gotcha  Active vault selection is last-opened based unless callers pass a vault id.
 */

import { desc, eq } from "drizzle-orm";

import { schema, type VaultRecord } from "@post/db";

import type { DomainContext } from "../context";
import { DomainError } from "../errors";

export function listVaults(ctx: DomainContext): VaultRecord[] {
  return ctx.db.select().from(schema.vaults).orderBy(desc(schema.vaults.lastOpenedAt)).all();
}

export function getVault(ctx: DomainContext, vaultId: string): VaultRecord | null {
  return ctx.db.select().from(schema.vaults).where(eq(schema.vaults.id, vaultId)).get() ?? null;
}

export function getVaultOrThrow(ctx: DomainContext, vaultId: string): VaultRecord {
  const vault = getVault(ctx, vaultId);
  if (!vault) {
    throw new DomainError("VAULT_NOT_FOUND", "Vault not found", { status: "NOT_FOUND" });
  }

  return vault;
}

export function getRequestedOrActiveVault(
  ctx: DomainContext,
  vaultId?: string,
): VaultRecord | null {
  if (vaultId) {
    return getVaultOrThrow(ctx, vaultId);
  }

  if (ctx.activeVaultId) {
    return getVaultOrThrow(ctx, ctx.activeVaultId);
  }

  return (
    ctx.db.select().from(schema.vaults).orderBy(desc(schema.vaults.lastOpenedAt)).get() ?? null
  );
}

export function getActiveVaultOrThrow(ctx: DomainContext, vaultId?: string): VaultRecord {
  const vault = getRequestedOrActiveVault(ctx, vaultId);
  if (!vault) {
    throw new DomainError("NO_ACTIVE_VAULT", "No active vault selected");
  }

  return vault;
}
