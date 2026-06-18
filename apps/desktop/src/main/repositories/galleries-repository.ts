/**
 * @purpose Centralize SQLite reads and writes for image gallery data.
 * @role    Main-process persistence boundary for gallery use cases and board projections.
 * @deps    @post/db schema, Drizzle query helpers, main db connection utilities.
 * @gotcha  Gallery membership preserves missing files; do not filter members by file_exists here.
 */

import { and, asc, eq, inArray, isNull } from "drizzle-orm";

import { schema } from "@post/db";
import { getDatabase } from "../db";

export type GalleryMemberRow = {
  item: typeof schema.assetGalleryItems.$inferSelect;
  asset: typeof schema.assets.$inferSelect;
  file: typeof schema.assetFiles.$inferSelect;
  vault: typeof schema.vaults.$inferSelect;
  image: typeof schema.imageCache.$inferSelect | null;
  tags: Array<typeof schema.tags.$inferSelect>;
};

export type GalleryDetail = {
  gallery: typeof schema.assetGalleries.$inferSelect;
  members: GalleryMemberRow[];
};

function attachTagsToMembers(members: Array<Omit<GalleryMemberRow, "tags">>): GalleryMemberRow[] {
  const assetIds = members.map((member) => member.asset.id);
  if (assetIds.length === 0) {
    return members.map((member) => ({ ...member, tags: [] }));
  }

  const tagRows = getDatabase()
    .select({
      assetId: schema.assetTags.assetId,
      tag: schema.tags,
    })
    .from(schema.assetTags)
    .innerJoin(schema.tags, eq(schema.tags.id, schema.assetTags.tagId))
    .where(inArray(schema.assetTags.assetId, assetIds))
    .all();
  const tagsByAsset = new Map<string, Array<typeof schema.tags.$inferSelect>>();

  for (const row of tagRows) {
    const tags = tagsByAsset.get(row.assetId) ?? [];
    tags.push(row.tag);
    tagsByAsset.set(row.assetId, tags);
  }

  return members.map((member) => ({
    ...member,
    tags: tagsByAsset.get(member.asset.id) ?? [],
  }));
}

export function getGalleryRecord(galleryId: string) {
  return getDatabase()
    .select()
    .from(schema.assetGalleries)
    .where(and(eq(schema.assetGalleries.id, galleryId), isNull(schema.assetGalleries.deletedAt)))
    .get();
}

export function getGalleryDetails(vaultId: string): GalleryDetail[] {
  const galleries = getDatabase()
    .select()
    .from(schema.assetGalleries)
    .where(and(eq(schema.assetGalleries.vaultId, vaultId), isNull(schema.assetGalleries.deletedAt)))
    .all();

  return galleries.map((gallery) => ({
    gallery,
    members: getGalleryMembers(gallery.id),
  }));
}

export function getGalleryDetail(galleryId: string): GalleryDetail | null {
  const gallery = getGalleryRecord(galleryId);
  if (!gallery) {
    return null;
  }

  return {
    gallery,
    members: getGalleryMembers(gallery.id),
  };
}

export function getGalleryMembers(galleryId: string): GalleryMemberRow[] {
  const rows = getDatabase()
    .select({
      item: schema.assetGalleryItems,
      asset: schema.assets,
      file: schema.assetFiles,
      vault: schema.vaults,
      image: schema.imageCache,
    })
    .from(schema.assetGalleryItems)
    .innerJoin(schema.assets, eq(schema.assets.id, schema.assetGalleryItems.assetId))
    .innerJoin(schema.assetFiles, eq(schema.assetFiles.assetId, schema.assets.id))
    .innerJoin(schema.vaults, eq(schema.vaults.id, schema.assets.vaultId))
    .leftJoin(schema.imageCache, eq(schema.imageCache.assetId, schema.assets.id))
    .where(and(eq(schema.assetGalleryItems.galleryId, galleryId), isNull(schema.assets.deletedAt)))
    .orderBy(asc(schema.assetGalleryItems.sortOrder), asc(schema.assets.title))
    .all();

  return attachTagsToMembers(rows);
}

export function getAssetGalleryMemberships(assetIds: readonly string[]) {
  if (assetIds.length === 0) {
    return [];
  }

  return getDatabase()
    .select()
    .from(schema.assetGalleryItems)
    .where(inArray(schema.assetGalleryItems.assetId, [...assetIds]))
    .all();
}

export function getGalleryMemberIds(galleryId: string) {
  return getDatabase()
    .select({ assetId: schema.assetGalleryItems.assetId })
    .from(schema.assetGalleryItems)
    .where(eq(schema.assetGalleryItems.galleryId, galleryId))
    .all()
    .map((row) => row.assetId);
}
