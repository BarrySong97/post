#!/usr/bin/env node
/**
 * @purpose Build the prod Chrome extension zip for GitHub Releases and store upload.
 * @role    Packaging script invoked by `pnpm -F extension package:prod` and the Release workflow.
 * @deps    Node child_process/fs/path; local Vite prod build output in dist_chrome_prod.
 * @gotcha  Zip root must contain manifest.json (and INSTALL.md). Do not nest the dist folder.
 */

import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const extensionRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const distDir = path.join(extensionRoot, "dist_chrome_prod");
const installSrc = path.join(extensionRoot, "INSTALL.md");
const zipPath = path.join(extensionRoot, "post-extension.zip");

execFileSync("pnpm", ["run", "build:prod"], {
  cwd: extensionRoot,
  stdio: "inherit",
});

if (!existsSync(path.join(distDir, "manifest.json"))) {
  console.error(`Missing ${path.join(distDir, "manifest.json")} after build:prod.`);
  process.exit(1);
}

if (!existsSync(installSrc)) {
  console.error(`Missing ${installSrc}.`);
  process.exit(1);
}

copyFileSync(installSrc, path.join(distDir, "INSTALL.md"));

rmSync(zipPath, { force: true });
execFileSync("zip", ["-qr", "-FS", zipPath, "."], {
  cwd: distDir,
  stdio: "inherit",
});

console.log(`packaged -> ${zipPath}`);
