/**
 * @purpose Manage active vault watcher processes and their renderer-visible state.
 * @role    Main-process coordinator for filesystem watch scopes and indexer watch commands.
 * @deps    indexer sidecar, events, vault/task routers.
 * @gotcha  Ensure watchers are stopped when vaults, scopes, or windows change to avoid orphan work.
 */

import {
  appEventBus,
  type WatcherFileChange,
  type WatcherScope,
  type WatcherStatus,
} from "./events";
import { backgroundTaskManager } from "./background-tasks";
import {
  runIndexer,
  startIndexerWatchDaemon,
  type IndexerEvent,
  type IndexerWatchDaemon,
  type IndexerWatchScope,
} from "./indexer";
import { runThumbnailTask } from "./thumbnail-tasks";
import { filterThumbnailAssetIdsNeedingWork } from "./services/thumbnail-service";

export type VaultWatcherScopeInput =
  | {
      type: "idle";
    }
  | {
      type: "vault";
      vaultId: string;
      rootPath: string;
      vaultName: string;
    }
  | {
      type: "note";
      vaultId: string;
      rootPath: string;
      vaultName: string;
      assetId: string;
      relativePath: string;
    };

export type VaultWatcherSnapshot = {
  scope: VaultWatcherScopeInput;
  status: WatcherStatus;
  pid?: number;
  lastEventAt?: number;
  lastSyncAt?: number;
  lastError?: string;
};

type ActiveWatcher = {
  vaultId: string;
  rootPath: string;
  vaultName: string;
  handle: IndexerWatchDaemon;
  stopRequested: boolean;
};

type ThumbnailVault = {
  id: string;
  rootPath: string;
  name: string;
};

const WATCH_SYNC_DEBOUNCE_MS = 500;
const THUMBNAIL_RETRY_DELAY_MS = 1000;

class VaultWatcherManager {
  private active: ActiveWatcher | null = null;
  private scope: VaultWatcherScopeInput = { type: "idle" };
  private status: WatcherStatus = "idle";
  private lastEventAt: number | undefined;
  private lastSyncAt: number | undefined;
  private lastError: string | undefined;
  private syncTimer: ReturnType<typeof setTimeout> | null = null;
  private syncRunning = false;
  private syncQueued = false;
  private pendingSyncPaths = new Set<string>();
  private pendingSyncChangeCount = 0;
  private pendingThumbnailAssetIds = new Set<string>();
  private pendingThumbnailVault: ThumbnailVault | null = null;
  private thumbnailRunning = false;
  private thumbnailTimer: ReturnType<typeof setTimeout> | null = null;

  setScope(scope: VaultWatcherScopeInput): VaultWatcherSnapshot {
    this.scope = scope;

    if (scope.type === "idle") {
      this.stopActiveWatcher();
      this.setStatus("idle");
      return this.getSnapshot();
    }

    const active = this.ensureActiveWatcher(scope);
    active.handle.setScope(toIndexerScope(scope));
    active.handle.audit();
    this.setStatus("watching");

    return this.getSnapshot();
  }

  audit(): VaultWatcherSnapshot {
    this.active?.handle.audit();
    return this.getSnapshot();
  }

  shutdown(): void {
    const previousScope = this.scope;
    this.stopActiveWatcher();
    this.setStatus("stopped", previousScope);
    this.scope = { type: "idle" };
  }

  getSnapshot(): VaultWatcherSnapshot {
    return {
      scope: this.scope,
      status: this.status,
      pid: this.active?.handle.pid,
      lastEventAt: this.lastEventAt,
      lastSyncAt: this.lastSyncAt,
      lastError: this.lastError,
    };
  }

  private ensureActiveWatcher(
    scope: Exclude<VaultWatcherScopeInput, { type: "idle" }>,
  ): ActiveWatcher {
    if (
      this.active &&
      this.active.vaultId === scope.vaultId &&
      this.active.rootPath === scope.rootPath
    ) {
      return this.active;
    }

    this.stopActiveWatcher();
    this.setStatus("starting", scope);

    const active: ActiveWatcher = {
      vaultId: scope.vaultId,
      rootPath: scope.rootPath,
      vaultName: scope.vaultName,
      stopRequested: false,
      handle: startIndexerWatchDaemon(
        {
          vaultId: scope.vaultId,
          rootPath: scope.rootPath,
        },
        {
          onEvent: (event) => {
            this.handleIndexerEvent(event);
          },
          onError: (error) => {
            if (this.active === active) {
              this.active = null;
            }
            this.failWatcher(error);
          },
          onExit: (_code, _signal, stderr) => {
            if (!active.stopRequested) {
              if (this.active === active) {
                this.active = null;
              }
              this.failWatcher(new Error(stderr || "Vault watcher stopped unexpectedly"));
            }
          },
        },
      ),
    };

    this.active = active;
    return active;
  }

