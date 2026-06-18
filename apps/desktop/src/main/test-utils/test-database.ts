/**
 * @purpose Provide isolated SQLite databases for main-process unit tests.
 * @role    Vitest helper that migrates a temporary database and installs it into main db accessors.
 * @deps    node temp files, @post/db migration helpers, main db test hook.
 * @gotcha  Tests should call resetTestDatabase after each case to avoid leaking the active DB.
 */

import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { createDatabase, migrateDatabase, type Database } from "@post/db";
import { setDatabaseForTests } from "../db";

export function setupTestDatabase(): Database {
  const dir = mkdtempSync(join(tmpdir(), "post-db-test-"));
  const db = createDatabase(join(dir, "test.sqlite"));
  const currentDir = dirname(fileURLToPath(import.meta.url));
  const migrationsFolder = resolve(currentDir, "../../../../../packages/db/drizzle");
  migrateDatabase(db, migrationsFolder);
  setDatabaseForTests(db);
  return db;
}

export function resetTestDatabase(): void {
  setDatabaseForTests(null);
}
