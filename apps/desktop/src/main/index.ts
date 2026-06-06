import { app, BrowserWindow, ipcMain, shell } from "electron";
import { electronApp, is, optimizer } from "@electron-toolkit/utils";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import { getDatabasePath, initDatabase } from "./db";
import { appRouter } from "./trpc/router";

type TRPCRequest = {
  type: "query" | "mutation" | "subscription";
  path: string;
  input: unknown;
};

function getCallerProcedure(caller: unknown, path: string): unknown {
  return path.split(".").reduce<unknown>((target, segment) => {
    if (target && (typeof target === "object" || typeof target === "function")) {
      return (target as Record<string, unknown>)[segment];
    }

    return undefined;
  }, caller);
}

function registerTRPCHandler(): void {
  const caller = appRouter.createCaller({});

  ipcMain.handle("trpc:request", async (_event, request: TRPCRequest) => {
    if (request.type === "subscription") {
      return {
        ok: false,
        error: {
          message: "Subscriptions are not supported over this IPC link",
        },
      };
    }

    const procedure = getCallerProcedure(caller, request.path);
    if (typeof procedure !== "function") {
      return {
        ok: false,
        error: {
          message: `Unknown tRPC procedure: ${request.path}`,
        },
      };
    }

    try {
      const data = await procedure(request.input);
      return { ok: true, data };
    } catch (error) {
      return {
        ok: false,
        error: {
          message: error instanceof Error ? error.message : String(error),
        },
      };
    }
  });
}

function createWindow(): BrowserWindow {
  const macWindowOptions =
    process.platform === "darwin"
      ? ({
          backgroundColor: "#00000000",
          trafficLightPosition: { x: 24, y: 14 },
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
    if (is.dev && process.env.OPEN_DEVTOOLS === "1") {
      mainWindow.webContents.openDevTools({ mode: "detach" });
    }
  });

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url);
    return { action: "deny" };
  });

  if (is.dev && process.env.ELECTRON_RENDERER_URL) {
    mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    const indexUrl = pathToFileURL(join(__dirname, "../renderer/index.html")).toString();
    mainWindow.loadURL(`${indexUrl}#/`);
  }

  return mainWindow;
}

app.whenReady().then(() => {
  initDatabase();
  electronApp.setAppUserModelId("com.post.desktop");

  app.on("browser-window-created", (_, window) => {
    optimizer.watchWindowShortcuts(window);
  });

  ipcMain.handle("get-database-path", () => getDatabasePath());
  registerTRPCHandler();

  createWindow();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});
