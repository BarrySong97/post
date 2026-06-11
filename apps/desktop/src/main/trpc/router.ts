import { assetsRouter } from "./routers/assets";
import { eventsRouter } from "./routers/events";
import { notesRouter } from "./routers/notes";
import { tasksRouter } from "./routers/tasks";
import { watcherRouter } from "./routers/watcher";
import { router } from "./trpc";

export const appRouter = router({
  assets: assetsRouter,
  events: eventsRouter,
  notes: notesRouter,
  tasks: tasksRouter,
  watcher: watcherRouter,
});

export type AppRouter = typeof appRouter;
