import { notesRouter } from "./routers/notes";
import { router } from "./trpc";

export const appRouter = router({
  notes: notesRouter,
});

export type AppRouter = typeof appRouter;

