import { useCallback } from "react";
import { useQueryClient } from "@tanstack/react-query";

import { trpc } from "@/lib/trpc";

export function useInvalidateVaultState() {
  const queryClient = useQueryClient();

  return useCallback(async () => {
    await Promise.all([
      queryClient.invalidateQueries(trpc.assets.list.queryFilter()),
      queryClient.invalidateQueries(trpc.assets.markdownContent.queryFilter()),
      queryClient.invalidateQueries(trpc.assets.vaults.queryFilter()),
      queryClient.invalidateQueries(trpc.tasks.snapshot.queryFilter()),
    ]);
  }, [queryClient]);
}
