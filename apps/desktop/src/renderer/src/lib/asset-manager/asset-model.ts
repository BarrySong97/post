/**
 * @purpose Support asset manager asset model behavior and data shaping.
 * @role    Renderer asset manager model module shared by pages, layout, and controls.
 * @deps    Asset tRPC types, React/HeroUI where UI is present, local storage or URL helpers as needed.
 * @gotcha  Keep asset kind/status/tag/view contracts synchronized with packages/db schema and saved-view JSON.
 */

import type { Asset, AssetKind, AssetStatus, IndexedAsset } from "@/lib/asset-manager/types";
import { buildAssetFileUrl, buildAssetThumbnailUrl } from "@/lib/asset-manager/asset-url";
import type {
  AssetFilterState,
  AssetSortOrder,
  AssetTimeFilter,
} from "@/store/asset-manager-atoms";

export function getTagHue(name: string): number {
  let hash = 0;
  for (let index = 0; index < name.length; index += 1) {
    hash = (hash * 31 + name.charCodeAt(index)) % 360;
  }

  return hash || 210;
}

function mapIndexedAssetKind(kind: IndexedAsset["kind"], extension?: string | null): AssetKind {
  if (kind === "markdown" || kind === "image" || kind === "video" || kind === "web") {
    return kind;
  }

  if (extension === "url" || extension === "webloc") {
    return "link";
  }

  return "file";
}

function mapIndexedAssetStatus(status: IndexedAsset["status"]): AssetStatus {
  if (status === "archived") {
    return "organized";
  }

  return status;
}

export function formatBytes(sizeBytes: number) {
  if (sizeBytes < 1024) {
    return `${sizeBytes} B`;
  }

  if (sizeBytes < 1024 * 1024) {
    return `${Math.round(sizeBytes / 1024)} KB`;
  }

  return `${(sizeBytes / 1024 / 1024).toFixed(1)} MB`;
}

// Hoisted to module scope: constructing an Intl.DateTimeFormat is expensive, and
// mapIndexedAsset runs once per asset (up to ~180 per hydrate batch). Reuse one instance.
const ASSET_TIME_FORMATTER = new Intl.DateTimeFormat("zh-CN", {
  month: "short",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});

function formatAssetTime(value: unknown) {
  const date = value instanceof Date ? value : new Date(value as string | number);

  if (Number.isNaN(date.getTime())) {
    return "刚刚";
  }

  return ASSET_TIME_FORMATTER.format(date);
}

function getAssetTimestampMs(value: unknown, fallbackMs = Date.now()) {
  if (value === null || value === undefined) {
    return fallbackMs;
  }

  const date = value instanceof Date ? value : new Date(value as string | number);
  return Number.isNaN(date.getTime()) ? fallbackMs : date.getTime();
}

export function mapIndexedAsset(asset: IndexedAsset): Asset {
  const tag = asset.tags[0]?.name ?? "待整理";
  const kind = mapIndexedAssetKind(asset.kind, asset.extension);
  const extension = asset.extension ?? asset.fileName.split(".").pop() ?? "file";
  const mediaUrl =
    kind === "image" || kind === "video" ? buildAssetFileUrl(asset.id, asset.fileName) : undefined;
  const usesOriginalAsThumbnail = kind === "image" && extension.toLowerCase() === "svg";
  const thumbnailUrl = usesOriginalAsThumbnail
    ? mediaUrl
    : (kind === "image" || kind === "video") &&
        asset.image?.status === "ready" &&
        asset.image.thumbnailPath
      ? buildAssetThumbnailUrl(asset.id, asset.fileName)
      : undefined;
  const metaPrefix = {
    markdown: "Markdown",
    image: "图片",
    video: "视频",
    link: "链接",
    web: "网页",
    file: extension.toUpperCase(),
  } satisfies Record<AssetKind, string>;

  const updatedTimestampMs = getAssetTimestampMs(asset.mtimeMs);

  return {
    id: asset.id,
    kind,
    status: mapIndexedAssetStatus(asset.status),
    privacy: asset.privacy,
    title: asset.title,
    body: asset.description ?? asset.markdown?.excerpt ?? undefined,
    source: `${asset.vaultName} / ${asset.relativePath}`,
    sourceType: "vault",
    fileExists: asset.fileExists,
    time: formatAssetTime(asset.mtimeMs),
    timestampMs: updatedTimestampMs,
    createdTimestampMs: getAssetTimestampMs(asset.ctimeMs, updatedTimestampMs),
    tag,
    tagIds: asset.tags.map((tagItem) => tagItem.id),
    meta: `${metaPrefix[kind]} · ${formatBytes(asset.sizeBytes)}`,
    accent: getTagHue(tag),
    height: kind === "image" || kind === "video" ? "medium" : "short",
    mediaUrl,
    thumbnailUrl,
    thumbnailStatus: asset.image?.status ?? (usesOriginalAsThumbnail ? "ready" : null),
    imageWidth: asset.image?.width,
    imageHeight: asset.image?.height,
    thumbnailWidth: asset.image?.thumbnailWidth,
    thumbnailHeight: asset.image?.thumbnailHeight,
    related: asset.relatedIds,
    fileExt: kind === "file" || kind === "image" || kind === "video" ? extension : undefined,
    imageCount: kind === "image" ? 1 : undefined,
  };
}

