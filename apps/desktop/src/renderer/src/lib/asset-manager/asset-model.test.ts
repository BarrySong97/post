/**
 * @purpose Lock the renderer asset view-model mapping, especially post source attribution.
 * @role    Vitest coverage for mapIndexedAsset and extractDomain in the asset manager model.
 * @deps    vitest, asset-model, asset-manager types.
 * @gotcha  Keep browser-safe: mapIndexedAsset must not depend on Electron or SQLite.
 */

import { describe, expect, it } from "vitest";

import { extractDomain, formatVideoDuration, mapIndexedAsset } from "./asset-model";
import type { IndexedAsset } from "./types";

function buildIndexedAsset(overrides: Partial<IndexedAsset> = {}): IndexedAsset {
  const base = {
    id: "asset-1",
    vaultId: "vault-1",
    kind: "image",
    status: "inbox",
    privacy: "normal",
    title: "Untitled",
    description: null,
    relativePath: "web-clips/media/asset-1.png",
    fileName: "asset-1.png",
    extension: "png",
    sizeBytes: 1024,
    // tRPC serializes timestamp_ms columns to ISO strings over the IPC boundary.
    mtimeMs: "2026-03-12T08:00:00.000Z",
    ctimeMs: "2026-03-10T08:00:00.000Z",
    fileExists: true,
    quickFingerprint: null,
    vaultRootPath: "/vault",
    vaultName: "Vault",
    markdown: null,
    image: null,
    post: null,
    web: null,
    tags: [],
    relatedIds: [],
  };

  return { ...base, ...overrides } as IndexedAsset;
}

describe("extractDomain", () => {
  it("strips the scheme and leading www", () => {
    expect(extractDomain("https://www.example.com/path?q=1")).toBe("example.com");
  });

  it("returns undefined for empty or invalid input", () => {
    expect(extractDomain(null)).toBeUndefined();
    expect(extractDomain("not a url")).toBeUndefined();
  });
});

describe("mapIndexedAsset post attribution", () => {
  it("maps postCache fields onto the view-model for X posts", () => {
    const asset = mapIndexedAsset(
      buildIndexedAsset({
        kind: "post",
        post: {
          platform: "x",
          authorName: "Andrej Karpathy",
          authorHandle: "@karpathy",
          authorAvatarUrl: "https://pbs.twimg.com/profile_images/123/karpathy_normal.jpg",
          canonicalUrl: "https://x.com/karpathy/status/123",
          publishedAt: "2026-03-12T08:00:00.000Z",
        },
      }),
    );

    expect(asset.platform).toBe("x");
    expect(asset.authorHandle).toBe("@karpathy");
    expect(asset.authorName).toBe("Andrej Karpathy");
    expect(asset.authorAvatarUrl).toBe(
      "https://pbs.twimg.com/profile_images/123/karpathy_normal.jpg",
    );
    expect(asset.url).toBe("https://x.com/karpathy/status/123");
    expect(asset.domain).toBe("x.com");
    expect(asset.publishedTime).toBeTruthy();
  });

  it("leaves attribution fields undefined for non-post assets", () => {
    const asset = mapIndexedAsset(buildIndexedAsset({ kind: "image" }));

    expect(asset.platform).toBeUndefined();
    expect(asset.authorHandle).toBeUndefined();
    expect(asset.authorAvatarUrl).toBeUndefined();
    expect(asset.domain).toBeUndefined();
    expect(asset.publishedTime).toBeUndefined();
  });
});

function buildImageCache(luma: number | null) {
  return {
    assetId: "asset-1",
    vaultId: "vault-1",
    fileId: "file-1",
    width: 800,
    height: 600,
    thumbnailPath: "/cache/asset-1.jpg",
    thumbnailWidth: 720,
    thumbnailHeight: 540,
    thumbnailSizeBytes: 4096,
    thumbnailFormat: "jpeg",
    thumbnailLuma: luma,
    sourceSizeBytes: 10_000,
    sourceMtimeMs: "2026-03-12T08:00:00.000Z",
    sourceQuickFingerprint: "fp",
    status: "ready",
    errorMessage: null,
    generatedAt: "2026-03-12T08:00:00.000Z",
    updatedAt: "2026-03-12T08:00:00.000Z",
  } as NonNullable<IndexedAsset["image"]>;
}

