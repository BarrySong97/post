/**
 * @purpose Soft-open / close asset detail without unmounting the asset board.
 * @role    Shared navigation helper for board cards, graph, CLI asset-detail.open, and deep links.
 * @deps    TanStack router singleton (hash history).
 * @gotcha  Soft detail lives on `/` as search `asset=<id>` so the board route instance stays mounted.
 *          Prefer history.back() when closing so Forward reopens the same overlay entry.
 *          Sidebar / filter navigation must call ensureAssetBoardVisible() — staying on `/` with
 *          `asset=` set keeps the overlay, so filter-only atom updates are invisible.
 */

import { router } from "@/lib/router";

export type OpenAssetDetailOptions = {
  /** When true, replace the current history entry (e.g. switching assets inside the overlay). */
  replace?: boolean;
};

function readSoftDetailAssetId(search: unknown): string {
  if (typeof search === "object" && search && "asset" in search) {
    return String((search as { asset?: string }).asset ?? "").trim();
  }
  return "";
}

function boardSearchWithoutAsset(prev: unknown): Record<string, unknown> {
  const next = { ...(prev as Record<string, unknown>) };
  delete next.asset;
  // Drop legacy scroll keys if any remain in the URL.
  delete next.i;
  delete next.o;
  return next;
}

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
  const currentAsset = readSoftDetailAssetId(current.search);

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
      const next = boardSearchWithoutAsset(prev);
      next.asset = id;
      return next;
    },
  });
}

/**
 * Close soft detail. Prefer back when the previous entry can restore the board-only URL.
 */
export function closeAssetDetail() {
  const current = router.state.location;
  const currentAsset = readSoftDetailAssetId(current.search);

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
    search: boardSearchWithoutAsset,
  });
}

/**
 * Show the asset board without soft detail.
 * Used by sidebar filter items and live CLI filter commands: those only update atoms, so if the
 * URL still has `asset=<id>` the overlay stays on top and the board change is invisible.
 * When soft detail is open, replace the entry so intentional leave does not leave detail as Forward.
 * When on a non-home route, navigate to `/`.
 */
export function ensureAssetBoardVisible() {
  const current = router.state.location;
  const currentAsset = readSoftDetailAssetId(current.search);
  const onHome = current.pathname === "/";
  const hasSoftDetail = onHome && Boolean(currentAsset);

  if (onHome && !hasSoftDetail) {
    return;
  }

  void router.navigate({
    to: "/",
    // Replace soft-detail so sidebar leave is not reversible into the same overlay via Forward.
    replace: hasSoftDetail,
    search: boardSearchWithoutAsset,
  });
}
