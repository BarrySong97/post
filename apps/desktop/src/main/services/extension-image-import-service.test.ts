/**
 * @purpose Verify collision-safe browser-extension image file allocation.
 * @role    Unit coverage for concurrent extension imports that share a page-derived file stem.
 * @deps    Vitest, Node temporary filesystem helpers, extension-image-import-service.
 * @gotcha  Run writes concurrently so the test covers the previous stat-then-write race.
 */

import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { writeImageFileToUniquePath } from "./extension-image-import-service";

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("writeImageFileToUniquePath", () => {
  it("allocates unique suffixes for concurrent images with the same stem", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "post-extension-image-"));
    temporaryRoots.push(root);
    const destination = "assets/web-clips";
    const images = [Buffer.from("first"), Buffer.from("second"), Buffer.from("third")];

    const relativePaths = await Promise.all(
      images.map((bytes) =>
        writeImageFileToUniquePath(root, destination, "2026-07-15-threads", "avif", bytes),
      ),
    );

    expect(new Set(relativePaths)).toEqual(
      new Set([
        `${destination}/2026-07-15-threads.avif`,
        `${destination}/2026-07-15-threads-2.avif`,
        `${destination}/2026-07-15-threads-3.avif`,
      ]),
    );

    const savedContents = await Promise.all(
      relativePaths.map((relativePath) => readFile(path.join(root, relativePath), "utf8")),
    );
    expect(new Set(savedContents)).toEqual(new Set(["first", "second", "third"]));
  });

  it("does not reuse a path retained by a soft-deleted asset", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "post-extension-image-"));
    temporaryRoots.push(root);
    const destination = "assets/web-clips";
    const reservedPath = `${destination}/2026-07-15-home-x.jpg`;

    const relativePath = await writeImageFileToUniquePath(
      root,
      destination,
      "2026-07-15-home-x",
      "jpg",
      Buffer.from("replacement"),
      (candidate) => candidate === reservedPath,
    );

    expect(relativePath).toBe(`${destination}/2026-07-15-home-x-2.jpg`);
    await expect(readFile(path.join(root, reservedPath))).rejects.toMatchObject({ code: "ENOENT" });
    await expect(readFile(path.join(root, relativePath), "utf8")).resolves.toBe("replacement");
  });
});
