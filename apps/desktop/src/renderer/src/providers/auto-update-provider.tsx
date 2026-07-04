/**
 * @purpose Subscribe to main-process auto-update events and surface update actions in the renderer.
 * @role    Root-level renderer controller for update toasts and shared update status state.
 * @deps    React effects, Jotai update atom, preload updater bridge, and local toast utility.
 * @gotcha  Mount once under AppShell so launch checks stay connected across all routes.
 */

import { useEffect } from "react";
import { useSetAtom } from "jotai";

import { toast } from "@/lib/toast";
import { updateStatusAtom } from "@/store/update-atoms";

const UPDATE_TOAST_ID = "post-update";

function formatVersion(version: string | undefined): string {
  return version ? ` ${version}` : "";
}

export function AutoUpdateProvider() {
  const setUpdateStatus = useSetAtom(updateStatusAtom);

  useEffect(() => {
    return window.api.updater.onStatus((event) => {
      setUpdateStatus(event);

      switch (event.state) {
        case "available":
          toast.info(`发现新版本${formatVersion(event.version)}`, {
            id: UPDATE_TOAST_ID,
            description: "点击更新以下载，下载完成后会自动重启安装",
            timeout: 0,
            actionLabel: "更新",
            onAction: () => void window.api.updater.download(),
          });
          break;
        case "downloading":
          toast.info(`正在下载更新 ${event.percent ?? 0}%`, {
            id: UPDATE_TOAST_ID,
            description: "下载完成后会自动重启安装",
            timeout: 0,
          });
          break;
        case "downloaded":
          toast.info(`更新已下载${formatVersion(event.version)}`, {
            id: UPDATE_TOAST_ID,
            description: "正在重启以完成安装",
            timeout: 0,
          });
          break;
        case "error":
          toast.close(UPDATE_TOAST_ID);
          toast.danger("更新失败", {
            description: event.message ?? "请稍后重试",
          });
          break;
        case "checking":
        case "not-available":
          break;
      }
    });
  }, [setUpdateStatus]);

  return null;
}
