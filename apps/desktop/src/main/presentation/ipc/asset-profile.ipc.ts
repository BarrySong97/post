/**
 * @purpose Receive renderer asset-manager profiling events over Electron IPC.
 * @role    Presentation-layer IPC adapter for installed-app performance diagnostics.
 * @deps    Electron ipcMain and asset profile log service.
 * @gotcha  Validate the event name because renderer input crosses the preload boundary.
 */

import { ipcMain } from "electron";

import {
  getAssetProfileLogPath,
  writeAssetProfileLog,
  type AssetProfileLogData,
} from "../../services/asset-profile-log-service";

type RendererAssetProfileLogEntry = {
  event: string;
  data?: AssetProfileLogData;
};

function isRendererAssetProfileLogEntry(value: unknown): value is RendererAssetProfileLogEntry {
  return (
    value != null &&
    typeof value === "object" &&
    typeof (value as { event?: unknown }).event === "string"
  );
}

export function registerAssetProfileLogHandlers(): void {
  ipcMain.handle("asset-prof:get-log-path", () => getAssetProfileLogPath());
  ipcMain.on("asset-prof:log", (_event, entry: unknown) => {
    if (!isRendererAssetProfileLogEntry(entry)) {
      return;
    }

    writeAssetProfileLog("renderer", entry.event, entry.data ?? {});
  });
}
