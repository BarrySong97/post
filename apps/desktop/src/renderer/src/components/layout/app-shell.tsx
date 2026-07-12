/**
 * @purpose Render the app shell surface for the desktop renderer.
 * @role    App-level React component composed by routes, shell, or shared workflows.
 * @deps    React, HeroUI/local UI primitives, tRPC hooks, and shared renderer modules as needed.
 * @gotcha  Keep operational layouts dense and aligned with design.md icon and panel sizing rules.
 *          GlobalToasts/UpdateToast mount after {children}; toast cards use window-no-drag so clicks
 *          work. Their fixed shells must be window-drag (not default/no-drag) or Chromium app-region
 *          punches a dead zone through the top-center chrome even when empty/pointer-events-none.
 *          Toast enter/exit avoids motion `layout` so paint stays cheap next to vault invalidation.
 */

import { useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { Button, Popover } from "@heroui/react";
import { AnimatePresence, motion } from "motion/react";
import { CheckCircle2, Info, Settings2, TriangleAlert, X, XCircle } from "lucide-react";
import { useTranslation } from "react-i18next";
import {
  getToastSnapshot,
  subscribeToasts,
  toast,
  TOAST_ENTER_MS,
  type ToastItem,
} from "@/lib/toast";

import { trpc, trpcClient, type RouterOutputs } from "@/lib/trpc";
import { applyFilterCommand } from "@/lib/asset-manager/apply-filter-command";
import { openAssetDetail } from "@/lib/asset-manager/open-asset-detail";
import { useInvalidateVaultState } from "@/hooks/use-invalidate-vault-state";
import { useHistoryNavigationShortcuts } from "@/hooks/use-history-navigation-shortcuts";
import { ConfirmModalProvider } from "@/components/common/confirm-modal";
import { UpdateToast } from "@/components/layout/update-toast";
import { AutoUpdateProvider } from "@/providers/auto-update-provider";

type TaskSnapshot = RouterOutputs["tasks"]["snapshot"];
type BackgroundTask = NonNullable<TaskSnapshot["activeTask"]>;
type FooterTaskType = BackgroundTask["type"];
type FooterTaskState = BackgroundTask["status"];
type FooterTask = {
  id: string;
  type: FooterTaskType;
  state: FooterTaskState;
  done: number;
  total: number;
  label?: string;
  reason?: string;
  completedAt?: number;
};

const COMPLETED_VISIBLE_MS = 8000;
const EVENT_TASK_RETENTION_MS = 30 * 60 * 1000;
const THUMBNAIL_REFRESH_BATCH_SIZE = 8;
const TASK_EVENT_INVALIDATION_DELAY_MS = 250;

function taskTypeLabel(type: FooterTaskType, t: (key: string) => string): string {
  return t(`shell.taskType.${type}`);
}

export function AppShell({ children }: { children: ReactNode }) {
  // Mounted at the root shell (not AppLayout) so back/forward works on every route —
  // including /settings, which renders outside the /_app layout.
  useHistoryNavigationShortcuts();

  return (
    <ConfirmModalProvider>
      <AutoUpdateProvider />
      <div className="flex h-screen min-h-0 flex-col overflow-hidden text-zinc-950">
        <div className="min-h-0 flex-1 overflow-hidden">{children}</div>
        <GlobalStatusLine />
      </div>
      {/* DOM-after AppLayout so toast no-drag wins clicks over chrome drag.
          The fixed shell is itself window-drag: an unmarked (default no-drag) shell would
          punch a dead zone through the top-center drag strip even when empty and
          pointer-events-none — Chromium resolves app-region by DOM order, not z-index. */}
      <GlobalToasts />
      <UpdateToast />
    </ConfirmModalProvider>
  );
}

function GlobalToasts() {
  const toasts = useSyncExternalStore(subscribeToasts, getToastSnapshot, getToastSnapshot);

  return (
    <div className="window-drag pointer-events-none fixed left-1/2 top-4 z-[200] flex w-[min(92vw,420px)] -translate-x-1/2 flex-col items-center gap-2">
      <AnimatePresence initial={false}>
        {toasts.map((item) => (
          <GlobalToast key={item.id} item={item} />
        ))}
      </AnimatePresence>
    </div>
  );
}

function GlobalToast({ item }: { item: ToastItem }) {
  const { t } = useTranslation();
  const Icon = getToastIcon(item.variant);

  return (
    <motion.div
      role="status"
      initial={{ opacity: 0, y: -10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -6, transition: { duration: 0.12, ease: "easeIn" } }}
      transition={{ duration: TOAST_ENTER_MS / 1000, ease: [0.22, 1, 0.36, 1] }}
      className="window-no-drag pointer-events-auto flex min-h-11 w-full items-center gap-3 rounded-xl border border-zinc-200 bg-white px-3.5 py-2.5 text-[13px] text-zinc-800 shadow-md will-change-[opacity,transform]"
    >
      <Icon aria-hidden="true" className={getToastIconClassName(item.variant)} size={15} />
      <div className="min-w-0 flex-1">
        <div className="truncate font-semibold leading-5">{item.title}</div>
        {item.description ? (
          <div className="truncate text-[12px] font-medium leading-4 text-zinc-500">
            {item.description}
          </div>
        ) : null}
      </div>
      {item.actionLabel ? (
        <button
          type="button"
          className="window-no-drag h-7 shrink-0 rounded-md bg-zinc-950 px-2.5 text-[12px] font-semibold text-white transition-colors hover:bg-zinc-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-500/25"
          onClick={item.onAction}
        >
          {item.actionLabel}
        </button>
      ) : null}
      <button
        type="button"
        aria-label={t("common.closeNotification")}
        className="window-no-drag grid h-6 w-6 shrink-0 place-items-center rounded-md text-zinc-400 transition-colors hover:bg-zinc-100 hover:text-zinc-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-500/25"
        onClick={() => toast.close(item.id)}
      >
        <X aria-hidden="true" size={13} />
      </button>
    </motion.div>
  );
}

function getToastIcon(variant: ToastItem["variant"]) {
  if (variant === "success") {
    return CheckCircle2;
  }
  if (variant === "danger") {
    return XCircle;
  }
  if (variant === "warning") {
    return TriangleAlert;
  }
  return Info;
}

function getToastIconClassName(variant: ToastItem["variant"]) {
  if (variant === "success") {
    return "shrink-0 text-emerald-600";
  }
  if (variant === "danger") {
    return "shrink-0 text-red-600";
  }
  if (variant === "warning") {
    return "shrink-0 text-amber-600";
  }
  return "shrink-0 text-blue-600";
}

function GlobalStatusLine() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [folderOpen, setFolderOpen] = useState(false);
  const [dismissed, setDismissed] = useState(() => new Set<string>());
  const [eventTasks, setEventTasks] = useState(() => new Map<string, BackgroundTask>());
  const [now, setNow] = useState(() => Date.now());
  const completedFirstSeen = useRef(new Map<string, number>());
  const completedInvalidatedIds = useRef(new Set<string>());
  const lastThumbnailProgressInvalidation = useRef({ taskId: "", progress: 0 });
  const taskEventInvalidationTimer = useRef<number | null>(null);
  const invalidateVaultState = useInvalidateVaultState();
  const vaultsQuery = useQuery(trpc.assets.vaults.queryOptions());
  const selectFolder = useMutation(
    trpc.assets.selectFolderAndScan.mutationOptions({
      onSuccess: invalidateVaultState,
    }),
  );
  const activateVault = useMutation(
    trpc.assets.activateVault.mutationOptions({
      onSuccess: async () => {
        setFolderOpen(false);
        await invalidateVaultState();
      },
    }),
  );
  const reconcileVault = useMutation(
    trpc.assets.reconcile.mutationOptions({
      onSuccess: invalidateVaultState,
    }),
  );
  const tasksQuery = useQuery({
    ...trpc.tasks.snapshot.queryOptions(),
    refetchInterval: (query) => {
      const snapshot = query.state.data as TaskSnapshot | undefined;
      return selectFolder.isPending || reconcileVault.isPending || hasVisibleTaskActivity(snapshot)
        ? 1000
        : 7000;
    },
    refetchOnWindowFocus: true,
  });
  const snapshot = tasksQuery.data;

  useEffect(() => {
    const scheduleTaskSnapshotInvalidation = () => {
      if (taskEventInvalidationTimer.current != null) {
        return;
      }

      taskEventInvalidationTimer.current = window.setTimeout(() => {
        taskEventInvalidationTimer.current = null;
        void queryClient.invalidateQueries(trpc.tasks.snapshot.queryFilter());
      }, TASK_EVENT_INVALIDATION_DELAY_MS);
    };

    const subscription = trpcClient.events.subscribe.subscribe(undefined, {
      onData: (event) => {
        if (
          event.type === "task.updated" ||
          event.type === "task.completed" ||
          event.type === "task.failed"
        ) {
          setEventTasks((current) => {
            const next = new Map(current);
            next.set(event.task.id, event.task);
            pruneEventTasks(next);
            return next;
          });
          scheduleTaskSnapshotInvalidation();
        }

        if (
          event.type === "task.completed" &&
          (event.task.type === "sync" ||
            event.task.type === "indexing" ||
            event.task.type === "reconcile")
        ) {
          void invalidateVaultState();
        }

        if (event.type === "task.completed" && event.task.type === "thumbnails") {
          void invalidateVaultState();
        }

        if (event.type === "ledger.changed") {
          void queryClient.invalidateQueries();
        }

        if (
          event.type === "asset-filter.apply" ||
          event.type === "asset-filter.activate-view" ||
          event.type === "asset-filter.select-sidebar" ||
          event.type === "asset-filter.clear"
        ) {
          void applyFilterCommand(event);
        }

        if (event.type === "asset-detail.open") {
          openAssetDetail(event.assetId);
        }
      },
      onError: (error) => {
        console.error("Task event subscription failed", error);
      },
    });

    return () => {
      subscription.unsubscribe();
      if (taskEventInvalidationTimer.current != null) {
        window.clearTimeout(taskEventInvalidationTimer.current);
        taskEventInvalidationTimer.current = null;
      }
    };
  }, [invalidateVaultState, navigate, queryClient]);

  useEffect(() => {
    if (!snapshot) {
      return;
    }

    const runningThumbnailTask = snapshot.running.find((task) => task.type === "thumbnails");
    const thumbnailProgress = runningThumbnailTask?.progress?.current ?? 0;
    if (
      runningThumbnailTask &&
      thumbnailProgress > 0 &&
      (runningThumbnailTask.id !== lastThumbnailProgressInvalidation.current.taskId ||
        thumbnailProgress !== lastThumbnailProgressInvalidation.current.progress) &&
      thumbnailProgress % THUMBNAIL_REFRESH_BATCH_SIZE === 0
    ) {
      lastThumbnailProgressInvalidation.current = {
        taskId: runningThumbnailTask.id,
        progress: thumbnailProgress,
      };
      void invalidateVaultState();
    }

    for (const task of snapshot.recentlyCompleted) {
      if (task.type !== "thumbnails" || completedInvalidatedIds.current.has(task.id)) {
        continue;
      }

      completedInvalidatedIds.current.add(task.id);
      void invalidateVaultState();
    }
  }, [invalidateVaultState, snapshot]);

  const tasks = useMemo(() => {
    const byId = new Map<string, BackgroundTask>();

    for (const task of eventTasks.values()) {
      byId.set(task.id, task);
    }

    if (snapshot) {
      for (const task of [
        ...snapshot.running,
        ...snapshot.queued,
        ...snapshot.failed,
        ...snapshot.recentlyCompleted,
      ]) {
        const current = byId.get(task.id);
        if (!current || task.updatedAt >= current.updatedAt) {
          byId.set(task.id, task);
        }
      }
    }

    return Array.from(byId.values())
      .sort((left, right) => right.updatedAt - left.updatedAt)
      .map(toFooterTask);
  }, [eventTasks, snapshot]);

  const live = useMemo(() => tasks.filter((task) => !dismissed.has(task.id)), [dismissed, tasks]);
  const running = live.filter((task) => task.state === "running");
  const queued = live.filter((task) => task.state === "queued");
  const failed = live.filter((task) => task.state === "failed");
  const completed = live.filter((task) => task.state === "completed");

  for (const task of completed) {
    if (task.completedAt == null && !completedFirstSeen.current.has(task.id)) {
      completedFirstSeen.current.set(task.id, now);
    }
  }

  const freshDone = completed.filter((task) => {
    const completedAt = task.completedAt ?? completedFirstSeen.current.get(task.id) ?? now;
    return now < completedAt + COMPLETED_VISIBLE_MS;
  });

  useEffect(() => {
    if (freshDone.length === 0) {
      return;
    }

    const intervalId = window.setInterval(() => setNow(Date.now()), 500);
    return () => window.clearInterval(intervalId);
  }, [freshDone.length, completed.map((task) => task.id).join()]);

  let kind: "run" | "queue" | "bad" | "good" | null = null;
  let active: FooterTask | null = null;
  let shown = 0;

  if (running.length > 0) {
    kind = "run";
    active = running[0];
    shown = 1;
  } else if (queued.length > 0) {
    kind = "queue";
    shown = queued.length;
  } else if (failed.length > 0) {
    kind = "bad";
    shown = failed.length;
  } else if (freshDone.length > 0) {
    kind = "good";
    active = freshDone[0];
    shown = 1;
  }

  const others = Math.max(0, live.length - shown);
  const hasPop = live.length > 0;
  const appVersion = __APP_VERSION__;
  const activeVault = snapshot?.activeVault ?? null;
  const vaultName = activeVault?.name ?? null;
  const vaultPath = activeVault?.rootPath ?? null;
  const syncRunning =
    reconcileVault.isPending ||
    running.some(
      (task) => task.type === "reconcile" || task.type === "indexing" || task.type === "sync",
    );
  const canSync = Boolean(activeVault) && !syncRunning;
  const dismissTask = (id: string) => {
    setDismissed((current) => new Set(current).add(id));
  };
  const chooseFolder = () => {
    setFolderOpen(false);
    selectFolder.mutate();
  };
  const syncVault = () => {
    if (!activeVault || syncRunning) {
      return;
    }

    reconcileVault.mutate({ vaultId: activeVault.id });
  };
  const statusTrigger = kind ? (
    <PFPill
      kind={kind}
      active={active}
      others={others}
      open={open}
      count={kind === "queue" ? queued.length : kind === "bad" ? failed.length : null}
    />
  ) : hasPop ? (
    <span className={`pf-pill pf-pill--stale ${open ? "is-open" : ""}`}>
      <span className="pf-pill-glyph">
        <span className="pf-dot pf-dot--stale" />
      </span>
      <span className="pf-pill-label">{t("shell.recentDone")}</span>
      <span className="pf-caret">▲</span>
    </span>
  ) : (
    <span className="pf-idle">
      <PFCheck s={12} /> {t("shell.upToDate")}
    </span>
  );

  useEffect(() => {
    if (!hasPop && open) {
      setOpen(false);
    }
  }, [hasPop, open]);

  return (
    <footer className="pf-footer window-no-drag">
      <div className="pf-foot-left">
        <Button
          isIconOnly
          variant="ghost"
          size="sm"
          aria-label={t("shell.settings")}
          className="h-6 w-6 min-w-6 rounded-md text-zinc-400"
          onPress={() => void navigate({ to: "/settings" })}
        >
          <Settings2 size={13} />
        </Button>
        <span className="pf-sep" />
        <div className="pf-appmeta">
          <span className="pf-appname">Post</span>
          <span className="pf-ver">v{appVersion}</span>
        </div>
        <span className="pf-sep" />
        <Popover isOpen={folderOpen} onOpenChange={setFolderOpen}>
          <Popover.Trigger className="pf-folder-trigger">
            <span
              className={`pf-folder ${vaultName ? "" : "pf-folder--empty"}`}
              title={vaultName ? (vaultPath ?? vaultName) : t("shell.noVault")}
            >
              <span className="pf-folder-ico">
                <PFFolderIco />
              </span>
              <span className="pf-folder-name">{vaultName ?? "No folder"}</span>
            </span>
          </Popover.Trigger>
          <Popover.Content className="pf-menu-content" offset={7} placement="top start">
            <Popover.Dialog className="pf-menu-dialog">
              <div className="pf-folder-menu">
                <div className="pf-menu-head">{t("shell.vaults")}</div>
                <div className="pf-menu-list">
                  {(vaultsQuery.data ?? []).map((vault) => (
                    <button
                      key={vault.id}
                      type="button"
                      className={`pf-menu-item ${activeVault?.id === vault.id ? "is-active" : ""}`}
                      onClick={() => {
                        if (activeVault?.id === vault.id) {
                          setFolderOpen(false);
                          return;
                        }

                        activateVault.mutate({ vaultId: vault.id });
                      }}
                    >
                      <span className="pf-menu-item-main">
                        <span className="pf-menu-item-name">{vault.name}</span>
                        <span className="pf-menu-item-path">{vault.rootPath}</span>
                      </span>
                      {activeVault?.id === vault.id ? <PFCheck s={12} /> : null}
                    </button>
                  ))}
                  {vaultsQuery.data?.length === 0 ? (
                    <div className="pf-menu-empty">{t("shell.noVaultsYet")}</div>
                  ) : null}
                </div>
                <div className="pf-menu-actions">
                  <button
                    type="button"
                    className="pf-menu-action"
                    disabled={selectFolder.isPending}
                    onClick={chooseFolder}
                  >
                    {selectFolder.isPending ? t("shell.indexing") : t("shell.chooseOtherFolder")}
                  </button>
                </div>
              </div>
            </Popover.Dialog>
          </Popover.Content>
        </Popover>
      </div>

      <div className="pf-foot-right">
        {activeVault ? (
          <button
            type="button"
            className={`pf-sync ${syncRunning ? "is-running" : ""}`}
            disabled={!canSync}
            onClick={syncVault}
            title={syncRunning ? t("shell.syncRunningTitle") : t("shell.syncClickTitle")}
          >
            <span className={syncRunning ? "pf-spin pf-spin--sync" : "pf-dot pf-dot--good"} />
            <span>{syncRunning ? t("shell.syncing") : t("shell.syncDone")}</span>
          </button>
        ) : null}
        {hasPop ? (
          <Popover isOpen={open} onOpenChange={setOpen}>
            <Popover.Trigger className="pf-popover-trigger">{statusTrigger}</Popover.Trigger>
            <Popover.Content className="pf-pop-content" offset={6} placement="top end">
              <Popover.Dialog className="pf-pop-dialog">
                <PFPopover
                  running={running}
                  queued={queued}
                  failed={failed}
                  completed={completed}
                  onDismiss={dismissTask}
                />
              </Popover.Dialog>
            </Popover.Content>
          </Popover>
        ) : (
          statusTrigger
        )}
      </div>
    </footer>
  );
}

