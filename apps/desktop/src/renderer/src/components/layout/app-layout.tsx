/**
 * @purpose Render the app layout surface for the desktop renderer.
 * @role    App-level React component composed by routes, shell, or shared workflows.
 * @deps    React, HeroUI/local UI primitives, tRPC hooks, and shared renderer modules as needed.
 * @gotcha  Keep operational layouts dense and aligned with design.md icon and panel sizing rules.
 */

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { motion } from "motion/react";
import type { PanelImperativeHandle } from "react-resizable-panels";

import { trpc } from "@/lib/trpc";
import {
  SIDEBAR_COLLAPSED_STORAGE_KEY,
  SIDEBAR_MIN_WIDTH_PX,
  SIDEBAR_WIDTH_STORAGE_KEY,
} from "@/lib/asset-manager/storage";
import type { AssetSummary, SidebarTag, SidebarView } from "@/lib/asset-manager/types";
import { TagFormModal, ViewFormModal } from "@/components/asset-manager/asset-management-modals";
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable";
import {
  Sidebar,
  SidebarEdgeHotspot,
  FloatingSidebarDragOverlay,
  syncWindowControlsWithSidebar,
  getSidebarPreviewWidth,
  SIDEBAR_PREVIEW_EXIT_PADDING,
} from "@/components/layout/sidebar/sidebar";
import {
  AppLayoutContext,
  useAppLayout,
  type AppLayoutContextValue,
} from "@/components/layout/app-layout-context";
import { WindowChromeNav, useToolbarClearance } from "@/components/layout/window-chrome-nav";

export { useAppLayout };

/**
 * The shared top chrome bar for a page rendered inside {@link AppLayout}'s main
 * panel. Mirrors the asset board header exactly (`h-14`, starts at top-0, the
 * whole bar is a window drag region) so the draggable area is identical across
 * every page. Non-interactive `children` (titles) ride along as drag surface;
 * wrap any clickable element in `window-no-drag`.
 */
export function PageChrome({ children }: { children?: ReactNode }) {
  const { backgroundWindowDragEnabled } = useAppLayout();
  const dragClassName = backgroundWindowDragEnabled ? "window-drag" : "window-no-drag";
  const headerRef = useToolbarClearance();

  return (
    <div
      ref={headerRef}
      className={`${dragClassName} relative z-[75] flex h-10 shrink-0 items-center gap-2.5 border-b border-zinc-100 bg-white px-6`}
    >
      {children}
    </div>
  );
}

const EMPTY_SUMMARY: AssetSummary & { untagged: number } = {
  total: 0,
  untagged: 0,
  inbox: 0,
  organized: 0,
  draft: 0,
  published: 0,
  archived: 0,
};

type SidebarTagModalState = { kind: "create" } | { kind: "edit"; tag: SidebarTag };

type SidebarViewModalState = { kind: "create" } | { kind: "edit"; view: SidebarView };

/**
 * The shared application shell: a persistent sidebar that switches the route
 * rendered in the right-hand main panel. The sidebar (and all of its
 * collapse / floating-preview / traffic-light behaviour) lives here once, so it
 * is never re-mounted on navigation and the top chrome stays draggable on
 * every page.
 */
