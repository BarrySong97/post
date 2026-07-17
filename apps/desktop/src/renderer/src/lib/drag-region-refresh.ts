/**
 * @purpose Force Chromium to recollect and re-send -webkit-app-region draggable regions.
 * @role    Renderer workaround for stale native drag-region snapshots (electron#21034 family).
 * @deps    DOM only (no React); installed once from AppShell.
 * @gotcha  The main process caches drag regions as a static SkRegion snapshot and never recomputes
 *          it on window resize — it waits for Blink to re-send. Blink only re-sends when the
 *          collected region list changes, so after some resize/focus sequences the native snapshot
 *          goes stale and top-chrome dragging dies per element. The probe's 1px layout toggle is a
 *          guaranteed region change that forces a fresh full-document collection in a quiet frame.
 *          The probe must be app-region: drag (adds a rect; a no-drag probe would punch a hole).
 */

let probe: HTMLDivElement | null = null;
let probeTall = false;
let nudgeToken = 0;

function ensureProbe(): HTMLDivElement {
  if (probe && probe.isConnected) {
    return probe;
  }

  const element = document.createElement("div");
  element.setAttribute("aria-hidden", "true");
  element.style.position = "fixed";
  element.style.left = "0";
  element.style.top = "0";
  element.style.width = "1px";
  element.style.height = "1px";
  element.style.opacity = "0";
  element.style.pointerEvents = "none";
  element.style.setProperty("-webkit-app-region", "drag");
  document.body.appendChild(element);
  probe = element;
  return element;
}

/**
 * Toggle the probe's height so the document's draggable-region list is guaranteed to differ from
 * the last one Blink sent. Blink then recollects every region from the current layout and pushes
 * the fresh list to the main process, replacing any stale snapshot.
 */
export function refreshDragRegions(): void {
  const element = ensureProbe();
  nudgeToken += 1;
  const token = nudgeToken;

  probeTall = !probeTall;
  element.style.height = probeTall ? "2px" : "1px";

  // Revert after the toggled layout has been committed and collected; the revert itself triggers
  // one more collection, so the final snapshot always reflects the settled layout.
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      if (token !== nudgeToken) {
        return;
      }
      probeTall = !probeTall;
      element.style.height = probeTall ? "2px" : "1px";
    });
  });
}

const RESIZE_SETTLE_MS = 150;
const FOCUS_SETTLE_MS = 50;

/**
 * Refresh drag regions after the situations known to leave the native snapshot stale: live window
 * resizes (debounced until the resize settles) and app switches (focus / tab becoming visible).
 * Returns a cleanup function; safe to install once for the app's lifetime.
 */
export function installDragRegionRefresh(): () => void {
  let timer: ReturnType<typeof setTimeout> | null = null;

  const schedule = (delayMs: number) => {
    if (timer !== null) {
      clearTimeout(timer);
    }
    timer = setTimeout(() => {
      timer = null;
      refreshDragRegions();
    }, delayMs);
  };

  const onResize = () => schedule(RESIZE_SETTLE_MS);
  const onFocus = () => schedule(FOCUS_SETTLE_MS);
  const onVisibilityChange = () => {
    if (document.visibilityState === "visible") {
      schedule(FOCUS_SETTLE_MS);
    }
  };

  window.addEventListener("resize", onResize);
  window.addEventListener("focus", onFocus);
  document.addEventListener("visibilitychange", onVisibilityChange);

  return () => {
    window.removeEventListener("resize", onResize);
    window.removeEventListener("focus", onFocus);
    document.removeEventListener("visibilitychange", onVisibilityChange);
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
    if (probe?.isConnected) {
      probe.remove();
    }
    probe = null;
  };
}
