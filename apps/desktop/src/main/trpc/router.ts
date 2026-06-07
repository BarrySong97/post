import { assetsRouter } from "./routers/assets";
import { notesRouter } from "./routers/notes";
import { tasksRouter } from "./routers/tasks";
import { router } from "./trpc";

export const appRouter = router({
  assets: assetsRouter,
  notes: notesRouter,
  tasks: tasksRouter,
});

export type AppRouter = typeof appRouter;
