import { createFileRoute } from "@tanstack/react-router";

import { ViewsManagementPage } from "@/components/views-management-page";

export const Route = createFileRoute("/_app/views")({
  component: ViewsManagementPage,
});
