#!/usr/bin/env node
/**
 * @purpose Launch the Post CLI from a globally linked package.
 * @role    Thin executable wrapper around Electron Node mode and the TypeScript CLI entrypoint.
 * @deps    node child_process/module/path/url, electron, tsx.
 * @gotcha  Keep this wrapper tiny; command behavior belongs in src/main.ts.
 */

import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const packageRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const requireFromPackage = createRequire(join(packageRoot, "package.json"));
const electronBinary = requireFromPackage("electron");
const mainPath = join(packageRoot, "src/main.ts");

const result = spawnSync(
  electronBinary,
  ["--import", "tsx", "--", mainPath, ...process.argv.slice(2)],
  {
    cwd: packageRoot,
    env: {
      ...process.env,
      ELECTRON_RUN_AS_NODE: "1",
    },
    stdio: "inherit",
  },
);

if (result.error) {
  throw result.error;
}

process.exit(result.status ?? 1);
