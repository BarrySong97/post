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
