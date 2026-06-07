import type { ElectronAPI } from "@electron-toolkit/preload";

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
      trpcRequest: (request: {
        type: string;
        path: string;
        input: unknown;
      }) => Promise<unknown>;
    };
  }
}

export {};
