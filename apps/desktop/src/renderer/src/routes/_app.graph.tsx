import { createFileRoute } from "@tanstack/react-router";

import { KnowledgeGraphPage } from "@/components/knowledge-graph-page";

export const Route = createFileRoute("/_app/graph")({
  component: KnowledgeGraphPage,
});
