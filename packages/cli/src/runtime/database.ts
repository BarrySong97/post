/**
 * @purpose Resolve and open the Post SQLite database for CLI commands.
 * @role    CLI runtime adapter around @post/db connection and migration helpers.
 * @deps    node fs/path/os, @post/db.
 * @gotcha  npm builds carry their own copied Drizzle migrations under dist/drizzle.
 */

import { existsSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { createDatabase, migrateDatabase, type Database } from "@post/db";

export type DatabaseRuntime = {
  db: Database;
  dbPath: string;
  migrationsFolder: string;
};

function getRepoRoot(): string {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");
}

function getDefaultUserDataDir(): string {
  if (process.env.POST_USER_DATA_DIR) {
    return process.env.POST_USER_DATA_DIR;
  }

  if (process.platform === "darwin") {
    return path.join(homedir(), "Library", "Application Support", "desktop");
  }

  if (process.platform === "win32") {
    return path.join(process.env.APPDATA ?? path.join(homedir(), "AppData", "Roaming"), "desktop");
  }

  return path.join(process.env.XDG_CONFIG_HOME ?? path.join(homedir(), ".config"), "desktop");
}

export function resolveDefaultDbPath(appEnv = "prod"): string {
  return path.join(getDefaultUserDataDir(), `post-${appEnv}.sqlite`);
}

export function resolveMigrationsFolder(): string {
  const moduleDir = path.dirname(fileURLToPath(import.meta.url));
  const candidates = [
    process.env.POST_CLI_MIGRATIONS_DIR,
    path.join(moduleDir, "drizzle"),
    path.join(moduleDir, "migrations"),
    path.join(getRepoRoot(), "packages", "db", "drizzle"),
    path.resolve(process.cwd(), "packages", "db", "drizzle"),
    path.resolve(process.cwd(), "..", "db", "drizzle"),
  ].filter((candidate): candidate is string => Boolean(candidate));

  const folder = candidates.find((candidate) => existsSync(candidate));
  if (!folder) {
    throw new Error(`Drizzle migrations folder was not found. Checked: ${candidates.join(", ")}`);
  }

  return folder;
}

export function openCliDatabase(input: { dbPath?: string; appEnv?: string }): DatabaseRuntime {
  const dbPath = path.resolve(input.dbPath ?? resolveDefaultDbPath(input.appEnv ?? "prod"));
  mkdirSync(path.dirname(dbPath), { recursive: true });

  const migrationsFolder = resolveMigrationsFolder();
  const db = createDatabase(dbPath);
  migrateDatabase(db, migrationsFolder);

  return { db, dbPath, migrationsFolder };
}
