/**
 * @purpose Drive router back/forward from every input a user's mouse/keyboard might produce.
 * @role    Global input hook mounted once by AppLayout so back/forward works app-wide, mirroring
 *          the arrow buttons in WindowChromeNav.
 * @deps    useHistoryNavigation (router history + canGoBack/canGoForward atoms), window.api IPC bridge.
 * @gotcha  macOS bare mouse side buttons emit NO DOM event and NO app-command (that event is
 *          Windows/Linux only). Depending on the mouse driver they surface as: a `swipe` gesture
 *          (forwarded from main via IPC), DOM button 3/4, or ⌘[ / ⌘] / Alt+Arrow keys — so we
 *          listen for all of them. Listeners use the capture phase so drag/@dnd-kit handlers that
 *          stopPropagation can't swallow them first. Preload changes need an Electron restart.
 */

import { useEffect } from "react";

import { useHistoryNavigation } from "@/hooks/use-history-navigation";

// DOM MouseEvent.button: 3 = back (X1), 4 = forward (X2).
const MOUSE_BUTTON_BACK = 3;
const MOUSE_BUTTON_FORWARD = 4;

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) {
    return false;
  }
  return (
    target.isContentEditable ||
    target.tagName === "INPUT" ||
    target.tagName === "TEXTAREA" ||
    target.tagName === "SELECT"
  );
}

export function useHistoryNavigationShortcuts() {
  const { canGoBack, canGoForward, goBack, goForward } = useHistoryNavigation();

  useEffect(() => {
    const back = () => {
      if (canGoBack) goBack();
    };
    const forward = () => {
      if (canGoForward) goForward();
    };

    // (1) OS-level inputs forwarded from the main process: Windows/Linux mouse side buttons
    // (app-command) and macOS swipe / driver-mapped navigation gestures. See main/bootstrap/window.ts.
    const offIpc = window.api.onHistoryNavigate?.((direction) => {
      if (direction === "back") back();
      else forward();
    });

    // (2) Mouse side buttons that do reach the DOM (most platforms/drivers).
    const handleMouseUp = (event: MouseEvent) => {
      if (event.button === MOUSE_BUTTON_BACK) {
        event.preventDefault();
        back();
      } else if (event.button === MOUSE_BUTTON_FORWARD) {
        event.preventDefault();
        forward();
      }
    };

    // (3) Keyboard: the macOS system standard (⌘[ / ⌘]) and the Alt+Arrow mapping many mouse
    // drivers emit for their back/forward buttons. Skipped while typing in an editable field.
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.repeat || isEditableTarget(event.target)) {
        return;
      }

      const withCmdOrCtrl = event.metaKey || event.ctrlKey;
      if (withCmdOrCtrl && !event.altKey && !event.shiftKey && event.key === "[") {
        event.preventDefault();
        back();
        return;
      }
      if (withCmdOrCtrl && !event.altKey && !event.shiftKey && event.key === "]") {
        event.preventDefault();
        forward();
        return;
      }
      if (event.altKey && !event.metaKey && !event.ctrlKey && event.key === "ArrowLeft") {
        event.preventDefault();
        back();
        return;
      }
      if (event.altKey && !event.metaKey && !event.ctrlKey && event.key === "ArrowRight") {
        event.preventDefault();
        forward();
      }
    };

    window.addEventListener("mouseup", handleMouseUp, { capture: true });
    window.addEventListener("keydown", handleKeyDown, { capture: true });
    return () => {
      offIpc?.();
      window.removeEventListener("mouseup", handleMouseUp, { capture: true });
      window.removeEventListener("keydown", handleKeyDown, { capture: true });
    };
  }, [canGoBack, canGoForward, goBack, goForward]);
}
