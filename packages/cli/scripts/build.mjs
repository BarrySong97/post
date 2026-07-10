#!/usr/bin/env node
/**
 * @purpose Build the npm-publishable Post CLI package.
 * @role    Bundles workspace TypeScript into dist/index.mjs and writes a sanitized npm package.
 * @deps    Node fs/child_process/path/url and workspace esbuild.
 * @gotcha  Keep better-sqlite3 external so npm installs the native module for the user's Node ABI.
 */

import {
  chmodSync,
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { execFileSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const packageRoot = resolve(here, "..");
const repoRoot = resolve(packageRoot, "../..");
const distDir = resolve(packageRoot, "dist");
const npmDir = resolve(packageRoot, "npm");
const npmDistDir = resolve(npmDir, "dist");
const npmPackageName = process.env.POST_CLI_NPM_PACKAGE ?? "@barrysongdev4real/post-cli";

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function readCatalog() {
  const text = readFileSync(resolve(repoRoot, "pnpm-workspace.yaml"), "utf8");
  const catalog = new Map();
  let inCatalog = false;

  for (const line of text.split("\n")) {
    if (line === "catalog:") {
      inCatalog = true;
      continue;
    }

    if (inCatalog && line.length > 0 && !line.startsWith("  ")) {
      break;
    }

    const match = line.match(/^\s{2}['"]?([^:'"]+)['"]?:\s*(.+)$/);
    if (inCatalog && match) {
      catalog.set(match[1], match[2].trim());
    }
  }

  return catalog;
}

function dependencyVersion(name, sourcePackage, catalog) {
  const fromSource = sourcePackage.dependencies?.[name] ?? sourcePackage.devDependencies?.[name];
  if (fromSource && fromSource !== "catalog:") {
    return fromSource;
  }

  const fromCatalog = catalog.get(name);
  if (!fromCatalog) {
    throw new Error(`Missing npm dependency version for ${name}.`);
  }

  return fromCatalog;
}

rmSync(distDir, { recursive: true, force: true });
rmSync(npmDir, { recursive: true, force: true });
mkdirSync(distDir, { recursive: true });
mkdirSync(npmDistDir, { recursive: true });

execFileSync(
  "pnpm",
  [
    "exec",
    "esbuild",
    "src/main.ts",
    "--bundle",
    "--platform=node",
    "--format=esm",
    "--target=node20",
    "--outfile=dist/index.mjs",
    "--banner:js=#!/usr/bin/env node",
    "--external:better-sqlite3",
    "--external:commander",
    "--external:drizzle-orm",
    "--external:drizzle-orm/*",
  ],
  { cwd: packageRoot, stdio: "inherit" },
);

const migrationsSource = resolve(repoRoot, "packages/db/drizzle");
if (!existsSync(migrationsSource)) {
  throw new Error(`Migrations source not found: ${migrationsSource}`);
}

cpSync(migrationsSource, resolve(distDir, "drizzle"), { recursive: true });
chmodSync(resolve(distDir, "index.mjs"), 0o755);

cpSync(distDir, npmDistDir, { recursive: true });
cpSync(resolve(packageRoot, "README.md"), resolve(npmDir, "README.md"));

const sourcePackage = readJson(resolve(packageRoot, "package.json"));
const catalog = readCatalog();
const publishPackage = {
  name: npmPackageName,
  version: sourcePackage.version,
  description: sourcePackage.description,
  license: sourcePackage.license,
  type: "module",
  main: "./dist/index.mjs",
  exports: {
    ".": "./dist/index.mjs",
  },
  bin: {
    "post-cli": "dist/index.mjs",
  },
  files: ["dist", "README.md"],
  publishConfig: {
    access: "public",
  },
  dependencies: {
    "better-sqlite3": dependencyVersion("better-sqlite3", sourcePackage, catalog),
    commander: dependencyVersion("commander", sourcePackage, catalog),
    "drizzle-orm": dependencyVersion("drizzle-orm", sourcePackage, catalog),
  },
};

writeFileSync(resolve(npmDir, "package.json"), `${JSON.stringify(publishPackage, null, 2)}\n`);
