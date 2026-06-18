/**
 * @purpose Provide shared identifier input contracts for renderer and main process calls.
 * @role    Small Zod contract helpers reused by tRPC procedures and renderer forms.
 * @deps    zod only.
 * @gotcha  Keep this module browser-safe; do not import Electron, database, or filesystem code.
 */

import { z } from "zod";

export const idInputSchema = z.object({
  id: z.string().min(1),
});

export const assetIdInputSchema = z.object({
  assetId: z.string().min(1),
});

export const optionalVaultInputSchema = z.object({
  vaultId: z.string().min(1).optional(),
});

export const vaultIdInputSchema = z.object({
  vaultId: z.string().min(1),
});
