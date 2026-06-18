/**
 * @purpose Compose all domain tRPC routers into the application router.
 * @role    Root AppRouter type and procedure tree for the custom Electron IPC tRPC link.
 * @deps    assets/events/notes/tasks/watcher routers and trpc.ts.
 * @gotcha  Renderer type inference depends on AppRouter; update imports when adding or renaming routers.
 */

import { assetBoardRouter } from "./routers/asset-board";
import { assetsRouter } from "./routers/assets";
import { eventsRouter } from "./routers/events";
import { galleriesRouter } from "./routers/galleries";
import { notesRouter } from "./routers/notes";
import { tasksRouter } from "./routers/tasks";
import { watcherRouter } from "./routers/watcher";
import { router } from "./trpc";

export const appRouter = router({
  assetBoard: assetBoardRouter,
  assets: assetsRouter,
  events: eventsRouter,
  galleries: galleriesRouter,
  notes: notesRouter,
  tasks: tasksRouter,
  watcher: watcherRouter,
});

export type AppRouter = typeof appRouter;
