/**
 * @purpose Auto-install the Chrome Native Messaging host manifest that binds the Post extension
 *          (chrome.runtime.sendNativeMessage) to this desktop app's local IPC bridge.
 * @role    Bootstrap step run once at startup in packaged builds only.
 * @deps    Electron app APIs, node fs/os/path, the post-native-host.mjs script bundled via
 *          electron-builder.yml extraResources.
 * @gotcha  The manifest's "path" points at a wrapper script that re-execs this app's own binary with
 *          ELECTRON_RUN_AS_NODE=1, not a system `node` — end users are not expected to have Node.js
 *          installed, and Electron's bundled runtime can run plain scripts in that mode. Never runs in
 *          dev (isDevRuntime()) so it can't clobber a developer's manually-installed unpacked-extension
 *          id from apps/extension/native-host/install-native-host.mjs.
 */

import { chmodSync, mkdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

const HOST_NAME = "com.post.desktop";
const HOST_DESCRIPTION = "Post Desktop native messaging bridge";
const PROD_EXTENSION_ID = "mdpiamelfbcdfglbodgnfdkilamgllae";

function getChromeNativeMessagingHostsDir(): string | null {
  if (process.platform !== "darwin") {
    // Windows/Linux install locations differ (registry / ~/.config); the release pipeline is
    // Mac-only today (see scripts/release.mjs), so skip rather than guess at those paths.
    return null;
  }

  return path.join(
    homedir(),
    "Library",
    "Application Support",
    "Google",
    "Chrome",
    "NativeMessagingHosts",
  );
}

export function installNativeMessagingHost(): void {
  const targetDir = getChromeNativeMessagingHostsDir();
  if (!targetDir) {
    return;
  }

  const hostScriptPath = path.join(process.resourcesPath, "native-host", "post-native-host.mjs");

  mkdirSync(targetDir, { recursive: true });

  const wrapperPath = path.join(targetDir, `${HOST_NAME}.sh`);
  writeFileSync(
    wrapperPath,
    [
      "#!/bin/sh",
      "export ELECTRON_RUN_AS_NODE=1",
      `exec ${JSON.stringify(process.execPath)} ${JSON.stringify(hostScriptPath)}`,
      "",
    ].join("\n"),
  );
  chmodSync(wrapperPath, 0o755);

  const manifest = {
    name: HOST_NAME,
    description: HOST_DESCRIPTION,
    path: wrapperPath,
    type: "stdio",
    allowed_origins: [`chrome-extension://${PROD_EXTENSION_ID}/`],
  };
  writeFileSync(
    path.join(targetDir, `${HOST_NAME}.json`),
    `${JSON.stringify(manifest, null, 2)}\n`,
  );
}