describe("formatVideoDuration", () => {
  it("formats minutes and seconds", () => {
    expect(formatVideoDuration(65_000)).toBe("1:05");
  });

  it("formats hours when needed", () => {
    expect(formatVideoDuration(3_725_000)).toBe("1:02:05");
  });

  it("clamps negative values used by remaining-time countdown", () => {
    expect(formatVideoDuration(-500)).toBe("0:00");
  });
});

describe("mapIndexedAsset video duration", () => {
  it("exposes formatted and raw duration for video cards", () => {
    const asset = mapIndexedAsset(
      buildIndexedAsset({
        kind: "video",
        extension: "mp4",
        fileName: "clip.mp4",
        relativePath: "media/clip.mp4",
        image: {
          ...buildImageCache(40),
          videoDurationMs: 125_000,
        },
      }),
    );

    expect(asset.duration).toBe("2:05");
    expect(asset.durationMs).toBe(125_000);
  });

  it("omits duration when the cache sentinel marks a failed probe", () => {
    const asset = mapIndexedAsset(
      buildIndexedAsset({
        kind: "video",
        extension: "mp4",
        fileName: "clip.mp4",
        relativePath: "media/clip.mp4",
        image: {
          ...buildImageCache(40),
          videoDurationMs: -1,
        },
      }),
    );

    expect(asset.duration).toBeUndefined();
    expect(asset.durationMs).toBeUndefined();
  });
});

describe("mapIndexedAsset cover luma", () => {
  it("flags a bright bottom strip as a light cover", () => {
    const asset = mapIndexedAsset(
      buildIndexedAsset({ kind: "image", image: buildImageCache(210) }),
    );
    expect(asset.coverIsLight).toBe(true);
  });

  it("flags a dark bottom strip as not light", () => {
    const asset = mapIndexedAsset(buildIndexedAsset({ kind: "image", image: buildImageCache(40) }));
    expect(asset.coverIsLight).toBe(false);
  });

  it("leaves coverIsLight undefined when luma was never captured", () => {
    const asset = mapIndexedAsset(
      buildIndexedAsset({ kind: "image", image: buildImageCache(null) }),
    );
    expect(asset.coverIsLight).toBeUndefined();
  });
});

describe("mapIndexedAsset original image fallback", () => {
  it.each(["svg", "avif"])("uses the original %s file when no thumbnail exists", (extension) => {
    const asset = mapIndexedAsset(
      buildIndexedAsset({
        extension,
        fileName: `cover.${extension}`,
        relativePath: `media/cover.${extension}`,
        image: null,
      }),
    );

    expect(asset.thumbnailUrl).toBe(asset.mediaUrl);
    expect(asset.thumbnailStatus).toBe("ready");
  });

  it("uses a small raster source when the indexer marks it as original", () => {
    const image = {
      ...buildImageCache(180),
      width: 480,
      height: 320,
      thumbnailPath: null,
      thumbnailWidth: 480,
      thumbnailHeight: 320,
      thumbnailFormat: "original",
    };
    const asset = mapIndexedAsset(buildIndexedAsset({ image }));

    expect(asset.thumbnailUrl).toBe(asset.mediaUrl);
    expect(asset.thumbnailStatus).toBe("ready");
  });
});

describe("mapIndexedAsset web OG cover", () => {
  it("renders a web asset with a cached OG image as a cover with domain", () => {
    const asset = mapIndexedAsset(
      buildIndexedAsset({
        kind: "web",
        image: buildImageCache(90),
        web: {
          url: "https://www.inkandswitch.com/local-first/",
          domain: "inkandswitch.com",
          siteName: "Ink & Switch",
        },
      }),
    );

    expect(asset.kind).toBe("web");
    expect(asset.ogImage).toBe(true);
    expect(asset.thumbnailUrl).toBeTruthy();
    expect(asset.domain).toBe("inkandswitch.com");
    expect(asset.coverIsLight).toBe(false);
  });

  it("falls back to a plain web asset without an OG image", () => {
    const asset = mapIndexedAsset(
      buildIndexedAsset({
        kind: "web",
        web: { url: "https://example.com/page", domain: null, siteName: null },
      }),
    );

    expect(asset.ogImage).toBe(false);
    expect(asset.thumbnailUrl).toBeUndefined();
    expect(asset.domain).toBe("example.com");
  });
});
