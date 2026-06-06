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
      trpcRequest: (request: {
        type: string;
        path: string;
        input: unknown;
      }) => Promise<unknown>;
    };
  }
}

export {};
