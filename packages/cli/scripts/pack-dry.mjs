#!/usr/bin/env node
/**
 * @purpose Inspect the generated Post CLI npm package without publishing it.
 * @role    Thin npm pack wrapper with a stable temporary cache default.
 * @deps    Node child_process/os/path/url and npm CLI.
 * @gotcha  Avoid relying on a user's global npm cache, which may have stale ownership.
 */

import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const packageRoot = resolve(here, "..");
const npmCache = process.env.npm_config_cache ?? join(tmpdir(), "post-npm-cache");

execFileSync("npm", ["pack", "--dry-run", "./npm"], {
  cwd: packageRoot,
  env: { ...process.env, npm_config_cache: npmCache },
  stdio: "inherit",
});