function toFooterTask(task: BackgroundTask): FooterTask {
  const done = task.progress?.current ?? 0;
  const total = task.progress?.total ?? 0;

  return {
    id: task.id,
    type: task.type,
    state: task.status,
    done,
    total,
    label: task.progress?.label,
    reason: task.errorMessage,
    completedAt: task.completedAt,
  };
}

function pruneEventTasks(tasks: Map<string, BackgroundTask>) {
  const cutoff = Date.now() - EVENT_TASK_RETENTION_MS;

  for (const [id, task] of tasks) {
    if (
      (task.status === "completed" || task.status === "failed") &&
      (task.completedAt ?? task.updatedAt) < cutoff
    ) {
      tasks.delete(id);
    }
  }
}

function PFPill({
  kind,
  active,
  count,
  others,
  open,
}: {
  kind: "run" | "queue" | "bad" | "good";
  active: FooterTask | null;
  count: number | null;
  others: number;
  open: boolean;
}) {
  const { t } = useTranslation();
  const activeTypeLabel = active ? taskTypeLabel(active.type, t) : t("shell.task");
  const label =
    kind === "run"
      ? t("shell.taskRunning", { label: activeTypeLabel })
      : kind === "queue"
        ? t("shell.taskQueued", { count: count ?? 0 })
        : kind === "bad"
          ? t("shell.taskFailed", { count: count ?? 0 })
          : t("shell.taskCompleted", { label: activeTypeLabel });
  const countStr = kind === "run" && active ? getTaskProgressLabel(active) : null;
  const glyph =
    kind === "run" ? (
      <span className="pf-spin" />
    ) : (
      <span
        className={`pf-dot ${kind === "bad" ? "pf-dot--bad" : kind === "good" ? "pf-dot--good" : "pf-dot--queue"}`}
      />
    );

  return (
    <span className={`pf-pill pf-pill--${kind} ${open ? "is-open" : ""}`}>
      <span className="pf-pill-glyph">{glyph}</span>
      <span className="pf-pill-label">{label}</span>
      {countStr ? <span className="pf-pill-count">{countStr}</span> : null}
      {others > 0 ? <span className="pf-pill-more">+{others}</span> : null}
      <span className="pf-caret">▲</span>
    </span>
  );
}

