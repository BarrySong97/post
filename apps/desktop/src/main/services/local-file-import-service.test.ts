/**
 * @purpose Verify local-file import naming and path-guard helpers.
 * @role    Pure unit coverage for collision suffixes, vault containment, and hidden skips.
 * @deps    vitest and local-file-import-service helpers.
 * @gotcha  Keep expectations aligned with indexer hidden-path rules (dot-prefixed segments).
 */

import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  buildUniqueDirectoryName,
  buildUniqueRelativePath,
  isHiddenPathSegment,
  isPathInsideDirectory,
  LOCAL_IMPORT_DIR,
  splitFileName,
} from "./local-file-import-service";

describe("local file import helpers", () => {
  it("detects hidden path segments", () => {
    expect(isHiddenPathSegment(".DS_Store")).toBe(true);
    expect(isHiddenPathSegment(".git")).toBe(true);
    expect(isHiddenPathSegment("photo.jpg")).toBe(false);
  });

  it("detects paths inside the vault root", () => {
    const vaultRoot = path.resolve("/tmp/vault");
    expect(isPathInsideDirectory(path.join(vaultRoot, "a.png"), vaultRoot)).toBe(true);
    expect(isPathInsideDirectory(vaultRoot, vaultRoot)).toBe(true);
    expect(isPathInsideDirectory(path.resolve("/tmp/other/a.png"), vaultRoot)).toBe(false);
  });

  it("splits file names into stem and extension", () => {
    expect(splitFileName("photo.jpg")).toEqual({ stem: "photo", extension: "jpg" });
    expect(splitFileName("archive")).toEqual({ stem: "archive", extension: "" });
    expect(splitFileName("archive.tar.gz")).toEqual({ stem: "archive.tar", extension: "gz" });
  });

  it("allocates collision-safe relative paths", () => {
    const existing = new Set([`${LOCAL_IMPORT_DIR}/photo.jpg`]);
    const relative = buildUniqueRelativePath(LOCAL_IMPORT_DIR, "photo.jpg", existing, () => false);
    expect(relative).toBe(`${LOCAL_IMPORT_DIR}/photo-2.jpg`);

    const next = buildUniqueRelativePath(
      LOCAL_IMPORT_DIR,
      "photo.jpg",
      new Set([`${LOCAL_IMPORT_DIR}/photo.jpg`, `${LOCAL_IMPORT_DIR}/photo-2.jpg`]),
      (candidate) => candidate === `${LOCAL_IMPORT_DIR}/photo-3.jpg`,
    );
    expect(next).toBe(`${LOCAL_IMPORT_DIR}/photo-4.jpg`);
  });

  it("allocates collision-safe import folder names", () => {
    const existing = new Set([`${LOCAL_IMPORT_DIR}/vacation`]);
    const name = buildUniqueDirectoryName("vacation", existing, () => false);
    expect(name).toBe("vacation-2");
  });
});
