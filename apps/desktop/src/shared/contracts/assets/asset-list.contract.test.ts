/**
 * @purpose Verify shared asset-list contracts used across renderer and main process code.
 * @role    Vitest smoke coverage for the new TypeScript unit-test baseline.
 * @deps    vitest, asset-list.contract.
 * @gotcha  Keep this test browser-safe; shared contracts must not depend on Electron or SQLite.
 */

import { describe, expect, it } from "vitest";

import { ASSET_LIST_DEFAULT_LIMIT, assetListInputSchema } from "./asset-list.contract";

describe("assetListInputSchema", () => {
  it("accepts omitted input for the active vault default list", () => {
    expect(assetListInputSchema.parse(undefined)).toBeUndefined();
  });

  it("accepts image filters with the default paging contract", () => {
    const result = assetListInputSchema.parse({
      typeFilters: ["image"],
      limit: ASSET_LIST_DEFAULT_LIMIT,
      sort: "updated_desc",
    });

    expect(result?.typeFilters).toEqual(["image"]);
    expect(result?.limit).toBe(ASSET_LIST_DEFAULT_LIMIT);
  });

  it("rejects limits above the shared maximum", () => {
    expect(() => assetListInputSchema.parse({ limit: 1_000 })).toThrow();
  });
});
