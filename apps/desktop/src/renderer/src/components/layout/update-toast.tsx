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
import { useTranslation } from "react-i18next";

import { TOAST_ENTER_MS } from "@/lib/toast";
import { updateStatusAtom } from "@/store/update-atoms";
import type { UpdateStatusEvent } from "@shared/contracts/update/update.contract";

function formatVersion(version: string | undefined): string {
  return version ? ` ${version}` : "";
}

function updateToastCopy(
  status: UpdateStatusEvent,
  t: (key: string, opts?: Record<string, string | number>) => string,
): {
  title: string;
  description: string;
  actionLabel?: string;
} {
  switch (status.state) {
    case "available":
      return {
        title: t("update.availableTitle", { version: formatVersion(status.version) }),
        description: t("update.availableDesc"),
        actionLabel: t("update.action"),
      };
    case "downloading":
      return {
        title: t("update.downloadingTitle", { percent: status.percent ?? 0 }),
        description: t("update.downloadingDesc"),
      };
    case "downloaded":
      return {
        title: t("update.downloadedTitle", { version: formatVersion(status.version) }),
        description: t("update.downloadedDesc"),
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
  const { t } = useTranslation();
  const status = useAtomValue(updateStatusAtom);
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const [dismissedKey, setDismissedKey] = useState<string | null>(null);

  const versionKey = status?.version ?? "unknown";
  const onSettings = pathname === "/settings";
  const active = isUpdateToastState(status);
  const dismissed = dismissedKey === versionKey;
  const visible = !onSettings && active && !dismissed;
  const copy = active ? updateToastCopy(status, t) : null;

  return (
    // Shell is window-drag so an empty fixed layer does not punch a no-drag hole over chrome.
    <div className="window-drag pointer-events-none fixed left-1/2 top-4 z-[200] flex w-[min(92vw,420px)] -translate-x-1/2 flex-col items-center gap-2">
      <AnimatePresence initial={false}>
        {visible && copy ? (
          <motion.div
            key="post-update"
            role="status"
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6, transition: { duration: 0.12, ease: "easeIn" } }}
            transition={{ duration: TOAST_ENTER_MS / 1000, ease: [0.22, 1, 0.36, 1] }}
            className="window-no-drag pointer-events-auto flex min-h-11 w-full items-center gap-3 rounded-xl border border-zinc-200 bg-white px-3.5 py-2.5 text-[13px] text-zinc-800 shadow-md will-change-[opacity,transform]"
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
              aria-label={t("common.closeNotification")}
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
