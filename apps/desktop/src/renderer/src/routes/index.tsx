import { createFileRoute } from "@tanstack/react-router";

import { AssetManagerPage } from "@/components/asset-manager-page";

export const Route = createFileRoute("/")({
  component: AssetManagerPage,
});
