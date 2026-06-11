import { contextBridge, ipcRenderer } from "electron";
import { electronAPI } from "@electron-toolkit/preload";

type TerminalDataEvent = {
  sessionId: string;
  data: string;
};

type TerminalExitEvent = {
  sessionId: string;
  exitCode: number;
  signal: number | string | null;
};

type TRPCSubscriptionEvent =
  | {
      id: string;
      type: "next";
      data: unknown;
    }
  | {
      id: string;
      type: "error";
      error: {
        message: string;
      };
    }
  | {
      id: string;
      type: "complete";
    };

const api = {
  platform: {
    isMac: process.platform === "darwin",
    isWindows: process.platform === "win32",
    isLinux: process.platform === "linux",
    name: process.platform,
  },
  getDatabasePath: () => ipcRenderer.invoke("get-database-path") as Promise<string>,
  setWindowControlsState: (state: {
    trafficLightsVisible?: boolean;
    trafficLightPosition?: { x: number; y: number } | null;
  }) => ipcRenderer.invoke("window:set-controls-state", state) as Promise<void>,
  terminal: {
    start: (input?: { cols?: number; rows?: number }) =>
      ipcRenderer.invoke("terminal:start", input) as Promise<{
        sessionId: string;
        cwd: string;
        pid: number;
        status: "running" | "exited";
        history: string;
      }>,
    write: (input: { sessionId: string; data: string }) =>
      ipcRenderer.invoke("terminal:write", input) as Promise<void>,
    resize: (input: { sessionId: string; cols: number; rows: number }) =>
      ipcRenderer.invoke("terminal:resize", input) as Promise<void>,
    close: (input: { sessionId: string }) =>
      ipcRenderer.invoke("terminal:close", input) as Promise<void>,
    onData: (callback: (event: TerminalDataEvent) => void) => {
      const listener = (_event: Electron.IpcRendererEvent, payload: TerminalDataEvent) => {
        callback(payload);
      };
      ipcRenderer.on("terminal:data", listener);
      return () => ipcRenderer.off("terminal:data", listener);
    },
    onExit: (callback: (event: TerminalExitEvent) => void) => {
      const listener = (_event: Electron.IpcRendererEvent, payload: TerminalExitEvent) => {
        callback(payload);
      };
      ipcRenderer.on("terminal:exit", listener);
      return () => ipcRenderer.off("terminal:exit", listener);
    },
  },
  trpcRequest: (request: { type: string; path: string; input: unknown }) =>
    ipcRenderer.invoke("trpc:request", request) as Promise<unknown>,
  trpcSubscribe: (request: { id: string; path: string; input: unknown }) => {
    ipcRenderer.send("trpc:subscribe", request);
  },
  trpcUnsubscribe: (request: { id: string }) => {
    ipcRenderer.send("trpc:unsubscribe", request);
  },
  onTRPCSubscriptionEvent: (callback: (event: TRPCSubscriptionEvent) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, payload: TRPCSubscriptionEvent) => {
      callback(payload);
    };
    ipcRenderer.on("trpc:subscription:event", listener);
    return () => ipcRenderer.off("trpc:subscription:event", listener);
  },
};

if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld("electron", electronAPI);
    contextBridge.exposeInMainWorld("api", api);
  } catch (error) {
    console.error(error);
  }
} else {
  const globalWindow = window as typeof window & {
    electron: typeof electronAPI;
    api: typeof api;
  };

  globalWindow.electron = electronAPI;
  globalWindow.api = api;
}
