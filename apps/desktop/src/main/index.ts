import { app, BrowserWindow, ipcMain, protocol, shell } from "electron";
import { electronApp, is, optimizer } from "@electron-toolkit/utils";
import path, { join } from "node:path";
import { pathToFileURL } from "node:url";

import { schema } from "@post/db";
import { and, eq } from "drizzle-orm";

import { getDatabase, getDatabasePath, initDatabase } from "./db";
import { getThumbnailCacheRoot } from "./indexer";
import { registerTerminalHandlers } from "./terminal";
import { appRouter } from "./trpc/router";

protocol.registerSchemesAsPrivileged([
  {
    scheme: "post-file",
    privileges: {
      standard: true,
      secure: true,
      corsEnabled: true,
    },
  },
]);

type TRPCRequest = {
  type: "query" | "mutation" | "subscription";
  path: string;
  input: unknown;
};

const TRAFFIC_LIGHT_POSITION = { x: 18, y: 14 };

type WindowControlsState = {
  trafficLightsVisible?: boolean;
  trafficLightPosition?: { x: number; y: number } | null;
};

type MacWindowControls = BrowserWindow & {
  setWindowButtonPosition?: (position: { x: number; y: number } | null) => void;
};

function applyWindowControlsState(window: BrowserWindow, state: WindowControlsState) {
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

function registerAssetProtocol(): void {
  protocol.registerFileProtocol("post-file", (request, callback) => {
    try {
      const url = new URL(request.url);
      if (url.hostname === "thumb") {
        const assetId = decodeURIComponent(url.pathname.replace(/^\/+/, "").split("/")[0] ?? "");
        const row = getDatabase()
          .select()
          .from(schema.imageCache)
          .where(and(eq(schema.imageCache.assetId, assetId), eq(schema.imageCache.status, "ready")))
          .get();

        if (!row?.thumbnailPath) {
          callback({ error: -6 });
          return;
        }

        const thumbnailRoot = path.resolve(getThumbnailCacheRoot());
        const absolutePath = path.resolve(row.thumbnailPath);
        if (absolutePath !== thumbnailRoot && !absolutePath.startsWith(`${thumbnailRoot}${path.sep}`)) {
          callback({ error: -10 });
          return;
        }

        callback({ path: absolutePath });
        return;
      }

      if (url.hostname === "asset") {
        const assetId = decodeURIComponent(url.pathname.replace(/^\/+/, "").split("/")[0] ?? "");
        const row = getDatabase()
          .select({
            file: schema.assetFiles,
            vault: schema.vaults,
          })
          .from(schema.assetFiles)
          .innerJoin(schema.vaults, eq(schema.vaults.id, schema.assetFiles.vaultId))
          .where(eq(schema.assetFiles.assetId, assetId))
          .get();

        if (!row || !row.file.fileExists) {
          callback({ error: -6 });
          return;
        }

        const vaultRoot = path.resolve(row.vault.rootPath);
        const absolutePath = path.resolve(vaultRoot, row.file.relativePath);
        if (absolutePath !== vaultRoot && !absolutePath.startsWith(`${vaultRoot}${path.sep}`)) {
          callback({ error: -10 });
          return;
        }

        callback({ path: absolutePath });
        return;
      }

      callback({ error: -6 });
    } catch (error) {
      console.error("Failed to serve asset file", error);
      callback({ error: -2 });
    }
  });
}

function createWindow(): BrowserWindow {
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
    if (is.dev) {
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
  ipcMain.handle("window:set-controls-state", (event, state: WindowControlsState) => {
    const window = BrowserWindow.fromWebContents(event.sender);
    if (window) {
      applyWindowControlsState(window, state);
    }
  });
  registerTRPCHandler();
  registerAssetProtocol();
  registerTerminalHandlers();

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
