/**
 * @purpose Mock Electron Toolkit utility exports for Node-only unit tests.
 * @role    Vitest alias target for main modules that branch on dev/prod runtime helpers.
 * @deps    none.
 * @gotcha  Keep this aligned with the small subset imported by main-process modules in tests.
 */

export const is = {
  dev: true,
};

export const electronApp = {
  setAppUserModelId: () => undefined,
};

export const optimizer = {
  watchWindowShortcuts: () => undefined,
};
