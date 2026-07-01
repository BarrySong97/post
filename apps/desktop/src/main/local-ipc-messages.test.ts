/**
 * @purpose Verify local-IPC live command validation used by the socket server.
 * @role    Vitest coverage for the filter and asset wire contract accepted from post-cli.
 * @deps    vitest, local-ipc-messages, shared asset-list/saved-view contracts.
 * @gotcha  Keep the wire canonical/id-based; these schemas are the trust boundary for external input.
 */

import { describe, expect, it } from "vitest";

import { commandMessageSchema } from "./local-ipc-messages";

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
      expect(result.sort).toBe("updated_desc");
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
