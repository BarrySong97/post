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
import { useTranslation } from "react-i18next";

import { toast } from "@/lib/toast";
import { updateStatusAtom } from "@/store/update-atoms";

export function AutoUpdateProvider() {
  const { t } = useTranslation();
  const setUpdateStatus = useSetAtom(updateStatusAtom);
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const pathnameRef = useRef(pathname);
  const tRef = useRef(t);
  pathnameRef.current = pathname;
  tRef.current = t;

  useEffect(() => {
    return window.api.updater.onStatus((event) => {
      setUpdateStatus(event);

      if (event.state === "error" && pathnameRef.current !== "/settings") {
        toast.danger(tRef.current("update.failed"), {
          description: event.message ?? tRef.current("common.retryLater"),
        });
      }
    });
  }, [setUpdateStatus]);

  return null;
}
