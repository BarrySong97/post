/**
 * @purpose Soft-open / close asset detail without unmounting the asset board.
 * @role    Shared navigation helper for board cards, graph, CLI asset-detail.open, and deep links.
 * @deps    TanStack router singleton (hash history).
 * @gotcha  Soft detail lives on `/` as search `asset=<id>` so the board route instance stays mounted.
 *          Prefer history.back() when closing so Forward reopens the same overlay entry.
 */

import { router } from "@/lib/router";

export type OpenAssetDetailOptions = {
  /** When true, replace the current history entry (e.g. switching assets inside the overlay). */
  replace?: boolean;
};

/**
 * Soft-open asset detail on the home route. Pushes a history entry by default so Back closes it.
 */
export function openAssetDetail(assetId: string, options?: OpenAssetDetailOptions) {
  const id = assetId.trim();
  if (!id) {
    return;
  }

  const replace = options?.replace ?? false;
  const current = router.state.location;
  const currentAsset =
    typeof current.search === "object" && current.search && "asset" in current.search
      ? String((current.search as { asset?: string }).asset ?? "")
      : "";

  // Already showing this asset on home — no-op.
  if (current.pathname === "/" && currentAsset === id && !replace) {
    return;
  }

  // Switching asset while already on a soft-detail home entry: replace to avoid stack spam.
  const shouldReplace =
    replace || (current.pathname === "/" && Boolean(currentAsset) && currentAsset !== id);

  void router.navigate({
    to: "/",
    replace: shouldReplace,
    search: (prev) => {
      const next = { ...(prev as Record<string, unknown>) };
      next.asset = id;
      // Drop legacy scroll keys if any remain in the URL.
      delete next.i;
      delete next.o;
      return next;
    },
  });
}

/**
 * Close soft detail. Prefer back when the previous entry can restore the board-only URL.
 */
export function closeAssetDetail() {
  const current = router.state.location;
  const currentAsset =
    typeof current.search === "object" && current.search && "asset" in current.search
      ? String((current.search as { asset?: string }).asset ?? "")
      : "";

  if (current.pathname !== "/" || !currentAsset) {
    void router.navigate({ to: "/" });
    return;
  }

  // If we can go back, pop the soft-open entry (board was under it and stays mounted).
  const index =
    typeof current.state === "object" &&
    current.state &&
    "__TSR_index" in current.state &&
    typeof (current.state as { __TSR_index?: number }).__TSR_index === "number"
      ? (current.state as { __TSR_index: number }).__TSR_index
      : 0;

  if (index > 0) {
    router.history.back();
    return;
  }

  void router.navigate({
    to: "/",
    replace: true,
    search: (prev) => {
      const next = { ...(prev as Record<string, unknown>) };
      delete next.asset;
      delete next.i;
      delete next.o;
      return next;
    },
  });
}
