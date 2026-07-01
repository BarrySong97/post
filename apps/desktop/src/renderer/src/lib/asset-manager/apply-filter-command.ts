/**
 * @purpose Apply CLI-driven live filter commands to the asset manager Jotai atoms.
 * @role    Renderer bridge from main-process asset-filter.* events into filter/sidebar state.
 * @deps    jotai default store, asset filter atoms/codecs, tRPC vanilla client.
 * @gotcha  Wire payloads are id-based; resolve ids to tag names via sidebarMeta before setting atoms.
 */

import { getDefaultStore } from "jotai";

import {
  assetFiltersAtom,
  activeSidebarItemAtom,
  getDefaultAssetFilters,
  type AssetSortOrder,
} from "@/store/asset-manager-atoms";
import {
  assetFiltersToSavedViewFilters,
  savedViewFiltersToAssetFilters,
  type SavedViewFiltersOutput,
} from "@/components/asset-manager/asset-filter-controls";
import type { SidebarTag } from "@/lib/asset-manager/types";
import { trpcClient } from "@/lib/trpc";

export type ApplyFilterEvent =
  | { type: "asset-filter.apply"; filters: SavedViewFiltersOutput; sort: AssetSortOrder }
  | { type: "asset-filter.activate-view"; viewId: string }
  | {
      type: "asset-filter.select-sidebar";
      item: { kind: "mgmt"; id: "all" | "inbox" } | { kind: "tag"; id: string };
    }
  | { type: "asset-filter.clear" };

/**
 * Mirror the sidebar click handlers (sidebar.tsx) so a CLI command updates the live filter exactly
 * like a user interaction, then re-report the resulting snapshot for `filter.get` read-back.
 */
export async function applyFilterCommand(event: ApplyFilterEvent): Promise<void> {
  const store = getDefaultStore();
  const needsMeta =
    event.type === "asset-filter.apply" ||
    event.type === "asset-filter.activate-view" ||
    (event.type === "asset-filter.select-sidebar" && event.item.kind === "tag");
  const meta = needsMeta ? await trpcClient.assets.sidebarMeta.query() : null;
  const tags = meta?.tags ?? [];

  switch (event.type) {
    case "asset-filter.apply":
      // Ad-hoc filter is authoritative; reset the sidebar selection so it is not merged in.
      store.set(activeSidebarItemAtom, { kind: "mgmt", id: "all" });
      store.set(assetFiltersAtom, savedViewFiltersToAssetFilters(event.filters, tags, event.sort));
      break;
    case "asset-filter.activate-view": {
      const view = meta?.views.find((item) => item.id === event.viewId);
      store.set(activeSidebarItemAtom, { kind: "view", id: event.viewId });
      store.set(
        assetFiltersAtom,
        view
          ? savedViewFiltersToAssetFilters(view.filters, tags, view.sort)
          : getDefaultAssetFilters(),
      );
      break;
    }
    case "asset-filter.select-sidebar":
      if (event.item.kind === "mgmt") {
        store.set(activeSidebarItemAtom, { kind: "mgmt", id: event.item.id });
        store.set(assetFiltersAtom, getDefaultAssetFilters());
      } else {
        const tagName = tags.find((tag) => tag.id === event.item.id)?.name;
        store.set(activeSidebarItemAtom, { kind: "tag", id: event.item.id });
        store.set(assetFiltersAtom, {
          ...store.get(assetFiltersAtom),
          tags: tagName ? [tagName] : [],
        });
      }
      break;
    case "asset-filter.clear":
      store.set(activeSidebarItemAtom, { kind: "mgmt", id: "all" });
      store.set(assetFiltersAtom, getDefaultAssetFilters());
      break;
  }

  await reportCurrentFilterSnapshot(tags);
}

/**
 * Push the current live filter (canonical, id-based) to the main-process cache that answers
 * `filter.get`. Pass the tag options used to resolve names back to ids.
 */
export async function reportCurrentFilterSnapshot(
  tagOptions: readonly SidebarTag[],
): Promise<void> {
  const store = getDefaultStore();
  const filters = store.get(assetFiltersAtom);
  const activeItem = store.get(activeSidebarItemAtom);
  await trpcClient.events.reportFilterState.mutate({
    filters: assetFiltersToSavedViewFilters(filters, tagOptions),
    sort: filters.sort,
    activeItem,
  });
}
