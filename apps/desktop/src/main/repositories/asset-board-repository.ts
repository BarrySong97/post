/**
 * @purpose Build gallery-aware asset board display projections.
 * @role    Main-process repository that folds image gallery members into gallery cards.
 * @deps    Asset and gallery repositories plus shared SQLite schema types.
 * @gotcha  This returns display items, not raw assets; keep raw asset APIs on assets-repository.
 */

import type { AssetGalleryRecord } from "@post/db";

import {
  getAssetPage,
  type AssetListItem,
  type AssetListPageInput,
  type AssetListSort,
  type AssetListTimeFilter,
} from "./assets-repository";
import {
  type GalleryDetail,
  type GalleryMemberRow,
  getGalleryDetails,
} from "./galleries-repository";

const BOARD_SCAN_LIMIT = 100_000;
const DAY_MS = 24 * 60 * 60 * 1000;

export type GalleryListItem = {
  id: string;
  vaultId: string;
  title: string;
  description: string | null;
  status: AssetGalleryRecord["status"];
  privacy: AssetGalleryRecord["privacy"];
  coverAssetId: string | null;
  memberCount: number;
  missingCount: number;
  createdAt: Date;
  updatedAt: Date;
  cover: AssetListItem | null;
  previewAssetIds: string[];
};

export type AssetBoardItem =
  | {
      itemType: "asset";
      id: string;
      sortValueMs: number;
      asset: AssetListItem;
    }
  | {
      itemType: "gallery";
      id: string;
      sortValueMs: number;
      gallery: GalleryListItem;
    };

export type AssetBoardPage = {
  items: AssetBoardItem[];
  total: number;
  nextCursor: AssetListPageInput["cursor"] | null;
};

function getTimestampMs(value: Date | number | string | null | undefined, fallback = Date.now()) {
  if (value === null || value === undefined) {
    return fallback;
  }

  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? fallback : date.getTime();
}

function getAssetSortValue(asset: AssetListItem, sort: AssetListSort) {
  if (sort.startsWith("created")) {
    return getTimestampMs(asset.ctimeMs, getTimestampMs(asset.mtimeMs));
  }

  return getTimestampMs(asset.mtimeMs);
}

function getGallerySortValue(gallery: AssetGalleryRecord, sort: AssetListSort) {
  return getTimestampMs(sort.startsWith("created") ? gallery.createdAt : gallery.updatedAt);
}

function isInTimeRange(updatedAt: Date, timeFilter: AssetListTimeFilter | undefined) {
  if (!timeFilter || timeFilter === "any") {
    return true;
  }

  const timestampMs = updatedAt.getTime();
  if (timeFilter === "today") {
    const now = new Date();
    const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    return timestampMs >= startOfDay;
  }

  const elapsedMs = timeFilter === "week" ? 7 * DAY_MS : 30 * DAY_MS;
  return timestampMs >= Date.now() - elapsedMs;
}

function galleryMatchesTags(gallery: GalleryDetail, input: AssetListPageInput) {
  if (input.untagged) {
    return gallery.members.every((member) => member.tags.length === 0);
  }

  if (!input.tagIds?.length) {
    return true;
  }

  const tagIds = new Set(gallery.members.flatMap((member) => member.tags.map((tag) => tag.id)));
  if (input.tagMatch === "or") {
    return input.tagIds.some((tagId) => tagIds.has(tagId));
  }

  return input.tagIds.every((tagId) => tagIds.has(tagId));
}

function galleryMatchesBoardFilters(gallery: GalleryDetail, input: AssetListPageInput) {
  if (gallery.members.length < 2) {
    return false;
  }

  if (input.typeFilters?.length && !input.typeFilters.includes("image")) {
    return false;
  }

  if (input.sourceTypes?.length && !input.sourceTypes.includes("vault")) {
    return false;
  }

  if (input.statusFilter && gallery.gallery.status !== input.statusFilter) {
    return false;
  }

  if (!isInTimeRange(gallery.gallery.updatedAt, input.timeFilter)) {
    return false;
  }

  return galleryMatchesTags(gallery, input);
}

