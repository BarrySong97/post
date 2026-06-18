#!/usr/bin/env node
/**
 * @purpose Create a branded Electron.app copy for macOS development runs.
 * @role    Helper invoked by desktop dev scripts before electron-vite launches Electron.
 * @deps    Electron npm package layout, macOS PlistBuddy, filesystem copy APIs.
 * @gotcha  electron-vite honors ELECTRON_EXEC_PATH; app.setName alone cannot rename the dev bundle.
 */

import {
  chmodSync,
  copyFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const APP_NAME = "Post";
const APP_ID = "com.post.desktop.dev";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const desktopRoot = join(repoRoot, "apps/desktop");
const requireFromDesktop = createRequire(join(desktopRoot, "package.json"));

function setPlistValue(plistPath, key, value) {
  const setResult = spawnSync(
    "/usr/libexec/PlistBuddy",
    ["-c", `Set :${key} ${value}`, plistPath],
    {
      stdio: "ignore",
    },
  );

  if (setResult.status === 0) {
    return;
  }

  const addResult = spawnSync(
    "/usr/libexec/PlistBuddy",
    ["-c", `Add :${key} string ${value}`, plistPath],
    {
      stdio: "inherit",
    },
  );

  if (addResult.status !== 0) {
    throw new Error(`Failed to write ${key} to ${plistPath}`);
  }
}

function getElectronPackageRoot() {
  return dirname(requireFromDesktop.resolve("electron/package.json"));
}

function getSourceAppPath(electronRoot) {
  const pathText = readFileSync(join(electronRoot, "path.txt"), "utf8").trim();
  const appPathEnd = pathText.indexOf(".app/");

  if (appPathEnd === -1) {
    throw new Error(`Unsupported Electron executable path: ${pathText}`);
  }

  return join(electronRoot, "dist", pathText.slice(0, appPathEnd + ".app".length));
}

function prepareMacDevApp() {
  const electronRoot = getElectronPackageRoot();
  const electronPackage = JSON.parse(readFileSync(join(electronRoot, "package.json"), "utf8"));
  const sourceApp = getSourceAppPath(electronRoot);
  const devRoot = join(desktopRoot, ".electron-dev");
  const destinationApp = join(devRoot, `${APP_NAME}.app`);
  const executablePath = join(destinationApp, "Contents/MacOS", APP_NAME);
  const markerPath = join(devRoot, "post-electron-dev-app.json");
  const expectedMarker = JSON.stringify(
    {
      appName: APP_NAME,
      electronVersion: electronPackage.version,
      sourceApp,
    },
    null,
    2,
  );

  if (
    !existsSync(executablePath) ||
    !existsSync(markerPath) ||
    readFileSync(markerPath, "utf8") !== expectedMarker
  ) {
    rmSync(destinationApp, { recursive: true, force: true });
    mkdirSync(devRoot, { recursive: true });
    cpSync(sourceApp, destinationApp, { recursive: true, verbatimSymlinks: true });

    const macOsDir = join(destinationApp, "Contents/MacOS");
    copyFileSync(join(macOsDir, "Electron"), executablePath);
    chmodSync(executablePath, 0o755);

    const plistPath = join(destinationApp, "Contents/Info.plist");
    setPlistValue(plistPath, "CFBundleName", APP_NAME);
    setPlistValue(plistPath, "CFBundleDisplayName", APP_NAME);
    setPlistValue(plistPath, "CFBundleExecutable", APP_NAME);
    setPlistValue(plistPath, "CFBundleIdentifier", APP_ID);
    writeFileSync(markerPath, expectedMarker);
  }

  return executablePath;
}

if (process.platform === "darwin") {
  process.stdout.write(prepareMacDevApp());
} else {
  process.stdout.write(requireFromDesktop("electron"));
}
