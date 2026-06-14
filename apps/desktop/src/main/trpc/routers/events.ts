/**
 * @purpose Define main-process tRPC procedures for events domain operations.
 * @role    IPC-facing application API layer called by renderer tRPC hooks.
 * @deps    trpc.ts base procedures, repositories/services, Drizzle schema types.
 * @gotcha  Validate inputs and keep side effects in repositories/services rather than renderer components.
 */

import { observable } from "@trpc/server/observable";

import { appEventBus, type AppEvent } from "../../events";
import { publicProcedure, router } from "../trpc";

export const eventsRouter = router({
  subscribe: publicProcedure.subscription(() => {
    return observable<AppEvent>((emit) => {
      return appEventBus.subscribe((event) => {
        emit.next(event);
      });
    });
  }),
});
