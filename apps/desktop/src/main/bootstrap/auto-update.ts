/**
 * @purpose Wire electron-updater to GitHub Releases and relay update status to the renderer.
 * @role    Main-process auto-update controller for launch checks, manual checks, downloads, and restart install.
 * @deps    electron-updater, Electron ipcMain/BrowserWindow, filesystem resource metadata.
 * @gotcha  Dev and local dir installs do not have app-update.yml, so they expose inert handlers.
 */

import { ipcMain, type BrowserWindow } from "electron";
import electronUpdater from "electron-updater";
import { existsSync } from "node:fs";
import { join } from "node:path";

import type { UpdateStatusEvent } from "@shared/contracts/update/update.contract";

import { isDevRuntime } from "./runtime-env";

const { autoUpdater } = electronUpdater;

const UPDATE_STATUS_CHANNEL = "post:updater:status";

type GetWindow = () => BrowserWindow | null;

let initialized = false;
let installing = false;

function emit(getWindow: GetWindow, event: UpdateStatusEvent): void {
  const window = getWindow();
  if (!window || window.isDestroyed()) {
    return;
  }

  window.webContents.send(UPDATE_STATUS_CHANNEL, event);
}

function registerHandlers(): void {
  ipcMain.handle("post:updater:check", async () => {
    await autoUpdater.checkForUpdates();
  });
  ipcMain.handle("post:updater:download", async () => {
    await autoUpdater.downloadUpdate();
  });
}

function registerInertHandlers(getWindow: GetWindow): void {
  // Dev / unpackaged builds have no app-update.yml. Still emit status so the
  // renderer's optimistic loading state is overwritten instead of hanging.
  ipcMain.handle("post:updater:check", () => emit(getWindow, { state: "not-available" }));
  ipcMain.handle("post:updater:download", () => emit(getWindow, { state: "not-available" }));
}

function hasPackagedUpdateMetadata(): boolean {
  return existsSync(join(process.resourcesPath, "app-update.yml"));
}

export function initAutoUpdate(getWindow: GetWindow): void {
  if (initialized) {
    return;
  }
  initialized = true;

  if (isDevRuntime() || !hasPackagedUpdateMetadata()) {
    registerInertHandlers(getWindow);
    return;
  }

  autoUpdater.logger = console;
  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.on("checking-for-update", () => emit(getWindow, { state: "checking" }));
  autoUpdater.on("update-available", (info) =>
    emit(getWindow, { state: "available", version: info.version }),
  );
  autoUpdater.on("update-not-available", (info) =>
    emit(getWindow, { state: "not-available", version: info.version }),
  );
  autoUpdater.on("download-progress", (progress) =>
    emit(getWindow, { state: "downloading", percent: Math.round(progress.percent) }),
  );
  autoUpdater.on("update-downloaded", (info) => {
    emit(getWindow, { state: "downloaded", version: info.version });
    if (installing) {
      return;
    }
    installing = true;
    autoUpdater.quitAndInstall();
  });
  autoUpdater.on("error", (error) =>
    emit(getWindow, {
      state: "error",
      message: error instanceof Error ? error.message : String(error),
    }),
  );

  registerHandlers();

  void autoUpdater.checkForUpdates().catch(() => {});
}
