import { app } from "electron";
import { desc } from "drizzle-orm";

import { schema } from "@post/db";
import { backgroundTaskManager } from "../../background-tasks";
import { getDatabase } from "../../db";
import { publicProcedure, router } from "../trpc";

export const tasksRouter = router({
  snapshot: publicProcedure.query(() => {
    const activeVault = getDatabase()
      .select({
        id: schema.vaults.id,
        name: schema.vaults.name,
        rootPath: schema.vaults.rootPath,
      })
      .from(schema.vaults)
      .orderBy(desc(schema.vaults.lastOpenedAt))
      .get() ?? null;

    return {
      ...backgroundTaskManager.getSnapshot({ activeVault }),
      appVersion: app.getVersion(),
    };
  }),
});
