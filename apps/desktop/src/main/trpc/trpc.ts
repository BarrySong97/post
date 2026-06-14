/**
 * @purpose Initialize shared tRPC helpers for main-process routers and subscriptions.
 * @role    Server-side tRPC foundation used by every router procedure.
 * @deps    @trpc/server observable utilities.
 * @gotcha  Keep context shape compatible with appRouter.createCaller({}) in the Electron IPC handler.
 */

import { initTRPC } from "@trpc/server";

const t = initTRPC.create({ isServer: true });

export const router = t.router;
export const publicProcedure = t.procedure;
