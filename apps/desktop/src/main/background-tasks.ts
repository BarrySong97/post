/**
 * @purpose Track long-running main-process work and expose task state to the app.
 * @role    Background task registry for indexing, thumbnails, and other asynchronous workflows.
 * @deps    events module, task router consumers, native services.
 * @gotcha  Update task status consistently so renderer indicators do not get stuck.
 *          completedDigest is a rolling 30m window independent of recentlyCompleted retention.
 */

import { app } from "electron";

import { appEventBus } from "./events";

export type BackgroundTaskType = "indexing" | "reconcile" | "sync" | "thumbnails" | "import";
export type BackgroundTaskStatus = "queued" | "running" | "completed" | "failed";

export type BackgroundTaskProgress = {
  current?: number;
  total?: number;
  label?: string;
};

export type BackgroundTaskSubject = {
  /** Up to 3 display names for the objects this task acts on. */
  names: string[];
  count: number;
};

export type BackgroundTaskRetry = {
  kind: "thumbnails";
  assetIds: string[];
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
  subject?: BackgroundTaskSubject;
  retry?: BackgroundTaskRetry;
  startedAt: number;
  updatedAt: number;
  completedAt?: number;
  errorMessage?: string;
  hidden?: boolean;
};

export type CompletedDigestEntry = {
  type: BackgroundTaskType;
  taskCount: number;
  itemCount: number;
  lastCompletedAt: number;
};

export type BackgroundTaskSnapshot = {
  activeTask: BackgroundTask | null;
  running: BackgroundTask[];
  queued: BackgroundTask[];
  recentlyCompleted: BackgroundTask[];
  failed: BackgroundTask[];
  completedDigest: CompletedDigestEntry[];
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
  subject?: BackgroundTaskSubject;
  retry?: BackgroundTaskRetry;
  hidden?: boolean;
};

type SnapshotContext = {
  activeVault?: BackgroundTaskSnapshot["activeVault"];
};

type CompletedLogEntry = {
  type: BackgroundTaskType;
  vaultId?: string;
  completedAt: number;
  itemCount: number;
};

const RECENT_COMPLETED_LIMIT = 10;
const RECENT_COMPLETED_TTL_MS = 30 * 60 * 1000;
const DIGEST_TTL_MS = 30 * 60 * 1000;
const DIGEST_LOG_HARD_LIMIT = 1000;

export class BackgroundTaskManager {
  private tasks = new Map<string, BackgroundTask>();
  private sequence = 0;
  private completedLog: CompletedLogEntry[] = [];

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
      subject: input.subject,
      retry: input.retry,
      hidden: input.hidden,
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

  updateTask(
    taskId: string,
    patch: Partial<Pick<BackgroundTask, "progress" | "summary" | "title" | "subject">>,
  ): void {
    this.patch(taskId, patch);
  }

  completeTask(taskId: string, summary?: string): void {
    const existing = this.tasks.get(taskId);
    this.patch(taskId, {
      status: "completed",
      summary,
      completedAt: Date.now(),
      errorMessage: undefined,
    });

    if (existing && !existing.hidden) {
      const completedAt = Date.now();
      const itemCount =
        existing.progress?.current ?? existing.progress?.total ?? existing.subject?.count ?? 1;
      this.completedLog.push({
        type: existing.type,
        vaultId: existing.vaultId,
        completedAt,
        itemCount,
      });
      this.pruneLog(completedAt);
    }
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

  hasRecentCompletedTask(
    type: BackgroundTaskType,
    vaultId: string | undefined,
    ttlMs: number,
  ): boolean {
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
    this.pruneLog(Date.now());

    const tasks = Array.from(this.tasks.values())
      .filter((task) => !task.hidden)
      .sort((left, right) => right.updatedAt - left.updatedAt);
    const running = tasks.filter((task) => task.status === "running");
    const queued = tasks.filter((task) => task.status === "queued");
    const failed = tasks.filter((task) => task.status === "failed");
    const recentlyCompleted = tasks
      .filter((task) => task.status === "completed")
      .sort(
        (left, right) =>
          (right.completedAt ?? right.updatedAt) - (left.completedAt ?? left.updatedAt),
      )
      .slice(0, RECENT_COMPLETED_LIMIT);

    return {
      activeTask: running[0] ?? queued[0] ?? failed[0] ?? recentlyCompleted[0] ?? null,
      running,
      queued,
      recentlyCompleted,
      failed,
      completedDigest: this.buildCompletedDigest(),
      appVersion: app.getVersion(),
      activeVault: context.activeVault ?? null,
    };
  }

  /** Test helper — clears in-memory task + digest state. */
  resetForTests(): void {
    this.tasks.clear();
    this.sequence = 0;
    this.completedLog = [];
  }

  private buildCompletedDigest(): CompletedDigestEntry[] {
    const byType = new Map<BackgroundTaskType, CompletedDigestEntry>();

    for (const entry of this.completedLog) {
      const current = byType.get(entry.type);
      if (!current) {
        byType.set(entry.type, {
          type: entry.type,
          taskCount: 1,
          itemCount: entry.itemCount,
          lastCompletedAt: entry.completedAt,
        });
        continue;
      }

      current.taskCount += 1;
      current.itemCount += entry.itemCount;
      if (entry.completedAt > current.lastCompletedAt) {
        current.lastCompletedAt = entry.completedAt;
      }
    }

    return Array.from(byType.values()).sort(
      (left, right) => right.lastCompletedAt - left.lastCompletedAt,
    );
  }

  private pruneLog(now: number): void {
    const cutoff = now - DIGEST_TTL_MS;
    this.completedLog = this.completedLog.filter((entry) => entry.completedAt >= cutoff);
    if (this.completedLog.length > DIGEST_LOG_HARD_LIMIT) {
      this.completedLog = this.completedLog.slice(this.completedLog.length - DIGEST_LOG_HARD_LIMIT);
    }
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
    if (task.hidden) {
      return;
    }

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
      .sort(
        (left, right) =>
          (right.completedAt ?? right.updatedAt) - (left.completedAt ?? left.updatedAt),
      );
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
