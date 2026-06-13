import { useEffect, useMemo, useState, type ComponentType, type ReactNode } from "react";
import { useNavigate, useRouterState } from "@tanstack/react-router";
import { useAtom, useSetAtom } from "jotai";
import { DragDropProvider, type DragEndEvent } from "@dnd-kit/react";
import { isSortable, useSortable } from "@dnd-kit/react/sortable";
import { PointerActivationConstraints, PointerSensor } from "@dnd-kit/dom";
import { arrayMove } from "@dnd-kit/helpers";
import { AnimatePresence, motion } from "motion/react";
import { Button } from "@heroui/react";
import {
  Archive,
  ChevronDown,
  FolderKanban,
  Inbox,
  Megaphone,
  Network,
  PanelLeftClose,
  PanelLeftOpen,
  Pencil,
  Plus,
  Trash2,
} from "lucide-react";

import { Collapsible, CollapsibleTrigger } from "@/components/ui/collapsible";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  activeSidebarItemAtom,
  assetFiltersAtom,
  getDefaultAssetFilters,
} from "@/store/asset-manager-atoms";
import { getTagHue } from "@/features/assets/asset-model";
import { SIDEBAR_ORDER_STORAGE_KEY } from "@/features/assets/storage";
import type { AssetSummary, SidebarTag, SidebarView } from "@/features/assets/types";
import { isMacWindow } from "@/lib/platform";

type SidebarSectionId = "views" | "tags";

type SidebarOrderState = {
  sections: SidebarSectionId[];
  views: string[];
  tags: string[];
};

const SIDEBAR_SECTION_IDS: SidebarSectionId[] = ["views", "tags"];
const SIDEBAR_SECTION_TYPE = "sidebar-section";
const SIDEBAR_ITEM_TYPE_PREFIX = "sidebar-item:";
const TRAFFIC_LIGHT_POSITION = { x: 18, y: 14 };
const SIDEBAR_PREVIEW_MAX_WIDTH = 320;
const SIDEBAR_PREVIEW_VIEWPORT_RATIO = 0.84;
export const SIDEBAR_PREVIEW_EXIT_PADDING = 32;
const SIDEBAR_EDGE_HOTSPOT_WIDTH = 24;
let lastWindowControlsVisible: boolean | null = null;

export function syncWindowControlsWithSidebar(trafficLightsVisible: boolean) {
  if (!isMacWindow() || typeof window.api.setWindowControlsState !== "function") {
    return;
  }

  if (lastWindowControlsVisible === trafficLightsVisible) {
    return;
  }
  lastWindowControlsVisible = trafficLightsVisible;

  void window.api
    .setWindowControlsState({
      trafficLightsVisible,
      trafficLightPosition: TRAFFIC_LIGHT_POSITION,
    })
    .catch(() => {
      // Window control APIs are macOS/Electron-version specific.
    });
}

export function getSidebarPreviewWidth() {
  if (typeof window === "undefined") {
    return SIDEBAR_PREVIEW_MAX_WIDTH;
  }

  return Math.min(SIDEBAR_PREVIEW_MAX_WIDTH, window.innerWidth * SIDEBAR_PREVIEW_VIEWPORT_RATIO);
}

const getDefaultSidebarOrder = (
  views: readonly SidebarView[] = [],
  tags: readonly SidebarTag[] = [],
): SidebarOrderState => ({
  sections: [...SIDEBAR_SECTION_IDS],
  views: views.map((view) => view.id),
  tags: tags.map((tag) => tag.id),
});

function isSidebarSectionId(value: unknown): value is SidebarSectionId {
  return typeof value === "string" && SIDEBAR_SECTION_IDS.includes(value as SidebarSectionId);
}

function getSidebarItemType(sectionId: SidebarSectionId) {
  return `${SIDEBAR_ITEM_TYPE_PREFIX}${sectionId}`;
}

