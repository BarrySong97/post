/**
 * @purpose Register the root route provider in the file-based TanStack Router tree.
 * @role    Renderer route module that connects URL state to the matching page component.
 * @deps    TanStack Router createFileRoute and desktop page/layout components.
 * @gotcha  Route IDs and filenames drive routeTree.gen.ts; keep paths aligned with navigation links.
 */

import { Outlet, createRootRoute } from "@tanstack/react-router";

import { AppShell } from "@/components/layout/app-shell";

export const Route = createRootRoute({
  component: () => (
    <AppShell>
      <Outlet />
    </AppShell>
  ),
});
