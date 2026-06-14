/**
 * @purpose Provide renderer trpc utilities shared across pages and components.
 * @role    Small renderer helper module outside page-specific ownership.
 * @deps    Renderer runtime, tRPC/client/provider code, platform or toast libraries as appropriate.
 * @gotcha  Keep helpers browser-safe unless they intentionally call preload-exposed APIs.
 */

import { QueryClient } from "@tanstack/react-query";
import { createTRPCClient } from "@trpc/client";
import { createTRPCOptionsProxy } from "@trpc/tanstack-react-query";
import type { inferRouterInputs, inferRouterOutputs } from "@trpc/server";

import type { AppRouter } from "@main/trpc/router";
import { ipcTRPCLink } from "./ipc-trpc-link";

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
      retry: 1,
    },
  },
});

export const trpcClient = createTRPCClient<AppRouter>({
  links: [ipcTRPCLink()],
});

export const trpc = createTRPCOptionsProxy<AppRouter>({
  client: trpcClient,
  queryClient,
});

export type RouterInputs = inferRouterInputs<AppRouter>;
export type RouterOutputs = inferRouterOutputs<AppRouter>;
export type NoteView = RouterOutputs["notes"]["list"][number];
