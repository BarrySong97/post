/**
 * @purpose Verify image gallery use-case invariants.
 * @role    Focused Vitest coverage for gallery membership, cover, delete, and missing semantics.
 * @deps    Vitest, temporary SQLite helper, @post/db schema, gallery use cases.
 * @gotcha  Gallery tests intentionally preserve missing files but use real FK cascade for asset deletion.
 */

import { afterEach, describe, expect, it } from "vitest";
import { TRPCError } from "@trpc/server";

import { schema, type Database } from "@post/db";
import { eq } from "drizzle-orm";
import { setupTestDatabase, resetTestDatabase } from "../test-utils/test-database";
import { createGallery, deleteGallery, getGalleryById, removeGalleryItems } from "./galleries";

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

function seedImage(db: Database, id: string, options: { fileExists?: boolean } = {}) {
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
}

function setupGalleryFixture() {
  const db = setupTestDatabase();
  seedVault(db);
  seedImage(db, "img-a");
  seedImage(db, "img-b");
  seedImage(db, "img-c");
  return db;
}

afterEach(() => {
  resetTestDatabase();
});

describe("gallery use cases", () => {
  it("creates a gallery with the first selected image as cover", () => {
    setupGalleryFixture();

    const detail = createGallery({
      vaultId: "vault-1",
      title: "Login flow",
      assetIds: ["img-a", "img-b"],
    });

    expect(detail.gallery.title).toBe("Login flow");
    expect(detail.gallery.coverAssetId).toBe("img-a");
    expect(detail.members.map((member) => member.asset.id)).toEqual(["img-a", "img-b"]);
  });

  it("prevents an image from belonging to two folded galleries", () => {
    setupGalleryFixture();
    createGallery({
      vaultId: "vault-1",
      title: "First",
      assetIds: ["img-a", "img-b"],
    });

    expect(() =>
      createGallery({
        vaultId: "vault-1",
        title: "Second",
        assetIds: ["img-a", "img-c"],
      }),
    ).toThrow(TRPCError);
  });

  it("keeps missing members in gallery detail", () => {
    const db = setupGalleryFixture();
    const detail = createGallery({
      vaultId: "vault-1",
      title: "Missing state",
      assetIds: ["img-a", "img-b"],
    });

    db.update(schema.assetFiles)
      .set({ fileExists: false, missingSince: NOW })
      .where(eq(schema.assetFiles.assetId, "img-b"))
      .run();

    const nextDetail = getGalleryById(detail.gallery.id);
    expect(nextDetail.members.map((member) => [member.asset.id, member.file.fileExists])).toEqual([
      ["img-a", true],
      ["img-b", false],
    ]);
  });

  it("deletes a gallery without deleting member images", () => {
    const db = setupGalleryFixture();
    const detail = createGallery({
      vaultId: "vault-1",
      title: "Delete me",
      assetIds: ["img-a", "img-b"],
    });

    deleteGallery(detail.gallery.id);

    const assets = db.select().from(schema.assets).all();
    const memberships = db.select().from(schema.assetGalleryItems).all();
    expect(assets.map((asset) => asset.id).sort()).toEqual(["img-a", "img-b", "img-c"]);
    expect(memberships).toEqual([]);
  });

  it("repairs cover selection when the cover asset is permanently deleted", () => {
    const db = setupGalleryFixture();
    const detail = createGallery({
      vaultId: "vault-1",
      title: "Repair cover",
      assetIds: ["img-a", "img-b", "img-c"],
    });

    db.delete(schema.assets).where(eq(schema.assets.id, "img-a")).run();

    const nextDetail = getGalleryById(detail.gallery.id);
    expect(nextDetail.gallery.coverAssetId).toBe("img-b");
    expect(nextDetail.members.map((member) => member.asset.id)).toEqual(["img-b", "img-c"]);
  });

  it("soft-deletes the gallery when the last member is removed", () => {
    setupGalleryFixture();
    const detail = createGallery({
      vaultId: "vault-1",
      title: "Single draft",
      assetIds: ["img-a"],
    });

    const nextDetail = removeGalleryItems({ galleryId: detail.gallery.id, assetIds: ["img-a"] });

    expect(nextDetail).toBeNull();
    expect(() => getGalleryById(detail.gallery.id)).toThrow(TRPCError);
  });
});
