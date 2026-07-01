/**
 * @purpose Describe the window.api contract exposed by the preload bridge.
 * @role    Renderer-facing TypeScript contract for platform, terminal, database, and tRPC IPC methods.
 * @deps    @electron-toolkit/preload ElectronAPI and preload/index.ts implementation.
 * @gotcha  Keep this declaration synchronized whenever preload channels or payload shapes change.
 */

import type { ElectronAPI } from "@electron-toolkit/preload";

type TerminalSnapshot = {
  sessionId: string;
  cwd: string;
  pid: number;
  status: "running" | "exited";
  history: string;
};

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

declare global {
  interface Window {
    electron: ElectronAPI;
    api: {
      platform: {
        isMac: boolean;
        isWindows: boolean;
        isLinux: boolean;
        name: NodeJS.Platform;
      };
      getDatabasePath: () => Promise<string>;
      setWindowControlsState: (state: {
        trafficLightsVisible?: boolean;
        trafficLightPosition?: { x: number; y: number } | null;
      }) => Promise<void>;
      terminal: {
        start: (input?: { cols?: number; rows?: number }) => Promise<TerminalSnapshot>;
        write: (input: { sessionId: string; data: string }) => Promise<void>;
        resize: (input: { sessionId: string; cols: number; rows: number }) => Promise<void>;
        close: (input: { sessionId: string }) => Promise<void>;
        onData: (callback: (event: TerminalDataEvent) => void) => () => void;
        onExit: (callback: (event: TerminalExitEvent) => void) => () => void;
      };
      trpcRequest: (request: { type: string; path: string; input: unknown }) => Promise<unknown>;
      getAssetProfileLogPath: () => Promise<string>;
      assetProfileLog: (entry: { event: string; data?: Record<string, unknown> }) => void;
      trpcSubscribe: (request: { id: string; path: string; input: unknown }) => void;
      trpcUnsubscribe: (request: { id: string }) => void;
      onTRPCSubscriptionEvent: (callback: (event: TRPCSubscriptionEvent) => void) => () => void;
      onHistoryNavigate: (callback: (direction: "back" | "forward") => void) => () => void;
    };
  }
}

export {};
