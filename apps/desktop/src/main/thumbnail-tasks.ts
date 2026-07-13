/**
 * @purpose Manage thumbnail generation work for indexed assets.
 * @role    Background task coordinator between asset records, indexer thumbnails, and UI events.
 * @deps    indexer utilities, database repositories, background task/event services.
 * @gotcha  Avoid blocking app startup; thumbnail work should remain incremental and cancellable where possible.
 *          Retry payloads omit assetIds above 500 to keep task.updated IPC small.
 */

import { backgroundTaskManager, type BackgroundTaskSubject } from "./background-tasks";
import { runIndexer, type IndexerEvent } from "./indexer";
import { getAssetRowsByIds } from "./repositories/assets-repository";

type ThumbnailVault = {
  id: string;
  rootPath: string;
  name: string;
};

type ThumbnailTaskInput = {
  assetIds?: string[];
  limit?: number;
  hidden?: boolean;
};

type ThumbnailTaskState = {
  requested: number;
  ready: number;
  cached: number;
  failed: number;
};

const RETRY_ASSET_ID_LIMIT = 500;

export function runThumbnailTask(vault: ThumbnailVault, input: ThumbnailTaskInput = {}) {
  const nameByAssetId = new Map<string, string>();
  const subject = buildThumbnailSubject(input.assetIds, nameByAssetId);
  const retry =
    input.assetIds && input.assetIds.length > 0 && input.assetIds.length <= RETRY_ASSET_ID_LIMIT
      ? { kind: "thumbnails" as const, assetIds: [...input.assetIds] }
      : undefined;

  const task = backgroundTaskManager.createTask({
    type: "thumbnails",
    title: "Generating thumbnails",
    vaultId: vault.id,
    vaultName: vault.name,
    subject,
    retry,
    hidden: input.hidden,
  });
  const state: ThumbnailTaskState = {
    requested: 0,
    ready: 0,
    cached: 0,
    failed: 0,
  };

  backgroundTaskManager.startTask(task.id);

  return runIndexer(
    "thumbnails",
    {
      vaultId: vault.id,
      rootPath: vault.rootPath,
      assetIds: input.assetIds,
      limit: input.limit,
    },
    {
      onEvent: (event) => {
        applyThumbnailEventToTask(task.id, event, state, subject, nameByAssetId);
      },
    },
  )
    .then((result) => {
      backgroundTaskManager.completeTask(task.id, getThumbnailCompletionSummary(state));
      return result;
    })
    .catch((error: unknown) => {
      backgroundTaskManager.failTask(task.id, error);
      throw error;
    });
}

function buildThumbnailSubject(
  assetIds: string[] | undefined,
  nameByAssetId: Map<string, string>,
): BackgroundTaskSubject | undefined {
  if (!assetIds || assetIds.length === 0) {
    return undefined;
  }

  const rows = getAssetRowsByIds(assetIds);
  for (const row of rows) {
    const name = row.title?.trim() || row.fileName;
    if (name) {
      nameByAssetId.set(row.id, name);
    }
  }

  const names = Array.from(nameByAssetId.values()).slice(0, 3);

  return {
    names,
    count: assetIds.length,
  };
}

function applyThumbnailEventToTask(
  taskId: string,
  event: IndexerEvent,
  state: ThumbnailTaskState,
  subject: BackgroundTaskSubject | undefined,
  nameByAssetId: Map<string, string>,
) {
  if (event.type === "started" && typeof event.requested === "number") {
    state.requested = event.requested;
    // Full-vault runs omit assetIds at create time — backfill count from indexer started.
    if (!subject) {
      backgroundTaskManager.updateTask(taskId, {
        subject: {
          names: [],
          count: event.requested,
        },
      });
    }
  }

  let progressLabel: string | undefined;
  if (event.type === "thumbnail_ready") {
    state.ready += 1;
    progressLabel = resolveAssetLabel(event, nameByAssetId) ?? subject?.names[0];
  } else if (event.type === "thumbnail_cached") {
    state.cached += 1;
  } else if (event.type === "thumbnail_failed") {
    state.failed += 1;
  } else if (event.type === "completed") {
    if (typeof event.ready === "number") {
      state.ready = event.ready;
    }
    if (typeof event.cached === "number") {
      state.cached = event.cached;
    }
    if (typeof event.failed === "number") {
      state.failed = event.failed;
    }
  }

  const current = state.ready + state.cached + state.failed;
  backgroundTaskManager.updateTask(taskId, {
    progress: {
      current,
      total: state.requested || undefined,
      label:
        progressLabel ??
        (state.requested > 0 ? `${current} / ${state.requested}` : `${current} thumbnails`),
    },
  });
}

function resolveAssetLabel(
  event: IndexerEvent,
  nameByAssetId: Map<string, string>,
): string | undefined {
  if (typeof event.assetId === "string") {
    return nameByAssetId.get(event.assetId);
  }
  return undefined;
}

function getThumbnailCompletionSummary(state: ThumbnailTaskState) {
  if (state.requested === 0) {
    return "Thumbnails up to date";
  }

  if (state.failed > 0) {
    return `Generated ${state.ready} thumbnails · ${state.failed} failed`;
  }

  return `Thumbnails complete · ${state.ready} generated`;
}
