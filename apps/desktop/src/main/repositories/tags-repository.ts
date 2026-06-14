/**
 * @purpose Centralize SQLite reads and writes for tags data.
 * @role    Main-process persistence boundary between tRPC routers/services and Drizzle tables.
 * @deps    @post/db schema, drizzle-orm query helpers, main db connection utilities.
 * @gotcha  Keep query result shapes stable for routers and renderer models that consume them.
 */

import { randomUUID } from "node:crypto";

import { and, eq } from "drizzle-orm";

import { schema } from "@post/db";
import { getDatabase } from "../db";

export function upsertTag(vaultId: string, name: string, now: Date) {
  const existing = getDatabase()
    .select()
    .from(schema.tags)
    .where(and(eq(schema.tags.vaultId, vaultId), eq(schema.tags.name, name)))
    .get();
  if (existing) {
    return existing;
  }

  return getDatabase()
    .insert(schema.tags)
    .values({
      id: randomUUID(),
      vaultId,
      name,
      sortOrder: 0,
      createdAt: now,
      updatedAt: now,
    })
    .returning()
    .get();
}
