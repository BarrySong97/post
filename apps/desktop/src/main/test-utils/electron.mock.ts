/**
 * @purpose Mock Electron exports for Node-only unit tests.
 * @role    Vitest alias target that prevents tests from loading the native Electron runtime.
 * @deps    none.
 * @gotcha  Add only the Electron APIs needed by unit-tested modules.
 */

export const app = {
  getPath: () => "/tmp/post-test-user-data",
  getVersion: () => "0.0.0-test",
};

export const clipboard = {
  writeText: () => undefined,
};

export const shell = {
  openPath: async () => "",
  openExternal: async () => undefined,
};

export const ipcMain = {
  handle: () => undefined,
  on: () => undefined,
};

export const protocol = {
  registerSchemesAsPrivileged: () => undefined,
  registerFileProtocol: () => undefined,
};

export const BrowserWindow = {
  fromWebContents: () => null,
  getAllWindows: () => [],
};
