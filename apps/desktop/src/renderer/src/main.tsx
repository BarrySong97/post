/**
 * @purpose Mount the React renderer and wire global styles, providers, and the router.
 * @role    Renderer entrypoint that composes TRPCProvider + RouterProvider into the DOM root.
 * @deps    @post/ui styles, React DOM, TanStack RouterProvider, the router singleton, TRPCProvider.
 * @gotcha  The router lives in lib/router.ts (so stores can import it); do not hand-edit routeTree.gen.ts.
 */

import "@post/ui/styles.css";

import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { RouterProvider } from "@tanstack/react-router";

import { TRPCProvider } from "./providers/trpc-provider";
import { router } from "@/lib/router";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <TRPCProvider>
      <RouterProvider router={router} />
    </TRPCProvider>
  </StrictMode>,
);
