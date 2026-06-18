/**
 * @purpose Define shared watcher scope contracts.
 * @role    Renderer/main Zod schema for watcher tRPC inputs.
 * @deps    zod only.
 * @gotcha  Scope payloads are translated to indexer watch scopes only inside main-process code.
 */

import { z } from "zod";

export const setWatcherScopeInputSchema = z.discriminatedUnion("type", [
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
