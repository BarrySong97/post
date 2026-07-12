/**
 * @purpose Persistent top-left window toolbar: sidebar toggle + route back/forward.
 * @role    Window-level overlay rendered once by AppLayout; stays next to the macOS traffic lights
 *          in both expanded and collapsed sidebar states.
 * @deps    HeroUI Button, lucide icons, useHistoryNavigation, platform helper.
 * @gotcha  MUST be rendered DOM-last in AppLayout: Chromium resolves `-webkit-app-region` in layout
 *          (DOM) order, not z-index, so the `window-no-drag` buttons only stay clickable if they are
 *          composited AFTER every overlapping `window-drag` region (page header + drag overlays).
 *          Keep CHROME_NAV geometry in sync with the collapsed-header spacer.
 */

import { useLayoutEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { ArrowLeft, ArrowRight, PanelLeftClose, PanelLeftOpen } from "lucide-react";
import { Button } from "@heroui/react";

import { useHistoryNavigation } from "@/hooks/use-history-navigation";
import { isMacWindow } from "@/lib/platform";

const TRAFFIC_LIGHT_SAFE_ZONE_PX = 100;
const NON_MAC_SAFE_ZONE_PX = 12; // pl-3
const TOOLBAR_BUTTONS_PX = 104; // three 32px icon buttons + two 4px gaps
const TITLE_GAP_PX = 12; // breathing room between toolbar and the page title
const HEADER_NATURAL_PADDING_PX = 24; // page headers use px-6

/**
 * Absolute left offset (from the window edge) the toolbar occupies — the window x past which a
 * collapsed-state page title must start so it clears the toolbar.
 */
export function collapsedHeaderInsetPx(): number {
  const safeZone = isMacWindow() ? TRAFFIC_LIGHT_SAFE_ZONE_PX : NON_MAC_SAFE_ZONE_PX;
  return safeZone + TOOLBAR_BUTTONS_PX + TITLE_GAP_PX;
}

/**
 * Ref for a page header whose title must clear the persistent toolbar.
 *
 * The title's window x is `headerLeftEdge + paddingLeft`, and the header's left edge is the
 * resizable panel's left edge — which the sidebar collapse animates on a non-linear flex-grow
 * curve. So the title must *follow* the panel, never run its own tween: a CSS/rAF/Motion animation
 * racing the panel desyncs from that curve and visibly flashes. A single ResizeObserver reports the
 * header's real border-box every frame the panel resizes it — passively, after layout, so we never
 * force a sync layout or read the collapsed final value early (the old per-toggle measurement did,
 * which was the flash). `paddingLeft = max(natural, toolbarRight − liveLeftEdge)` clamps the title
 * just past the toolbar, frame-locked to the panel. (paddingLeft is inside the border box, so it
 * never changes the observed border-box — no feedback loop.)
 */
export function useToolbarClearance() {
  const ref = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) {
      return undefined;
    }

    const clearance = collapsedHeaderInsetPx();
    const apply = () => {
      const edge = el.getBoundingClientRect().left;
      el.style.paddingLeft = `${Math.max(HEADER_NATURAL_PADDING_PX, clearance - edge)}px`;
    };

    apply();
    const observer = new ResizeObserver(apply);
    observer.observe(el, { box: "border-box" });
    return () => observer.disconnect();
  }, []);

  return ref;
}

const ICON_BUTTON_CLASS = "window-no-drag h-8 w-8 text-zinc-500 hover:bg-black/5";

export function WindowChromeNav({
  sidebarCollapsed,
  onToggleSidebar,
}: {
  sidebarCollapsed: boolean;
  onToggleSidebar: () => void;
}) {
  const { t } = useTranslation();
  const { canGoBack, canGoForward, goBack, goForward } = useHistoryNavigation();
  const ToggleIcon = sidebarCollapsed ? PanelLeftOpen : PanelLeftClose;
  const safeZonePadding = isMacWindow() ? "pl-[100px]" : "pl-3";

  return (
    // pointer-events-none wrapper so the draggable strip behind stays draggable through the safe
    // zone and the gaps between buttons; only the buttons (window-no-drag) capture events. This must
    // be the DOM-last child in AppLayout so the no-drag region wins over the header's window-drag.
    <div
      className={`pointer-events-none absolute left-0 top-0 z-[90] flex h-10 items-center ${safeZonePadding}`}
    >
      <div className="window-no-drag pointer-events-auto -ml-1 inline-flex items-center gap-1">
        <Button
          isIconOnly
          aria-label={sidebarCollapsed ? t("nav.expandSidebar") : t("nav.collapseSidebar")}
          data-no-drag
          size="sm"
          variant="ghost"
          className={ICON_BUTTON_CLASS}
          onPress={onToggleSidebar}
        >
          <ToggleIcon size={19} />
        </Button>
        <Button
          isIconOnly
          aria-label={t("nav.back")}
          data-no-drag
          size="sm"
          variant="ghost"
          isDisabled={!canGoBack}
          className={`${ICON_BUTTON_CLASS} disabled:opacity-35`}
          onPress={goBack}
        >
          <ArrowLeft size={18} />
        </Button>
        <Button
          isIconOnly
          aria-label={t("nav.forward")}
          data-no-drag
          size="sm"
          variant="ghost"
          isDisabled={!canGoForward}
          className={`${ICON_BUTTON_CLASS} disabled:opacity-35`}
          onPress={goForward}
        >
          <ArrowRight size={18} />
        </Button>
      </div>
    </div>
  );
}