export function getActiveFilterCount(filters: AssetFilterState) {
  return (
    filters.types.length +
    filters.tags.length +
    filters.sources.length +
    (filters.time !== "any" ? 1 : 0) +
    (filters.status !== "any" ? 1 : 0) +
    (filters.sort !== "updated_desc" ? 1 : 0)
  );
}

export function getAssetSourceLabel(asset: Asset) {
  if (asset.sourceType === "vault") {
    return "资产库";
  }

  if (asset.sourceType === "external_file") {
    return "本地文件";
  }

  return "链接";
}

function getAssetTagNames(asset: Asset) {
  return asset.tag === "待整理" ? [] : [asset.tag];
}

function isAssetInTimeRange(asset: Asset, time: AssetTimeFilter) {
  if (time === "any" || time === "custom") {
    return true;
  }

  const date = new Date(asset.timestampMs);
  const now = new Date();
  const elapsedMs = Math.max(0, now.getTime() - asset.timestampMs);
  if (time === "today") {
    return date.toDateString() === now.toDateString();
  }

  if (time === "week") {
    return elapsedMs <= 7 * 24 * 60 * 60 * 1000;
  }

  return elapsedMs <= 30 * 24 * 60 * 60 * 1000;
}

function filterAssets(assetItems: readonly Asset[], filters: AssetFilterState) {
  const predicates: Array<(asset: Asset) => boolean> = [];

  if (filters.types.length > 0) {
    predicates.push((asset) =>
      filters.types.some((type) => {
        if (type === "link") {
          return asset.kind === "link" || asset.kind === "web";
        }

        return asset.kind === type;
      }),
    );
  }

  if (filters.tags.length > 0) {
    predicates.push((asset) => filters.tags.every((tag) => getAssetTagNames(asset).includes(tag)));
  }

  if (filters.sources.length > 0) {
    predicates.push((asset) => filters.sources.includes(getAssetSourceLabel(asset)));
  }

  if (filters.status !== "any") {
    predicates.push((asset) => asset.status === filters.status);
  }

  if (filters.time !== "any") {
    predicates.push((asset) => isAssetInTimeRange(asset, filters.time));
  }

  if (predicates.length === 0) {
    return [...assetItems];
  }

  return assetItems.filter((asset) => {
    const matches = predicates.map((predicate) => predicate(asset));
    return filters.match === "and" ? matches.every(Boolean) : matches.some(Boolean);
  });
}

function compareAssetTitles(a: Asset, b: Asset) {
  return a.title.localeCompare(b.title, "zh-Hans-CN");
}

function sortAssets(assetItems: readonly Asset[], sort: AssetSortOrder) {
  const [field, direction] = sort.split("_") as ["updated" | "created", "asc" | "desc"];
  const multiplier = direction === "asc" ? 1 : -1;

  return [...assetItems].sort((a, b) => {
    const aTimestamp = field === "created" ? a.createdTimestampMs : a.timestampMs;
    const bTimestamp = field === "created" ? b.createdTimestampMs : b.timestampMs;
    const timestampDelta = aTimestamp - bTimestamp;

    if (timestampDelta !== 0) {
      return timestampDelta * multiplier;
    }

    return compareAssetTitles(a, b);
  });
}

export function filterAndSortAssets(assetItems: readonly Asset[], filters: AssetFilterState) {
  return sortAssets(filterAssets(assetItems, filters), filters.sort);
}
