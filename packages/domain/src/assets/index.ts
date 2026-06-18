/**
 * @purpose Implement reusable asset lookup helpers for organization workflows.
 * @role    Domain query module for CLI and desktop use cases that need asset targets.
 * @deps    Domain context/errors, @post/db schema, drizzle query helpers.
 * @gotcha  These queries never mutate vault files; assets are only CLI operation targets.
 */

import { and, asc, desc, eq, inArray, isNull, like } from "drizzle-orm";

import { schema, type AssetKind, type AssetStatus } from "@post/db";

import type { DomainContext } from "../context";
import { DomainError } from "../errors";
import { getActiveVaultOrThrow } from "../vaults/index";

export type AssetQueryInput = {
  vaultId?: string;
  kind?: AssetKind;
  status?: AssetStatus;
  tagId?: string;
  search?: string;
  limit?: number;
};

export function getAssetOrThrow(ctx: DomainContext, assetId: string) {
  const row = ctx.db
    .select({
      asset: schema.assets,
      file: schema.assetFiles,
      image: schema.imageCache,
      vault: schema.vaults,
    })
    .from(schema.assets)
    .innerJoin(schema.assetFiles, eq(schema.assetFiles.assetId, schema.assets.id))
    .innerJoin(schema.vaults, eq(schema.vaults.id, schema.assets.vaultId))
    .leftJoin(schema.imageCache, eq(schema.imageCache.assetId, schema.assets.id))
    .where(and(eq(schema.assets.id, assetId), isNull(schema.assets.deletedAt)))
    .get();

  if (!row) {
    throw new DomainError("ASSET_NOT_FOUND", "Asset not found", { status: "NOT_FOUND" });
  }

  return row;
}

export function listAssets(ctx: DomainContext, input: AssetQueryInput = {}) {
  const vault = getActiveVaultOrThrow(ctx, input.vaultId);
  const filters = [eq(schema.assets.vaultId, vault.id), isNull(schema.assets.deletedAt)];

  if (input.kind) {
    filters.push(eq(schema.assets.kind, input.kind));
  }

  if (input.status) {
    filters.push(eq(schema.assets.status, input.status));
  }

  if (input.search?.trim()) {
    filters.push(like(schema.assets.title, `%${input.search.trim()}%`));
  }

  const base = ctx.db
    .select({
      asset: schema.assets,
      file: schema.assetFiles,
      image: schema.imageCache,
      vault: schema.vaults,
    })
    .from(schema.assets)
    .innerJoin(schema.assetFiles, eq(schema.assetFiles.assetId, schema.assets.id))
    .innerJoin(schema.vaults, eq(schema.vaults.id, schema.assets.vaultId))
    .leftJoin(schema.imageCache, eq(schema.imageCache.assetId, schema.assets.id));

  const query = input.tagId
    ? base
        .innerJoin(schema.assetTags, eq(schema.assetTags.assetId, schema.assets.id))
        .where(and(...filters, eq(schema.assetTags.tagId, input.tagId)))
    : base.where(and(...filters));

  return query
    .orderBy(desc(schema.assetFiles.mtimeMs), asc(schema.assets.title))
    .limit(input.limit ?? 80)
    .all();
}

export function getAssetTags(ctx: DomainContext, assetId: string) {
  getAssetOrThrow(ctx, assetId);

  return ctx.db
    .select({
      assetId: schema.assetTags.assetId,
      tag: schema.tags,
    })
    .from(schema.assetTags)
    .innerJoin(schema.tags, eq(schema.tags.id, schema.assetTags.tagId))
    .where(eq(schema.assetTags.assetId, assetId))
    .orderBy(asc(schema.tags.sortOrder), asc(schema.tags.name))
    .all();
}

export function getImageAssetIdsOrThrow(
  ctx: DomainContext,
  vaultId: string,
  assetIds: readonly string[],
): string[] {
  const uniqueAssetIds = Array.from(new Set(assetIds));
  if (uniqueAssetIds.length === 0) {
    return [];
  }

  const rows = ctx.db
    .select({
      id: schema.assets.id,
      kind: schema.assets.kind,
      vaultId: schema.assets.vaultId,
    })
    .from(schema.assets)
    .where(
      and(
        eq(schema.assets.vaultId, vaultId),
        inArray(schema.assets.id, uniqueAssetIds),
        isNull(schema.assets.deletedAt),
      ),
    )
    .all();
  const rowsById = new Map(rows.map((row) => [row.id, row]));

  for (const assetId of uniqueAssetIds) {
    const row = rowsById.get(assetId);
    if (!row) {
      throw new DomainError("GALLERY_ASSET_UNKNOWN", "Gallery references unknown assets");
    }

    if (row.kind !== "image") {
      throw new DomainError("GALLERY_MEMBER_NOT_IMAGE", "Gallery members must be images");
    }
  }

  return uniqueAssetIds;
}
