/**
 * @purpose Cache the renderer's last-reported live asset-filter snapshot for CLI read-back.
 * @role    Main-process single-slot store answering local-IPC filter.get requests.
 * @deps    Shared saved-view/asset-list contract types.
 * @gotcha  Reflects only what the renderer last reported; may be stale or null before the asset manager opens.
 */

import type { AssetListSortInput } from "@shared/contracts/assets/asset-list.contract";
import type { SavedViewFiltersInput } from "@shared/contracts/assets/saved-views/saved-view.contract";

export type LiveFilterActiveItem =
  | { kind: "mgmt"; id: "all" | "inbox" }
  | { kind: "view"; id: string }
  | { kind: "tag"; id: string };

export type LiveFilterSnapshot = {
  filters: SavedViewFiltersInput;
  sort: AssetListSortInput;
  activeItem: LiveFilterActiveItem;
  reportedAt: number;
};

let currentSnapshot: LiveFilterSnapshot | null = null;

export function setLiveFilterSnapshot(snapshot: LiveFilterSnapshot): void {
  currentSnapshot = snapshot;
}

export function getLiveFilterSnapshot(): LiveFilterSnapshot | null {
  return currentSnapshot;
}
