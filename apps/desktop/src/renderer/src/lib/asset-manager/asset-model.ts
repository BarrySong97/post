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
import i18n from "@/i18n";

export function extractDomain(rawUrl: string | null | undefined): string | undefined {
  if (!rawUrl) {
    return undefined;
  }

  try {
    return new URL(rawUrl).hostname.replace(/^www\./, "");
  } catch {
    return undefined;
  }
}

// Hoisted like ASSET_TIME_FORMATTER: reused once per post asset per hydrate batch.
const POST_DATE_FORMATTER = new Intl.DateTimeFormat("zh-CN", {
  month: "short",
  day: "numeric",
});

function formatPostDate(value: unknown): string | undefined {
  if (value === null || value === undefined) {
    return undefined;
  }

  const date = value instanceof Date ? value : new Date(value as string | number);
  return Number.isNaN(date.getTime()) ? undefined : POST_DATE_FORMATTER.format(date);
}

export function getTagHue(name: string): number {
  let hash = 0;
  for (let index = 0; index < name.length; index += 1) {
    hash = (hash * 31 + name.charCodeAt(index)) % 360;
  }

  return hash || 210;
}

function mapIndexedAssetKind(kind: IndexedAsset["kind"], extension?: string | null): AssetKind {
  if (
    kind === "markdown" ||
    kind === "post" ||
    kind === "image" ||
    kind === "video" ||
    kind === "youtube" ||
    kind === "web"
  ) {
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
    return i18n.t("assets.justNow");
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

export function formatVideoDuration(durationMs: number) {
  const totalSeconds = Math.max(0, Math.round(durationMs / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  }
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

export function mapIndexedAsset(asset: IndexedAsset): Asset {
  // Match vault sidebar order so cards and detail share the same primary tag.
  const tags = [...asset.tags]
    .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name, "zh-Hans-CN"))
    .map((tagItem) => ({ id: tagItem.id, name: tagItem.name }));
  // Sentinel display placeholder for untagged assets (not a real user tag).
  const tag = tags[0]?.name ?? i18n.t("assets.untagged");
  const kind = mapIndexedAssetKind(asset.kind, asset.extension);
  const extension = asset.extension ?? asset.fileName.split(".").pop() ?? "file";
  const mediaUrl =
    kind === "image" || kind === "video" ? buildAssetFileUrl(asset.id, asset.fileName) : undefined;
  // Chromium can render SVG and AVIF directly. Small raster images are also marked as
  // `original` by the indexer so cards avoid upscaling and recompressing already-soft sources.
  const usesOriginalAsThumbnail =
    kind === "image" &&
    (["svg", "avif"].includes(extension.toLowerCase()) ||
      (asset.image?.status === "ready" && asset.image.thumbnailFormat === "original"));
  // Web assets carry their OG cover image on the shared imageCache thumbnail.
  const hasCachedThumbnail =
    (kind === "image" || kind === "video" || kind === "youtube" || kind === "web") &&
    asset.image?.status === "ready" &&
    Boolean(asset.image.thumbnailPath);
  const thumbnailUrl = usesOriginalAsThumbnail
    ? mediaUrl
    : hasCachedThumbnail
      ? buildAssetThumbnailUrl(asset.id, asset.fileName)
      : undefined;
  const ogImage = kind === "web" && hasCachedThumbnail;
  const metaPrefix = {
    markdown: "Markdown",
    post: "X Post",
    image: i18n.t("assets.kind.image"),
    video: i18n.t("assets.kind.video"),
    youtube: i18n.t("assets.kind.youtube"),
    link: i18n.t("assets.kind.link"),
    web: i18n.t("assets.kind.web"),
    file: extension.toUpperCase(),
  } satisfies Record<AssetKind, string>;

  const updatedTimestampMs = getAssetTimestampMs(asset.mtimeMs);
  const body = asset.description ?? asset.markdown?.excerpt ?? undefined;
  const noteImagesRaw = kind === "markdown" ? (asset.noteImages ?? []) : [];
  // Image-primary notes (short body + at least one vault image) upgrade to a cover.
  const coverMode = noteImagesRaw.length > 0 && (body?.trim().length ?? 0) < 80;
  const noteImageCount = noteImagesRaw.length > 0 ? noteImagesRaw.length : undefined;
  const noteImages =
    noteImagesRaw.length === 0
      ? undefined
      : coverMode
        ? noteImagesRaw.slice(0, 1)
        : noteImagesRaw.slice(0, 3);
  const rawDurationMs =
    kind === "youtube" ? asset.youtube?.durationMs : asset.image?.videoDurationMs;
  const durationMs =
    (kind === "video" || kind === "youtube") &&
    typeof rawDurationMs === "number" &&
    rawDurationMs >= 0
      ? rawDurationMs
      : undefined;
  const duration = durationMs !== undefined ? formatVideoDuration(durationMs) : undefined;

  return {
    id: asset.id,
    kind,
    status: mapIndexedAssetStatus(asset.status),
    privacy: asset.privacy,
    title: asset.title,
    body,
    source: `${asset.vaultName} / ${asset.relativePath}`,
    sourceType: "vault",
    fileExists: asset.fileExists,
    time: formatAssetTime(asset.mtimeMs),
    timestampMs: updatedTimestampMs,
    createdTimestampMs: getAssetTimestampMs(asset.ctimeMs, updatedTimestampMs),
    tag,
    tags,
    tagIds: tags.map((tagItem) => tagItem.id),
    meta: `${metaPrefix[kind]} · ${formatBytes(asset.sizeBytes)}`,
    accent: getTagHue(tag),
    height: kind === "image" || kind === "video" || kind === "youtube" ? "medium" : "short",
    duration,
    durationMs,
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
    noteImages,
    noteImageCount,
    coverMode: coverMode || undefined,
    ogImage,
    // >150/255 reads as a light bottom strip; leave undefined when luma is uncaptured.
    coverIsLight:
      asset.image?.thumbnailLuma === null || asset.image?.thumbnailLuma === undefined
        ? undefined
        : asset.image.thumbnailLuma > 150,
    platform: asset.post?.platform,
    authorName: asset.post?.authorName ?? undefined,
    authorHandle: asset.post?.authorHandle ?? undefined,
    authorAvatarUrl: asset.post?.authorAvatarUrl ?? undefined,
    publishedTime: formatPostDate(asset.post?.publishedAt),
    url: asset.youtube?.canonicalUrl ?? asset.post?.canonicalUrl ?? asset.web?.url ?? undefined,
    domain:
      kind === "youtube"
        ? "YouTube"
        : (extractDomain(asset.post?.canonicalUrl) ??
          asset.web?.domain ??
          extractDomain(asset.web?.url)),
  };
}

export function getActiveFilterCount(filters: AssetFilterState) {
  return (
    filters.types.length +
    filters.tags.length +
    filters.sources.length +
    (filters.time !== "any" ? 1 : 0) +
    (filters.status !== "any" ? 1 : 0) +
    (filters.sort !== "added_desc" ? 1 : 0)
  );
}

/** Stable source key used in filter state (not a localized label). */
export function getAssetSourceLabel(asset: Asset) {
  if (asset.sourceType === "vault") {
    return "vault";
  }

  if (asset.sourceType === "external_file") {
    return "external_file";
  }

  return "url";
}

function getAssetTagNames(asset: Asset) {
  return asset.tags.map((tagItem) => tagItem.name);
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
