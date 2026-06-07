import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Activity, AlertCircle, CheckCircle2, Clock3, FolderOpen } from "lucide-react";

import { trpc, type RouterOutputs } from "@/lib/trpc";

type TaskSnapshot = RouterOutputs["tasks"]["snapshot"];
type BackgroundTask = NonNullable<TaskSnapshot["activeTask"]>;
type TaskGroupKey = "running" | "queued" | "failed" | "recentlyCompleted";

const COMPLETED_VISIBLE_MS = 8000;
const THUMBNAIL_REFRESH_BATCH_SIZE = 8;

export function AppShell({ children }: { children: ReactNode }) {
  return (
    <div className="flex h-screen min-h-0 flex-col overflow-hidden bg-white text-zinc-950">
      <div className="min-h-0 flex-1 overflow-hidden">{children}</div>
      <GlobalStatusLine />
    </div>
  );
}

function GlobalStatusLine() {
  const queryClient = useQueryClient();
  const [popoverOpen, setPopoverOpen] = useState(false);
  const [dismissedFailureVersion, setDismissedFailureVersion] = useState(0);
  const dismissedFailureIds = useRef(new Set<string>());
  const completedInvalidatedIds = useRef(new Set<string>());
  const lastThumbnailProgressInvalidation = useRef({ taskId: "", progress: 0 });
  const tasksQuery = useQuery({
    ...trpc.tasks.snapshot.queryOptions(),
    refetchInterval: (query) => {
      const snapshot = query.state.data as TaskSnapshot | undefined;
      return hasVisibleTaskActivity(snapshot) ? 1000 : 7000;
    },
    refetchOnWindowFocus: true,
  });
  const snapshot = tasksQuery.data;

  useEffect(() => {
    if (!snapshot) {
      return;
    }

    const runningThumbnailTask = snapshot.running.find((task) => task.type === "thumbnails");
    const thumbnailProgress = runningThumbnailTask?.progress?.current ?? 0;
    if (
      runningThumbnailTask
      &&
      thumbnailProgress > 0
      && (
        runningThumbnailTask.id !== lastThumbnailProgressInvalidation.current.taskId
        || thumbnailProgress !== lastThumbnailProgressInvalidation.current.progress
      )
      && thumbnailProgress % THUMBNAIL_REFRESH_BATCH_SIZE === 0
    ) {
      lastThumbnailProgressInvalidation.current = {
        taskId: runningThumbnailTask.id,
        progress: thumbnailProgress,
      };
      void queryClient.invalidateQueries(trpc.assets.list.queryFilter());
    }

    for (const task of snapshot.recentlyCompleted) {
      if (task.type !== "thumbnails" || completedInvalidatedIds.current.has(task.id)) {
        continue;
      }

      completedInvalidatedIds.current.add(task.id);
      void queryClient.invalidateQueries(trpc.assets.list.queryFilter());
    }
  }, [queryClient, snapshot]);

  const activeTask = useMemo(() => {
    const task = snapshot?.activeTask ?? null;
    if (!task) {
      return null;
    }

    if (task.status === "completed") {
      const completedAt = task.completedAt ?? task.updatedAt;
      return Date.now() - completedAt <= COMPLETED_VISIBLE_MS ? task : null;
    }

    if (task.status === "failed" && dismissedFailureIds.current.has(task.id)) {
      return null;
    }

    return task;
  }, [dismissedFailureVersion, snapshot]);

  const activeVaultName = snapshot?.activeVault?.name ?? "No folder";
  const appVersion = snapshot?.appVersion ?? "0.0.0";

  return (
    <footer className="window-no-drag relative z-[90] flex h-8 shrink-0 items-center justify-between border-t border-[#ddd6ca] bg-[#fbfaf7] px-2 text-[11px] text-[#5f574d]">
      <button
        type="button"
        className="flex min-w-0 items-center gap-2 rounded-md px-1.5 py-1 text-left transition-colors hover:bg-black/[0.035]"
        title={`Post v${appVersion} | Folder: ${activeVaultName}`}
      >
        <span className="shrink-0 font-semibold text-[#37322c]">Post v{appVersion}</span>
        <span className="shrink-0 text-[#c5bdb1]">|</span>
        <FolderOpen size={12} className="shrink-0 text-[#8d8579]" />
        <span className="min-w-0 truncate">Folder: {activeVaultName}</span>
      </button>

      <div className="relative flex min-w-[240px] justify-end">
        {activeTask ? (
          <button
            type="button"
            className={`flex h-6 max-w-[360px] items-center gap-2 rounded-[7px] border px-2.5 text-[11px] shadow-[0_1px_0_rgba(20,18,14,0.03)] transition-colors ${getTaskPillClass(activeTask)}`}
            onClick={() => {
              if (activeTask.status === "failed") {
                dismissedFailureIds.current.add(activeTask.id);
                setDismissedFailureVersion((version) => version + 1);
              }
              setPopoverOpen((open) => !open);
            }}
          >
            <TaskStatusIcon task={activeTask} />
            <span className="min-w-0 truncate">{getTaskLabel(activeTask)}</span>
            {activeTask.progress?.label ? (
              <span className="shrink-0 text-[#7d756a]">{activeTask.progress.label}</span>
            ) : null}
          </button>
        ) : null}

        {popoverOpen && snapshot ? (
          <TaskPopover snapshot={snapshot} onClose={() => setPopoverOpen(false)} />
        ) : null}
      </div>
    </footer>
  );
}