function getSectionIdFromItemType(type: unknown): SidebarSectionId | null {
  if (typeof type !== "string" || !type.startsWith(SIDEBAR_ITEM_TYPE_PREFIX)) {
    return null;
  }

  const sectionId = type.slice(SIDEBAR_ITEM_TYPE_PREFIX.length);
  return isSidebarSectionId(sectionId) ? sectionId : null;
}

function mergeKnownOrder<T extends string>(
  storedOrder: unknown,
  defaultOrder: readonly T[],
  isKnownId: (value: unknown) => value is T = (value): value is T =>
    typeof value === "string" && defaultOrder.includes(value as T),
) {
  const seenIds = new Set<T>();
  const storedIds = Array.isArray(storedOrder)
    ? storedOrder.filter((id): id is T => {
        if (!isKnownId(id) || seenIds.has(id)) {
          return false;
        }

        seenIds.add(id);
        return true;
      })
    : [];
  const missingIds = defaultOrder.filter((id) => !storedIds.includes(id));
  return [...storedIds, ...missingIds];
}

function normalizeSidebarOrder(value: unknown, defaults: SidebarOrderState): SidebarOrderState {
  const stored = value && typeof value === "object" ? value as Partial<SidebarOrderState> : {};

  return {
    sections: mergeKnownOrder(stored.sections, defaults.sections, isSidebarSectionId),
    views: mergeKnownOrder(stored.views, defaults.views),
    tags: mergeKnownOrder(stored.tags, defaults.tags),
  };
}

function readSidebarOrderFromStorage(defaults: SidebarOrderState) {
  if (typeof window === "undefined") {
    return defaults;
  }

  try {
    const raw = window.localStorage.getItem(SIDEBAR_ORDER_STORAGE_KEY);
    return normalizeSidebarOrder(raw ? JSON.parse(raw) : null, defaults);
  } catch {
    return defaults;
  }
}

function orderByIds<T>(
  items: readonly T[],
  orderedIds: readonly string[],
  getId: (item: T) => string,
) {
  const byId = new Map(items.map((item) => [getId(item), item]));
  return orderedIds.flatMap((id) => {
    const item = byId.get(id);
    return item ? [item] : [];
  });
}


type SidebarSectionProps = {
  title: string;
  children: ReactNode;
  action?: ReactNode;
  defaultOpen?: boolean;
  dragHandleRef?: (element: Element | null) => void;
};

function SidebarSection({ title, children, action, defaultOpen = true, dragHandleRef }: SidebarSectionProps) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <div
        ref={dragHandleRef}
        className="group/section flex select-none items-center gap-1 px-2 py-1"
      >
        <span className="flex-1 text-[11px] font-semibold uppercase tracking-wide text-zinc-400">
          {title}
        </span>
        <div className="flex items-center gap-0.5 opacity-0 transition-opacity group-hover/section:opacity-100">
          {action}
          <CollapsibleTrigger asChild>
            <button
              type="button"
              className="flex h-5 w-5 items-center justify-center rounded text-zinc-400 hover:bg-black/5"
            >
              <ChevronDown
                size={12}
                className={`transition-transform duration-200 ${open ? "" : "-rotate-90"}`}
              />
            </button>
          </CollapsibleTrigger>
        </div>
      </div>
      <AnimatePresence initial={false}>
        {open ? (
          <motion.div
            key="content"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.18, ease: [0.25, 0.46, 0.45, 0.94] }}
            className="overflow-hidden"
          >
            {children}
          </motion.div>
        ) : null}
      </AnimatePresence>
    </Collapsible>
  );
}

type SidebarItemProps = {
  label: string;
  meta?: ReactNode;
  actions?: ReactNode;
  icon?: ComponentType<{ size?: number; className?: string }>;
  colorDot?: string;
  active?: boolean;
  onClick?: () => void;
};

type SidebarItemActionButtonProps = {
  label: string;
  icon: ComponentType<{ size?: number; className?: string }>;
};

