/**
 * @purpose Resolve the app database path and initialize the desktop SQLite database.
 * @role    Main-process database bootstrap used before routers and services access data.
 * @deps    Electron app userData path, @post/db connection helpers.
 * @gotcha  Dev/prod database filenames differ; avoid hardcoding paths outside this layer.
 */

import { app } from "electron";
import { is } from "@electron-toolkit/utils";
import { existsSync } from "node:fs";
import path from "node:path";

import { createDatabase, migrateDatabase, type Database } from "@post/db";

let db: Database | null = null;

export function getDatabasePath(): string {
  const appEnv = (import.meta.env.VITE_APP_ENV ?? (is.dev ? "dev" : "prod")).toLowerCase();
  return path.join(app.getPath("userData"), `post-${appEnv}.sqlite`);
}

export function getMigrationsFolder(): string {
  if (is.dev) {
    return path.resolve(process.cwd(), "../../packages/db/drizzle");
  }

  return path.join(process.resourcesPath, "drizzle");
}

export function initDatabase(): Database {
  const database = createDatabase(getDatabasePath());
  const migrationsFolder = getMigrationsFolder();

  if (!existsSync(migrationsFolder)) {
    throw new Error(`Drizzle migrations folder was not found: ${migrationsFolder}`);
  }

  migrateDatabase(database, migrationsFolder);
  db = database;

  return database;
}

export function getDatabase(): Database {
  if (!db) {
    throw new Error("Database has not been initialized");
  }

  return db;
}