function memberToAssetListItem(member: GalleryMemberRow): AssetListItem {
  return {
    id: member.asset.id,
    vaultId: member.asset.vaultId,
    kind: member.asset.kind,
    status: member.asset.status,
    privacy: member.asset.privacy,
    title: member.asset.title,
    description: member.asset.description,
    relativePath: member.file.relativePath,
    fileName: member.file.fileName,
    extension: member.file.extension,
    sizeBytes: member.file.sizeBytes,
    mtimeMs: member.file.mtimeMs,
    ctimeMs: member.file.ctimeMs,
    fileExists: member.file.fileExists,
    quickFingerprint: member.file.quickFingerprint,
    vaultRootPath: member.vault.rootPath,
    vaultName: member.vault.name,
    markdown: null,
    image: member.image,
    tags: member.tags,
    relatedIds: [],
  };
}

function galleryToListItem(gallery: GalleryDetail): GalleryListItem {
  const coverMember =
    gallery.members.find((member) => member.asset.id === gallery.gallery.coverAssetId) ??
    gallery.members[0] ??
    null;

  return {
    id: gallery.gallery.id,
    vaultId: gallery.gallery.vaultId,
    title: gallery.gallery.title,
    description: gallery.gallery.description,
    status: gallery.gallery.status,
    privacy: gallery.gallery.privacy,
    coverAssetId: gallery.gallery.coverAssetId,
    memberCount: gallery.members.length,
    missingCount: gallery.members.filter((member) => !member.file.fileExists).length,
    createdAt: gallery.gallery.createdAt,
    updatedAt: gallery.gallery.updatedAt,
    cover: coverMember ? memberToAssetListItem(coverMember) : null,
    previewAssetIds: gallery.members.slice(0, 6).map((member) => member.asset.id),
  };
}

function getBoardItemKey(item: AssetBoardItem) {
  return `${item.itemType}:${item.id}`;
}

function compareBoardItems(sort: AssetListSort, a: AssetBoardItem, b: AssetBoardItem) {
  const multiplier = sort.endsWith("asc") ? 1 : -1;
  const timestampDelta = a.sortValueMs - b.sortValueMs;
  if (timestampDelta !== 0) {
    return timestampDelta * multiplier;
  }

  return getBoardItemKey(a).localeCompare(getBoardItemKey(b));
}

export function getAssetBoardPage(input: AssetListPageInput): AssetBoardPage {
  const sort = input.sort ?? "updated_desc";
  const galleries = getGalleryDetails(input.vaultId);
  const foldedGalleries = galleries.filter((gallery) => gallery.members.length >= 2);
  const foldedAssetIds = new Set(
    foldedGalleries.flatMap((gallery) => gallery.members.map((member) => member.asset.id)),
  );
  const assetPage = getAssetPage({
    ...input,
    cursor: undefined,
    limit: BOARD_SCAN_LIMIT,
  });
  const assetItems: AssetBoardItem[] = assetPage.items
    .filter((asset) => !foldedAssetIds.has(asset.id))
    .map((asset) => ({
      itemType: "asset" as const,
      id: asset.id,
      sortValueMs: getAssetSortValue(asset, sort),
      asset,
    }));
  const galleryItems: AssetBoardItem[] = foldedGalleries
    .filter((gallery) => galleryMatchesBoardFilters(gallery, input))
    .map((gallery) => ({
      itemType: "gallery" as const,
      id: gallery.gallery.id,
      sortValueMs: getGallerySortValue(gallery.gallery, sort),
      gallery: galleryToListItem(gallery),
    }));
  const allItems = [...assetItems, ...galleryItems].sort((a, b) => compareBoardItems(sort, a, b));
  const cursorKey = input.cursor?.id;
  const startIndex = cursorKey
    ? Math.max(0, allItems.findIndex((item) => getBoardItemKey(item) === cursorKey) + 1)
    : 0;
  const pageItems = allItems.slice(startIndex, startIndex + input.limit);
  const overflowItem = allItems[startIndex + input.limit];

  return {
    items: pageItems,
    total: allItems.length,
    nextCursor: overflowItem
      ? {
          valueMs: overflowItem.sortValueMs,
          id: getBoardItemKey(overflowItem),
        }
      : null,
  };
}
