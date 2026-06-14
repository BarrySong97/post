/**
 * @purpose Create and configure Drizzle SQLite connections for the desktop app.
 * @role    Database utility layer that centralizes WAL and foreign-key pragmas.
 * @deps    better-sqlite3, drizzle-orm, schema.ts.
 * @gotcha  Every connection must preserve WAL mode and foreign keys; callers choose dev/prod userData paths.
 */

import BetterSqlite3 from "better-sqlite3";
import { drizzle, type BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";

import * as schema from "./schema";
export * from "./schema";

export type Database = BetterSQLite3Database<typeof schema>;

export function createDatabase(dbFilePath: string): Database {
  const client = new BetterSqlite3(dbFilePath);
  client.pragma("journal_mode = WAL");
  client.pragma("foreign_keys = ON");

  return drizzle(client, { schema });
}

export function migrateDatabase(db: Database, migrationsFolder: string): void {
  migrate(db, { migrationsFolder });
}

export { schema };
