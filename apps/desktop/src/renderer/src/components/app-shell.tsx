import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Popover, ToastProvider } from "@heroui/react";

import { trpc, type RouterOutputs } from "@/lib/trpc";

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
  reason?: string;
  completedAt?: number;
};

const COMPLETED_VISIBLE_MS = 8000;
const THUMBNAIL_REFRESH_BATCH_SIZE = 8;
const PF_TYPE: Record<FooterTaskType, { label: string }> = {
  indexing: { label: "索引" },
  reconcile: { label: "校验" },
  thumbnails: { label: "缩略图" },
};

export function AppShell({ children }: { children: ReactNode }) {
  useEffect(() => {
    injectFooterCSS();
  }, []);

  return (
    <div className="flex h-screen min-h-0 flex-col overflow-hidden text-zinc-950">
      <ToastProvider placement="top" />
      <div className="min-h-0 flex-1 overflow-hidden">{children}</div>
      <GlobalStatusLine />
    </div>
  );
}

function GlobalStatusLine() {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [folderOpen, setFolderOpen] = useState(false);
  const [dismissed, setDismissed] = useState(() => new Set<string>());
  const [now, setNow] = useState(() => Date.now());
  const completedFirstSeen = useRef(new Map<string, number>());
  const completedInvalidatedIds = useRef(new Set<string>());
  const lastThumbnailProgressInvalidation = useRef({ taskId: "", progress: 0 });
  const invalidateVaultState = async () => {
    await Promise.all([
      queryClient.invalidateQueries(trpc.assets.list.queryFilter()),
      queryClient.invalidateQueries(trpc.assets.vaults.queryFilter()),
      queryClient.invalidateQueries(trpc.tasks.snapshot.queryFilter()),
    ]);
  };
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
      return selectFolder.isPending || reconcileVault.isPending || hasVisibleTaskActivity(snapshot) ? 1000 : 7000;
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
      && thumbnailProgress > 0
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

  const tasks = useMemo(() => {
    if (!snapshot) {
      return [];
    }

    return [
      ...snapshot.running,
      ...snapshot.queued,
      ...snapshot.failed,
      ...snapshot.recentlyCompleted,
    ].map(toFooterTask);
  }, [snapshot]);

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
  const appVersion = snapshot?.appVersion ?? "0.0.0";
  const activeVault = snapshot?.activeVault ?? null;
  const vaultName = activeVault?.name ?? null;
  const vaultPath = activeVault?.rootPath ?? null;
  const syncRunning = reconcileVault.isPending || running.some((task) => task.type === "reconcile" || task.type === "indexing");
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
      <span className="pf-pill-glyph"><span className="pf-dot pf-dot--stale" /></span>
      <span className="pf-pill-label">近期完成</span>
      <span className="pf-caret">▲</span>
    </span>
  ) : (
    <span className="pf-idle"><PFCheck s={12} /> 已是最新</span>
  );

  useEffect(() => {
    if (!hasPop && open) {
      setOpen(false);
    }
  }, [hasPop, open]);

  return (
    <footer className="pf-footer window-no-drag">
      <div className="pf-foot-left">
        <div className="pf-appmeta">
          <span className="pf-appname">Post</span>
          <span className="pf-ver">v{appVersion}</span>
        </div>
        <span className="pf-sep" />
        <Popover isOpen={folderOpen} onOpenChange={setFolderOpen}>
          <Popover.Trigger className="pf-folder-trigger">
            <span
              className={`pf-folder ${vaultName ? "" : "pf-folder--empty"}`}
              title={vaultName ? (vaultPath ?? vaultName) : "未关联资产库"}
            >
              <span className="pf-folder-ico"><PFFolderIco /></span>
              <span className="pf-folder-name">{vaultName ?? "No folder"}</span>
            </span>
          </Popover.Trigger>
          <Popover.Content className="pf-menu-content" offset={7} placement="top start">
            <Popover.Dialog className="pf-menu-dialog">
              <div className="pf-folder-menu">
                <div className="pf-menu-head">资产库</div>
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
                    <div className="pf-menu-empty">还没有资产库</div>
                  ) : null}
                </div>
                <div className="pf-menu-actions">
                  <button
                    type="button"
                    className="pf-menu-action"
                    disabled={selectFolder.isPending}
                    onClick={chooseFolder}
                  >
                    {selectFolder.isPending ? "索引中" : "选择其他文件夹"}
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
            title={syncRunning ? "正在同步" : "点击重新同步"}
          >
            <span className={syncRunning ? "pf-spin pf-spin--sync" : "pf-dot pf-dot--good"} />
            <span>{syncRunning ? "同步中" : "已同步完成"}</span>
          </button>
        ) : null}
        {hasPop ? (
          <Popover isOpen={open} onOpenChange={setOpen}>
            <Popover.Trigger className="pf-popover-trigger">
              {statusTrigger}
            </Popover.Trigger>
            <Popover.Content
              className="pf-pop-content"
              offset={6}
              placement="top end"
            >
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
    reason: task.errorMessage,
    completedAt: task.completedAt,
  };
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
  const activeTypeLabel = active ? PF_TYPE[active.type].label : "任务";
  const label = kind === "run"
    ? `正在${activeTypeLabel}`
    : kind === "queue"
      ? `${count ?? 0} 项排队`
      : kind === "bad"
        ? `${count ?? 0} 项失败`
        : `${activeTypeLabel}已完成`;
  const countStr = kind === "run" && active ? getTaskProgressLabel(active) : null;
  const glyph = kind === "run"
    ? <span className="pf-spin" />
    : <span className={`pf-dot ${kind === "bad" ? "pf-dot--bad" : kind === "good" ? "pf-dot--good" : "pf-dot--queue"}`} />;

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
  const groups = [
    { key: "running", title: "进行中", items: running },
    { key: "queued", title: "排队中", items: queued },
    { key: "failed", title: "失败", items: failed },
    { key: "completed", title: "近期完成", items: completed },
  ].filter((group) => group.items.length > 0);
  const total = running.length + queued.length + failed.length + completed.length;

  return (
    <div className="pf-pop" onClick={(event) => event.stopPropagation()}>
      <div className="pf-pop-head">
        <span className="pf-pop-title">后台任务</span>
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
              <PFRow key={task.id} t={task} group={group.key} onDismiss={onDismiss} />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

function PFRow({
  t,
  group,
  onDismiss,
}: {
  t: FooterTask;
  group: string;
  onDismiss: (id: string) => void;
}) {
  const progress = t.total > 0 ? Math.round((t.done / t.total) * 100) : 0;

  return (
    <div className={`pf-trow pf-trow--${group}`}>
      <span className="pf-tico"><PFTaskIco t={t.type} /></span>
      <div className="pf-tmain">
        <div className="pf-tlabel">{PF_TYPE[t.type].label}</div>
        {group === "running" ? (
          <div className="pf-tbar"><i style={{ width: `${progress}%` }} /></div>
        ) : (
          <div className={`pf-tsub ${group === "failed" ? "pf-tsub--bad" : ""}`}>
            {group === "queued" ? "排队中" : group === "failed" ? (t.reason ?? "失败") : "已完成"}
          </div>
        )}
      </div>
      <div className={`pf-tright ${group === "completed" ? "pf-tright--good" : ""}`}>
        {group === "running" ? <span>{getTaskProgressLabel(t)}</span> : null}
        {group === "queued" ? <span style={{ color: "var(--faint,#b6b6b2)" }}>等待</span> : null}
        {group === "completed" ? <PFCheck s={13} /> : null}
        {group === "failed" ? (
          <button type="button" className="pf-tdismiss" title="忽略" onClick={() => onDismiss(t.id)}>✕</button>
        ) : null}
      </div>
    </div>
  );
}

function getTaskProgressLabel(task: FooterTask) {
  if (task.total > 0) {
    return `${task.done}/${task.total}`;
  }

  if (task.done > 0) {
    return `${task.done}`;
  }

  return null;
}

function PFTaskIco({ t, size = 13 }: { t: FooterTaskType; size?: number }) {
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

  if (t === "indexing") {
    return (
      <svg {...iconProps}>
        <line x1="3" y1="4" x2="11" y2="4" />
        <line x1="3" y1="7.2" x2="8" y2="7.2" />
        <circle cx="9.6" cy="10.2" r="2.5" />
        <line x1="11.5" y1="12.1" x2="13.3" y2="13.9" />
      </svg>
    );
  }

  if (t === "reconcile") {
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

function injectFooterCSS() {
  if (typeof document === "undefined" || document.getElementById("pf-footer-styles")) {
    return;
  }

  const element = document.createElement("style");
  element.id = "pf-footer-styles";
  element.textContent = `
.pf-footer{ box-sizing:border-box; flex:none; height:30px; display:flex; align-items:center; gap:14px;
  padding:0 10px 0 13px; background:var(--panel,#fbfbfa); border-top:1px solid var(--border,#ececea);
  font-family:var(--font,-apple-system,"PingFang SC","Helvetica Neue",Helvetica,Arial,sans-serif);
  font-size:11.5px; color:var(--sub,#8c8c88); user-select:none; position:relative; z-index:90; }
.pf-footer *{ box-sizing:border-box; }
.pf-foot-left{ display:flex; align-items:center; gap:10px; min-width:0; }
.pf-appmeta{ display:flex; align-items:center; gap:7px; flex:none; }
.pf-appname{ font-weight:600; color:var(--text,#1b1b1a); letter-spacing:.01em; }
.pf-ver{ font-family:var(--mono,"JetBrains Mono",ui-monospace,Menlo,monospace); font-size:10px; color:var(--faint,#b6b6b2); letter-spacing:.01em; }
.pf-sep{ width:1px; height:13px; background:var(--border,#ececea); flex:none; }
.pf-folder{ display:flex; align-items:center; gap:6px; min-width:0; padding:3px 7px; margin-left:-4px; border-radius:6px; cursor:default; }
.pf-folder:hover{ background:var(--panel-2,#f4f4f2); }
.pf-folder-ico{ color:var(--faint,#b6b6b2); flex:none; display:flex; }
.pf-folder-name{ color:var(--text,#1b1b1a); font-weight:500; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
.pf-folder--empty .pf-folder-ico{ opacity:.7; }
.pf-folder--empty .pf-folder-name{ color:var(--faint,#b6b6b2); font-weight:400; }
.pf-foot-right{ margin-left:auto; display:flex; align-items:center; position:relative; }
.pf-folder-trigger{ display:flex; min-width:0; outline:none; }
.pf-popover-trigger{ display:flex; align-items:center; outline:none; }
.pf-sync{ display:flex; align-items:center; gap:6px; border:0; background:transparent; cursor:pointer;
  font:inherit; color:var(--text,#1b1b1a); border-radius:99px; padding:3px 7px; line-height:1; margin-right:6px; }
.pf-sync:hover{ background:var(--panel-2,#f4f4f2); }
.pf-sync:disabled{ cursor:default; opacity:.72; }
.pf-sync.is-running:hover{ background:transparent; }
.pf-idle{ display:flex; align-items:center; gap:6px; color:var(--faint,#b6b6b2); font-size:11.5px; padding:3px 4px; }
.pf-idle svg{ color:var(--good,oklch(0.62 0.14 150)); opacity:.85; }
.pf-pill{ display:flex; align-items:center; gap:7px; border:0; background:transparent; cursor:pointer;
  font:inherit; color:var(--sub,#8c8c88); border-radius:99px; padding:3px 7px; line-height:1; }
.pf-pill:hover{ background:var(--panel-2,#f4f4f2); }
.pf-pill.is-open{ background:var(--panel-2,#f4f4f2); }
.pf-pill-glyph{ display:flex; align-items:center; flex:none; }
.pf-pill-label{ color:var(--text,#1b1b1a); font-weight:500; white-space:nowrap; }
.pf-pill-count{ font-family:var(--mono,"JetBrains Mono",ui-monospace,Menlo,monospace); font-size:10px; color:var(--faint,#b6b6b2); }
.pf-pill-more{ font-family:var(--mono,"JetBrains Mono",ui-monospace,Menlo,monospace); font-size:9.5px; color:var(--faint,#b6b6b2);
  background:var(--panel-2,#f4f4f2); border-radius:5px; padding:1px 4px; }
.pf-caret{ color:var(--faint,#b6b6b2); font-size:8px; margin-left:1px; transform:translateY(-.5px); }
.pf-pill--bad .pf-pill-label{ color:var(--pf-bad,oklch(0.585 0.16 27)); }
.pf-pill--good .pf-pill-label{ color:var(--good,oklch(0.62 0.14 150)); }
.pf-pill--queue .pf-pill-label{ color:var(--text,#1b1b1a); }
.pf-pill--stale .pf-pill-label{ color:var(--sub,#8c8c88); }
.pf-dot{ width:7px; height:7px; border-radius:50%; flex:none; }
.pf-dot--queue{ background:var(--faint,#b6b6b2); }
.pf-dot--bad{ background:var(--pf-bad,oklch(0.585 0.16 27)); box-shadow:0 0 0 3px color-mix(in oklch, var(--pf-bad,oklch(0.585 0.16 27)), transparent 84%); }
.pf-dot--good{ background:var(--good,oklch(0.62 0.14 150)); box-shadow:0 0 0 3px color-mix(in oklch, var(--good,oklch(0.62 0.14 150)), transparent 82%); }
.pf-dot--stale{ background:var(--good,oklch(0.62 0.14 150)); opacity:.55; }
.pf-spin{ width:12px; height:12px; border-radius:50%; flex:none;
  border:1.6px solid color-mix(in oklch, var(--accent,oklch(0.55 0.13 256)), transparent 74%);
  border-top-color:var(--accent,oklch(0.55 0.13 256)); animation:pf-spin .8s linear infinite; }
.pf-spin.pf-spin--sync{ width:10px; height:10px; border-width:1.4px; }
@keyframes pf-spin{ to{ transform:rotate(360deg); } }
.pf-pop-content{ z-index:120 !important; padding:0 !important; border:0 !important; background:transparent !important; box-shadow:none !important; overflow:visible !important; }
.pf-pop-dialog{ outline:none; }
.pf-menu-content{ z-index:120 !important; padding:0 !important; border:0 !important; background:transparent !important; box-shadow:none !important; overflow:visible !important; }
.pf-menu-dialog{ outline:none; }
.pf-folder-menu{ width:300px; overflow:hidden; border:1px solid var(--border,#ececea); border-radius:13px;
  background:var(--card,#fff); box-shadow:0 16px 40px rgba(20,18,16,.20), 0 2px 8px rgba(20,18,16,.10); animation:pf-pop-in .15s ease-out; }
.pf-menu-head{ padding:12px 14px 8px; color:var(--text,#1b1b1a); font-size:12px; font-weight:680; }
.pf-menu-list{ max-height:260px; overflow:auto; padding:0 7px 6px; }
.pf-menu-item{ display:flex; width:100%; align-items:center; gap:10px; border:0; border-radius:9px; background:transparent;
  padding:7px 8px; text-align:left; cursor:pointer; color:var(--text,#1b1b1a); font:inherit; }
.pf-menu-item:hover{ background:var(--panel-2,#f4f4f2); }
.pf-menu-item.is-active{ background:var(--panel-2,#f4f4f2); }
.pf-menu-item-main{ min-width:0; flex:1; display:flex; flex-direction:column; gap:2px; }
.pf-menu-item-name{ overflow:hidden; text-overflow:ellipsis; white-space:nowrap; font-size:12px; font-weight:560; color:var(--text,#1b1b1a); }
.pf-menu-item-path{ overflow:hidden; text-overflow:ellipsis; white-space:nowrap; font-size:10.5px; color:var(--faint,#b6b6b2); }
.pf-menu-item svg{ flex:none; color:var(--good,oklch(0.62 0.14 150)); }
.pf-menu-empty{ padding:10px 8px 12px; color:var(--faint,#b6b6b2); font-size:11px; }
.pf-menu-actions{ border-top:1px solid var(--border-soft,#f3f3f1); padding:7px; }
.pf-menu-action{ width:100%; border:0; border-radius:9px; background:transparent; cursor:pointer; padding:7px 8px;
  text-align:left; color:var(--accent,oklch(0.55 0.13 256)); font:inherit; font-weight:560; }
.pf-menu-action:hover{ background:var(--panel-2,#f4f4f2); }
.pf-menu-action:disabled{ cursor:default; opacity:.58; }
.pf-pop{ width:300px;
  background:var(--card,#fff); border:1px solid var(--border,#ececea); border-radius:13px;
  box-shadow:0 16px 40px rgba(20,18,16,.20), 0 2px 8px rgba(20,18,16,.10); overflow:hidden; animation:pf-pop-in .15s ease-out; }
@keyframes pf-pop-in{ from{ transform:translateY(6px); } to{ transform:none; } }
.pf-pop-head{ display:flex; align-items:center; gap:8px; padding:12px 14px 9px; }
.pf-pop-title{ font-size:12px; font-weight:680; color:var(--text,#1b1b1a); letter-spacing:.01em; }
.pf-pop-n{ font-family:var(--mono,"JetBrains Mono",ui-monospace,Menlo,monospace); font-size:10px; color:var(--faint,#b6b6b2);
  margin-left:auto; background:var(--panel-2,#f4f4f2); border-radius:6px; padding:2px 6px; }
.pf-pop-body{ max-height:340px; overflow:auto; padding:0 7px 7px; }
.pf-grp{ padding:5px 0 3px; }
.pf-grp + .pf-grp{ border-top:1px solid var(--border-soft,#f3f3f1); }
.pf-grp-head{ display:flex; align-items:center; gap:7px; padding:6px 8px 5px; font-size:9.5px; font-weight:680;
  letter-spacing:.07em; text-transform:uppercase; color:var(--faint,#b6b6b2); }
.pf-grp-dot{ width:6px; height:6px; border-radius:50%; flex:none; }
.pf-grp-dot--running{ background:var(--accent,oklch(0.55 0.13 256)); }
.pf-grp-dot--queued{ background:var(--faint,#b6b6b2); }
.pf-grp-dot--failed{ background:var(--pf-bad,oklch(0.585 0.16 27)); }
.pf-grp-dot--completed{ background:var(--good,oklch(0.62 0.14 150)); }
.pf-grp-n{ margin-left:auto; font-family:var(--mono,"JetBrains Mono",ui-monospace,Menlo,monospace); color:var(--faint,#b6b6b2); letter-spacing:0; }
.pf-trow{ display:flex; align-items:center; gap:10px; padding:7px 8px; border-radius:9px; }
.pf-trow:hover{ background:var(--panel-2,#f4f4f2); }
.pf-tico{ width:24px; height:24px; flex:none; border-radius:7px; background:var(--panel-2,#f4f4f2);
  display:flex; align-items:center; justify-content:center; color:var(--sub,#8c8c88); }
.pf-trow--failed .pf-tico{ color:var(--pf-bad,oklch(0.585 0.16 27)); background:var(--pf-bad-soft,oklch(0.955 0.024 30)); }
.pf-trow--running .pf-tico{ color:var(--accent,oklch(0.55 0.13 256)); background:var(--accent-soft,oklch(0.965 0.018 256)); }
.pf-tmain{ flex:1; min-width:0; }
.pf-tlabel{ font-size:12.5px; font-weight:560; color:var(--text,#1b1b1a); }
.pf-tsub{ font-size:11px; color:var(--faint,#b6b6b2); margin-top:2px; }
.pf-tsub--bad{ color:var(--pf-bad,oklch(0.585 0.16 27)); }
.pf-tbar{ height:3px; border-radius:99px; background:var(--panel-2,#f4f4f2); margin-top:6px; overflow:hidden; }
.pf-tbar i{ display:block; height:100%; border-radius:99px; background:var(--accent,oklch(0.55 0.13 256)); }
.pf-tright{ flex:none; display:flex; align-items:center; gap:6px;
  font-family:var(--mono,"JetBrains Mono",ui-monospace,Menlo,monospace); font-size:10.5px; color:var(--sub,#8c8c88); }
.pf-tright--good{ color:var(--good,oklch(0.62 0.14 150)); }
.pf-tdismiss{ border:0; background:transparent; cursor:pointer; color:var(--faint,#b6b6b2); width:20px; height:20px;
  border-radius:6px; display:flex; align-items:center; justify-content:center; font-size:12px; }
.pf-tdismiss:hover{ background:var(--pf-bad-soft,oklch(0.955 0.024 30)); color:var(--pf-bad,oklch(0.585 0.16 27)); }
`;
  document.head.appendChild(element);
}
