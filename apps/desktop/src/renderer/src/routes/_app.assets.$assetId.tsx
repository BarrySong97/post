import { createFileRoute } from "@tanstack/react-router";

import { AssetManagerPage } from "@/components/asset-manager-page";

export const Route = createFileRoute("/_app/assets/$assetId")({
  component: AssetDetailRoute,
});

function AssetDetailRoute() {
  const { assetId } = Route.useParams();

  return <AssetManagerPage assetId={assetId} />;
}
