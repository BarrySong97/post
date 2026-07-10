/**
 * @purpose Store cross-component asset manager UI state in Jotai atoms.
 * @role    Renderer state boundary for filters, sidebar selection, and asset manager view state.
 * @deps    jotai and asset filter types.
 * @gotcha  Keep persisted/filter state serializable because saved views and storage helpers depend on it.
 */

import { atom } from "jotai";

export type AssetTypeFilter = "markdown" | "post" | "image" | "video" | "link" | "file";
export type AssetFilterMatch = "and" | "or";
export type AssetTimeFilter = "any" | "today" | "week" | "m30" | "custom";
export type AssetStatusFilter = "any" | "inbox" | "draft" | "published";
export type AssetSortOrder = "updated_desc" | "updated_asc" | "created_desc" | "created_asc";

export type AssetFilterState = {
  types: AssetTypeFilter[];
  tags: string[];
  sources: string[];
  match: AssetFilterMatch;
  time: AssetTimeFilter;
  status: AssetStatusFilter;
  sort: AssetSortOrder;
};

export type ActiveSidebarItem =
  | { kind: "mgmt"; id: "all" | "inbox" }
  | { kind: "view"; id: string }
  | { kind: "tag"; id: string };

export function getEmptyAssetFilters(match: AssetFilterMatch = "and"): AssetFilterState {
  return {
    types: [],
    tags: [],
    sources: [],
    match,
    time: "any",
    status: "any",
    sort: "updated_desc",
  };
}

export function getDefaultAssetFilters(): AssetFilterState {
  return getEmptyAssetFilters();
}

export const assetFiltersAtom = atom<AssetFilterState>(getDefaultAssetFilters());
export const activeSidebarItemAtom = atom<ActiveSidebarItem>({ kind: "mgmt", id: "all" });
