import { atom } from "jotai";

export type AssetTypeFilter = "markdown" | "image" | "video" | "link" | "file";
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

export type AssetListParams = {
  vaultId?: string;
  tagId?: string;
  statusFilter?: "inbox" | "organized" | "draft" | "published" | "archived";
  untagged?: boolean;
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
export const listParamsAtom = atom<AssetListParams>({});
export const activeSidebarItemAtom = atom<ActiveSidebarItem>({ kind: "mgmt", id: "all" });
