/**
 * @purpose Show a top-center update toast that mirrors GlobalToast visuals and updates in place.
 * @role    AppShell-mounted surface driven by updateStatusAtom (not the generic toast queue).
 * @deps    Jotai update atom, TanStack Router, motion, lucide icons, preload updater bridge.
 * @gotcha  Must stay DOM-after AppLayout. Fixed shell is window-drag (empty no-drag shells punch a
 *          dead zone through top chrome); the card itself is window-no-drag so actions stay clickable.
 *          Suppressed on /settings where the Software Update row is inline.
 */

import { useState } from "react";
import { useAtomValue } from "jotai";
import { useRouterState } from "@tanstack/react-router";
import { AnimatePresence, motion } from "motion/react";
import { Info, X } from "lucide-react";

import { updateStatusAtom } from "@/store/update-atoms";
import type { UpdateStatusEvent } from "@shared/contracts/update/update.contract";

function formatVersion(version: string | undefined): string {
  return version ? ` ${version}` : "";
}

function updateToastCopy(status: UpdateStatusEvent): {
  title: string;
  description: string;
  actionLabel?: string;
} {
  switch (status.state) {
    case "available":
      return {
        title: `发现新版本${formatVersion(status.version)}`,
        description: "点击更新以下载，下载完成后会自动重启安装",
        actionLabel: "更新",
      };
    case "downloading":
      return {
        title: `正在下载更新 ${status.percent ?? 0}%`,
        description: "下载完成后会自动重启安装",
      };
    case "downloaded":
      return {
        title: `更新已下载${formatVersion(status.version)}`,
        description: "正在重启以完成安装",
      };
    default:
      return { title: "", description: "" };
  }
}

function isUpdateToastState(status: UpdateStatusEvent | null): status is UpdateStatusEvent & {
  state: "available" | "downloading" | "downloaded";
} {
  return (
    status?.state === "available" ||
    status?.state === "downloading" ||
    status?.state === "downloaded"
  );
}

export function UpdateToast() {
  const status = useAtomValue(updateStatusAtom);
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const [dismissedKey, setDismissedKey] = useState<string | null>(null);

  const versionKey = status?.version ?? "unknown";
  const onSettings = pathname === "/settings";
  const active = isUpdateToastState(status);
  const dismissed = dismissedKey === versionKey;
  const visible = !onSettings && active && !dismissed;
  const copy = active ? updateToastCopy(status) : null;

  return (
    // Shell is window-drag so an empty fixed layer does not punch a no-drag hole over chrome.
    <div className="window-drag pointer-events-none fixed left-1/2 top-4 z-[200] flex w-[min(92vw,420px)] -translate-x-1/2 flex-col items-center gap-2">
      <AnimatePresence initial={false}>
        {visible && copy ? (
          <motion.div
            key="post-update"
            role="status"
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.14, ease: "easeOut" }}
            className="window-no-drag pointer-events-auto flex min-h-11 w-full items-center gap-3 rounded-xl border border-zinc-200 bg-white px-3.5 py-2.5 text-[13px] text-zinc-800 shadow-md will-change-transform"
          >
            <Info aria-hidden="true" className="shrink-0 text-blue-600" size={15} />
            <div className="min-w-0 flex-1">
              <div className="truncate font-semibold leading-5">{copy.title}</div>
              <div className="truncate text-[12px] font-medium leading-4 text-zinc-500">
                {copy.description}
              </div>
            </div>
            {copy.actionLabel ? (
              <button
                type="button"
                className="window-no-drag h-7 shrink-0 rounded-md bg-zinc-950 px-2.5 text-[12px] font-semibold text-white transition-colors hover:bg-zinc-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-500/25"
                onClick={() => void window.api.updater.download()}
              >
                {copy.actionLabel}
              </button>
            ) : null}
            <button
              type="button"
              aria-label="关闭通知"
              className="window-no-drag grid h-6 w-6 shrink-0 place-items-center rounded-md text-zinc-400 transition-colors hover:bg-zinc-100 hover:text-zinc-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-500/25"
              onClick={() => setDismissedKey(versionKey)}
            >
              <X aria-hidden="true" size={13} />
            </button>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  );
}
