#!/usr/bin/env node
/**
 * @purpose Cut a Mac-only Post release through version bumps, release notes validation, tag push, and workflow wait.
 * @role    Local release helper that prepares GitHub Releases for electron-updater Mac clients.
 * @deps    Node built-ins plus git, gh, and pnpm commands available on the release operator machine.
 * @gotcha  Add the release note first; the first entry must match the version and own the latest badge.
 */

import { readFileSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";

const REPO = env("POST_RELEASE_REPO", "BarrySong97/post");
const MAIN_BRANCH = env("POST_RELEASE_BRANCH", "main");
const NOTES_FILE = env(
  "POST_RELEASE_NOTES_FILE",
  "apps/website/app/components/releases/release-timeline.tsx",
);
const VERSION_FILES = env("POST_RELEASE_VERSION_FILES", [
  "apps/desktop/package.json",
  "apps/website/package.json",
]);

const args = process.argv.slice(2);
const version = args.find((arg) => !arg.startsWith("--"));
const flags = new Set(args.filter((arg) => arg.startsWith("--")));
const dryRun = flags.has("--dry-run");
const noChecks = flags.has("--no-checks");
const noPublish = flags.has("--no-publish");
const noWait = flags.has("--no-wait");

if (flags.has("--help") || flags.has("-h")) {
  usage();
  process.exit(0);
}

if (!version) {
  usage();
  process.exit(1);
}

if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version)) {
  fail(`Invalid version "${version}". Expected semver like 0.1.0.`);
}

const tag = `v${version}`;

main();

function main() {
  validateReleaseNotes(version);
  ensureBranch();
  ensureTagDoesNotExist(tag);

  for (const file of VERSION_FILES) {
    bumpPackageVersion(file, version);
  }

  if (!noChecks) {
    runQualityGates();
  }

  mut("git", ["add", NOTES_FILE, ...VERSION_FILES]);
  mut("git", ["commit", "-m", `chore(release): ${tag}`]);
  mut("git", ["push", "origin", MAIN_BRANCH]);
  mut("git", ["tag", tag]);
  mut("git", ["push", "origin", tag]);

  if (!noWait) {
    waitForReleaseWorkflow(tag);
  }

  if (!noPublish) {
    publishDraft(tag);
  }

  info(`Mac release pipeline finished for ${tag}.`);
}

function validateReleaseNotes(expectedVersion) {
  const text = readFileSync(NOTES_FILE, "utf8");
  const releaseData = text.slice(text.indexOf("export const RELEASES"));
  const versions = [...releaseData.matchAll(/version:\s*["']([^"']+)["']/g)].map(
    (match) => match[1],
  );
  if (versions[0] !== expectedVersion) {
    fail(
      `${NOTES_FILE} first release version is ${versions[0] ?? "missing"}, expected ${expectedVersion}.`,
    );
  }

  const latestMatch = releaseData.match(
    /version:\s*["']([^"']+)["'][\s\S]*?badge:\s*["']latest["']/,
  );
  if (!latestMatch || latestMatch[1] !== expectedVersion) {
    fail(`${NOTES_FILE} must move badge: "latest" to version ${expectedVersion}.`);
  }

  const latestCount = [...releaseData.matchAll(/badge:\s*["']latest["']/g)].length;
  if (latestCount !== 1) {
    fail(`${NOTES_FILE} must contain exactly one latest badge; found ${latestCount}.`);
  }
}

function ensureBranch() {
  const branch = sh("git", ["branch", "--show-current"]);
  if (branch !== MAIN_BRANCH) {
    const message = `Current branch is ${branch || "(detached)"}, expected ${MAIN_BRANCH}.`;
    if (dryRun) {
      info(`[dry-run] ${message}`);
      return;
    }
    fail(message);
  }
}

function ensureTagDoesNotExist(tagName) {
  const local = sh("git", ["tag", "--list", tagName]);
  if (local) {
    if (dryRun) {
      info(`[dry-run] local tag ${tagName} already exists`);
      return;
    }
    fail(`Local tag ${tagName} already exists.`);
  }

  if (dryRun) {
    info(`[dry-run] skip remote tag check for ${tagName}`);
    return;
  }

  const remote = shAllowFailure("git", ["ls-remote", "--tags", "origin", tagName]);
  if (remote) {
    fail(`Remote tag ${tagName} already exists.`);
  }
}

function bumpPackageVersion(file, nextVersion) {
  const before = readFileSync(file, "utf8");
  const after = before.replace(/("version"\s*:\s*")([^"]+)(")/, `$1${nextVersion}$3`);
  if (after === before) {
    info(`No version change needed in ${file}.`);
    return;
  }
  if (dryRun) {
    info(`[dry-run] update ${file}`);
    return;
  }
  writeFileSync(file, after);
}

function runQualityGates() {
  mut("pnpm", ["ffmpeg:prepare"]);
  mut("pnpm", ["indexer:build"]);
  mut("pnpm", ["-F", "desktop", "check-types"]);
  mut("pnpm", ["-F", "website", "check-types"]);
  mut("pnpm", ["-F", "website", "build"]);
  mut("node", ["scripts/check-docs.mjs"]);
}

function waitForReleaseWorkflow(tagName) {
  info(`Waiting for GitHub Actions release workflow for ${tagName}...`);
  const runId = findReleaseRun(tagName);
  mut("gh", ["run", "watch", runId, "--repo", REPO, "--exit-status"]);
}

function findReleaseRun(tagName) {
  for (let attempt = 1; attempt <= 30; attempt += 1) {
    const id = shAllowFailure("gh", [
      "run",
      "list",
      "--repo",
      REPO,
      "--workflow",
      "Release",
      "--branch",
      tagName,
      "--limit",
      "1",
      "--json",
      "databaseId",
      "--jq",
      ".[0].databaseId // empty",
    ]);
    if (id) {
      return id;
    }
    info(`Waiting for release workflow to appear (${attempt}/30)...`);
    if (!dryRun) {
      execFileSync("sleep", ["5"]);
    }
  }
  fail(`Could not find Release workflow run for ${tagName}.`);
}

function publishDraft(tagName) {
  mut("gh", ["release", "edit", tagName, "--repo", REPO, "--draft=false", "--latest"]);
}

function mut(command, commandArgs) {
  if (dryRun) {
    info(`[dry-run] ${command} ${commandArgs.join(" ")}`);
    return "";
  }
  return sh(command, commandArgs);
}

function sh(command, commandArgs) {
  return execFileSync(command, commandArgs, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "inherit"],
  }).trim();
}

function shAllowFailure(command, commandArgs) {
  try {
    return sh(command, commandArgs);
  } catch {
    return "";
  }
}

function env(name, fallback) {
  const value = process.env[name];
  if (!value) {
    return fallback;
  }
  if (Array.isArray(fallback)) {
    return value
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean);
  }
  return value;
}

function usage() {
  console.log(`Usage: pnpm release <version> [--dry-run] [--no-checks] [--no-wait] [--no-publish]

Examples:
  pnpm release 0.1.1 --dry-run --no-checks --no-wait --no-publish
  pnpm release 0.1.1
`);
}

function info(message) {
  console.log(message);
}

function fail(message) {
  console.error(message);
  process.exit(1);
}
