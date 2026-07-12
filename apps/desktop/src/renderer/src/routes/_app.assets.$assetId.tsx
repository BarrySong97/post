/**
 * @purpose Deep-link entry for a single asset; soft-redirects into home search overlay.
 * @role    Renderer route module that connects URL state to the matching page component.
 * @deps    TanStack Router createFileRoute and openAssetDetail helper.
 * @gotcha  Always replace-redirect to `/?asset=` so detail and board share one home route instance.
 */

import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/_app/assets/$assetId")({
  beforeLoad: ({ params }) => {
    const assetId = params.assetId?.trim();
    if (!assetId) {
      throw redirect({ to: "/", replace: true });
    }

    throw redirect({
      to: "/",
      replace: true,
      search: (prev) => ({
        ...(prev as Record<string, unknown>),
        asset: assetId,
      }),
    });
  },
});
