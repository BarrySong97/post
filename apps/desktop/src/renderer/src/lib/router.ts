/**
 * @purpose Create and export the singleton TanStack Router instance for the renderer.
 * @role    Shared router singleton consumed by main.tsx (RouterProvider) and jotai history atoms.
 * @deps    TanStack Router, generated routeTree.
 * @gotcha  Keep this side-effect-free (no createRoot here) so atoms/stores can import the router safely.
 */

import { createHashHistory, createRouter } from "@tanstack/react-router";

import { routeTree } from "@/routeTree.gen";

export const router = createRouter({
  routeTree,
  history: createHashHistory(),
  defaultPreload: "intent",
  scrollRestoration: true,
});

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}
