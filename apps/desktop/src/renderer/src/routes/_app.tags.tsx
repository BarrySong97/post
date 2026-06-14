import { createFileRoute } from "@tanstack/react-router";

import { TagsManagementPage } from "@/components/tags-management-page";

export const Route = createFileRoute("/_app/tags")({
  component: TagsManagementPage,
});
