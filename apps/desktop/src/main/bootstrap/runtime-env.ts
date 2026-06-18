/**
 * @purpose Normalize Electron runtime environment checks for desktop bootstrap code.
 * @role    Shared main-process helper for dev/prod resource path decisions.
 * @deps    electron-toolkit dev detection and electron-vite development environment variable.
 * @gotcha  Branded macOS dev bundles can make app.isPackaged true, so do not rely on is.dev alone.
 */

import { is } from "@electron-toolkit/utils";

export function isDevRuntime(): boolean {
  return is.dev || process.env.NODE_ENV_ELECTRON_VITE === "development";
}
