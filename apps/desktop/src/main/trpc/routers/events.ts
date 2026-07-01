/**
 * @purpose Define main-process tRPC procedures for events domain operations.
 * @role    IPC-facing application API layer called by renderer tRPC hooks.
 * @deps    trpc.ts base procedures, repositories/services, Drizzle schema types.
 * @gotcha  Validate inputs and keep side effects in repositories/services rather than renderer components.
 */

import { observable } from "@trpc/server/observable";
import { z } from "zod";

import { assetListSortInputSchema } from "@shared/contracts/assets/asset-list.contract";
import { savedViewFiltersInputSchema } from "@shared/contracts/assets/saved-views/saved-view.contract";

import { appEventBus, type AppEvent } from "../../events";
import { setLiveFilterSnapshot } from "../../live-filter-state";
import { publicProcedure, router } from "../trpc";

const reportFilterStateInputSchema = z.object({
  filters: savedViewFiltersInputSchema,
  sort: assetListSortInputSchema,
  activeItem: z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("mgmt"), id: z.enum(["all", "inbox"]) }),
    z.object({ kind: z.literal("view"), id: z.string().min(1) }),
    z.object({ kind: z.literal("tag"), id: z.string().min(1) }),
  ]),
});

export const eventsRouter = router({
  subscribe: publicProcedure.subscription(() => {
    return observable<AppEvent>((emit) => {
      return appEventBus.subscribe((event) => {
        emit.next(event);
      });
    });
  }),
  reportFilterState: publicProcedure.input(reportFilterStateInputSchema).mutation(({ input }) => {
    setLiveFilterSnapshot({ ...input, reportedAt: Date.now() });
    return { ok: true } as const;
  }),
});
