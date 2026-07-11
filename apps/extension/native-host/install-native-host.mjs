#!/usr/bin/env node
/**
 * @purpose Install a user-level Chrome Native Messaging host manifest for the Post extension.
 * @role    Development helper that binds one unpacked extension ID to the local native host script.
 * @deps    Node fs/os/path/url built-ins.
 * @gotcha  Browsers require exact extension origins; rerun this when the unpacked extension ID changes.
 *          Pass a comma-separated list to allow several extensions (e.g. the dev and prod builds)
 *          to share the one native host.
 */

import { chmodSync, mkdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HOST_NAME = "com.post.desktop";
const HOST_DESCRIPTION = "Post Desktop native messaging bridge";
const args = process.argv.slice(2);

function readFlag(name) {
  const prefix = `${name}=`;
  const inline = args.find((arg) => arg.startsWith(prefix));
  if (inline) {
    return inline.slice(prefix.length);
  }

  const index = args.indexOf(name);
  if (index >= 0) {
    return args[index + 1];
  }

  return undefined;
}

function getBrowserDirectory(browser) {
  switch (browser) {
    case "chrome":
      return path.join(
        homedir(),
        "Library",
        "Application Support",
        "Google",
        "Chrome",
        "NativeMessagingHosts",
      );
    case "chromium":
      return path.join(
        homedir(),
        "Library",
        "Application Support",
        "Chromium",
        "NativeMessagingHosts",
      );
    case "chrome-for-testing":
      return path.join(
        homedir(),
        "Library",
        "Application Support",
        "Google",
        "ChromeForTesting",
        "NativeMessagingHosts",
      );
    case "edge":
      return path.join(
        homedir(),
        "Library",
        "Application Support",
        "Microsoft Edge",
        "NativeMessagingHosts",
      );
    case "brave":
      return path.join(
        homedir(),
        "Library",
        "Application Support",
        "BraveSoftware",
        "Brave-Browser",
        "NativeMessagingHosts",
      );
    default:
      throw new Error(
        `Unsupported browser "${browser}". Use --manifest-dir for custom Chromium browsers.`,
      );
  }
}

const extensionIdArg = readFlag("--extension-id");
const browser = readFlag("--browser") ?? "chrome";
const manifestDir = readFlag("--manifest-dir");

const extensionIds = (extensionIdArg ?? "")
  .split(",")
  .map((id) => id.trim())
  .filter(Boolean);

if (extensionIds.length === 0 || extensionIds.some((id) => !/^[a-p]{32}$/.test(id))) {
  console.error(
    "Usage: pnpm -F extension native-host:install -- --extension-id <32-char-id>[,<id2>,...]",
  );
  process.exit(1);
}

const hostPath = path.join(path.dirname(fileURLToPath(import.meta.url)), "post-native-host.mjs");

const targetDir = manifestDir ? path.resolve(manifestDir) : getBrowserDirectory(browser);
mkdirSync(targetDir, { recursive: true });

const wrapperPath = path.join(targetDir, `${HOST_NAME}.sh`);
writeFileSync(
  wrapperPath,
  ["#!/bin/sh", `exec ${JSON.stringify(process.execPath)} ${JSON.stringify(hostPath)}`, ""].join(
    "\n",
  ),
);
chmodSync(wrapperPath, 0o755);

const manifest = {
  name: HOST_NAME,
  description: HOST_DESCRIPTION,
  path: wrapperPath,
  type: "stdio",
  allowed_origins: extensionIds.map((id) => `chrome-extension://${id}/`),
};

const manifestPath = path.join(targetDir, `${HOST_NAME}.json`);
writeFileSync(`${manifestPath}`, `${JSON.stringify(manifest, null, 2)}\n`);

console.log(
  `Installed ${HOST_NAME} native messaging host for ${manifestDir ? targetDir : browser}:`,
);
console.log(manifestPath);