function SidebarItemActionButton({ label, icon: Icon }: SidebarItemActionButtonProps) {
  return (
    <button
      type="button"
      aria-label={label}
      data-no-drag
      className="grid h-5 w-5 place-items-center rounded-md text-zinc-400 transition-colors hover:bg-black/5 hover:text-zinc-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-500/25"
      onClick={(event) => event.stopPropagation()}
      onPointerDown={(event) => event.stopPropagation()}
    >
      <Icon size={13} />
    </button>
  );
}

function SidebarItem({ label, meta, actions, icon: Icon, colorDot, active = false, onClick }: SidebarItemProps) {
  const itemStateClass = active
    ? "bg-[var(--sidebar-item-selected)] font-medium text-zinc-950 shadow-[inset_0_0_0_1px_var(--sidebar-item-selected-border)] hover:bg-[var(--sidebar-item-selected-hover)] active:bg-[var(--sidebar-item-pressed)]"
    : "text-zinc-600 hover:bg-[var(--sidebar-item-hover)] hover:text-zinc-800 active:bg-[var(--sidebar-item-pressed)]";
  const iconClass = active ? "shrink-0 text-zinc-700" : "shrink-0 text-zinc-400 group-hover/item:text-zinc-500";
  const metaClass = active ? "text-xs text-zinc-500" : "text-xs text-zinc-400";
  const interactionClass = onClick ? "cursor-pointer" : "";

  const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (!onClick || (event.key !== "Enter" && event.key !== " ")) {
      return;
    }

    event.preventDefault();
    onClick();
  };

  return (
    <div
      role={onClick ? "button" : undefined}
      tabIndex={onClick ? 0 : undefined}
      className={`group/item flex w-full select-none items-center gap-2 rounded-lg px-3 py-1.5 text-left text-[13px] outline-none transition-colors focus-visible:ring-2 focus-visible:ring-zinc-500/25 ${interactionClass} ${itemStateClass}`}
      onClick={onClick}
      onKeyDown={handleKeyDown}
    >
      {Icon ? <Icon size={14} className={iconClass} /> : null}
      {colorDot ? <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: colorDot }} /> : null}
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {meta !== undefined || actions !== undefined ? (
        <span className="relative ml-auto flex h-5 min-w-[46px] shrink-0 items-center justify-end overflow-hidden">
          {meta !== undefined ? (
            <span className={`${metaClass} transition-all duration-150 ease-out ${actions !== undefined ? "group-hover/item:-translate-y-1 group-hover/item:opacity-0 group-focus-within/item:-translate-y-1 group-focus-within/item:opacity-0" : ""}`}>
              {meta}
            </span>
          ) : null}
          {actions !== undefined ? (
            <span className="pointer-events-none absolute right-0 flex translate-y-1 items-center gap-0.5 opacity-0 transition-all duration-150 ease-out group-hover/item:pointer-events-auto group-hover/item:translate-y-0 group-hover/item:opacity-100 group-focus-within/item:pointer-events-auto group-focus-within/item:translate-y-0 group-focus-within/item:opacity-100">
              {actions}
            </span>
          ) : null}
        </span>
      ) : null}
    </div>
  );
}

type SortableSidebarSectionProps = {
  sectionId: SidebarSectionId;
  index: number;
  children: (dragHandleRef: (element: Element | null) => void) => ReactNode;
};

function SortableSidebarSection({ sectionId, index, children }: SortableSidebarSectionProps) {
  const { ref, handleRef, isDragging, isDropTarget } = useSortable({
    id: `section:${sectionId}`,
    index,
    group: "sidebar-sections",
    type: SIDEBAR_SECTION_TYPE,
    accept: SIDEBAR_SECTION_TYPE,
    transition: { duration: 170, easing: "cubic-bezier(0.25, 1, 0.5, 1)", idle: true },
  });

  return (
    <div
      ref={ref}
      className={`rounded-lg transition-[background-color,opacity] duration-150 ${isDragging ? "cursor-grabbing opacity-55" : ""} ${isDropTarget ? "bg-black/[0.025]" : ""}`}
    >
      {children(handleRef)}
    </div>
  );
}

type SortableSidebarItemProps = {
  sectionId: SidebarSectionId;
  itemId: string;
  index: number;
  children: ReactNode;
};

