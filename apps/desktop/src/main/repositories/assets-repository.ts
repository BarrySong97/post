/**
 * @purpose Centralize SQLite reads and writes for assets data.
 * @role    Main-process persistence boundary between tRPC routers/services and Drizzle tables.
 * @deps    @post/db schema, drizzle-orm query helpers, main db connection utilities.
 * @gotcha  Keep query result shapes stable for routers and renderer models that consume them.
 */

import {
  and,
  asc,
  count,
  desc,
  eq,
  exists,
  gt,
  gte,
  inArray,
  isNotNull,
  isNull,
  lt,
  notExists,
  notInArray,
  or,
  sql,
  type SQL,
} from "drizzle-orm";

import { schema } from "@post/db";
import { getDatabase } from "../db";

export type AssetListTypeFilter =
  | "markdown"
  | "post"
  | "image"
  | "video"
  | "youtube"
  | "link"
  | "file";
export type AssetListTimeFilter = "any" | "today" | "week" | "m30";
export type AssetListSourceType = "vault" | "external_file" | "url";
export type AssetListTagMatch = "and" | "or";
export type AssetListSort =
  | "added_desc"
  | "added_asc"
  | "updated_desc"
  | "updated_asc"
  | "created_desc"
  | "created_asc";
export type AssetListStatusFilter = "inbox" | "organized" | "draft" | "published" | "archived";
export type AssetListCursor = {
  valueMs: number;
  id: string;
};

export type AssetListFilters = {
  vaultId: string;
  tagIds?: string[];
  tagMatch?: AssetListTagMatch;
  statusFilter?: AssetListStatusFilter;
  untagged?: boolean;
  typeFilters?: AssetListTypeFilter[];
  timeFilter?: AssetListTimeFilter;
  sourceTypes?: AssetListSourceType[];
  sort?: AssetListSort;
};

export type AssetListPageInput = AssetListFilters & {
  limit: number;
  cursor?: AssetListCursor;
};

export type AssetLayoutIndexInput = AssetListFilters;

const URL_FILE_EXTENSIONS = ["url", "webloc"] as const;
const NON_FILE_ASSET_KINDS = ["markdown", "post", "image", "video", "youtube", "web"] as const;
const DAY_MS = 24 * 60 * 60 * 1000;

const EMPTY_ASSET_SUMMARY = {
  total: 0,
  untagged: 0,
  inbox: 0,
  organized: 0,
  draft: 0,
  published: 0,
  archived: 0,
};

export type SavedViewFilters = {
  match: AssetListTagMatch;
  tagIds: string[];
  types: AssetListTypeFilter[];
  sources: AssetListSourceType[];
  time: AssetListTimeFilter;
  status: AssetListStatusFilter | "any";
};

const EMPTY_SAVED_VIEW_FILTERS: SavedViewFilters = {
  match: "and",
  tagIds: [],
  types: [],
  sources: [],
  time: "any",
  status: "any",
};

const ASSET_LIST_TYPE_FILTERS = new Set<AssetListTypeFilter>([
  "markdown",
  "post",
  "image",
  "video",
  "youtube",
  "link",
  "file",
]);
const ASSET_LIST_TIME_FILTERS = new Set<AssetListTimeFilter>(["any", "today", "week", "m30"]);
const ASSET_LIST_SOURCE_TYPES = new Set<AssetListSourceType>(["vault", "external_file", "url"]);
const ASSET_LIST_STATUS_FILTERS = new Set<AssetListStatusFilter>([
  "inbox",
  "organized",
  "draft",
  "published",
  "archived",
]);
const ASSET_LIST_SORTS = new Set<AssetListSort>([
  "added_desc",
  "added_asc",
  "updated_desc",
  "updated_asc",
  "created_desc",
  "created_asc",
]);

type AssetJoinedRow = {
  asset: typeof schema.assets.$inferSelect;
  file: typeof schema.assetFiles.$inferSelect;
  vault: typeof schema.vaults.$inferSelect;
  markdown: typeof schema.markdownCache.$inferSelect | null;
  image: typeof schema.imageCache.$inferSelect | null;
  post: typeof schema.postCache.$inferSelect | null;
  web: typeof schema.webCache.$inferSelect | null;
  youtube: typeof schema.youtubeCache.$inferSelect | null;
};

