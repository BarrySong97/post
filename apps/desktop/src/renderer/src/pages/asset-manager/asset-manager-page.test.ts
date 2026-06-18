/**
 * @purpose Guard asset manager renderer code against Electron-incompatible browser prompts.
 * @role    Vitest regression coverage for gallery creation UI runtime behavior.
 * @deps    node fs/path utilities, vitest.
 * @gotcha  This is a narrow guard until renderer component tests are introduced.
 */

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const testDir = dirname(fileURLToPath(import.meta.url));
const pageSource = readFileSync(resolve(testDir, "asset-manager-page.tsx"), "utf8");

describe("AssetManagerPage renderer runtime guards", () => {
  it("does not use browser prompt APIs for gallery creation", () => {
    expect(pageSource).not.toContain("window.prompt");
    expect(pageSource).not.toMatch(/\bprompt\s*\(/);
  });
});
