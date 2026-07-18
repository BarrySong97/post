/**
 * @purpose Verify local-IPC live command and bookmark validation used by the socket server.
 * @role    Vitest coverage for post-cli commands and extension bookmark wire contracts.
 * @deps    vitest, local-ipc-messages, shared asset-list/saved-view contracts.
 * @gotcha  Keep the wire canonical/id-based; these schemas are the trust boundary for external input.
 */

import { describe, expect, it } from "vitest";

import {
  commandMessageSchema,
  extensionBookmarkLookupMessageSchema,
  extensionBookmarkSaveMessageSchema,
} from "./local-ipc-messages";

const dbPath = "/tmp/post-dev.sqlite";

describe("commandMessageSchema", () => {
  it("accepts an ad-hoc apply message and fills filter defaults", () => {
    const result = commandMessageSchema.parse({
      type: "filter.apply",
      source: "post-cli",
      dbPath,
      filters: { types: ["image"], status: "inbox" },
    });

    expect(result.type).toBe("filter.apply");
    if (result.type === "filter.apply") {
      expect(result.filters.types).toEqual(["image"]);
      expect(result.filters.match).toBe("and");
      expect(result.filters.tagIds).toEqual([]);
      expect(result.sort).toBe("added_desc");
    }
  });

  it("accepts activateView, selectSidebar, clear, get, and asset.open messages", () => {
    expect(
      commandMessageSchema.parse({
        type: "filter.activateView",
        source: "post-cli",
        dbPath,
        viewId: "view_1",
      }).type,
    ).toBe("filter.activateView");

    expect(
      commandMessageSchema.parse({
        type: "filter.selectSidebar",
        source: "post-cli",
        dbPath,
        item: { kind: "tag", id: "tag_1" },
      }).type,
    ).toBe("filter.selectSidebar");

    expect(
      commandMessageSchema.parse({ type: "filter.clear", source: "post-cli", dbPath }).type,
    ).toBe("filter.clear");

    expect(
      commandMessageSchema.parse({ type: "filter.get", source: "post-cli", dbPath }).type,
    ).toBe("filter.get");

    const open = commandMessageSchema.parse({
      type: "asset.open",
      source: "post-cli",
      dbPath,
      assetId: "asset_1",
    });
    expect(open.type).toBe("asset.open");
    if (open.type === "asset.open") {
      expect(open.assetId).toBe("asset_1");
    }
  });

  it("rejects a foreign source, invalid filter enums, unknown sidebar kinds, and empty assetId", () => {
    expect(() =>
      commandMessageSchema.parse({ type: "filter.clear", source: "someone-else", dbPath }),
    ).toThrow();

    expect(() =>
      commandMessageSchema.parse({
        type: "filter.apply",
        source: "post-cli",
        dbPath,
        filters: { types: ["bogus"] },
      }),
    ).toThrow();

    expect(() =>
      commandMessageSchema.parse({
        type: "filter.selectSidebar",
        source: "post-cli",
        dbPath,
        item: { kind: "view", id: "view_1" },
      }),
    ).toThrow();

    expect(() =>
      commandMessageSchema.parse({ type: "asset.open", source: "post-cli", dbPath, assetId: "" }),
    ).toThrow();
  });
});

describe("extension bookmark messages", () => {
  const capture = {
    kind: "youtube" as const,
    videoId: "video123",
    canonicalUrl: "https://www.youtube.com/watch?v=video123",
    pageUrl: "https://www.youtube.com/shorts/video123",
    sourceTitle: "Video",
    capturedAt: 1_700_000_000_000,
  };

  it("accepts typed lookup and multi-tag save requests", () => {
    expect(
      extensionBookmarkLookupMessageSchema.parse({
        type: "extension.bookmark.lookup",
        source: "post-extension",
        dbPath,
        capture,
      }).capture.kind,
    ).toBe("youtube");

    const saved = extensionBookmarkSaveMessageSchema.parse({
      type: "extension.bookmark.save",
      source: "post-extension",
      dbPath,
      capture,
      titleOverride: "Project title",
      note: "Watch later",
      tagIds: ["tag-a", "tag-b"],
      action: "copy",
    });
    expect(saved.tagIds).toEqual(["tag-a", "tag-b"]);
    expect(saved.action).toBe("copy");
  });

  it("rejects malformed page metadata at the Desktop boundary", () => {
    expect(() =>
      extensionBookmarkSaveMessageSchema.parse({
        type: "extension.bookmark.save",
        source: "post-extension",
        dbPath,
        capture: { ...capture, canonicalUrl: "not-a-url" },
        action: "create",
      }),
    ).toThrow();
  });
});
