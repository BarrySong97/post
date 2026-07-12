/**
 * @purpose Render and manage the asset manager sidebar navigation.
 * @role    Layout navigation component for vault, tag, saved view, and status sections.
 * @deps    React, HeroUI/local UI primitives, asset manager atoms and renderer types.
 * @gotcha  Sidebar item IDs must stay compatible with asset filter and active selection state.
 */

import { useEffect, useMemo, useState, type ComponentType, type ReactNode } from "react";
import { useNavigate, useRouterState } from "@tanstack/react-router";
import { useMutation } from "@tanstack/react-query";
import { useAtom, useSetAtom } from "jotai";
import { DragDropProvider, type DragEndEvent } from "@dnd-kit/react";
import { isSortable, useSortable } from "@dnd-kit/react/sortable";
import { PointerActivationConstraints, PointerSensor } from "@dnd-kit/dom";
import { arrayMove } from "@dnd-kit/helpers";
import { AnimatePresence, motion } from "motion/react";
import { Dropdown } from "@heroui/react";
import {
  Archive,
  ArrowDown,
  ArrowUp,
  ArrowUpToLine,
  ChevronDown,
  Inbox,
  MoreHorizontal,
  Network,
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
import { getTagHue } from "@/lib/asset-manager/asset-model";
import { savedViewFiltersToAssetFilters } from "@/components/asset-manager/asset-filter-controls";
import { SIDEBAR_ORDER_STORAGE_KEY } from "@/lib/asset-manager/storage";
import { ViewIconRenderer } from "@/components/asset-manager/view-icon-picker";
import type { AssetSummary, SidebarTag, SidebarView } from "@/lib/asset-manager/types";
import { useConfirmModal } from "@/components/common/confirm-modal";
import { useInvalidateVaultState } from "@/hooks/use-invalidate-vault-state";
import { isMacWindow } from "@/lib/platform";
import { showToastAfterRefresh, toast } from "@/lib/toast";
import { trpc } from "@/lib/trpc";
import { useTranslation } from "react-i18next";

type SidebarSectionId = "views" | "tags";

type SidebarOrderState = {
  sections: SidebarSectionId[];
  views: string[];
  tags: string[];
};

const SIDEBAR_SECTION_IDS: SidebarSectionId[] = ["views", "tags"];
const SIDEBAR_SECTION_TYPE = "sidebar-section";
const SIDEBAR_ITEM_TYPE_PREFIX = "sidebar-item:";
// Aligns with the compact h-10 top-chrome content row (toolbar + page header), centered ~y20.
const TRAFFIC_LIGHT_POSITION = { x: 18, y: 14 };
const SIDEBAR_PREVIEW_MAX_WIDTH = 320;
const SIDEBAR_PREVIEW_VIEWPORT_RATIO = 0.84;
export const SIDEBAR_PREVIEW_EXIT_PADDING = 32;
const SIDEBAR_EDGE_HOTSPOT_WIDTH = 24;
const SIDEBAR_ITEM_ACTION_BUTTON_CLASS_NAME =
  "grid h-5 w-5 cursor-pointer place-items-center rounded-md text-zinc-400 transition-colors hover:bg-black/5 hover:text-zinc-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-500/25 disabled:pointer-events-none disabled:cursor-default disabled:opacity-35";
const SIDEBAR_ITEM_MORE_TRIGGER_CLASS_NAME =
  "grid h-5 w-5 cursor-pointer place-items-center rounded-md text-zinc-400 outline-none transition-colors hover:bg-black/5 hover:text-zinc-700 data-[focus-visible]:ring-2 data-[focus-visible]:ring-zinc-500/25";
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
  const stored = value && typeof value === "object" ? (value as Partial<SidebarOrderState>) : {};

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

type SidebarSectionProps = {
  title: string;
  children: ReactNode;
  action?: ReactNode;
  defaultOpen?: boolean;
  dragHandleRef?: (element: Element | null) => void;
};

function SidebarSection({
  title,
  children,
  action,
  defaultOpen = true,
  dragHandleRef,
}: SidebarSectionProps) {
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
  renderIcon?: (className: string) => ReactNode;
  colorDot?: string;
  active?: boolean;
  onClick?: () => void;
};

type SidebarItemActionButtonProps = {
  label: string;
  icon: ComponentType<{ size?: number; className?: string }>;
  disabled?: boolean;
  onClick: () => void;
};

function SidebarItemActionButton({
  label,
  icon: Icon,
  disabled = false,
  onClick,
}: SidebarItemActionButtonProps) {
  return (
    <button
      type="button"
      aria-label={label}
      data-no-drag
      disabled={disabled}
      className={SIDEBAR_ITEM_ACTION_BUTTON_CLASS_NAME}
      onClick={(event) => {
        event.stopPropagation();
        onClick();
      }}
      onPointerDown={(event) => event.stopPropagation()}
    >
      <Icon size={13} />
    </button>
  );
}

function SidebarItemMoreMenu({
  itemName,
  isFirst,
  onMoveFirst,
  onEdit,
  onDelete,
}: {
  itemName: string;
  isFirst: boolean;
  onMoveFirst: () => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const { t } = useTranslation();
  return (
    <Dropdown>
      <Dropdown.Trigger
        data-no-drag
        className={SIDEBAR_ITEM_MORE_TRIGGER_CLASS_NAME}
        aria-label={t("sidebar.itemMore", { name: itemName })}
        onClick={(event) => event.stopPropagation()}
        onPointerDown={(event) => event.stopPropagation()}
      >
        <MoreHorizontal size={13} />
      </Dropdown.Trigger>
      <Dropdown.Popover
        className="z-[120] overflow-hidden rounded-xl border border-zinc-200 bg-white p-1 shadow-[0_14px_34px_rgba(20,18,16,0.14),0_2px_7px_rgba(20,18,16,0.07)]"
        offset={6}
        placement="bottom end"
      >
        <Dropdown.Menu
          aria-label={t("sidebar.itemActions", { name: itemName })}
          className="min-w-32 p-0 outline-none"
          disabledKeys={isFirst ? ["move-first"] : []}
          onAction={(key) => {
            const action = String(key);
            if (action === "move-first") onMoveFirst();
            if (action === "edit") onEdit();
            if (action === "delete") onDelete();
          }}
        >
          <Dropdown.Item
            key="move-first"
            id="move-first"
            textValue={t("common.moveToFront")}
            className="flex h-7 cursor-default items-center gap-2 rounded-lg px-2 text-[12.5px] font-medium text-zinc-700 outline-none transition-colors data-[disabled]:opacity-45 data-[focused]:bg-zinc-100 data-[hovered]:bg-zinc-100"
          >
            <ArrowUpToLine size={13} className="text-zinc-500" />
            <span>{t("common.moveToFront")}</span>
          </Dropdown.Item>
          <Dropdown.Item
            key="edit"
            id="edit"
            textValue={t("common.edit")}
            className="flex h-7 cursor-default items-center gap-2 rounded-lg px-2 text-[12.5px] font-medium text-zinc-700 outline-none transition-colors data-[focused]:bg-zinc-100 data-[hovered]:bg-zinc-100"
          >
            <Pencil size={13} className="text-zinc-500" />
            <span>{t("common.edit")}</span>
          </Dropdown.Item>
          <Dropdown.Item
            key="delete"
            id="delete"
            textValue={t("common.delete")}
            className="flex h-7 cursor-default items-center gap-2 rounded-lg px-2 text-[12.5px] font-medium text-red-600 outline-none transition-colors data-[focused]:bg-red-50 data-[hovered]:bg-red-50"
          >
            <Trash2 size={13} />
            <span>{t("common.delete")}</span>
          </Dropdown.Item>
        </Dropdown.Menu>
      </Dropdown.Popover>
    </Dropdown>
  );
}

function SidebarItemHoverActions({ children }: { children: ReactNode }) {
  return (
    <span className="pointer-events-none absolute right-0 flex translate-y-1 items-center gap-0.5 opacity-0 transition-all duration-150 ease-out group-hover/item:pointer-events-auto group-hover/item:translate-y-0 group-hover/item:opacity-100 group-focus-within/item:pointer-events-auto group-focus-within/item:translate-y-0 group-focus-within/item:opacity-100">
      {children}
    </span>
  );
}

function SidebarItem({
  label,
  meta,
  actions,
  icon: Icon,
  renderIcon,
  colorDot,
  active = false,
  onClick,
}: SidebarItemProps) {
  const itemStateClass = active
    ? "bg-[var(--sidebar-item-selected)] font-medium text-zinc-950 shadow-[inset_0_0_0_1px_var(--sidebar-item-selected-border)] hover:bg-[var(--sidebar-item-selected-hover)] active:bg-[var(--sidebar-item-pressed)]"
    : "text-zinc-600 hover:bg-[var(--sidebar-item-hover)] hover:text-zinc-800 active:bg-[var(--sidebar-item-pressed)]";
  const iconClass = active
    ? "shrink-0 text-zinc-700"
    : "shrink-0 text-zinc-400 group-hover/item:text-zinc-500";
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
      {renderIcon ? renderIcon(iconClass) : Icon ? <Icon size={14} className={iconClass} /> : null}
      {colorDot ? (
        <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: colorDot }} />
      ) : null}
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {meta !== undefined || actions !== undefined ? (
        <span className="relative ml-auto flex h-5 min-w-[70px] shrink-0 items-center justify-end overflow-hidden">
          {meta !== undefined ? (
            <span
              className={`${metaClass} transition-all duration-150 ease-out ${actions !== undefined ? "group-hover/item:-translate-y-1 group-hover/item:opacity-0 group-focus-within/item:-translate-y-1 group-focus-within/item:opacity-0" : ""}`}
            >
              {meta}
            </span>
          ) : null}
          {actions !== undefined ? (
            <SidebarItemHoverActions>{actions}</SidebarItemHoverActions>
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

function getTagViewImpact(tag: SidebarTag, views: readonly SidebarView[]) {
  const updatedViews: SidebarView[] = [];
  const deletedViews: SidebarView[] = [];

  for (const view of views) {
    if (!view.filters.tagIds.includes(tag.id)) {
      continue;
    }

    const shouldDelete =
      view.filters.tagIds.length === 1 &&
      view.filters.types.length === 0 &&
      view.filters.sources.length === 0 &&
      view.filters.time === "any" &&
      view.filters.status === "any";

    if (shouldDelete) {
      deletedViews.push(view);
    } else {
      updatedViews.push(view);
    }
  }

  return { updatedViews, deletedViews };
}

function TagDeleteDescription({
  tag,
  updatedViews,
  deletedViews,
}: {
  tag: SidebarTag;
  updatedViews: SidebarView[];
  deletedViews: SidebarView[];
}) {
  const { t } = useTranslation();
  return (
    <div className="space-y-2">
      <p>{t("sidebar.deleteTagBody", { name: tag.name, count: tag.count })}</p>
      {updatedViews.length > 0 ? (
        <p>
          {t("sidebar.viewsKeepAfterTag")}
          {updatedViews.map((view) => `「${view.name}」`).join("、")}
        </p>
      ) : null}
      {deletedViews.length > 0 ? (
        <p>
          {t("sidebar.viewsDeleteWithTag")}
          {deletedViews.map((view) => `「${view.name}」`).join("、")}
        </p>
      ) : null}
    </div>
  );
}

export function Sidebar({
  tagItems,
  viewItems,
  vaultId,
  summary,
  onCreateTag,
  onEditTag,
  onCreateView,
  onEditView,
  floating = false,
}: {
  tagItems: SidebarTag[];
  viewItems: SidebarView[];
  vaultId?: string;
  summary: AssetSummary & { untagged: number };
  onCreateTag: () => void;
  onEditTag: (tag: SidebarTag) => void;
  onCreateView: () => void;
  onEditView: (view: SidebarView) => void;
  floating?: boolean;
}) {
  const { t } = useTranslation();
  const [activeSidebarItem, setActiveSidebarItem] = useAtom(activeSidebarItemAtom);
  const setFilters = useSetAtom(assetFiltersAtom);
  const navigate = useNavigate();
  const { location } = useRouterState();
  const isNonHomeRoute = location.pathname !== "/";
  const confirm = useConfirmModal();
  const invalidateVaultState = useInvalidateVaultState();
  const deleteTag = useMutation(trpc.assets.deleteTag.mutationOptions());
  const deleteSavedView = useMutation(trpc.assets.deleteSavedView.mutationOptions());
  const reorderTags = useMutation(
    trpc.assets.reorderTags.mutationOptions({ onSuccess: invalidateVaultState }),
  );
  const reorderSavedViews = useMutation(
    trpc.assets.reorderSavedViews.mutationOptions({ onSuccess: invalidateVaultState }),
  );

  const handleMgmtItemClick = (item: "all" | "inbox") => {
    setActiveSidebarItem({ kind: "mgmt", id: item });
    setFilters(getDefaultAssetFilters());
    if (isNonHomeRoute) void navigate({ to: "/" });
  };

  const handleViewClick = (viewId: string) => {
    const view = viewItems.find((v) => v.id === viewId);
    setActiveSidebarItem({ kind: "view", id: viewId });
    if (view) {
      setFilters(savedViewFiltersToAssetFilters(view.filters, tagItems, view.sort));
    } else {
      setFilters(getDefaultAssetFilters());
    }
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
  const [sidebarOrder, setSidebarOrder] = useState(() =>
    readSidebarOrderFromStorage(defaultSidebarOrder),
  );

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

  const orderedViews = useMemo(() => viewItems.slice(0, 10), [viewItems]);
  const orderedTags = useMemo(() => tagItems.slice(0, 10), [tagItems]);

  const handleDeleteView = (view: SidebarView) => {
    void (async () => {
      const confirmed = await confirm({
        title: t("sidebar.deleteViewTitle", { name: view.name }),
        description: t("sidebar.deleteViewDesc"),
        confirmLabel: t("common.delete"),
        cancelLabel: t("common.cancel"),
        variant: "danger",
        onConfirm: async () => {
          await deleteSavedView.mutateAsync({ id: view.id });
        },
      });
      if (!confirmed) {
        return;
      }
      await invalidateVaultState();
      showToastAfterRefresh(() => {
        toast.success(t("sidebar.viewDeleted"));
      });
    })();
  };

  const handleDeleteTag = (tag: SidebarTag) => {
    const { updatedViews, deletedViews } = getTagViewImpact(tag, viewItems);

    void (async () => {
      const confirmed = await confirm({
        title: t("sidebar.deleteTagTitle", { name: tag.name }),
        description: (
          <TagDeleteDescription tag={tag} updatedViews={updatedViews} deletedViews={deletedViews} />
        ),
        confirmLabel: t("common.delete"),
        cancelLabel: t("common.cancel"),
        variant: "danger",
        onConfirm: async () => {
          await deleteTag.mutateAsync({ id: tag.id });
        },
      });
      if (!confirmed) {
        return;
      }
      await invalidateVaultState();
      showToastAfterRefresh(() => {
        toast.success(t("sidebar.tagDeleted"));
      });
    })();
  };

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

    if (sectionId === "views") {
      const nextIds = arrayMove(
        orderedViews.map((view) => view.id),
        source.initialIndex,
        source.index,
      );
      reorderSavedViews.mutate({ vaultId, orderedIds: nextIds });
      return;
    }

    const nextIds = arrayMove(
      orderedTags.map((tag) => tag.id),
      source.initialIndex,
      source.index,
    );
    reorderTags.mutate({ vaultId, orderedIds: nextIds });
  };

  const moveSidebarView = (fromIndex: number, toIndex: number) => {
    const currentIds = orderedViews.map((view) => view.id);
    const nextIndex = Math.max(0, Math.min(currentIds.length - 1, toIndex));
    if (fromIndex === nextIndex) return;

    reorderSavedViews.mutate({ vaultId, orderedIds: arrayMove(currentIds, fromIndex, nextIndex) });
  };

  const moveSidebarTag = (fromIndex: number, toIndex: number) => {
    const currentIds = orderedTags.map((tag) => tag.id);
    const nextIndex = Math.max(0, Math.min(currentIds.length - 1, toIndex));
    if (fromIndex === nextIndex) return;

    reorderTags.mutate({ vaultId, orderedIds: arrayMove(currentIds, fromIndex, nextIndex) });
  };

  const renderSortableSection = (
    sectionId: SidebarSectionId,
    dragHandleRef: (element: Element | null) => void,
  ) => {
    if (sectionId === "views") {
      return (
        <SidebarSection
          title={t("sidebar.views")}
          dragHandleRef={dragHandleRef}
          action={
            <>
              <button
                type="button"
                aria-label={t("sidebar.newView")}
                data-no-drag
                className="grid h-5 w-5 place-items-center rounded text-zinc-400 hover:bg-black/5 hover:text-zinc-700"
                onClick={onCreateView}
              >
                <Plus size={11} />
              </button>
              <button
                type="button"
                data-no-drag
                className="rounded px-1.5 py-0.5 text-[11px] text-zinc-400 hover:bg-black/5 hover:text-zinc-700"
                onClick={() => void navigate({ to: "/views" })}
              >
                {t("common.manage")}
              </button>
            </>
          }
        >
          <div className="space-y-0.5">
            {orderedViews.map((view, index) => (
              <SortableSidebarItem key={view.id} sectionId="views" itemId={view.id} index={index}>
                <SidebarItem
                  renderIcon={(className) => (
                    <ViewIconRenderer value={view.icon} size={14} className={className} />
                  )}
                  label={view.name}
                  meta={view.count}
                  active={
                    !isNonHomeRoute &&
                    activeSidebarItem.kind === "view" &&
                    activeSidebarItem.id === view.id
                  }
                  onClick={() => handleViewClick(view.id)}
                  actions={
                    <>
                      <SidebarItemActionButton
                        label={t("sidebar.moveItemUp", { name: view.name })}
                        icon={ArrowUp}
                        disabled={index === 0}
                        onClick={() => moveSidebarView(index, index - 1)}
                      />
                      <SidebarItemActionButton
                        label={t("sidebar.moveItemDown", { name: view.name })}
                        icon={ArrowDown}
                        disabled={index === orderedViews.length - 1}
                        onClick={() => moveSidebarView(index, index + 1)}
                      />
                      <SidebarItemMoreMenu
                        itemName={view.name}
                        isFirst={index === 0}
                        onMoveFirst={() => moveSidebarView(index, 0)}
                        onEdit={() => onEditView(view)}
                        onDelete={() => handleDeleteView(view)}
                      />
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
        title={t("sidebar.tags")}
        dragHandleRef={dragHandleRef}
        action={
          <>
            <button
              type="button"
              aria-label={t("sidebar.newTag")}
              data-no-drag
              className="grid h-5 w-5 place-items-center rounded text-zinc-400 hover:bg-black/5 hover:text-zinc-700"
              onClick={onCreateTag}
            >
              <Plus size={11} />
            </button>
            <button
              type="button"
              data-no-drag
              className="rounded px-1.5 py-0.5 text-[11px] text-zinc-400 hover:bg-black/5 hover:text-zinc-700"
              onClick={() => void navigate({ to: "/tags" })}
            >
              {t("common.manage")}
            </button>
          </>
        }
      >
        <div className="space-y-0.5">
          {orderedTags.map((tag, index) => (
            <SortableSidebarItem key={tag.id} sectionId="tags" itemId={tag.id} index={index}>
              <SidebarItem
                colorDot={tag.color ?? `oklch(0.62 0.14 ${getTagHue(tag.name)})`}
                label={tag.name}
                meta={tag.count}
                active={
                  !isNonHomeRoute &&
                  activeSidebarItem.kind === "tag" &&
                  activeSidebarItem.id === tag.id
                }
                onClick={() => handleTagClick(tag.id)}
                actions={
                  <>
                    <SidebarItemActionButton
                      label={t("sidebar.moveItemUp", { name: tag.name })}
                      icon={ArrowUp}
                      disabled={index === 0}
                      onClick={() => moveSidebarTag(index, index - 1)}
                    />
                    <SidebarItemActionButton
                      label={t("sidebar.moveItemDown", { name: tag.name })}
                      icon={ArrowDown}
                      disabled={index === orderedTags.length - 1}
                      onClick={() => moveSidebarTag(index, index + 1)}
                    />
                    <SidebarItemMoreMenu
                      itemName={tag.name}
                      isFirst={index === 0}
                      onMoveFirst={() => moveSidebarTag(index, 0)}
                      onEdit={() => onEditTag(tag)}
                      onDelete={() => handleDeleteTag(tag)}
                    />
                  </>
                }
              />
            </SortableSidebarItem>
          ))}
        </div>
      </SidebarSection>
    );
  };

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
      {/* Chrome row spacer: reserves the traffic-light + WindowChromeNav toolbar zone and keeps
          the window-drag region. The sidebar toggle now lives in WindowChromeNav. */}
      <div className={sidebarChromeClassName}>
        <div aria-hidden="true" className={`${sidebarChromeDragClassName} absolute inset-0 z-0`} />
      </div>

      <div className="shrink-0 px-3 pb-1">
        <SidebarSection
          title={t("sidebar.assetManagement")}
          action={
            <button
              type="button"
              className="window-no-drag flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] text-zinc-400 hover:bg-black/5"
            >
              <Plus size={11} />
              {t("common.new")}
            </button>
          }
        >
          <div className="space-y-0.5">
            {(
              [
                {
                  id: "all" as const,
                  icon: Archive,
                  label: t("sidebar.allAssets"),
                  count: summary.total,
                },
                {
                  id: "inbox" as const,
                  icon: Inbox,
                  label: t("sidebar.inbox"),
                  count: summary.untagged,
                },
              ] as const
            ).map((item) => (
              <SidebarItem
                key={item.id}
                icon={item.icon}
                label={item.label}
                meta={item.count}
                active={
                  !isNonHomeRoute &&
                  activeSidebarItem.kind === "mgmt" &&
                  activeSidebarItem.id === item.id
                }
                onClick={() => handleMgmtItemClick(item.id)}
              />
            ))}
            <SidebarItem
              icon={Network}
              label={t("sidebar.knowledgeGraph")}
              active={location.pathname === "/graph"}
              onClick={() => void navigate({ to: "/graph" })}
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
                return (
                  event.target instanceof Element &&
                  event.target.closest(
                    "button, a, input, textarea, select, [contenteditable='true'], [data-no-drag]",
                  ) !== null
                );
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
