/**
 * @purpose Register the asset home route in the file-based TanStack Router tree.
 * @role    Renderer route module that connects URL state to the matching page component.
 * @deps    TanStack Router createFileRoute and desktop page/layout components.
 * @gotcha  Route IDs and filenames drive routeTree.gen.ts; keep paths aligned with navigation links.
 */

import { createFileRoute } from "@tanstack/react-router";

import { AssetManagerPage } from "@/pages/asset-manager/asset-manager-page";

type AssetIndexSearch = { i?: number; o?: number };

export const Route = createFileRoute("/_app/")({
  component: AssetManagerPage,
  // Persist the asset list's top item index (+ offset into it) so back-navigation restores scroll.
  validateSearch: (search: Record<string, unknown>): AssetIndexSearch => {
    const result: AssetIndexSearch = {};
    const i = Number(search.i);
    if (Number.isInteger(i) && i > 0) {
      result.i = i;
    }
    const o = Number(search.o);
    if (Number.isFinite(o) && o > 0) {
      result.o = Math.round(o);
    }
    return result;
  },
});
