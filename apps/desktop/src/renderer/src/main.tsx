/**
 * @purpose Mount the React renderer and wire global styles, providers, and the router.
 * @role    Renderer entrypoint that composes TRPCProvider + RouterProvider into the DOM root.
 * @deps    @post/ui styles, React DOM, TanStack RouterProvider, i18n, TRPCProvider.
 * @gotcha  The router lives in lib/router.ts (so stores can import it); do not hand-edit routeTree.gen.ts.
 *          Import `@/i18n` before render so useTranslation works on first paint.
 */

import "@post/ui/styles.css";
import "@/i18n";

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