export function getAssetRows(vaultId?: string, assetId?: string) {
  const filters = [
    vaultId ? eq(schema.assets.vaultId, vaultId) : undefined,
    assetId ? eq(schema.assets.id, assetId) : undefined,
    isNull(schema.assets.deletedAt),
    eq(schema.assetFiles.fileExists, true),
  ].filter((filter) => filter !== undefined);

  return getDatabase()
    .select({
      asset: schema.assets,
      file: schema.assetFiles,
      vault: schema.vaults,
      markdown: schema.markdownCache,
      image: schema.imageCache,
      post: schema.postCache,
      web: schema.webCache,
      youtube: schema.youtubeCache,
    })
    .from(schema.assets)
    .innerJoin(schema.assetFiles, eq(schema.assetFiles.assetId, schema.assets.id))
    .innerJoin(schema.vaults, eq(schema.vaults.id, schema.assets.vaultId))
    .leftJoin(schema.markdownCache, eq(schema.markdownCache.assetId, schema.assets.id))
    .leftJoin(schema.imageCache, eq(schema.imageCache.assetId, schema.assets.id))
    .leftJoin(schema.postCache, eq(schema.postCache.assetId, schema.assets.id))
    .leftJoin(schema.webCache, eq(schema.webCache.assetId, schema.assets.id))
    .leftJoin(schema.youtubeCache, eq(schema.youtubeCache.assetId, schema.assets.id))
    .where(and(...filters))
    .orderBy(desc(schema.assets.updatedAt))
    .all();
}

