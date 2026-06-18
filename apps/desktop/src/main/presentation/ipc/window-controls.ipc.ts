/**
 * @purpose Register Electron IPC handlers for native window control state.
 * @role    Presentation-layer IPC adapter for renderer-driven titlebar controls.
 * @deps    Electron ipcMain/BrowserWindow and bootstrap window helpers.
 * @gotcha  This is native IPC because it affects BrowserWindow chrome rather than app data.
 */

import { BrowserWindow, ipcMain } from "electron";

import { applyWindowControlsState, type WindowControlsState } from "../../bootstrap/window";

export function registerWindowControlsHandlers(): void {
  ipcMain.handle("window:set-controls-state", (event, state: WindowControlsState) => {
    const window = BrowserWindow.fromWebContents(event.sender);
    if (window) {
      applyWindowControlsState(window, state);
    }
  });
}
