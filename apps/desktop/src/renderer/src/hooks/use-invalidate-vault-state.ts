/**
 * @purpose Provide the use invalidate vault state React hook for renderer workflows.
 * @role    Reusable renderer hook that coordinates cache invalidation or shared UI behavior.
 * @deps    React, tRPC/React Query clients, and related renderer state.
 * @gotcha  Keep invalidation keys aligned with the router procedures that populate the affected views.
 */

import { useCallback } from "react";
import { useQueryClient } from "@tanstack/react-query";

import { trpc } from "@/lib/trpc";

export function useInvalidateVaultState() {
  const queryClient = useQueryClient();

  return useCallback(async () => {
    await Promise.all([
      queryClient.invalidateQueries(trpc.assets.sidebarMeta.queryFilter()),
      queryClient.invalidateQueries(trpc.assets.list.queryFilter()),
      queryClient.invalidateQueries(trpc.assets.list.infiniteQueryFilter()),
      queryClient.invalidateQueries(trpc.assets.byId.queryFilter()),
      queryClient.invalidateQueries(trpc.assets.markdownContent.queryFilter()),
      queryClient.invalidateQueries(trpc.assets.vaults.queryFilter()),
      queryClient.invalidateQueries(trpc.tasks.snapshot.queryFilter()),
    ]);
  }, [queryClient]);
}
