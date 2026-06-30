/**
 * @purpose Bridge the router's navigation history into jotai-readable back/forward availability.
 * @role    Shared store consumed by useHistoryNavigation / WindowChromeNav (and any future consumer).
 * @deps    jotai, the router singleton (lib/router), TanStack history `__TSR_index` + subscribe action.
 * @gotcha  REPLACE navigations (e.g. the asset list scroll `?i/o`) do not change the index, so they
 *          never affect back/forward state. A PUSH truncates the forward chain (resets `top`).
 */

import { atom } from "jotai";

import { router } from "@/lib/router";

type NavState = {
  /** Absolute navigation index for the current entry (TanStack `__TSR_index`). */
  index: number;
  /** Highest index reachable in the current forward chain. `index < top` ⇒ can go forward. */
  top: number;
};

function readIndex(): number {
  const state = router.history.location.state as { __TSR_index?: number };
  return state.__TSR_index ?? 0;
}

const historyNavAtom = atom<NavState>({ index: 0, top: 0 });

historyNavAtom.onMount = (set) => {
  const sync = (actionType?: string) => {
    const index = readIndex();
    set((prev) => ({
      index,
      // PUSH starts a new branch and truncates any forward entries → reset top to the new index.
      top: actionType === "PUSH" ? index : Math.max(prev.top, index),
    }));
  };

  sync();
  return router.history.subscribe(({ action }) => sync(action.type));
};

export const canGoBackAtom = atom((get) => get(historyNavAtom).index > 0);

export const canGoForwardAtom = atom((get) => {
  const { index, top } = get(historyNavAtom);
  return index < top;
});
