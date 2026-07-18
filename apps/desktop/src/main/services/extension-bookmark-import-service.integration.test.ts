/**
 * @purpose Verify bookmark create/update/copy behavior across Vault files and SQLite metadata.
 * @role    Focused integration coverage for the extension bookmark import service.
 * @deps    Temporary Vault directories, migrated test database, and Drizzle schema.
 * @gotcha  Fixtures omit remote covers so tests stay offline and avoid Electron cache paths.
 */

import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { asc, eq } from "drizzle-orm";

import { schema, type Database } from "@post/db";
import { getAssetPage } from "../repositories/assets-repository";
import { resetTestDatabase, setupTestDatabase } from "../test-utils/test-database";
import {
  lookupExtensionBookmarks,
  saveExtensionBookmark,
} from "./extension-bookmark-import-service";

describe("extension bookmark import", () => {
  let db: Database;
  let vaultRoot: string;

  beforeEach(async () => {
    db = setupTestDatabase();
    vaultRoot = await mkdtemp(path.join(tmpdir(), "post-bookmark-vault-"));
    const now = new Date("2026-07-18T00:00:00Z");
    db.insert(schema.vaults)
      .values({
        id: "vault-1",
        name: "Bookmarks",
        rootPath: vaultRoot,
        createdAt: now,
        updatedAt: now,
        lastOpenedAt: now,
        syncStatus: "idle",
      })
      .run();
    db.insert(schema.tags)
      .values([
        {
          id: "tag-a",
          vaultId: "vault-1",
          name: "Research",
          sortOrder: 0,
          createdAt: now,
          updatedAt: now,
        },
        {
          id: "tag-b",
          vaultId: "vault-1",
          name: "Design",
          sortOrder: 1,
          createdAt: now,
          updatedAt: now,
        },
      ])
      .run();
  });

  afterEach(async () => {
    resetTestDatabase();
    await rm(vaultRoot, { recursive: true, force: true });
  });

  it("preserves user fields on update and allocates an independent copy", async () => {
    const capture = {
      kind: "youtube" as const,
      videoId: "video123",
      canonicalUrl: "https://youtu.be/video123",
      pageUrl: "https://www.youtube.com/watch?v=video123",
      sourceTitle: "Source title",
      description: "Description",
      channelName: "Channel",
      publishedAt: "2026-07-17T00:00:00Z",
      durationMs: 42_000,
      liveStatus: "none" as const,
      capturedAt: Date.parse("2026-07-18T00:00:00Z"),
    };
    const created = await saveExtensionBookmark({
      capture,
      titleOverride: "My title",
      note: "Keep this note",
      tagIds: ["tag-a"],
      action: "create",
      vaultId: "vault-1",
    });

    expect(created.status).toBe("created");
    expect(await readFile(path.join(vaultRoot, created.relativePath), "utf8")).toBe(
      "[InternetShortcut]\nURL=https://www.youtube.com/watch?v=video123\n",
    );

    const updated = await saveExtensionBookmark({
      capture: { ...capture, sourceTitle: "Refreshed source title" },
      titleOverride: "Ignored replacement",
      note: "Ignored replacement note",
      tagIds: ["tag-b"],
      action: "update",
      vaultId: "vault-1",
    });
    expect(updated).toMatchObject({
      assetId: created.assetId,
      title: "My title",
      status: "updated",
    });
    expect(
      db
        .select()
        .from(schema.youtubeCache)
        .where(eq(schema.youtubeCache.assetId, created.assetId))
        .get(),
    ).toMatchObject({
      sourceTitle: "Refreshed source title",
      titleOverride: "My title",
      note: "Keep this note",
      copyIndex: 0,
    });
    expect(
      db
        .select({ tagId: schema.assetTags.tagId })
        .from(schema.assetTags)
        .where(eq(schema.assetTags.assetId, created.assetId))
        .all()
        .map((row) => row.tagId)
        .sort(),
    ).toEqual(["tag-a", "tag-b"]);

    const copy = await saveExtensionBookmark({
      capture,
      titleOverride: "Project copy",
      note: "Different context",
      tagIds: [],
      action: "copy",
      vaultId: "vault-1",
    });
    expect(copy.status).toBe("created");
    expect(copy.relativePath).toBe("assets/web-clips/youtube/video123-2.url");
    expect(
      db
        .select({ copyIndex: schema.youtubeCache.copyIndex })
        .from(schema.youtubeCache)
        .orderBy(asc(schema.youtubeCache.copyIndex))
        .all(),
    ).toEqual([{ copyIndex: 0 }, { copyIndex: 1 }]);
    expect(lookupExtensionBookmarks({ capture, vaultId: "vault-1" })).toHaveLength(2);

    expect(
      getAssetPage({ vaultId: "vault-1", typeFilters: ["youtube"], limit: 10 })
        .items.map((item) => item.id)
        .sort(),
    ).toEqual([copy.assetId, created.assetId].sort());
    expect(getAssetPage({ vaultId: "vault-1", typeFilters: ["link"], limit: 10 }).items).toEqual(
      [],
    );
  });
});
