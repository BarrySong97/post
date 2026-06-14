/**
 * @purpose Register the authenticated app layout route in the file-based TanStack Router tree.
 * @role    Renderer route module that connects URL state to the matching page component.
 * @deps    TanStack Router createFileRoute and desktop page/layout components.
 * @gotcha  Route IDs and filenames drive routeTree.gen.ts; keep paths aligned with navigation links.
 */

import { Outlet, createFileRoute } from "@tanstack/react-router";

import { AppLayout } from "@/components/layout/app-layout";

export const Route = createFileRoute("/_app")({
  component: AppLayoutRoute,
});

function AppLayoutRoute() {
  return (
    <AppLayout>
      <Outlet />
    </AppLayout>
  );
}
