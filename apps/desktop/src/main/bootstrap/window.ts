/**
 * @purpose Create and configure Electron BrowserWindow instances for the desktop app.
 * @role    Main-process window factory and macOS window-control state helper.
 * @deps    Electron BrowserWindow/shell APIs, runtime env detection, preload/renderer/resource paths.
 * @gotcha  Allow the dev renderer origin to navigate internally; send every other http(s) URL to the system browser.
 */

import { BrowserWindow, shell } from "electron";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import { APP_DISPLAY_NAME } from "./app-info";
import { isDevRuntime } from "./runtime-env";

// Aligns with the compact h-10 top-chrome content row (toolbar + page header), centered ~y20.
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

export type HistoryNavigationDirection = "back" | "forward";

/**
 * Bridge OS-level "back / forward" inputs that never reach the renderer as DOM events into
 * the app router. On Windows/Linux the physical mouse side buttons arrive as `app-command`;
 * on macOS bare mouse side buttons emit nothing, but driver software (Logi Options+,
 * SensibleSideButtons, …) and legacy trackpads map them to the standard `swipe` navigation
 * gesture that Finder/Safari respond to. Both are forwarded over IPC so the renderer drives
 * its own hash-history stack — Chromium's built-in mouse-button navigation targets the
 * webContents history, which is a different (and on macOS buggy) stack than the router's
 * (electron#24899). The renderer additionally handles DOM side-button + keyboard fallbacks.
 */
function attachHistoryNavigationForwarding(window: BrowserWindow): void {
  const send = (direction: HistoryNavigationDirection): void => {
    if (window.isDestroyed()) {
      return;
    }
    window.webContents.send("history:navigate", direction);
  };

  window.on("app-command", (_event, command) => {
    if (command === "browser-backward") {
      send("back");
    } else if (command === "browser-forward") {
      send("forward");
    }
  });

  window.on("swipe", (_event, direction) => {
    if (direction === "left") {
      send("back");
    } else if (direction === "right") {
      send("forward");
    }
  });
}

function shouldOpenInSystemBrowser(rawUrl: string, internalWebOrigin?: string): boolean {
  let target: URL;
  try {
    target = new URL(rawUrl);
  } catch {
    return false;
  }

  if (target.protocol !== "http:" && target.protocol !== "https:") {
    return false;
  }

  return !internalWebOrigin || target.origin !== internalWebOrigin;
}

function openInSystemBrowser(rawUrl: string): void {
  void shell.openExternal(rawUrl).catch((error) => {
    console.error("Failed to open external URL", error);
  });
}

function attachExternalNavigationHandling(window: BrowserWindow): void {
  const internalWebOrigin = process.env.ELECTRON_RENDERER_URL
    ? new URL(process.env.ELECTRON_RENDERER_URL).origin
    : undefined;

  window.webContents.setWindowOpenHandler(({ url }) => {
    if (shouldOpenInSystemBrowser(url, internalWebOrigin)) {
      openInSystemBrowser(url);
    }
    return { action: "deny" };
  });

  window.webContents.on("will-navigate", (event, url) => {
    if (!shouldOpenInSystemBrowser(url, internalWebOrigin)) {
      return;
    }

    event.preventDefault();
    openInSystemBrowser(url);
  });
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
          // Vibrancy WITHOUT `transparent: true`. A fully-transparent window is what makes macOS
          // draggable regions (-webkit-app-region) go stale after resize / focus (electron#31862 &
          // friends). Vibrancy itself only needs `visualEffectState` + a transparent page background
          // (styles.css: `body { background: transparent }`), so the frosted sidebar survives while
          // the window stays opaque → draggable regions stay reliable.
          backgroundColor: "#00000000",
          trafficLightPosition: TRAFFIC_LIGHT_POSITION,
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

  attachExternalNavigationHandling(mainWindow);
  attachHistoryNavigationForwarding(mainWindow);

  if (isDevRuntime() && process.env.ELECTRON_RENDERER_URL) {
    mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    const indexUrl = pathToFileURL(join(__dirname, "../renderer/index.html")).toString();
    mainWindow.loadURL(`${indexUrl}#/`);
  }

  return mainWindow;
}
