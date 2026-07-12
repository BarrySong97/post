/**
 * @purpose Subscribe to main-process auto-update events and keep shared update status in sync.
 * @role    Root-level renderer controller for updateStatusAtom; surfaces update errors via toast.
 * @deps    React effects, Jotai update atom, TanStack Router location, preload updater bridge, toast.
 * @gotcha  Mount once under AppShell. Update UI lives in UpdateToast / Settings — this only writes atom
 *          (and non-settings error toasts). Pathname is read via ref so the IPC subscription stays stable.
 */

import { useEffect, useRef } from "react";
import { useSetAtom } from "jotai";
import { useRouterState } from "@tanstack/react-router";

import { toast } from "@/lib/toast";
import { updateStatusAtom } from "@/store/update-atoms";

export function AutoUpdateProvider() {
  const setUpdateStatus = useSetAtom(updateStatusAtom);
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const pathnameRef = useRef(pathname);
  pathnameRef.current = pathname;

  useEffect(() => {
    return window.api.updater.onStatus((event) => {
      setUpdateStatus(event);

      if (event.state === "error" && pathnameRef.current !== "/settings") {
        toast.danger("更新失败", {
          description: event.message ?? "请稍后重试",
        });
      }
    });
  }, [setUpdateStatus]);

  return null;
}