function SortableSidebarItem({ sectionId, itemId, index, children }: SortableSidebarItemProps) {
  const type = getSidebarItemType(sectionId);
  const { ref, isDragging, isDropTarget } = useSortable({
    id: `item:${sectionId}:${itemId}`,
    index,
    group: `sidebar-items:${sectionId}`,
    type,
    accept: type,
    transition: { duration: 140, easing: "cubic-bezier(0.25, 1, 0.5, 1)", idle: true },
  });

  return (
    <div
      ref={ref}
      className={`rounded-lg transition-[background-color,opacity] duration-150 ${isDragging ? "cursor-grabbing opacity-55" : ""} ${isDropTarget ? "bg-black/[0.025]" : ""}`}
    >
      {children}
    </div>
  );
}

export function SidebarEdgeHotspot({ onOpen }: { onOpen: () => void }) {
  return (
    <div
      aria-hidden="true"
      className="window-no-drag absolute inset-y-0 left-0 z-[75]"
      style={{ width: SIDEBAR_EDGE_HOTSPOT_WIDTH }}
      onMouseEnter={onOpen}
      onMouseMove={onOpen}
    />
  );
}

export function FloatingSidebarDragOverlay() {
  return (
    <div
      aria-hidden="true"
      className="pointer-events-none absolute left-0 top-0 z-[95] h-14 w-[min(320px,84vw)]"
    >
      <div className="pointer-events-auto window-drag absolute left-0 top-0 h-full w-[88px]" />
      <div className="pointer-events-auto window-drag absolute left-[140px] right-0 top-0 h-full" />
    </div>
  );
}