  private stopActiveWatcher(): void {
    if (!this.active) {
      return;
    }

    this.active.stopRequested = true;
    this.active.handle.stop();
    this.active = null;
    this.clearSyncTimer();
    this.syncQueued = false;
    this.pendingSyncPaths.clear();
    this.pendingSyncChangeCount = 0;
    this.pendingThumbnailAssetIds.clear();
    this.pendingThumbnailVault = null;
    this.clearThumbnailTimer();
  }

  private handleIndexerEvent(event: IndexerEvent): void {
    this.lastEventAt = Date.now();

    if (event.type === "watcher_ready") {
      this.setStatus("watching");
      return;
    }

    if (event.type === "watcher_error") {
      const message = typeof event.message === "string" ? event.message : "Vault watcher failed";
      this.failWatcher(new Error(message));
      return;
    }

    if (event.type !== "watcher_changes") {
      return;
    }

    const appScope = toAppScope(this.scope);
    if (!appScope) {
      return;
    }

    const changes = parseWatcherChanges(event.changes);
    if (changes.length === 0) {
      return;
    }

    appEventBus.publish({
      type: "watcher.changed",
      emittedAt: Date.now(),
      scope: appScope,
      changes,
    });
    this.queueSync(changes);
  }

  private queueSync(changes: WatcherFileChange[] = []): void {
    this.collectSyncPaths(changes);

    if (this.syncRunning) {
      this.syncQueued = true;
      return;
    }

    if (this.syncTimer) {
      return;
    }

    this.syncTimer = setTimeout(() => {
      this.syncTimer = null;
      void this.runSync();
    }, WATCH_SYNC_DEBOUNCE_MS);
  }

  private async runSync(): Promise<void> {
    const scope = this.scope;
    if (scope.type === "idle" || this.syncRunning) {
      return;
    }

    const paths = Array.from(this.pendingSyncPaths);
    const changeCount = this.pendingSyncChangeCount;
    this.pendingSyncPaths.clear();
    this.pendingSyncChangeCount = 0;

    if (paths.length === 0) {
      this.setStatus("watching");
      return;
    }

    this.syncRunning = true;
    this.syncQueued = false;
    this.setStatus("auditing");

    const task = backgroundTaskManager.createTask({
      type: "sync",
      title: "Syncing changes",
      vaultId: scope.vaultId,
      vaultName: scope.vaultName,
      progress: {
        current: 0,
        total: paths.length,
        label: `${paths.length} paths`,
      },
    });
    const state = { filesSeen: 0, filesMissing: 0 };
    backgroundTaskManager.startTask(task.id);

    try {
      const result = await runIndexer(
        "refresh",
        {
          vaultId: scope.vaultId,
          rootPath: scope.rootPath,
          paths,
        },
        {
          onEvent: (event) => {
            if (typeof event.filesMissing === "number") {
              state.filesMissing = event.filesMissing;
            }

            if (typeof event.filesSeen === "number") {
              state.filesSeen = event.filesSeen;
              backgroundTaskManager.updateTask(task.id, {
                progress: {
                  current: Math.min(paths.length, state.filesSeen + state.filesMissing),
                  total: paths.length,
                  label: `${state.filesSeen} files · ${state.filesMissing} missing`,
                },
              });
            }
          },
        },
      );
      const completed = findLastEvent(result.events, "completed");
      const filesSeen =
        typeof completed?.filesSeen === "number" ? completed.filesSeen : state.filesSeen;
      const filesMissing =
        typeof completed?.filesMissing === "number" ? completed.filesMissing : state.filesMissing;
      this.queueThumbnailGeneration(
        scope,
        parseStringArray(completed?.thumbnailAssetIds ?? completed?.imageAssetIds),
      );
      backgroundTaskManager.completeTask(
        task.id,
        `Synced ${filesSeen + filesMissing} changes from ${changeCount} events`,
      );
      this.lastSyncAt = Date.now();
      this.setStatus("watching");
    } catch (error) {
      backgroundTaskManager.failTask(task.id, error);
      this.failWatcher(error instanceof Error ? error : new Error(String(error)));
    } finally {
      this.syncRunning = false;
      if (this.syncQueued) {
        this.queueSync();
      }
    }
  }

  private setStatus(
    status: WatcherStatus,
    scope: VaultWatcherScopeInput = this.scope,
    message?: string,
  ): void {
    this.status = status;
    if (status !== "error") {
      this.lastError = undefined;
    } else {
      this.lastError = message;
    }

    const appScope = toAppScope(scope);
    if (!appScope) {
      return;
    }

    appEventBus.publish({
      type: "watcher.status",
      emittedAt: Date.now(),
      scope: appScope,
      status,
      message,
    });
  }

