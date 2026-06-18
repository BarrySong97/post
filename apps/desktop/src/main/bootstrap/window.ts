/**
 * @purpose Create and configure Electron BrowserWindow instances for the desktop app.
 * @role    Main-process window factory and macOS window-control state helper.
 * @deps    Electron BrowserWindow/shell APIs, runtime env detection, preload/renderer/resource paths.
 * @gotcha  __dirname resolves to out/main after bundling, while packaged extraResources live under process.resourcesPath.
 */

import { BrowserWindow, shell } from "electron";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import { APP_DISPLAY_NAME } from "./app-info";
import { isDevRuntime } from "./runtime-env";

export const TRAFFIC_LIGHT_POSITION = { x: 18, y: 14 };

export type WindowControlsState = {
  trafficLightsVisible?: boolean;
  trafficLightPosition?: { x: number; y: number } | null;
};

type MacWindowControls = BrowserWindow & {
  setWindowButtonPosition?: (position: { x: number; y: number } | null) => void;
};

export function applyWindowControlsState(window: BrowserWindow, state: WindowControlsState): void {
  if (process.platform !== "darwin") {
    return;
  }

  const macWindow = window as MacWindowControls;
  const visible = state.trafficLightsVisible ?? true;
  const position = state.trafficLightPosition ?? TRAFFIC_LIGHT_POSITION;

  if (typeof macWindow.setWindowButtonPosition === "function") {
    macWindow.setWindowButtonPosition(visible ? position : { x: -120, y: position.y });
  }
}

export function getWindowIconPath(): string {
  if (isDevRuntime()) {
    return join(__dirname, "../../resources/icons/Post-512.png");
  }

  return join(process.resourcesPath, "icons/Post-512.png");
}

export function getDevDockIconPath(): string {
  return join(__dirname, "../../resources/icons/Post-dev-dock.png");
}

export function createWindow(): BrowserWindow {
  const macWindowOptions =
    process.platform === "darwin"
      ? ({
          backgroundColor: "#00000000",
          trafficLightPosition: TRAFFIC_LIGHT_POSITION,
          transparent: true,
          vibrancy: "sidebar",
          visualEffectState: "active",
        } as const)
      : {};

  const mainWindow = new BrowserWindow({
    width: 1120,
    height: 780,
    minWidth: 860,
    minHeight: 620,
    show: false,
    autoHideMenuBar: true,
    icon: getWindowIconPath(),
    title: APP_DISPLAY_NAME,
    titleBarStyle: process.platform === "darwin" ? "hiddenInset" : "default",
    ...macWindowOptions,
    webPreferences: {
      preload: join(__dirname, "../preload/index.mjs"),
      sandbox: false,
      contextIsolation: true,
    },
  });

  mainWindow.on("ready-to-show", () => {
    mainWindow.show();
    if (isDevRuntime()) {
      mainWindow.webContents.openDevTools({ mode: "detach" });
    }
  });

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url);
    return { action: "deny" };
  });

  if (isDevRuntime() && process.env.ELECTRON_RENDERER_URL) {
    mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    const indexUrl = pathToFileURL(join(__dirname, "../renderer/index.html")).toString();
    mainWindow.loadURL(`${indexUrl}#/`);
  }

  return mainWindow;
}
