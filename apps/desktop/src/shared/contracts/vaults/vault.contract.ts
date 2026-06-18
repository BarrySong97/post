/**
 * @purpose Define shared vault operation contracts.
 * @role    Renderer/main Zod schemas for importing, activating, and reconciling vaults.
 * @deps    zod and common id contracts.
 * @gotcha  These schemas only validate transport input; filesystem checks stay in main use cases.
 */

import { z } from "zod";

import { vaultIdInputSchema } from "../common/id.contract";

export const importPathInputSchema = z.object({
  rootPath: z.string().min(1),
  name: z.string().trim().min(1).optional(),
});

export const activateVaultInputSchema = vaultIdInputSchema;
export const reconcileVaultInputSchema = vaultIdInputSchema;