  private failWatcher(error: Error): void {
    this.setStatus("error", this.scope, error.message);
  }

  private clearSyncTimer(): void {
    if (!this.syncTimer) {
      return;
    }

    clearTimeout(this.syncTimer);
    this.syncTimer = null;
  }

  private collectSyncPaths(changes: WatcherFileChange[]): void {
    if (changes.length === 0) {
      return;
    }

    this.pendingSyncChangeCount += changes.length;
    for (const change of changes) {
      this.pendingSyncPaths.add(change.relativePath);
      if (change.previousRelativePath) {
        this.pendingSyncPaths.add(change.previousRelativePath);
      }
    }
  }

  private queueThumbnailGeneration(
    scope: Exclude<VaultWatcherScopeInput, { type: "idle" }>,
    assetIds: string[],
  ): void {
    if (assetIds.length === 0) {
      return;
    }

    this.pendingThumbnailVault = {
      id: scope.vaultId,
      rootPath: scope.rootPath,
      name: scope.vaultName,
    };
    for (const assetId of assetIds) {
      this.pendingThumbnailAssetIds.add(assetId);
    }
    this.runPendingThumbnailGeneration();
  }

  private runPendingThumbnailGeneration(): void {
    if (
      this.thumbnailRunning ||
      this.pendingThumbnailAssetIds.size === 0 ||
      !this.pendingThumbnailVault
    ) {
      return;
    }

    if (backgroundTaskManager.hasActiveTask("thumbnails", this.pendingThumbnailVault.id)) {
      this.scheduleThumbnailRetry();
      return;
    }

    const vault = this.pendingThumbnailVault;
    const assetIds = filterThumbnailAssetIdsNeedingWork(
      vault,
      Array.from(this.pendingThumbnailAssetIds),
    );
    this.pendingThumbnailAssetIds.clear();
    if (assetIds.length === 0) {
      this.pendingThumbnailVault = null;
      return;
    }
    this.thumbnailRunning = true;

    void runThumbnailTask(vault, { assetIds, limit: assetIds.length })
      .catch((error) => {
        console.error("Failed to generate watcher thumbnails", error);
      })
      .finally(() => {
        this.thumbnailRunning = false;
        if (this.pendingThumbnailAssetIds.size > 0) {
          this.runPendingThumbnailGeneration();
        } else {
          this.pendingThumbnailVault = null;
        }
      });
  }

  private scheduleThumbnailRetry(): void {
    if (this.thumbnailTimer != null) {
      return;
    }

    this.thumbnailTimer = setTimeout(() => {
      this.thumbnailTimer = null;
      this.runPendingThumbnailGeneration();
    }, THUMBNAIL_RETRY_DELAY_MS);
  }

  private clearThumbnailTimer(): void {
    if (!this.thumbnailTimer) {
      return;
    }

    clearTimeout(this.thumbnailTimer);
    this.thumbnailTimer = null;
  }
}

function toIndexerScope(
  scope: Exclude<VaultWatcherScopeInput, { type: "idle" }>,
): IndexerWatchScope {
  if (scope.type === "note") {
    return {
      type: "note",
      assetId: scope.assetId,
      relativePath: scope.relativePath,
    };
  }

  return { type: "vault" };
}

function toAppScope(scope: VaultWatcherScopeInput): WatcherScope | null {
  if (scope.type === "idle") {
    return null;
  }

  if (scope.type === "note") {
    return {
      type: "note",
      vaultId: scope.vaultId,
      noteId: scope.assetId,
    };
  }

  return {
    type: "vault",
    vaultId: scope.vaultId,
  };
}

function parseWatcherChanges(value: unknown): WatcherFileChange[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.flatMap((item) => {
    if (
      !isRecord(item) ||
      typeof item.relativePath !== "string" ||
      !isWatcherChangeKind(item.kind)
    ) {
      return [];
    }

    return [
      {
        kind: item.kind,
        vaultId: typeof item.vaultId === "string" ? item.vaultId : "",
        relativePath: item.relativePath,
        previousRelativePath:
          typeof item.previousRelativePath === "string" ? item.previousRelativePath : undefined,
        contentHash: typeof item.contentHash === "string" ? item.contentHash : undefined,
        mtimeMs: typeof item.mtimeMs === "number" ? item.mtimeMs : undefined,
      },
    ];
  });
}

function isWatcherChangeKind(value: unknown): value is WatcherFileChange["kind"] {
  return value === "created" || value === "updated" || value === "deleted" || value === "moved";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === "object";
}

function findLastEvent(events: IndexerEvent[], eventType: string): IndexerEvent | undefined {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    if (events[index]?.type === eventType) {
      return events[index];
    }
  }

  return undefined;
}

function parseStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter((item): item is string => typeof item === "string" && item.length > 0);
}

export const vaultWatcherManager = new VaultWatcherManager();
