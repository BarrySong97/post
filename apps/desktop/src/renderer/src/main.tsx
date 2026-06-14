/**
 * @purpose Mount the React renderer and configure TanStack Router for the Electron app.
 * @role    Renderer entrypoint that wires global styles, tRPC provider, and route tree.
 * @deps    @post/ui styles, React DOM, TanStack Router, TRPCProvider.
 * @gotcha  The route tree is generated; do not hand-edit routeTree.gen.ts.
 */

import "@post/ui/styles.css";

import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { RouterProvider, createHashHistory, createRouter } from "@tanstack/react-router";

import { TRPCProvider } from "./providers/trpc-provider";
import { routeTree } from "./routeTree.gen";

const router = createRouter({
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

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <TRPCProvider>
      <RouterProvider router={router} />
    </TRPCProvider>
  </StrictMode>,
);
