/**
 * @purpose Publish and subscribe to main-process app events for renderer-facing updates.
 * @role    Event coordination utility for background tasks, watchers, and tRPC subscriptions.
 * @deps    Node event primitives and typed event payload contracts.
 * @gotcha  Keep event payloads serializable because they cross Electron IPC boundaries.
 */

import type { AssetListSortInput } from "@shared/contracts/assets/asset-list.contract";
import type { SavedViewFiltersInput } from "@shared/contracts/assets/saved-views/saved-view.contract";

import type { BackgroundTask } from "./background-tasks";

export type WatcherStatus = "idle" | "starting" | "watching" | "auditing" | "stopped" | "error";

export type AssetFilterSidebarTarget =
  | { kind: "mgmt"; id: "all" | "inbox" }
  | { kind: "tag"; id: string };

export type WatcherScope =
  | {
      type: "vault";
      vaultId: string;
    }
  | {
      type: "note";
      vaultId: string;
      noteId: string;
    };

export type WatcherFileChange = {
  kind: "created" | "updated" | "deleted" | "moved";
  vaultId: string;
  relativePath: string;
  previousRelativePath?: string;
  contentHash?: string;
  mtimeMs?: number;
};

export type AppEvent =
  | {
      type: "ledger.changed";
      emittedAt: number;
      source: "post-cli" | "post-extension";
      dbPath: string;
      changed: string[];
      operationCount: number;
    }
  | {
      type: "asset-filter.apply";
      emittedAt: number;
      filters: SavedViewFiltersInput;
      sort: AssetListSortInput;
    }
  | {
      type: "asset-filter.activate-view";
      emittedAt: number;
      viewId: string;
    }
  | {
      type: "asset-filter.select-sidebar";
      emittedAt: number;
      item: AssetFilterSidebarTarget;
    }
  | {
      type: "asset-filter.clear";
      emittedAt: number;
    }
  | {
      type: "asset-detail.open";
      emittedAt: number;
      assetId: string;
    }
  | {
      type: "task.updated";
      emittedAt: number;
      task: BackgroundTask;
    }
  | {
      type: "task.completed";
      emittedAt: number;
      task: BackgroundTask;
    }
  | {
      type: "task.failed";
      emittedAt: number;
      task: BackgroundTask;
    }
  | {
      type: "watcher.status";
      emittedAt: number;
      scope: WatcherScope;
      status: WatcherStatus;
      message?: string;
    }
  | {
      type: "watcher.changed";
      emittedAt: number;
      scope: WatcherScope;
      changes: WatcherFileChange[];
    };

type AppEventListener = (event: AppEvent) => void;

class AppEventBus {
  private listeners = new Set<AppEventListener>();

  subscribe(listener: AppEventListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  publish(event: AppEvent): void {
    for (const listener of Array.from(this.listeners)) {
      try {
        listener(event);
      } catch (error) {
        console.error("App event listener failed", error);
      }
    }
  }
}

export const appEventBus = new AppEventBus();