export function attachRelations(rows: AssetJoinedRow[]) {
  const assetIds = rows.map((row) => row.asset.id);
  if (assetIds.length === 0) {
    return [];
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

  const linkRows = getDatabase()
    .select()
    .from(schema.assetLinks)
    .where(
      or(
        inArray(schema.assetLinks.sourceAssetId, assetIds),
        inArray(schema.assetLinks.targetAssetId, assetIds),
      ),
    )
    .all();
  const relatedByAsset = new Map<string, Set<string>>();

  for (const link of linkRows) {
    if (link.targetAssetId && assetIds.includes(link.sourceAssetId)) {
      const related = relatedByAsset.get(link.sourceAssetId) ?? new Set<string>();
      related.add(link.targetAssetId);
      relatedByAsset.set(link.sourceAssetId, related);
    }

    if (link.targetAssetId && assetIds.includes(link.targetAssetId)) {
      const related = relatedByAsset.get(link.targetAssetId) ?? new Set<string>();
      related.add(link.sourceAssetId);
      relatedByAsset.set(link.targetAssetId, related);
    }
  }

  // Resolved vault images/embeds referenced by markdown notes, ordered by source
  // span so cards show thumbs in document order. Join image_cache.status=ready so
  // remote/unresolved/non-image targets never reach the renderer.
  const noteImageRows = getDatabase()
    .select({
      sourceAssetId: schema.assetLinks.sourceAssetId,
      assetId: schema.assetLinks.targetAssetId,
      fileName: schema.assetFiles.fileName,
    })
    .from(schema.assetLinks)
    .innerJoin(schema.imageCache, eq(schema.imageCache.assetId, schema.assetLinks.targetAssetId))
    .innerJoin(schema.assetFiles, eq(schema.assetFiles.assetId, schema.assetLinks.targetAssetId))
    .where(
      and(
        inArray(schema.assetLinks.sourceAssetId, assetIds),
        inArray(schema.assetLinks.relationType, ["markdown_image", "embed"]),
        eq(schema.assetLinks.resolvedStatus, "resolved"),
        isNotNull(schema.assetLinks.targetAssetId),
        eq(schema.imageCache.status, "ready"),
      ),
    )
    .orderBy(asc(schema.assetLinks.sourceSpanStart))
    .all();

  const noteImagesByAsset = new Map<string, Array<{ assetId: string; fileName: string }>>();
  for (const row of noteImageRows) {
    if (!row.assetId) {
      continue;
    }
    const images = noteImagesByAsset.get(row.sourceAssetId) ?? [];
    if (images.some((image) => image.assetId === row.assetId)) {
      continue;
    }
    images.push({ assetId: row.assetId, fileName: row.fileName });
    noteImagesByAsset.set(row.sourceAssetId, images);
  }

  return rows.map((row) => ({
    id: row.asset.id,
    vaultId: row.asset.vaultId,
    kind: row.asset.kind,
    status: row.asset.status,
    privacy: row.asset.privacy,
    title: row.markdown?.title ?? row.asset.title,
    description: row.asset.description,
    relativePath: row.file.relativePath,
    fileName: row.file.fileName,
    extension: row.file.extension,
    sizeBytes: row.file.sizeBytes,
    mtimeMs: row.file.mtimeMs,
    ctimeMs: row.file.ctimeMs,
    fileExists: row.file.fileExists,
    quickFingerprint: row.file.quickFingerprint,
    vaultRootPath: row.vault.rootPath,
    vaultName: row.vault.name,
    markdown: row.markdown,
    image: row.image,
    // Only the source-attribution fields the grid card needs. The heavy JSON columns
    // (mediaJson, quotedPostJson, pollJson) stay out of the hydrate payload.
    post: row.post
      ? {
          platform: row.post.platform,
          authorName: row.post.authorName,
          authorHandle: row.post.authorHandle,
          authorAvatarUrl: row.post.authorAvatarUrl,
          canonicalUrl: row.post.canonicalUrl,
          publishedAt: row.post.publishedAt,
        }
      : null,
    web: row.web
      ? {
          url: row.web.url,
          domain: row.web.domain,
          siteName: row.web.siteName,
        }
      : null,
    youtube: row.youtube
      ? {
          videoId: row.youtube.videoId,
          canonicalUrl: row.youtube.canonicalUrl,
          channelId: row.youtube.channelId,
          channelName: row.youtube.channelName,
          channelUrl: row.youtube.channelUrl,
          publishedAt: row.youtube.publishedAt,
          durationMs: row.youtube.durationMs,
          liveStatus: row.youtube.liveStatus,
        }
      : null,
    tags: tagsByAsset.get(row.asset.id) ?? [],
    relatedIds: Array.from(relatedByAsset.get(row.asset.id) ?? []),
    noteImages: noteImagesByAsset.get(row.asset.id) ?? [],
  }));
}

export type AssetListItem = ReturnType<typeof attachRelations>[number];

export function getAssetRowsByIds(assetIds: readonly string[]) {
  const uniqueAssetIds = Array.from(new Set(assetIds));
  if (uniqueAssetIds.length === 0) {
    return [];
  }

  const rows = getDatabase()
    .select({
      asset: schema.assets,
      file: schema.assetFiles,
      vault: schema.vaults,
      markdown: schema.markdownCache,
      image: schema.imageCache,
      post: schema.postCache,
      web: schema.webCache,
      youtube: schema.youtubeCache,
    })
    .from(schema.assets)
    .innerJoin(schema.assetFiles, eq(schema.assetFiles.assetId, schema.assets.id))
    .innerJoin(schema.vaults, eq(schema.vaults.id, schema.assets.vaultId))
    .leftJoin(schema.markdownCache, eq(schema.markdownCache.assetId, schema.assets.id))
    .leftJoin(schema.imageCache, eq(schema.imageCache.assetId, schema.assets.id))
    .leftJoin(schema.postCache, eq(schema.postCache.assetId, schema.assets.id))
    .leftJoin(schema.webCache, eq(schema.webCache.assetId, schema.assets.id))
    .leftJoin(schema.youtubeCache, eq(schema.youtubeCache.assetId, schema.assets.id))
    .where(
      and(
        inArray(schema.assets.id, uniqueAssetIds),
        isNull(schema.assets.deletedAt),
        eq(schema.assetFiles.fileExists, true),
      ),
    )
    .all();
  const byId = new Map(attachRelations(rows).map((row) => [row.id, row]));

  return uniqueAssetIds
    .map((id) => byId.get(id))
    .filter((row): row is AssetListItem => row !== undefined);
}

function compactConditions(conditions: Array<SQL | undefined>) {
  return conditions.filter((condition): condition is SQL => condition !== undefined);
}

function getExistingAssetConditions(vaultId: string) {
  return [
    eq(schema.assetFiles.vaultId, vaultId),
    eq(schema.assets.vaultId, vaultId),
    isNull(schema.assets.deletedAt),
    eq(schema.assetFiles.fileExists, true),
  ];
}

function getTagExistsCondition(tagId: string) {
  return exists(
    getDatabase()
      .select({ id: schema.assetTags.assetId })
      .from(schema.assetTags)
      .where(
        and(eq(schema.assetTags.assetId, schema.assets.id), eq(schema.assetTags.tagId, tagId)),
      ),
  );
}

function getTagFilterCondition(
  tagIds: readonly string[] | undefined,
  tagMatch: AssetListTagMatch = "and",
) {
  if (!tagIds?.length) {
    return undefined;
  }

  if (tagMatch === "or") {
    return exists(
      getDatabase()
        .select({ id: schema.assetTags.assetId })
        .from(schema.assetTags)
        .where(
          and(
            eq(schema.assetTags.assetId, schema.assets.id),
            inArray(schema.assetTags.tagId, [...tagIds]),
          ),
        ),
    );
  }

  return and(...tagIds.map(getTagExistsCondition));
}

function getUntaggedCondition(untagged: boolean | undefined) {
  if (!untagged) {
    return undefined;
  }

  return notExists(
    getDatabase()
      .select({ id: schema.assetTags.assetId })
      .from(schema.assetTags)
      .where(eq(schema.assetTags.assetId, schema.assets.id)),
  );
}

function getTypeFilterCondition(typeFilters: readonly AssetListTypeFilter[] | undefined) {
  if (!typeFilters?.length) {
    return undefined;
  }

  const conditions = typeFilters.flatMap((type): SQL[] => {
    if (
      type === "markdown" ||
      type === "post" ||
      type === "image" ||
      type === "video" ||
      type === "youtube"
    ) {
      return [eq(schema.assets.kind, type)];
    }

    if (type === "link") {
      return [
        or(
          eq(schema.assets.kind, "web"),
          and(
            notInArray(schema.assets.kind, ["youtube"]),
            inArray(schema.assetFiles.extension, [...URL_FILE_EXTENSIONS]),
          ),
        )!,
      ];
    }

    return [
      and(
        notInArray(schema.assets.kind, [...NON_FILE_ASSET_KINDS]),
        or(
          isNull(schema.assetFiles.extension),
          notInArray(schema.assetFiles.extension, [...URL_FILE_EXTENSIONS]),
        ),
      )!,
    ];
  });

  return conditions.length === 1 ? conditions[0] : or(...conditions);
}

function getTimeFilterCondition(timeFilter: AssetListTimeFilter | undefined) {
  if (!timeFilter || timeFilter === "any") {
    return undefined;
  }

  const now = new Date();
  if (timeFilter === "today") {
    const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    return gte(sql<number>`${schema.assetFiles.mtimeMs}`, startOfDay);
  }

  const elapsedMs = timeFilter === "week" ? 7 * DAY_MS : 30 * DAY_MS;
  return gte(sql<number>`${schema.assetFiles.mtimeMs}`, Date.now() - elapsedMs);
}

function getSourceFilterCondition(sourceTypes: readonly AssetListSourceType[] | undefined) {
  if (!sourceTypes?.length || sourceTypes.includes("vault")) {
    return undefined;
  }

  return sql`0 = 1`;
}

function getAssetFilterConditions(filters: AssetListFilters) {
  return compactConditions([
    ...getExistingAssetConditions(filters.vaultId),
    filters.statusFilter ? eq(schema.assets.status, filters.statusFilter) : undefined,
    getTagFilterCondition(filters.tagIds, filters.tagMatch),
    getUntaggedCondition(filters.untagged),
    getTypeFilterCondition(filters.typeFilters),
    getTimeFilterCondition(filters.timeFilter),
    getSourceFilterCondition(filters.sourceTypes),
  ]);
}

function getSortValueExpression(sort: AssetListSort = "added_desc") {
  if (sort.startsWith("added")) {
    return sql<number>`${schema.assets.createdAt}`;
  }

  return sort.startsWith("created")
    ? sql<number>`coalesce(${schema.assetFiles.ctimeMs}, ${schema.assetFiles.mtimeMs})`
    : sql<number>`${schema.assetFiles.mtimeMs}`;
}

function getCursorCondition(sort: AssetListSort, cursor: AssetListCursor | undefined) {
  if (!cursor) {
    return undefined;
  }

  const sortValue = getSortValueExpression(sort);
  const isDescending = sort.endsWith("desc");
  const valueComparator = isDescending
    ? lt(sortValue, cursor.valueMs)
    : gt(sortValue, cursor.valueMs);
  const idComparator = isDescending
    ? lt(schema.assetFiles.assetId, cursor.id)
    : gt(schema.assetFiles.assetId, cursor.id);

  return or(valueComparator, and(eq(sortValue, cursor.valueMs), idComparator));
}

export function getAssetCount(filters: AssetListFilters) {
  const row = getDatabase()
    .select({ total: count() })
    .from(schema.assets)
    .innerJoin(schema.assetFiles, eq(schema.assetFiles.assetId, schema.assets.id))
    .where(and(...getAssetFilterConditions(filters)))
    .get();

  return row?.total ?? 0;
}

export function getAssetPage(input: AssetListPageInput) {
  const sort = input.sort ?? "added_desc";
  const sortValue = getSortValueExpression(sort);
  const isDescending = sort.endsWith("desc");
  const whereConditions = compactConditions([
    ...getAssetFilterConditions(input),
    getCursorCondition(sort, input.cursor),
  ]);
  const rows = getDatabase()
    .select({
      asset: schema.assets,
      file: schema.assetFiles,
      vault: schema.vaults,
      markdown: schema.markdownCache,
      image: schema.imageCache,
      post: schema.postCache,
      web: schema.webCache,
      youtube: schema.youtubeCache,
      sortValue,
    })
    .from(schema.assets)
    .innerJoin(schema.assetFiles, eq(schema.assetFiles.assetId, schema.assets.id))
    .innerJoin(schema.vaults, eq(schema.vaults.id, schema.assets.vaultId))
    .leftJoin(schema.markdownCache, eq(schema.markdownCache.assetId, schema.assets.id))
    .leftJoin(schema.imageCache, eq(schema.imageCache.assetId, schema.assets.id))
    .leftJoin(schema.postCache, eq(schema.postCache.assetId, schema.assets.id))
    .leftJoin(schema.webCache, eq(schema.webCache.assetId, schema.assets.id))
    .leftJoin(schema.youtubeCache, eq(schema.youtubeCache.assetId, schema.assets.id))
    .where(and(...whereConditions))
    .orderBy(
      isDescending ? desc(sortValue) : asc(sortValue),
      isDescending ? desc(schema.assetFiles.assetId) : asc(schema.assetFiles.assetId),
    )
    .limit(input.limit + 1)
    .all();
  const pageRows = rows.slice(0, input.limit);
  const overflowRow = rows[input.limit];

  return {
    items: attachRelations(pageRows),
    total: getAssetCount(input),
    nextCursor: overflowRow
      ? {
          valueMs: Number(overflowRow.sortValue),
          id: overflowRow.asset.id,
        }
      : null,
  };
}

export function getAssetLayoutIndex(input: AssetLayoutIndexInput) {
  const sort = input.sort ?? "added_desc";
  const sortValue = getSortValueExpression(sort);
  const isDescending = sort.endsWith("desc");
  const rows = getDatabase()
    .select({
      id: schema.assets.id,
      vaultId: schema.assets.vaultId,
      kind: schema.assets.kind,
      status: schema.assets.status,
      privacy: schema.assets.privacy,
      title: sql<string>`coalesce(${schema.markdownCache.title}, ${schema.assets.title})`,
      relativePath: schema.assetFiles.relativePath,
      fileName: schema.assetFiles.fileName,
      extension: schema.assetFiles.extension,
      sizeBytes: schema.assetFiles.sizeBytes,
      mtimeMs: schema.assetFiles.mtimeMs,
      ctimeMs: schema.assetFiles.ctimeMs,
      fileExists: schema.assetFiles.fileExists,
      imageWidth: schema.imageCache.width,
      imageHeight: schema.imageCache.height,
      thumbnailWidth: schema.imageCache.thumbnailWidth,
      thumbnailHeight: schema.imageCache.thumbnailHeight,
      thumbnailStatus: schema.imageCache.status,
      sortValue,
    })
    .from(schema.assets)
    .innerJoin(schema.assetFiles, eq(schema.assetFiles.assetId, schema.assets.id))
    .leftJoin(schema.markdownCache, eq(schema.markdownCache.assetId, schema.assets.id))
    .leftJoin(schema.imageCache, eq(schema.imageCache.assetId, schema.assets.id))
    .where(and(...getAssetFilterConditions(input)))
    .orderBy(
      isDescending ? desc(sortValue) : asc(sortValue),
      isDescending ? desc(schema.assetFiles.assetId) : asc(schema.assetFiles.assetId),
    )
    .all();

  return {
    items: rows.map(({ sortValue: _sortValue, ...row }) => row),
    total: rows.length,
  };
}

export function getSidebarTags(vaultId: string) {
  const tagRows = getDatabase()
    .select()
    .from(schema.tags)
    .where(eq(schema.tags.vaultId, vaultId))
    .orderBy(schema.tags.sortOrder, schema.tags.name)
    .all();
  const countRows = getDatabase()
    .select({
      tagId: schema.assetTags.tagId,
      total: count(),
    })
    .from(schema.assetTags)
    .innerJoin(schema.assets, eq(schema.assets.id, schema.assetTags.assetId))
    .innerJoin(schema.assetFiles, eq(schema.assetFiles.assetId, schema.assets.id))
    .where(and(...getExistingAssetConditions(vaultId)))
    .groupBy(schema.assetTags.tagId)
    .all();
  const counts = new Map(countRows.map((row) => [row.tagId, row.total]));

  return tagRows.map((tag) => ({
    id: tag.id,
    name: tag.name,
    color: tag.color,
    count: counts.get(tag.id) ?? 0,
  }));
}

export function getSavedViews(vaultId: string) {
  return getDatabase()
    .select()
    .from(schema.savedViews)
    .where(eq(schema.savedViews.vaultId, vaultId))
    .orderBy(schema.savedViews.sortOrder, desc(schema.savedViews.updatedAt))
    .all()
    .map((view) => {
      const filters = parseSavedViewFilters(view.filterJson);
      const sort = parseSavedViewSort(view.sortJson);
      const conditions = getSavedViewConditions(filters);
      const count = getAssetCount(savedViewFiltersToAssetListFilters(vaultId, filters, sort));
      return {
        id: view.id,
        name: view.name,
        icon: view.icon,
        filterJson: view.filterJson,
        sortJson: view.sortJson,
        filters,
        sort,
        count,
        conditions,
      };
    });
}

export function parseSavedViewConditions(filterJson: string) {
  return getSavedViewConditions(parseSavedViewFilters(filterJson));
}

export function parseSavedViewFilters(filterJson: string): SavedViewFilters {
  try {
    const value = JSON.parse(filterJson) as {
      match?: unknown;
      conditions?: unknown;
      tagIds?: unknown;
      types?: unknown;
      sources?: unknown;
      time?: unknown;
      status?: unknown;
    };
    const conditionValues = Array.isArray(value.conditions)
      ? value.conditions.filter((condition): condition is string => typeof condition === "string")
      : [];
    const directTagIds = getStringArray(value.tagIds);
    const directTypes = getStringArray(value.types).filter(isAssetListTypeFilter);
    const directSources = getStringArray(value.sources).filter(isAssetListSourceType);

    const tagIds = [
      ...conditionValues
        .filter((condition) => condition.startsWith("tag:"))
        .map((condition) => condition.slice(4)),
      ...directTagIds,
    ];
    const types = [
      ...conditionValues
        .filter((condition) => condition.startsWith("type:"))
        .map((condition) => condition.slice(5))
        .filter(isAssetListTypeFilter),
      ...directTypes,
    ];
    const sources = [
      ...conditionValues
        .filter((condition) => condition.startsWith("source:"))
        .map((condition) => condition.slice(7))
        .filter(isAssetListSourceType),
      ...directSources,
    ];
    const conditionTime = conditionValues
      .find((condition) => condition.startsWith("time:"))
      ?.slice(5);
    const conditionStatus = conditionValues
      .find((condition) => condition.startsWith("status:"))
      ?.slice(7);
    const timeValue = typeof value.time === "string" ? value.time : conditionTime;
    const statusValue = typeof value.status === "string" ? value.status : conditionStatus;

    return {
      match: value.match === "or" ? "or" : "and",
      tagIds: uniqueStrings(tagIds),
      types: uniqueStrings(types),
      sources: uniqueStrings(sources),
      time: isAssetListTimeFilter(timeValue) ? timeValue : "any",
      status: isAssetListStatusFilter(statusValue) ? statusValue : "any",
    };
  } catch {
    return { ...EMPTY_SAVED_VIEW_FILTERS };
  }
}

export function serializeSavedViewFilters(filters: SavedViewFilters) {
  const conditions = getSavedViewConditions(filters);
  return JSON.stringify({
    match: filters.match,
    conditions,
    tagIds: filters.tagIds,
    types: filters.types,
    sources: filters.sources,
    time: filters.time,
    status: filters.status,
  });
}

export function serializeSavedViewSort(sort: AssetListSort) {
  return JSON.stringify({ sort });
}

export function parseSavedViewSort(sortJson: string): AssetListSort {
  try {
    const value = JSON.parse(sortJson) as { sort?: unknown };
    return isAssetListSort(value.sort) ? value.sort : "added_desc";
  } catch {
    return "added_desc";
  }
}

export function getSavedViewConditions(filters: SavedViewFilters) {
  return [
    ...filters.tagIds.map((tagId) => `tag:${tagId}`),
    ...filters.types.map((type) => `type:${type}`),
    ...filters.sources.map((source) => `source:${source}`),
    filters.time !== "any" ? `time:${filters.time}` : undefined,
    filters.status !== "any" ? `status:${filters.status}` : undefined,
  ].filter((condition): condition is string => condition !== undefined);
}

export function savedViewFiltersToAssetListFilters(
  vaultId: string,
  filters: SavedViewFilters,
  sort?: AssetListSort,
): AssetListFilters {
  return {
    vaultId,
    tagIds: filters.tagIds.length > 0 ? filters.tagIds : undefined,
    tagMatch: filters.match,
    typeFilters: filters.types.length > 0 ? filters.types : undefined,
    sourceTypes: filters.sources.length > 0 ? filters.sources : undefined,
    timeFilter: filters.time === "any" ? undefined : filters.time,
    statusFilter: filters.status === "any" ? undefined : filters.status,
    sort,
  };
}

function getStringArray(value: unknown) {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function uniqueStrings<T extends string>(values: readonly T[]) {
  return Array.from(new Set(values));
}

function isAssetListTypeFilter(value: unknown): value is AssetListTypeFilter {
  return typeof value === "string" && ASSET_LIST_TYPE_FILTERS.has(value as AssetListTypeFilter);
}

function isAssetListTimeFilter(value: unknown): value is AssetListTimeFilter {
  return typeof value === "string" && ASSET_LIST_TIME_FILTERS.has(value as AssetListTimeFilter);
}

function isAssetListSourceType(value: unknown): value is AssetListSourceType {
  return typeof value === "string" && ASSET_LIST_SOURCE_TYPES.has(value as AssetListSourceType);
}

function isAssetListStatusFilter(value: unknown): value is AssetListStatusFilter {
  return typeof value === "string" && ASSET_LIST_STATUS_FILTERS.has(value as AssetListStatusFilter);
}

function isAssetListSort(value: unknown): value is AssetListSort {
  return typeof value === "string" && ASSET_LIST_SORTS.has(value as AssetListSort);
}

export function getAssetSummary(vaultId?: string) {
  if (!vaultId) {
    return { ...EMPTY_ASSET_SUMMARY };
  }

  const row = getDatabase()
    .select({
      total: count(),
      untagged: sql<number>`sum(case when not exists (
        select 1 from ${schema.assetTags}
        where ${schema.assetTags.assetId} = ${schema.assets.id}
      ) then 1 else 0 end)`,
      inbox: sql<number>`sum(case when ${schema.assets.status} = 'inbox' then 1 else 0 end)`,
      organized: sql<number>`sum(case when ${schema.assets.status} = 'organized' then 1 else 0 end)`,
      draft: sql<number>`sum(case when ${schema.assets.status} = 'draft' then 1 else 0 end)`,
      published: sql<number>`sum(case when ${schema.assets.status} = 'published' then 1 else 0 end)`,
      archived: sql<number>`sum(case when ${schema.assets.status} = 'archived' then 1 else 0 end)`,
    })
    .from(schema.assets)
    .innerJoin(schema.assetFiles, eq(schema.assetFiles.assetId, schema.assets.id))
    .where(and(...getExistingAssetConditions(vaultId)))
    .get();

  return row
    ? {
        total: row.total,
        untagged: row.untagged ?? 0,
        inbox: row.inbox ?? 0,
        organized: row.organized ?? 0,
        draft: row.draft ?? 0,
        published: row.published ?? 0,
        archived: row.archived ?? 0,
      }
    : { ...EMPTY_ASSET_SUMMARY };
}
