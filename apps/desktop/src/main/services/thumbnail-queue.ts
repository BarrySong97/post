/**
 * @purpose Merge per-vault thumbnail generation requests into a single drain queue.
 * @role    Main-process coordinator shared by vault watcher and extension image import.
 * @deps    backgroundTaskManager, filterThumbnailAssetIdsNeedingWork, runThumbnailTask.
 * @gotcha  Indexer cannot append mid-run; drain pending after each batch instead of mutating totals.
 */

import { backgroundTaskManager } from "../background-tasks";
import { runThumbnailTask } from "../thumbnail-tasks";
import { filterThumbnailAssetIdsNeedingWork } from "./thumbnail-service";

export type ThumbnailQueueVault = {
  id: string;
  rootPath: string;
  name: string;
};

type VaultQueueState = {
  vault: ThumbnailQueueVault;
  pending: Set<string>;
  running: boolean;
  retryTimer: ReturnType<typeof setTimeout> | null;
};

const THUMBNAIL_RETRY_DELAY_MS = 1000;

const queues = new Map<string, VaultQueueState>();

export function enqueueThumbnails(vault: ThumbnailQueueVault, assetIds: string[]): void {
  if (assetIds.length === 0) {
    return;
  }

  const state = getOrCreateQueue(vault);
  state.vault = vault;
  for (const assetId of assetIds) {
    state.pending.add(assetId);
  }
  drain(vault.id);
}

export function disposeThumbnailQueue(vaultId?: string): void {
  if (vaultId) {
    const state = queues.get(vaultId);
    if (!state) {
      return;
    }
    clearRetryTimer(state);
    queues.delete(vaultId);
    return;
  }

  for (const state of queues.values()) {
    clearRetryTimer(state);
  }
  queues.clear();
}

function getOrCreateQueue(vault: ThumbnailQueueVault): VaultQueueState {
  const existing = queues.get(vault.id);
  if (existing) {
    return existing;
  }

  const created: VaultQueueState = {
    vault,
    pending: new Set(),
    running: false,
    retryTimer: null,
  };
  queues.set(vault.id, created);
  return created;
}

function drain(vaultId: string): void {
  const state = queues.get(vaultId);
  if (!state || state.running || state.pending.size === 0) {
    return;
  }

  if (backgroundTaskManager.hasActiveTask("thumbnails", vaultId)) {
    scheduleRetry(state);
    return;
  }

  const vault = state.vault;
  const assetIds = filterThumbnailAssetIdsNeedingWork(vault, Array.from(state.pending));
  state.pending.clear();
  if (assetIds.length === 0) {
    return;
  }

  state.running = true;
  void runThumbnailTask(vault, { assetIds, limit: assetIds.length })
    .catch((error) => {
      console.error("Failed to generate queued thumbnails", error);
    })
    .finally(() => {
      state.running = false;
      if (state.pending.size > 0) {
        drain(vaultId);
      }
    });
}

function scheduleRetry(state: VaultQueueState): void {
  if (state.retryTimer != null) {
    return;
  }

  state.retryTimer = setTimeout(() => {
    state.retryTimer = null;
    drain(state.vault.id);
  }, THUMBNAIL_RETRY_DELAY_MS);
}

function clearRetryTimer(state: VaultQueueState): void {
  if (state.retryTimer == null) {
    return;
  }
  clearTimeout(state.retryTimer);
  state.retryTimer = null;
}

/** Test helper — inspect queue size without starting work. */
export function getThumbnailQueuePendingCountForTests(vaultId: string): number {
  return queues.get(vaultId)?.pending.size ?? 0;
}

/** Test helper — whether a vault queue is currently running a batch. */
export function isThumbnailQueueRunningForTests(vaultId: string): boolean {
  return queues.get(vaultId)?.running ?? false;
}
