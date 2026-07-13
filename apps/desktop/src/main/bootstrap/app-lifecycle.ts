/**
 * @purpose Coordinate Electron app lifecycle startup, shutdown, and window recreation.
 * @role    Bootstrap module wiring database initialization, native adapters, IPC, and windows.
 * @deps    Electron app/path APIs, database bootstrap, presentation adapters, terminal, watcher manager.
 * @gotcha  Set display name and userData before app readiness so DB resolution stays stable.
 */

import { app, BrowserWindow, ipcMain } from "electron";
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

  app.whenReady().then(() => {
    initDatabase();
    resetAssetProfileLog();
    writeAssetProfileLog("main", "session.start", {
      logPath: getAssetProfileLogPath(),
    });
    startLocalIpcServer(app.getPath("userData"));
    electronApp.setAppUserModelId("com.post.desktop");
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
    if (BrowserWindow.getAllWindows().length === 0) {
      mainWindow = createWindow();
    }
  });
}
