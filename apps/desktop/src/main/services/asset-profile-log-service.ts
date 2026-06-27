/**
 * @purpose Persist lightweight asset-manager profiling events for installed app diagnostics.
 * @role    Main-process service shared by IPC handlers and asset query routers.
 * @deps    Electron app path APIs and Node fs/path append utilities.
 * @gotcha  Keep payloads small; the asset page can emit these during scroll.
 */

import { appendFile, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

import { app } from "electron";

export type AssetProfileLogData = Record<string, unknown>;

const ASSET_PROFILE_LOG_FILE = "asset-profile.log";
const MAX_LOG_LINE_LENGTH = 6_000;

function getRoundedNumber(value: number) {
  if (!Number.isFinite(value)) {
    return value;
  }

  return Math.round(value * 10) / 10;
}

function logPayloadReplacer(_key: string, value: unknown) {
  if (typeof value === "number") {
    return getRoundedNumber(value);
  }

  if (value instanceof Error) {
    return value.message;
  }

  return value;
}

export function getAssetProfileLogPath() {
  return path.join(app.getPath("userData"), ASSET_PROFILE_LOG_FILE);
}

export function resetAssetProfileLog() {
  const logPath = getAssetProfileLogPath();
  mkdirSync(path.dirname(logPath), { recursive: true });
  writeFileSync(logPath, "", "utf8");
}

export function writeAssetProfileLog(
  scope: "main" | "renderer",
  event: string,
  data: AssetProfileLogData = {},
) {
  const payload = {
    at: new Date().toISOString(),
    scope,
    event,
    data,
  };

  let line = JSON.stringify(payload, logPayloadReplacer);
  if (line.length > MAX_LOG_LINE_LENGTH) {
    line = `${line.slice(0, MAX_LOG_LINE_LENGTH)}...`;
  }

  console.info(`[asset-prof ${scope}] ${event}`, data);
  appendFile(getAssetProfileLogPath(), `${line}\n`, () => undefined);
}
