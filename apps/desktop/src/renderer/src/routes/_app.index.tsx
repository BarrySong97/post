/**
 * @purpose Register the asset home route in the file-based TanStack Router tree.
 * @role    Renderer route module that connects URL state to the matching page component.
 * @deps    TanStack Router createFileRoute and desktop page/layout components.
 * @gotcha  Route IDs and filenames drive routeTree.gen.ts; keep paths aligned with navigation links.
 */

import { createFileRoute } from "@tanstack/react-router";

import { AssetManagerPage } from "@/pages/asset-manager/asset-manager-page";

export const Route = createFileRoute("/_app/")({
  component: AssetManagerPage,
});
