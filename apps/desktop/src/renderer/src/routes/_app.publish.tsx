import { createFileRoute } from "@tanstack/react-router";

import { PublishPage } from "@/components/publish-page";

export const Route = createFileRoute("/_app/publish")({
  component: PublishPage,
});