function TaskPopover({
  snapshot,
  onClose,
}: {
  snapshot: TaskSnapshot;
  onClose: () => void;
}) {
  return (
    <div className="absolute bottom-8 right-0 w-[360px] overflow-hidden rounded-[9px] border border-[#d8d2c7] bg-white text-[#37322c] shadow-[0_18px_44px_rgba(20,18,14,0.16)]">
      <div className="flex items-center justify-between border-b border-[#eee9e1] px-3 py-2.5">
        <span className="text-[13px] font-semibold">Background tasks</span>
        <button
          type="button"
          className="rounded-md px-1.5 py-0.5 text-[11px] text-[#8d8579] transition-colors hover:bg-black/[0.04] hover:text-[#37322c]"
          onClick={onClose}
        >
          Close
        </button>
      </div>

      <div className="max-h-[360px] overflow-auto py-1">
        <TaskGroup title="Running" tasks={snapshot.running} groupKey="running" />
        <TaskGroup title="Queued" tasks={snapshot.queued} groupKey="queued" />
        <TaskGroup title="Failed" tasks={snapshot.failed} groupKey="failed" />
        <TaskGroup title="Recently completed" tasks={snapshot.recentlyCompleted} groupKey="recentlyCompleted" />
      </div>
    </div>
  );
}

function TaskGroup({
  title,
  tasks,
  groupKey,
}: {
  title: string;
  tasks: BackgroundTask[];
  groupKey: TaskGroupKey;
}) {
  if (tasks.length === 0) {
    return null;
  }

  return (
    <section className="border-b border-[#f0ebe4] last:border-b-0">
      <h3 className="px-3 pt-2 text-[10px] font-semibold uppercase tracking-[0.08em] text-[#9a9388]">{title}</h3>
      <div className="py-1">
        {tasks.map((task) => (
          <TaskRow key={`${groupKey}:${task.id}`} task={task} />
        ))}
      </div>
    </section>
  );
}

function TaskRow({ task }: { task: BackgroundTask }) {
  return (
    <div className="px-3 py-2">
      <div className="flex items-center justify-between gap-3 text-[12px]">
        <div className="flex min-w-0 items-center gap-2">
          <TaskStatusIcon task={task} />
          <span className="min-w-0 truncate font-medium">{task.title}</span>
        </div>
        <span className="shrink-0 text-[#7d756a]">{getTaskStatusText(task)}</span>
      </div>

      {task.progress?.total ? (
        <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-[#ece7df]">
          <div
            className="h-full rounded-full bg-[#6f8fdb]"
            style={{
              width: `${Math.min(100, Math.round(((task.progress.current ?? 0) / task.progress.total) * 100))}%`,
            }}
          />
        </div>
      ) : null}

      {task.summary ? <p className="mt-1 text-[11px] text-[#7d756a]">{task.summary}</p> : null}
      {task.errorMessage ? <p className="mt-1 text-[11px] text-[#9f433e]">{task.errorMessage}</p> : null}
    </div>
  );
}

function TaskStatusIcon({ task }: { task: BackgroundTask }) {
  if (task.status === "completed") {
    return <CheckCircle2 size={12} className="shrink-0 text-[#4f8b5f]" />;
  }

  if (task.status === "failed") {
    return <AlertCircle size={12} className="shrink-0 text-[#b54e48]" />;
  }

  if (task.status === "queued") {
    return <Clock3 size={12} className="shrink-0 text-[#8d8579]" />;
  }

  return <Activity size={12} className="shrink-0 text-[#6f8fdb]" />;
}

function getTaskPillClass(task: BackgroundTask) {
  if (task.status === "failed") {
    return "border-[#e1b5af] bg-[#fff2f0] text-[#8f3d38]";
  }

  if (task.status === "completed") {
    return "border-[#c8dac2] bg-[#f2f8ef] text-[#3f6f4b]";
  }

  return "border-[#d7d0c5] bg-[#ebe7df] text-[#37322c] hover:bg-[#e4dfd6]";
}

function getTaskLabel(task: BackgroundTask) {
  if (task.status === "completed") {
    return task.summary ?? task.title;
  }

  if (task.status === "failed") {
    return `${task.title} failed`;
  }

  return task.title;
}

function getTaskStatusText(task: BackgroundTask) {
  if (task.status === "completed") {
    return "Complete";
  }

  if (task.status === "failed") {
    return "Failed";
  }

  if (task.status === "queued") {
    return "Queued";
  }

  return task.progress?.label ?? "Running";
}

function hasVisibleTaskActivity(snapshot: TaskSnapshot | undefined) {
  if (!snapshot) {
    return true;
  }

  if (snapshot.running.length > 0 || snapshot.queued.length > 0 || snapshot.failed.length > 0) {
    return true;
  }

  const recent = snapshot.recentlyCompleted[0];
  if (!recent) {
    return false;
  }

  return Date.now() - (recent.completedAt ?? recent.updatedAt) <= COMPLETED_VISIBLE_MS;
}