export function Sidebar({
  tagItems,
  viewItems,
  summary,
  onToggleSidebar,
  toggleMode = "collapse",
  floating = false,
}: {
  tagItems: SidebarTag[];
  viewItems: SidebarView[];
  summary: AssetSummary & { untagged: number };
  onToggleSidebar: () => void;
  toggleMode?: "collapse" | "expand";
  floating?: boolean;
}) {
  const [activeSidebarItem, setActiveSidebarItem] = useAtom(activeSidebarItemAtom);
  const setFilters = useSetAtom(assetFiltersAtom);
  const navigate = useNavigate();
  const { location } = useRouterState();
  const isNonHomeRoute = location.pathname !== "/";

  const handleMgmtItemClick = (item: "all" | "inbox") => {
    setActiveSidebarItem({ kind: "mgmt", id: item });
    setFilters(getDefaultAssetFilters());
    if (isNonHomeRoute) void navigate({ to: "/" });
  };

  const handleViewClick = (viewId: string) => {
    const view = viewItems.find((v) => v.id === viewId);
    const tagId = view?.conditions.find((c) => c.startsWith("tag:"))?.slice(4);
    const tagName = tagId ? tagItems.find((t) => t.id === tagId)?.name : undefined;
    setActiveSidebarItem({ kind: "view", id: viewId });
    setFilters((prev) => ({ ...prev, tags: tagName ? [tagName] : [] }));
    if (isNonHomeRoute) void navigate({ to: "/" });
  };

  const handleTagClick = (tagId: string) => {
    const tagName = tagItems.find((t) => t.id === tagId)?.name;
    setActiveSidebarItem({ kind: "tag", id: tagId });
    setFilters((prev) => ({ ...prev, tags: tagName ? [tagName] : [] }));
    if (isNonHomeRoute) void navigate({ to: "/" });
  };

  const defaultSidebarOrder = useMemo(
    () => getDefaultSidebarOrder(viewItems, tagItems),
    [viewItems, tagItems],
  );
  const [sidebarOrder, setSidebarOrder] = useState(() => readSidebarOrderFromStorage(defaultSidebarOrder));

  // When viewItems/tagItems first arrive (async data load), merge their IDs into
  // the stored order so newly-added views/tags actually appear in the sidebar.
  useEffect(() => {
    setSidebarOrder((current) => normalizeSidebarOrder(current, defaultSidebarOrder));
  }, [defaultSidebarOrder]);

  useEffect(() => {
    try {
      window.localStorage.setItem(SIDEBAR_ORDER_STORAGE_KEY, JSON.stringify(sidebarOrder));
    } catch {
      // Ignore storage failures; drag state should still work for the current session.
    }
  }, [sidebarOrder]);

  // Use viewItems directly, respecting stored order but never hiding items not in the stored order
  const orderedViews = useMemo(() => {
    const ordered = orderByIds(viewItems, sidebarOrder.views, (v) => v.id);
    const unordered = viewItems.filter((v) => !sidebarOrder.views.includes(v.id));
    return [...ordered, ...unordered].slice(0, 8);
  }, [sidebarOrder.views, viewItems]);
  const orderedTags = useMemo(() => {
    const ordered = orderByIds(tagItems, sidebarOrder.tags, (t) => t.id);
    const unordered = tagItems.filter((t) => !sidebarOrder.tags.includes(t.id));
    return [...ordered, ...unordered].slice(0, 10);
  }, [sidebarOrder.tags, tagItems]);

  const handleSidebarDragEnd = (event: DragEndEvent) => {
    if (event.canceled) {
      return;
    }

    const { source } = event.operation;
    if (!isSortable(source) || source.initialIndex === source.index) {
      return;
    }

    if (source.type === SIDEBAR_SECTION_TYPE) {
      setSidebarOrder((current) => ({
        ...current,
        sections: arrayMove([...current.sections], source.initialIndex, source.index),
      }));
      return;
    }

    const sectionId = getSectionIdFromItemType(source.type);
    if (!sectionId || source.initialGroup !== source.group) {
      return;
    }

    setSidebarOrder((current) => ({
      ...current,
      [sectionId]: arrayMove([...current[sectionId]], source.initialIndex, source.index),
    }));
  };

  const renderSortableSection = (
    sectionId: SidebarSectionId,
    dragHandleRef: (element: Element | null) => void,
  ) => {
    if (sectionId === "views") {
      return (
        <SidebarSection title="Views" dragHandleRef={dragHandleRef}>
          <div className="space-y-0.5">
            {orderedViews.map((view, index) => (
              <SortableSidebarItem key={view.id} sectionId="views" itemId={view.id} index={index}>
                <SidebarItem
                  icon={FolderKanban}
                  label={view.name}
                  meta={view.count}
                  active={!isNonHomeRoute && activeSidebarItem.kind === "view" && activeSidebarItem.id === view.id}
                  onClick={() => handleViewClick(view.id)}
                  actions={
                    <>
                      <SidebarItemActionButton label={`编辑 ${view.name}`} icon={Pencil} />
                      <SidebarItemActionButton label={`删除 ${view.name}`} icon={Trash2} />
                    </>
                  }
                />
              </SortableSidebarItem>
            ))}
          </div>
        </SidebarSection>
      );
    }

    return (
      <SidebarSection
        title="Tags"
        dragHandleRef={dragHandleRef}
        action={
          <button
            type="button"
            data-no-drag
            className="rounded px-1.5 py-0.5 text-[11px] text-zinc-400 hover:bg-black/5"
          >
            + 管理
          </button>
        }
      >
        <div className="space-y-0.5">
          {orderedTags.map((tag, index) => (
            <SortableSidebarItem key={tag.id} sectionId="tags" itemId={tag.id} index={index}>
              <SidebarItem
                colorDot={tag.color ?? `oklch(0.62 0.14 ${getTagHue(tag.name)})`}
                label={tag.name}
                meta={tag.count}
                active={!isNonHomeRoute && activeSidebarItem.kind === "tag" && activeSidebarItem.id === tag.id}
                onClick={() => handleTagClick(tag.id)}
                actions={
                  <>
                    <SidebarItemActionButton label={`编辑 ${tag.name}`} icon={Pencil} />
                    <SidebarItemActionButton label={`删除 ${tag.name}`} icon={Trash2} />
                  </>
                }
              />
            </SortableSidebarItem>
          ))}
        </div>
      </SidebarSection>
    );
  };

  const ToggleIcon = toggleMode === "expand" ? PanelLeftOpen : PanelLeftClose;
  const sidebarChromePadding = isMacWindow() ? "pl-[100px]" : "pl-3";
  const sidebarChromeClassName = `relative mt-[10.5px] h-12 ${sidebarChromePadding}`;
  const sidebarChromeDragClassName = floating ? "window-no-drag" : "window-drag";

  return (
    <aside
      className={`flex h-full w-full flex-col border-r shadow-[inset_-1px_0_0_rgba(255,255,255,0.45)] ${
        floating
          ? "overflow-hidden rounded-r-2xl border-zinc-200 bg-white shadow-2xl shadow-black/15"
          : "border-white/45 bg-white/45 backdrop-blur-2xl backdrop-saturate-150"
      }`}
    >
      <div className={sidebarChromeClassName}>
        <div aria-hidden="true" className={`${sidebarChromeDragClassName} absolute inset-0 z-0`} />
        <div className="window-no-drag pointer-events-auto relative z-10 inline-flex -ml-1 -translate-y-1.5">
          <Button
            isIconOnly
            aria-label={toggleMode === "expand" ? "展开左侧栏" : "收起左侧栏"}
            data-no-drag
            size="sm"
            variant="ghost"
            className="window-no-drag h-8 w-8 text-zinc-500 hover:bg-black/5"
            onPress={onToggleSidebar}
          >
            <ToggleIcon size={19} />
          </Button>
        </div>
      </div>

      <div className="shrink-0 px-3 pb-1">
        <SidebarSection
          title="资产管理"
          action={
            <button type="button" className="window-no-drag flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] text-zinc-400 hover:bg-black/5">
              <Plus size={11} />
              新建
            </button>
          }
        >
          <div className="space-y-0.5">
            {([
              { id: "all" as const, icon: Archive, label: "全部资产", count: summary.total },
              { id: "inbox" as const, icon: Inbox, label: "待整理", count: summary.untagged },
            ] as const).map((item) => (
              <SidebarItem
                key={item.id}
                icon={item.icon}
                label={item.label}
                meta={item.count}
                active={!isNonHomeRoute && activeSidebarItem.kind === "mgmt" && activeSidebarItem.id === item.id}
                onClick={() => handleMgmtItemClick(item.id)}
              />
            ))}
            <SidebarItem
              icon={Network}
              label="知识图谱"
              active={location.pathname === "/graph"}
              onClick={() => void navigate({ to: "/graph" })}
            />
            <SidebarItem
              icon={Megaphone}
              label="发布中心"
              active={location.pathname === "/publish"}
              onClick={() => void navigate({ to: "/publish" })}
            />
          </div>
        </SidebarSection>
      </div>

      {/* 可滚动部分：Views / Tags */}
      <ScrollArea className="min-h-0 flex-1" viewportClassName="px-3 pb-4 pt-2">
        <DragDropProvider
          sensors={(defaults) => [
            ...defaults.filter((sensor) => sensor !== PointerSensor),
            PointerSensor.configure({
              activationConstraints(event) {
                return [
                  new PointerActivationConstraints.Delay({
                    value: event.pointerType === "touch" ? 250 : 180,
                    tolerance: 6,
                  }),
                ];
              },
              preventActivation(event) {
                return event.target instanceof Element &&
                  event.target.closest("button, a, input, textarea, select, [contenteditable='true'], [data-no-drag]") !== null;
              },
            }),
          ]}
          onDragEnd={handleSidebarDragEnd}
        >
          <nav className="space-y-3">
            {sidebarOrder.sections.map((sectionId, index) => (
              <SortableSidebarSection key={sectionId} sectionId={sectionId} index={index}>
                {(dragHandleRef) => renderSortableSection(sectionId, dragHandleRef)}
              </SortableSidebarSection>
            ))}
          </nav>
        </DragDropProvider>
      </ScrollArea>
    </aside>
  );
}
