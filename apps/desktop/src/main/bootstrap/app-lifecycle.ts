/**
 * @purpose Coordinate Electron app lifecycle startup, shutdown, and window recreation.
 * @role    Bootstrap module wiring database initialization, native adapters, IPC, and windows.
 * @deps    Electron app/path APIs, database bootstrap, presentation adapters, terminal, watcher manager.
 * @gotcha  Register the packaged post:// client and open-url listener before app readiness.
 */

import { app, ipcMain, type BrowserWindow } from "electron";
import { electronApp, optimizer } from "@electron-toolkit/utils";
import path from "node:path";

import { getDatabasePath, initDatabase } from "../db";
import { registerTerminalHandlers } from "../terminal";
import { vaultWatcherManager } from "../vault-watcher-manager";
import { startLocalIpcServer, stopLocalIpcServer } from "../local-ipc-server";
import { registerAssetProfileLogHandlers } from "../presentation/ipc/asset-profile.ipc";
import { registerWindowControlsHandlers } from "../presentation/ipc/window-controls.ipc";
import { registerAssetProtocol } from "../presentation/protocols/post-file.protocol";
import { registerTRPCIPCHandler } from "../presentation/trpc/ipc-adapter";
import {
  getAssetProfileLogPath,
  resetAssetProfileLog,
  writeAssetProfileLog,
} from "../services/asset-profile-log-service";
import { APP_DISPLAY_NAME } from "./app-info";
import { initAutoUpdate } from "./auto-update";
import { installNativeMessagingHost } from "./native-messaging-host";
import { isDevRuntime } from "./runtime-env";
import { createWindow, getDevDockIconPath } from "./window";

let mainWindow: BrowserWindow | null = null;
const APP_PROTOCOL_SCHEME = "post";

function focusMainWindow(): void {
  if (!mainWindow || mainWindow.isDestroyed()) {
    mainWindow = createWindow();
  }
  if (mainWindow.isMinimized()) {
    mainWindow.restore();
  }
  mainWindow.show();
  mainWindow.focus();
}

function isPostProtocolUrl(rawUrl: string): boolean {
  try {
    return new URL(rawUrl).protocol === `${APP_PROTOCOL_SCHEME}:`;
  } catch {
    return false;
  }
}

function applyDevDockIcon(): void {
  if (process.platform !== "darwin" || !isDevRuntime()) {
    return;
  }

  app.dock?.setIcon(getDevDockIconPath());
}

function applyNativeMessagingHost(): void {
  if (isDevRuntime()) {
    return;
  }

  try {
    installNativeMessagingHost();
  } catch (error) {
    console.error("Failed to install the native messaging host manifest", error);
  }
}

function applyUserDataPath(): void {
  const configuredPath = process.env.POST_USER_DATA_DIR;
  const userDataPath = configuredPath
    ? path.resolve(configuredPath)
    : path.join(app.getPath("appData"), "desktop");

  app.setPath("userData", userDataPath);
}

export function bootApplication(): void {
  app.setName(APP_DISPLAY_NAME);
  app.setAboutPanelOptions({ applicationName: APP_DISPLAY_NAME });
  applyUserDataPath();

  app.on("open-url", (event, rawUrl) => {
    if (!isPostProtocolUrl(rawUrl)) {
      return;
    }
    event.preventDefault();
    void app.whenReady().then(focusMainWindow);
  });

  app.whenReady().then(() => {
    initDatabase();
    resetAssetProfileLog();
    writeAssetProfileLog("main", "session.start", {
      logPath: getAssetProfileLogPath(),
    });
    startLocalIpcServer(app.getPath("userData"));
    electronApp.setAppUserModelId("com.post.desktop");
    if (!isDevRuntime()) {
      app.setAsDefaultProtocolClient(APP_PROTOCOL_SCHEME);
    }
    applyDevDockIcon();
    applyNativeMessagingHost();

    app.on("browser-window-created", (_, window) => {
      optimizer.watchWindowShortcuts(window);
    });

    ipcMain.handle("get-database-path", () => getDatabasePath());
    registerAssetProfileLogHandlers();
    registerWindowControlsHandlers();
    registerTRPCIPCHandler();
    registerAssetProtocol();
    registerTerminalHandlers();

    mainWindow = createWindow();
    initAutoUpdate(() => mainWindow);
  });

  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") {
      app.quit();
    }
  });

  app.on("before-quit", () => {
    stopLocalIpcServer();
    vaultWatcherManager.shutdown();
  });

  app.on("activate", () => {
    focusMainWindow();
  });
}
