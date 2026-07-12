/**
 * @purpose Register the asset home route in the file-based TanStack Router tree.
 * @role    Renderer route module that connects URL state to the matching page component.
 * @deps    TanStack Router createFileRoute and desktop page/layout components.
 * @gotcha  Soft asset detail lives here as search `asset=<id>` so the board stays mounted.
 *          Route IDs and filenames drive routeTree.gen.ts; keep paths aligned with navigation links.
 */

import { createFileRoute } from "@tanstack/react-router";

import { AssetManagerPage } from "@/pages/asset-manager/asset-manager-page";

type AssetIndexSearch = { asset?: string };

export const Route = createFileRoute("/_app/")({
  component: AssetManagerPage,
  validateSearch: (search: Record<string, unknown>): AssetIndexSearch => {
    const result: AssetIndexSearch = {};
    const asset = typeof search.asset === "string" ? search.asset.trim() : "";
    if (asset.length > 0) {
      result.asset = asset;
    }
    return result;
  },
});
