/**
 * @purpose Verify folded gallery projection rules for the asset board.
 * @role    Focused Vitest coverage for normal asset cards versus gallery cards.
 * @deps    Vitest, temporary SQLite helper, gallery use cases, asset-board repository.
 * @gotcha  Board projection hides members only when a gallery has at least two members.
 */

import { afterEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";

import { schema, type Database } from "@post/db";
import { setupTestDatabase, resetTestDatabase } from "../test-utils/test-database";
import { createGallery, deleteGallery } from "../use-cases/galleries";
import { getAssetBoardPage } from "./asset-board-repository";

const NOW = new Date("2026-06-15T00:00:00.000Z");

function seedVault(db: Database) {
  db.insert(schema.vaults)
    .values({
      id: "vault-1",
      name: "Vault",
      rootPath: "/tmp/vault",
      createdAt: NOW,
      updatedAt: NOW,
      lastOpenedAt: NOW,
      syncStatus: "idle",
    })
    .run();
}

function seedTag(db: Database, id: string, name: string) {
  db.insert(schema.tags)
    .values({
      id,
      vaultId: "vault-1",
      name,
      sortOrder: 0,
      createdAt: NOW,
      updatedAt: NOW,
    })
    .run();
}

function seedImage(
  db: Database,
  id: string,
  options: { tagId?: string; fileExists?: boolean } = {},
) {
  db.insert(schema.assets)
    .values({
      id,
      vaultId: "vault-1",
      kind: "image",
      status: "inbox",
      privacy: "normal",
      title: `${id}.png`,
      createdAt: NOW,
      updatedAt: NOW,
      indexedAt: NOW,
    })
    .run();
  db.insert(schema.assetFiles)
    .values({
      id: `file-${id}`,
      assetId: id,
      vaultId: "vault-1",
      relativePath: `${id}.png`,
      fileName: `${id}.png`,
      extension: "png",
      mimeType: "image/png",
      sizeBytes: 10,
      mtimeMs: NOW,
      ctimeMs: NOW,
      fileExists: options.fileExists ?? true,
      firstSeenAt: NOW,
      lastSeenAt: NOW,
    })
    .run();

  if (options.tagId) {
    db.insert(schema.assetTags).values({ assetId: id, tagId: options.tagId, createdAt: NOW }).run();
  }
}

function setupBoardFixture() {
  const db = setupTestDatabase();
  seedVault(db);
  seedTag(db, "tag-ui", "UI");
  seedImage(db, "img-a", { tagId: "tag-ui" });
  seedImage(db, "img-b");
  seedImage(db, "img-c");
  return db;
}

afterEach(() => {
  resetTestDatabase();
});

describe("getAssetBoardPage", () => {
  it("does not fold a one-member gallery", () => {
    setupBoardFixture();
    createGallery({
      vaultId: "vault-1",
      title: "Draft stack",
      assetIds: ["img-a"],
    });

    const page = getAssetBoardPage({ vaultId: "vault-1", limit: 20 });

    expect(page.items.map((item) => `${item.itemType}:${item.id}`).sort()).toEqual([
      "asset:img-a",
      "asset:img-b",
      "asset:img-c",
    ]);
  });

  it("folds a two-member gallery into one gallery card", () => {
    setupBoardFixture();
    const detail = createGallery({
      vaultId: "vault-1",
      title: "Folded stack",
      assetIds: ["img-a", "img-b"],
    });

    const page = getAssetBoardPage({ vaultId: "vault-1", limit: 20 });

    expect(page.items.map((item) => `${item.itemType}:${item.id}`).sort()).toEqual([
      "asset:img-c",
      `gallery:${detail.gallery.id}`,
    ]);
    const galleryItem = page.items.find((item) => item.itemType === "gallery");
    expect(galleryItem?.itemType === "gallery" ? galleryItem.gallery.memberCount : 0).toBe(2);
  });

  it("restores member assets to the board after deleting a gallery", () => {
    setupBoardFixture();
    const detail = createGallery({
      vaultId: "vault-1",
      title: "Temporary stack",
      assetIds: ["img-a", "img-b"],
    });
    deleteGallery(detail.gallery.id);

    const page = getAssetBoardPage({ vaultId: "vault-1", limit: 20 });

    expect(page.items.map((item) => `${item.itemType}:${item.id}`).sort()).toEqual([
      "asset:img-a",
      "asset:img-b",
      "asset:img-c",
    ]);
  });

  it("matches gallery cards through member tags", () => {
    setupBoardFixture();
    const detail = createGallery({
      vaultId: "vault-1",
      title: "Tagged stack",
      assetIds: ["img-a", "img-b"],
    });

    const page = getAssetBoardPage({
      vaultId: "vault-1",
      limit: 20,
      typeFilters: ["image"],
      tagIds: ["tag-ui"],
    });

    expect(page.items.map((item) => `${item.itemType}:${item.id}`)).toEqual([
      `gallery:${detail.gallery.id}`,
    ]);
  });

  it("counts missing gallery members without dropping the gallery card", () => {
    const db = setupBoardFixture();
    const detail = createGallery({
      vaultId: "vault-1",
      title: "Missing stack",
      assetIds: ["img-a", "img-b"],
    });
    db.update(schema.assetFiles)
      .set({ fileExists: false, missingSince: NOW })
      .where(eq(schema.assetFiles.assetId, "img-b"))
      .run();

    const page = getAssetBoardPage({ vaultId: "vault-1", limit: 20 });
    const galleryItem = page.items.find((item) => item.itemType === "gallery");

    expect(galleryItem?.itemType === "gallery" ? galleryItem.gallery.id : "").toBe(
      detail.gallery.id,
    );
    expect(galleryItem?.itemType === "gallery" ? galleryItem.gallery.missingCount : 0).toBe(1);
  });
});
