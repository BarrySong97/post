/**
 * @purpose Verify X Post capture keeps direct media unique and applies the selected tag to each asset.
 * @role    Integration coverage across resolver, Vault writes, and SQLite Post/media relationships.
 * @deps    Temporary Vault/database fixtures, mocked fetch, and the extension post import service.
 * @gotcha  The thumbnail queue is mocked so this test remains focused and offline.
 */

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";

import { schema, type Database } from "@post/db";
import { resetTestDatabase, setupTestDatabase } from "../test-utils/test-database";

vi.mock("./thumbnail-queue", () => ({ enqueueThumbnails: vi.fn() }));

import { saveExtensionPost } from "./extension-post-import-service";

describe("extension post import", () => {
  let db: Database;
  let vaultRoot: string;

  beforeEach(async () => {
    db = setupTestDatabase();
    vaultRoot = await mkdtemp(path.join(tmpdir(), "post-x-post-vault-"));
    const now = new Date("2026-07-21T00:00:00Z");
    db.insert(schema.vaults)
      .values({
        id: "vault-1",
        name: "X Clips",
        rootPath: vaultRoot,
        createdAt: now,
        updatedAt: now,
        lastOpenedAt: now,
        syncStatus: "idle",
      })
      .run();
    db.insert(schema.tags)
      .values({
        id: "tag-x",
        vaultId: "vault-1",
        name: "Research",
        sortOrder: 0,
        createdAt: now,
        updatedAt: now,
      })
      .run();
  });

  afterEach(async () => {
    vi.unstubAllGlobals();
    resetTestDatabase();
    await rm(vaultRoot, { recursive: true, force: true });
  });

  it("downloads one original image and applies the capture tag to the Post and child", async () => {
    const fetchMock = vi.fn(async (request: string | URL | Request) => {
      const url = String(request);
      if (url.startsWith("https://cdn.syndication.twimg.com/tweet-result")) {
        return new Response(
          JSON.stringify({
            id_str: "2077941050652623196",
            text: "Captured post",
            user: { screen_name: "example" },
            mediaDetails: [
              {
                type: "photo",
                media_url_https: "https://pbs.twimg.com/media/Example123.jpg?name=small",
              },
            ],
            photos: [
              {
                url: "https://pbs.twimg.com/media/Example123?format=jpg&name=medium",
              },
            ],
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      expect(url).toContain("name=orig");
      return new Response(Buffer.from("original-image-bytes"), {
        status: 200,
        headers: { "content-type": "image/jpeg" },
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await saveExtensionPost({
      postId: "2077941050652623196",
      canonicalUrl: "https://x.com/example/status/2077941050652623196",
      visibleSnapshot: {
        mediaUrls: ["https://pbs.twimg.com/media/Example123.jpg?name=360x360"],
      },
      tagId: "tag-x",
      vaultId: "vault-1",
    });

    expect(result.childAssetIds).toHaveLength(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const childAssetId = result.childAssetIds[0];
    expect(
      db
        .select({ assetId: schema.assetTags.assetId })
        .from(schema.assetTags)
        .where(eq(schema.assetTags.tagId, "tag-x"))
        .all()
        .map((row) => row.assetId)
        .sort(),
    ).toEqual([childAssetId, result.assetId].sort());
    expect(
      db
        .select({ targetAssetId: schema.assetLinks.targetAssetId })
        .from(schema.assetLinks)
        .where(eq(schema.assetLinks.sourceAssetId, result.assetId))
        .all(),
    ).toEqual([{ targetAssetId: childAssetId }]);
  });
});
