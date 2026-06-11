import { backgroundTaskManager } from "./background-tasks";
import { runIndexer, type IndexerEvent } from "./indexer";

type ThumbnailVault = {
  id: string;
  rootPath: string;
  name: string;
};

type ThumbnailTaskInput = {
  assetIds?: string[];
  limit?: number;
};

type ThumbnailTaskState = {
  requested: number;
  ready: number;
  cached: number;
  failed: number;
};

export function runThumbnailTask(
  vault: ThumbnailVault,
  input: ThumbnailTaskInput = {},
) {
  const task = backgroundTaskManager.createTask({
    type: "thumbnails",
    title: "Generating thumbnails",
    vaultId: vault.id,
    vaultName: vault.name,
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
        applyThumbnailEventToTask(task.id, event, state);
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

function applyThumbnailEventToTask(
  taskId: string,
  event: IndexerEvent,
  state: ThumbnailTaskState,
) {
  if (event.type === "started" && typeof event.requested === "number") {
    state.requested = event.requested;
  }

  if (event.type === "thumbnail_ready") {
    state.ready += 1;
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
      label: state.requested > 0
        ? `${current} / ${state.requested}`
        : `${current} images`,
    },
  });
}

function getThumbnailCompletionSummary(state: ThumbnailTaskState) {
  if (state.requested === 0) {
    return "Thumbnails up to date";
  }

  if (state.failed > 0) {
    return `Generated ${state.ready} thumbnails · ${state.failed} failed`;
  }

  return `Thumbnails complete · ${state.ready} images`;
}
