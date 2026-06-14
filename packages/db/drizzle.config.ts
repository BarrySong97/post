/**
 * @purpose Configure Drizzle Kit migration generation for the shared SQLite schema.
 * @role    Build-time database migration config used by pnpm db:generate.
 * @deps    drizzle-kit, packages/db/src/schema.ts, packages/db/drizzle output folder.
 * @gotcha  Keep paths relative to the package so workspace scripts generate migrations in the committed folder.
 */

import { defineConfig } from "drizzle-kit";

export default defineConfig({
  schema: "./src/schema.ts",
  out: "./drizzle",
  dialect: "sqlite",
  dbCredentials: {
    url: process.env.SQLITE_DB_PATH ?? "./local.sqlite",
  },
});
