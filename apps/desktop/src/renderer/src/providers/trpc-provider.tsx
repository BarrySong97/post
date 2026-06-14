/**
 * @purpose Provide tRPC and React Query clients to the renderer tree.
 * @role    Renderer data-layer provider for all tRPC hooks.
 * @deps    @tanstack/react-query, @trpc/tanstack-react-query, ipc-trpc-link.
 * @gotcha  Client setup must stay compatible with the Electron IPC link, not an HTTP transport.
 */

import type { ReactNode } from "react";
import { QueryClientProvider } from "@tanstack/react-query";

import { queryClient } from "@renderer/lib/trpc";

export function TRPCProvider({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}