function PFPopover({
  running,
  queued,
  failed,
  completed,
  onDismiss,
}: {
  running: FooterTask[];
  queued: FooterTask[];
  failed: FooterTask[];
  completed: FooterTask[];
  onDismiss: (id: string) => void;
}) {
  const { t } = useTranslation();
  const groups = [
    { key: "running", title: t("shell.running"), items: running },
    { key: "queued", title: t("shell.queued"), items: queued },
    { key: "failed", title: t("shell.failed"), items: failed },
    { key: "completed", title: t("shell.recentDone"), items: completed },
  ].filter((group) => group.items.length > 0);
  const total = running.length + queued.length + failed.length + completed.length;

  return (
    <div className="pf-pop" onClick={(event) => event.stopPropagation()}>
      <div className="pf-pop-head">
        <span className="pf-pop-title">{t("shell.backgroundTasks")}</span>
        <span className="pf-pop-n">{total}</span>
      </div>
      <div className="pf-pop-body">
        {groups.map((group) => (
          <div className="pf-grp" key={group.key}>
            <div className="pf-grp-head">
              <span className={`pf-grp-dot pf-grp-dot--${group.key}`} />
              {group.title}
              <span className="pf-grp-n">{group.items.length}</span>
            </div>
            {group.items.map((task) => (
              <PFRow key={task.id} task={task} group={group.key} onDismiss={onDismiss} />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

function PFRow({
  task,
  group,
  onDismiss,
}: {
  task: FooterTask;
  group: string;
  onDismiss: (id: string) => void;
}) {
  const { t } = useTranslation();
  const progress = task.total > 0 ? Math.round((task.done / task.total) * 100) : 0;

  return (
    <div className={`pf-trow pf-trow--${group}`}>
      <span className="pf-tico">
        <PFTaskIco type={task.type} />
      </span>
      <div className="pf-tmain">
        <div className="pf-tlabel">{taskTypeLabel(task.type, t)}</div>
        {group === "running" ? (
          <div className="pf-tbar">
            <i style={{ width: `${progress}%` }} />
          </div>
        ) : (
          <div className={`pf-tsub ${group === "failed" ? "pf-tsub--bad" : ""}`}>
            {group === "queued"
              ? t("shell.queued")
              : group === "failed"
                ? (task.reason ?? t("shell.failed"))
                : t("shell.completed")}
          </div>
        )}
      </div>
      <div className={`pf-tright ${group === "completed" ? "pf-tright--good" : ""}`}>
        {group === "running" ? <span>{getTaskProgressLabel(task)}</span> : null}
        {group === "queued" ? (
          <span style={{ color: "var(--faint,#b6b6b2)" }}>{t("shell.waiting")}</span>
        ) : null}
        {group === "completed" ? <PFCheck s={13} /> : null}
        {group === "failed" ? (
          <button
            type="button"
            className="pf-tdismiss"
            title={t("shell.dismiss")}
            onClick={() => onDismiss(task.id)}
          >
            ✕
          </button>
        ) : null}
      </div>
    </div>
  );
}

function getTaskProgressLabel(task: FooterTask) {
  if (task.label) {
    return task.label;
  }

  if (task.total > 0) {
    return `${task.done}/${task.total}`;
  }

  if (task.done > 0) {
    return `${task.done}`;
  }

  return null;
}

function PFTaskIco({ type, size = 13 }: { type: FooterTaskType; size?: number }) {
  const iconProps = {
    width: size,
    height: size,
    viewBox: "0 0 16 16",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.4,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
  };

  if (type === "indexing") {
    return (
      <svg {...iconProps}>
        <line x1="3" y1="4" x2="11" y2="4" />
        <line x1="3" y1="7.2" x2="8" y2="7.2" />
        <circle cx="9.6" cy="10.2" r="2.5" />
        <line x1="11.5" y1="12.1" x2="13.3" y2="13.9" />
      </svg>
    );
  }

  if (type === "reconcile") {
    return (
      <svg {...iconProps}>
        <path d="M3.3 6.4a4.6 4.6 0 0 1 8-1.6" />
        <path d="M11.3 3.6v2.1h-2.1" />
        <path d="M12.7 9.6a4.6 4.6 0 0 1-8 1.6" />
        <path d="M4.7 12.4v-2.1h2.1" />
      </svg>
    );
  }

  return (
    <svg {...iconProps}>
      <rect x="2.6" y="2.6" width="4.6" height="4.6" rx="1" />
      <rect x="8.8" y="2.6" width="4.6" height="4.6" rx="1" />
      <rect x="2.6" y="8.8" width="4.6" height="4.6" rx="1" />
      <rect x="8.8" y="8.8" width="4.6" height="4.6" rx="1" />
    </svg>
  );
}

function PFFolderIco() {
  return (
    <svg
      width="13"
      height="13"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.3"
      strokeLinejoin="round"
    >
      <path d="M2.2 4.4c0-.6.5-1 1-1h3l1.3 1.4h4.3c.6 0 1 .5 1 1v5.4c0 .6-.5 1-1 1H3.2c-.6 0-1-.5-1-1V4.4z" />
    </svg>
  );
}

function PFCheck({ s = 12 }: { s?: number }) {
  return (
    <svg
      width={s}
      height={s}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M3.5 8.5l3 3 6-6.5" />
    </svg>
  );
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
