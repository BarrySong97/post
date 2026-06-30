/**
 * @purpose Expose router back/forward availability + actions as a small renderer hook.
 * @role    Thin wrapper over history-nav atoms + the router singleton for nav UI (WindowChromeNav).
 * @deps    jotai, the router singleton (lib/router), history-nav atoms.
 * @gotcha  canGoForward is derived from a self-tracked index (see history-nav-atoms); goBack/goForward
 *          delegate straight to the router history.
 */

import { useAtomValue } from "jotai";

import { router } from "@/lib/router";
import { canGoBackAtom, canGoForwardAtom } from "@/store/history-nav-atoms";

export function useHistoryNavigation() {
  return {
    canGoBack: useAtomValue(canGoBackAtom),
    canGoForward: useAtomValue(canGoForwardAtom),
    goBack: () => router.history.back(),
    goForward: () => router.history.forward(),
  };
}