export function AppLayout({ children }: { children: ReactNode }) {
  const sidebarQuery = useQuery({
    ...trpc.assets.sidebarMeta.queryOptions(),
    refetchOnWindowFocus: false,
    staleTime: 30_000,
  });

  const sidebarSummary = useMemo(() => {
    const base = sidebarQuery.data?.summary;
    return base ? { ...base } : EMPTY_SUMMARY;
  }, [sidebarQuery.data?.summary]);

  const [sidebarCollapsed, setSidebarCollapsed] = useState(
    () => localStorage.getItem(SIDEBAR_COLLAPSED_STORAGE_KEY) === "true",
  );
  const [sidebarPreviewOpen, setSidebarPreviewOpen] = useState(false);
  const [tagModalState, setTagModalState] = useState<SidebarTagModalState | null>(null);
  const [viewModalState, setViewModalState] = useState<SidebarViewModalState | null>(null);
  const sidebarPanelRef = useRef<PanelImperativeHandle | null>(null);
  const sidebarCollapseIntentRef = useRef<"collapsed" | "expanded" | null>(null);
  const sidebarInitializingRef = useRef(true);

  // First-paint sidebar size. Passing this as defaultLayout lets the panel
  // render at its real width immediately instead of growing from 0.
  const [sidebarInitPct] = useState(() => {
    const stored = Number.parseFloat(localStorage.getItem(SIDEBAR_WIDTH_STORAGE_KEY) ?? "");
    return Number.isFinite(stored) ? Math.min(28, Math.max(16, stored)) : 20;
  });

  const handleToggleSidebar = () => {
    if (sidebarCollapsed || sidebarPanelRef.current?.isCollapsed()) {
      sidebarCollapseIntentRef.current = "expanded";
      setSidebarPreviewOpen(false);
      setSidebarCollapsed(false);
      sidebarPanelRef.current?.expand();
      return;
    }

    sidebarCollapseIntentRef.current = "collapsed";
    setSidebarPreviewOpen(false);
    setSidebarCollapsed(true);
    sidebarPanelRef.current?.collapse();
  };

  useEffect(() => {
    // Traffic lights stay visible in both expanded and collapsed states so the persistent
    // WindowChromeNav toolbar always sits next to them at the same position.
    syncWindowControlsWithSidebar(true);
  }, []);

  useEffect(() => {
    localStorage.setItem(SIDEBAR_COLLAPSED_STORAGE_KEY, String(sidebarCollapsed));
  }, [sidebarCollapsed]);

  useEffect(() => {
    if (!sidebarCollapsed || !sidebarPreviewOpen) {
      return;
    }

    const handlePointerMove = (event: PointerEvent) => {
      const previewWidth = getSidebarPreviewWidth();
      const exitPadding = SIDEBAR_PREVIEW_EXIT_PADDING;
      const outsideHorizontalBounds =
        event.clientX < -exitPadding || event.clientX > previewWidth + exitPadding;
      const outsideVerticalBounds =
        event.clientY < -exitPadding || event.clientY > window.innerHeight + exitPadding;

      if (outsideHorizontalBounds || outsideVerticalBounds) {
        setSidebarPreviewOpen(false);
      }
    };

    window.addEventListener("pointermove", handlePointerMove, { passive: true });
    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
    };
  }, [sidebarCollapsed, sidebarPreviewOpen]);

  useEffect(() => {
    return () => {
      syncWindowControlsWithSidebar(true);
    };
  }, []);

  const backgroundWindowDragEnabled = !(sidebarCollapsed && sidebarPreviewOpen);
  const contextValue = useMemo<AppLayoutContextValue>(
    () => ({ backgroundWindowDragEnabled, sidebarCollapsed }),
    [backgroundWindowDragEnabled, sidebarCollapsed],
  );
  const sidebarTags = useMemo(() => sidebarQuery.data?.tags ?? [], [sidebarQuery.data?.tags]);
  const sidebarViews = useMemo(() => sidebarQuery.data?.views ?? [], [sidebarQuery.data?.views]);
  const sourceOptions = useMemo(
    () => sidebarQuery.data?.sourceOptions ?? [],
    [sidebarQuery.data?.sourceOptions],
  );
  const vaultId = sidebarQuery.data?.vault?.id;

  const handleCreateTag = () => {
    setSidebarPreviewOpen(false);
    setTagModalState({ kind: "create" });
  };

  const handleEditTag = (tag: SidebarTag) => {
    setSidebarPreviewOpen(false);
    setTagModalState({ kind: "edit", tag });
  };

  const handleCreateView = () => {
    setSidebarPreviewOpen(false);
    setViewModalState({ kind: "create" });
  };

  const handleEditView = (view: SidebarView) => {
    setSidebarPreviewOpen(false);
    setViewModalState({ kind: "edit", view });
  };

  return (
    <AppLayoutContext.Provider value={contextValue}>
      <>
        <div className="relative h-full min-h-0 overflow-hidden text-zinc-950">
          {sidebarCollapsed && !sidebarPreviewOpen ? (
            <div
              aria-hidden="true"
              className="window-drag pointer-events-none absolute left-6 right-48 top-0 z-[74] h-14"
            />
          ) : null}
          {sidebarCollapsed ? (
            <SidebarEdgeHotspot onOpen={() => setSidebarPreviewOpen(true)} />
          ) : null}
          {sidebarCollapsed ? (
            <motion.div
              key="sidebar-preview"
              className="absolute inset-y-0 left-0 z-[85] w-[min(320px,84vw)]"
              initial={false}
              animate={{ x: sidebarPreviewOpen ? 0 : "-100%" }}
              transition={{ x: { duration: 0.22, ease: [0.22, 1, 0.36, 1] } }}
              style={{
                pointerEvents: sidebarPreviewOpen ? "auto" : "none",
                transformOrigin: "left center",
              }}
              onMouseEnter={() => setSidebarPreviewOpen(true)}
            >
              <Sidebar
                tagItems={sidebarTags}
                viewItems={sidebarViews}
                vaultId={vaultId}
                onCreateTag={handleCreateTag}
                onEditTag={handleEditTag}
                onCreateView={handleCreateView}
                onEditView={handleEditView}
                floating
                summary={sidebarSummary}
              />
            </motion.div>
          ) : null}
          {sidebarCollapsed && sidebarPreviewOpen ? <FloatingSidebarDragOverlay /> : null}

          <ResizablePanelGroup
            id="app-layout"
            direction="horizontal"
            className="panel-layout h-full min-h-0 overflow-hidden bg-transparent"
            resizeTargetMinimumSize={{ coarse: 32, fine: 12 }}
            defaultLayout={
              sidebarCollapsed
                ? { sidebar: 0, main: 100 }
                : { sidebar: sidebarInitPct, main: 100 - sidebarInitPct }
            }
          >
            <ResizablePanel
              panelRef={sidebarPanelRef}
              id="sidebar"
              defaultSize={20}
              minSize={`${SIDEBAR_MIN_WIDTH_PX}px`}
              maxSize={28}
              collapsible
              collapsedSize={0}
              onResize={(size) => {
                const nextCollapsed = size.asPercentage <= 0.01;

                if (!nextCollapsed) {
                  localStorage.setItem(SIDEBAR_WIDTH_STORAGE_KEY, String(size.asPercentage));
                }

                if (sidebarCollapseIntentRef.current === "collapsed") {
                  setSidebarCollapsed(true);
                  if (nextCollapsed) sidebarCollapseIntentRef.current = null;
                  return;
                }

                if (sidebarCollapseIntentRef.current === "expanded") {
                  setSidebarCollapsed(false);
                  if (!nextCollapsed) sidebarCollapseIntentRef.current = null;
                  return;
                }

                // Panel can report 0% once on mount before layout settles;
                // don't treat that as a user collapse.
                if (sidebarInitializingRef.current) {
                  if (!nextCollapsed) sidebarInitializingRef.current = false;
                  else return;
                }

                setSidebarCollapsed(nextCollapsed);
                if (!nextCollapsed) setSidebarPreviewOpen(false);
              }}
              className={`overflow-hidden transition-opacity duration-150 ${
                sidebarCollapsed ? "pointer-events-none opacity-0" : "opacity-100"
              }`}
            >
              {!sidebarCollapsed ? (
                <Sidebar
                  tagItems={sidebarTags}
                  viewItems={sidebarViews}
                  vaultId={vaultId}
                  onCreateTag={handleCreateTag}
                  onEditTag={handleEditTag}
                  onCreateView={handleCreateView}
                  onEditView={handleEditView}
                  summary={sidebarSummary}
                />
              ) : null}
            </ResizablePanel>

            <ResizableHandle
              withHandle
              className={sidebarCollapsed ? "opacity-0 pointer-events-none" : ""}
            />

            <ResizablePanel
              id="main"
              defaultSize={100 - sidebarInitPct}
              minSize={42}
              className="relative z-[60] min-w-0"
            >
              {children}
            </ResizablePanel>
          </ResizablePanelGroup>

          {/* DOM-last on purpose: Chromium composites -webkit-app-region in layout order, so the
              toolbar's no-drag buttons must come after every overlapping window-drag region (header
              + the z-[74] drag overlay) to be clickable. z-[90] still paints it visually on top. */}
          <WindowChromeNav
            sidebarCollapsed={sidebarCollapsed}
            onToggleSidebar={handleToggleSidebar}
          />
        </div>

        <TagFormModal
          isOpen={tagModalState !== null}
          mode={tagModalState ?? { kind: "create" }}
          vaultId={vaultId}
          onOpenChange={(isOpen) => {
            if (!isOpen) setTagModalState(null);
          }}
        />
        <ViewFormModal
          isOpen={viewModalState !== null}
          mode={viewModalState ?? { kind: "create" }}
          vaultId={vaultId}
          tagOptions={sidebarTags}
          sourceOptions={sourceOptions}
          onOpenChange={(isOpen) => {
            if (!isOpen) setViewModalState(null);
          }}
        />
      </>
    </AppLayoutContext.Provider>
  );
}
