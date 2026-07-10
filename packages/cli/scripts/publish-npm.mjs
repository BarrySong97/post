#!/usr/bin/env node
/**
 * @purpose Publish the generated Post CLI npm package.
 * @role    Thin npm publish wrapper that uses caller-provided npm auth.
 * @deps    Node child_process/os/path/url and npm CLI.
 * @gotcha  Auth must come from NODE_AUTH_TOKEN, npm login, or user-level config; never commit tokens.
 */

import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const packageRoot = resolve(here, "..");
const npmCache = process.env.npm_config_cache ?? join(tmpdir(), "post-npm-cache");

execFileSync("npm", ["publish", "./npm", "--access", "public"], {
  cwd: packageRoot,
  env: { ...process.env, npm_config_cache: npmCache },
  stdio: "inherit",
});
