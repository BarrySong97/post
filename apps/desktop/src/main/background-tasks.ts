import { app } from "electron";

import { appEventBus } from "./events";

export type BackgroundTaskType = "indexing" | "reconcile" | "sync" | "thumbnails";
export type BackgroundTaskStatus = "queued" | "running" | "completed" | "failed";

export type BackgroundTaskProgress = {
  current?: number;
  total?: number;
  label?: string;
};

export type BackgroundTask = {
  id: string;
  type: BackgroundTaskType;
  title: string;
  status: BackgroundTaskStatus;
  vaultId?: string;
  vaultName?: string;
  progress?: BackgroundTaskProgress;
  summary?: string;
  startedAt: number;
  updatedAt: number;
  completedAt?: number;
  errorMessage?: string;
};

export type BackgroundTaskSnapshot = {
  activeTask: BackgroundTask | null;
  running: BackgroundTask[];
  queued: BackgroundTask[];
  recentlyCompleted: BackgroundTask[];
  failed: BackgroundTask[];
  appVersion: string;
  activeVault: {
    id: string;
    name: string;
    rootPath: string;
  } | null;
};

type CreateTaskInput = {
  type: BackgroundTaskType;
  title: string;
  vaultId?: string;
  vaultName?: string;
  progress?: BackgroundTaskProgress;
};

type SnapshotContext = {
  activeVault?: BackgroundTaskSnapshot["activeVault"];
};

const RECENT_COMPLETED_LIMIT = 10;
const RECENT_COMPLETED_TTL_MS = 30 * 60 * 1000;

class BackgroundTaskManager {
  private tasks = new Map<string, BackgroundTask>();
  private sequence = 0;

  createTask(input: CreateTaskInput): BackgroundTask {
    const now = Date.now();
    const task: BackgroundTask = {
      id: `task_${now.toString(36)}_${(this.sequence += 1).toString(36)}`,
      type: input.type,
      title: input.title,
      status: "queued",
      vaultId: input.vaultId,
      vaultName: input.vaultName,
      progress: input.progress,
      startedAt: now,
      updatedAt: now,
    };

    this.tasks.set(task.id, task);
    this.prune();
    this.publishTaskEvents(task);
    return task;
  }

  startTask(taskId: string): void {
    this.patch(taskId, { status: "running" });
  }

  updateTask(taskId: string, patch: Partial<Pick<BackgroundTask, "progress" | "summary" | "title">>): void {
    this.patch(taskId, patch);
  }

  completeTask(taskId: string, summary?: string): void {
    this.patch(taskId, {
      status: "completed",
      summary,
      completedAt: Date.now(),
      errorMessage: undefined,
    });
  }

  failTask(taskId: string, error: unknown): void {
    this.patch(taskId, {
      status: "failed",
      errorMessage: error instanceof Error ? error.message : String(error),
      completedAt: Date.now(),
    });
  }

  hasActiveTask(type: BackgroundTaskType, vaultId?: string): boolean {
    return Array.from(this.tasks.values()).some((task) => {
      if (task.type !== type) {
        return false;
      }

      if (vaultId && task.vaultId !== vaultId) {
        return false;
      }

      return task.status === "queued" || task.status === "running";
    });
  }

  hasRecentCompletedTask(type: BackgroundTaskType, vaultId: string | undefined, ttlMs: number): boolean {
    const now = Date.now();
    return Array.from(this.tasks.values()).some((task) => {
      if (task.type !== type || task.status !== "completed") {
        return false;
      }

      if (vaultId && task.vaultId !== vaultId) {
        return false;
      }

      return now - (task.completedAt ?? task.updatedAt) <= ttlMs;
    });
  }

  getSnapshot(context: SnapshotContext = {}): BackgroundTaskSnapshot {
    this.prune();

    const tasks = Array.from(this.tasks.values()).sort((left, right) => right.updatedAt - left.updatedAt);
    const running = tasks.filter((task) => task.status === "running");
    const queued = tasks.filter((task) => task.status === "queued");
    const failed = tasks.filter((task) => task.status === "failed");
    const recentlyCompleted = tasks
      .filter((task) => task.status === "completed")
      .sort((left, right) => (right.completedAt ?? right.updatedAt) - (left.completedAt ?? left.updatedAt))
      .slice(0, RECENT_COMPLETED_LIMIT);

    return {
      activeTask: running[0] ?? queued[0] ?? failed[0] ?? recentlyCompleted[0] ?? null,
      running,
      queued,
      recentlyCompleted,
      failed,
      appVersion: app.getVersion(),
      activeVault: context.activeVault ?? null,
    };
  }

  private patch(taskId: string, patch: Partial<BackgroundTask>): void {
    const task = this.tasks.get(taskId);
    if (!task) {
      return;
    }

    const nextTask = {
      ...task,
      ...patch,
      updatedAt: Date.now(),
    };

    this.tasks.set(taskId, nextTask);
    this.prune();
    this.publishTaskEvents(nextTask, task.status);
  }

  private publishTaskEvents(task: BackgroundTask, previousStatus?: BackgroundTaskStatus): void {
    const emittedAt = Date.now();
    appEventBus.publish({
      type: "task.updated",
      emittedAt,
      task,
    });

    if (previousStatus === task.status) {
      return;
    }

    if (task.status === "completed") {
      appEventBus.publish({
        type: "task.completed",
        emittedAt,
        task,
      });
    } else if (task.status === "failed") {
      appEventBus.publish({
        type: "task.failed",
        emittedAt,
        task,
      });
    }
  }

  private prune(): void {
    const now = Date.now();
    const completed = Array.from(this.tasks.values())
      .filter((task) => task.status === "completed")
      .sort((left, right) => (right.completedAt ?? right.updatedAt) - (left.completedAt ?? left.updatedAt));
    const keepCompletedIds = new Set(
      completed
        .filter((task) => now - (task.completedAt ?? task.updatedAt) <= RECENT_COMPLETED_TTL_MS)
        .slice(0, RECENT_COMPLETED_LIMIT)
        .map((task) => task.id),
    );

    for (const task of this.tasks.values()) {
      if (task.status === "completed" && !keepCompletedIds.has(task.id)) {
        this.tasks.delete(task.id);
      }
    }
  }
}

export const backgroundTaskManager = new BackgroundTaskManager();
