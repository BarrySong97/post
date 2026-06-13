import { backgroundTaskManager } from "../background-tasks";
import { type IndexerCommand, type IndexerEvent, runIndexer } from "../indexer";

type RunIndexerTaskInput = {
  vaultId: string;
  rootPath: string;
  vaultName: string;
  title: string;
  assetIds?: string[];
  limit?: number;
};

export async function runIndexerTask(
  command: IndexerCommand,
  type: "indexing" | "reconcile",
  input: RunIndexerTaskInput,
) {
  const task = backgroundTaskManager.createTask({
    type,
    title: input.title,
    vaultId: input.vaultId,
    vaultName: input.vaultName,
  });
  const state = {
    filesSeen: 0,
  };

  backgroundTaskManager.startTask(task.id);

  try {
    const result = await runIndexer(
      command,
      {
        vaultId: input.vaultId,
        rootPath: input.rootPath,
        assetIds: input.assetIds,
        limit: input.limit,
      },
      {
        onEvent: (event) => {
          applyIndexerEventToTask(task.id, type, event, state);
        },
      },
    );
    backgroundTaskManager.completeTask(task.id, getTaskCompletionSummary(type, state, result.events));
    return result;
  } catch (error) {
    backgroundTaskManager.failTask(task.id, error);
    throw error;
  }
}

function applyIndexerEventToTask(
  taskId: string,
  type: "indexing" | "reconcile",
  event: IndexerEvent,
  state: {
    filesSeen: number;
  },
) {
  if (type === "indexing" || type === "reconcile") {
    if (typeof event.filesSeen === "number") {
      state.filesSeen = event.filesSeen;
      backgroundTaskManager.updateTask(taskId, {
        progress: {
          current: state.filesSeen,
          label: `${state.filesSeen} files`,
        },
      });
    }
  }
}

function getTaskCompletionSummary(
  type: "indexing" | "reconcile",
  state: {
    filesSeen: number;
  },
  events: IndexerEvent[],
) {
  if (type === "indexing") {
    const completed = findLastEvent(events, "completed");
    const filesSeen = typeof completed?.filesSeen === "number" ? completed.filesSeen : state.filesSeen;
    return `Indexed ${filesSeen} files`;
  }

  const completed = findLastEvent(events, "completed");
  const filesSeen = typeof completed?.filesSeen === "number" ? completed.filesSeen : state.filesSeen;
  return `Reindexed ${filesSeen} files`;
}

function findLastEvent(events: IndexerEvent[], eventType: string) {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    if (events[index]?.type === eventType) {
      return events[index];
    }
  }

  return undefined;
}
