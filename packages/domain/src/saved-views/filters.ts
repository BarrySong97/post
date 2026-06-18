/**
 * @purpose Encode and decode saved-view filter JSON for reusable domain workflows.
 * @role    Shared saved-view persistence codec used by desktop and CLI.
 * @deps    Domain utilities.
 * @gotcha  Keep accepted values compatible with renderer saved-view contracts.
 */

import { getStringArray, uniqueStrings } from "../utils";

export const assetListTypeFilterValues = ["markdown", "image", "video", "link", "file"] as const;
export const assetListTimeFilterValues = ["any", "today", "week", "m30"] as const;
export const assetListSourceTypeValues = ["vault", "external_file", "url"] as const;
export const assetListTagMatchValues = ["and", "or"] as const;
export const assetListStatusFilterValues = [
  "inbox",
  "organized",
  "draft",
  "published",
  "archived",
] as const;
export const assetListSortValues = [
  "updated_desc",
  "updated_asc",
  "created_desc",
  "created_asc",
] as const;

export type AssetListTypeFilter = (typeof assetListTypeFilterValues)[number];
export type AssetListTimeFilter = (typeof assetListTimeFilterValues)[number];
export type AssetListSourceType = (typeof assetListSourceTypeValues)[number];
export type AssetListTagMatch = (typeof assetListTagMatchValues)[number];
export type AssetListStatusFilter = (typeof assetListStatusFilterValues)[number];
export type AssetListSort = (typeof assetListSortValues)[number];

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

function isOneOf<const T extends readonly string[]>(values: T, value: unknown): value is T[number] {
  return typeof value === "string" && values.includes(value);
}

function isAssetListTypeFilter(value: unknown): value is AssetListTypeFilter {
  return isOneOf(assetListTypeFilterValues, value);
}

function isAssetListTimeFilter(value: unknown): value is AssetListTimeFilter {
  return isOneOf(assetListTimeFilterValues, value);
}

function isAssetListSourceType(value: unknown): value is AssetListSourceType {
  return isOneOf(assetListSourceTypeValues, value);
}

function isAssetListStatusFilter(value: unknown): value is AssetListStatusFilter | "any" {
  return value === "any" || isOneOf(assetListStatusFilterValues, value);
}

function isAssetListSort(value: unknown): value is AssetListSort {
  return isOneOf(assetListSortValues, value);
}

function getSavedViewConditions(filters: SavedViewFilters): string[] {
  return [
    ...filters.tagIds.map((tagId) => `tag:${tagId}`),
    ...filters.types.map((type) => `type:${type}`),
    ...filters.sources.map((source) => `source:${source}`),
    filters.time !== "any" ? `time:${filters.time}` : null,
    filters.status !== "any" ? `status:${filters.status}` : null,
  ].filter((condition): condition is string => Boolean(condition));
}

export function normalizeSavedViewFilters(input: Partial<SavedViewFilters> = {}): SavedViewFilters {
  return {
    match: input.match === "or" ? "or" : "and",
    tagIds: uniqueStrings(input.tagIds ?? []),
    types: uniqueStrings((input.types ?? []).filter(isAssetListTypeFilter)),
    sources: uniqueStrings((input.sources ?? []).filter(isAssetListSourceType)),
    time: isAssetListTimeFilter(input.time) ? input.time : "any",
    status: isAssetListStatusFilter(input.status) ? input.status : "any",
  };
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

    return normalizeSavedViewFilters({
      match: value.match === "or" ? "or" : "and",
      tagIds,
      types,
      sources,
      time: isAssetListTimeFilter(timeValue) ? timeValue : "any",
      status: isAssetListStatusFilter(statusValue) ? statusValue : "any",
    });
  } catch {
    return { ...EMPTY_SAVED_VIEW_FILTERS };
  }
}

export function serializeSavedViewFilters(filters: SavedViewFilters): string {
  const normalized = normalizeSavedViewFilters(filters);
  return JSON.stringify({
    match: normalized.match,
    conditions: getSavedViewConditions(normalized),
    tagIds: normalized.tagIds,
    types: normalized.types,
    sources: normalized.sources,
    time: normalized.time,
    status: normalized.status,
  });
}

export function serializeSavedViewSort(sort: AssetListSort): string {
  return JSON.stringify({ sort });
}

export function parseSavedViewSort(sortJson: string): AssetListSort {
  try {
    const value = JSON.parse(sortJson) as { sort?: unknown };
    return isAssetListSort(value.sort) ? value.sort : "updated_desc";
  } catch {
    return "updated_desc";
  }
}
