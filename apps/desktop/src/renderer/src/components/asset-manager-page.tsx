import React, { useState, useRef, useEffect, useMemo, type ComponentType, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { DragDropProvider, type DragEndEvent } from "@dnd-kit/react";
import { isSortable, useSortable } from "@dnd-kit/react/sortable";
import { PointerActivationConstraints, PointerSensor } from "@dnd-kit/dom";
import { arrayMove } from "@dnd-kit/helpers";
import { AnimatePresence, motion } from "motion/react";
import { useMasonry, usePositioner, useResizeObserver as useMasonryResizeObserver } from "masonic";
import { Collapsible, CollapsibleTrigger } from "@/components/ui/collapsible";
import {
  Archive,
  ArrowLeft,
  ChevronDown,
  ExternalLink,
  FileSpreadsheet,
  FileText,
  Filter,
  FolderKanban,
  Globe,
  Image as ImageIcon,
  Inbox,
  Info,
  Link as LinkIcon,
  MoreHorizontal,
  PanelLeftOpen,
  PanelLeftClose,
  Pencil,
  Play,
  Plus,
  ShieldCheck,
  Tags,
  Trash2,
  Video,
} from "lucide-react";
import {
  AccordionBody,
  AccordionItem,
  AccordionPanel,
  AccordionRoot,
  Button,
  Chip,
  Tag,
  TagGroup,
  Tabs,
} from "@heroui/react";

import type { PanelImperativeHandle } from "react-resizable-panels";
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/components/ui/resizable";
import { ScrollArea } from "@/components/ui/scroll-area";
import { trpc, type RouterOutputs } from "@/lib/trpc";

type AssetKind = "markdown" | "image" | "video" | "link" | "web" | "file";
type AssetStatus = "inbox" | "organized" | "draft" | "published";
type AssetPrivacy = "normal" | "private";

type Asset = {
  id: string;
  kind: AssetKind;
  status: AssetStatus;
  privacy: AssetPrivacy;
  title: string;
  body?: string;
  source: string;
  sourceType: "vault" | "external_file" | "url";
  time: string;
  timestampMs: number;
  tag: string;
  collection?: string;
  meta: string;
  accent: number;
  height?: "short" | "medium" | "tall";
  duration?: string;
  mediaUrl?: string;
  thumbnailUrl?: string;
  thumbnailStatus?: "pending" | "ready" | "failed" | null;
  imageWidth?: number | null;
  imageHeight?: number | null;
  thumbnailWidth?: number | null;
  thumbnailHeight?: number | null;
  url?: string;
  related: string[];
  // subtype helpers
  ogImage?: boolean;    // web: whether an OG image is cached
  fileExt?: string;     // file: "pdf" | "csv" | "docx" | "xls" …
  domain?: string;      // web/video/link: display domain
  imageCount?: number;  // image: images in the collection
};

type IndexedAsset = RouterOutputs["assets"]["list"]["assets"][number];
type SidebarTag = RouterOutputs["assets"]["list"]["tags"][number];
type SidebarView = RouterOutputs["assets"]["list"]["views"][number];
type AssetSummary = RouterOutputs["assets"]["list"]["summary"];

type SidebarSectionId = "views" | "tags";

type SidebarOrderState = {
  sections: SidebarSectionId[];
  views: string[];
  tags: string[];
};

const SIDEBAR_ORDER_STORAGE_KEY = "post.assetManager.sidebarOrder.v1";
const ASSET_FILTER_OPEN_STORAGE_KEY = "post.assetManager.filterOpen.v1";
const SIDEBAR_SECTION_IDS: SidebarSectionId[] = ["views", "tags"];
const SIDEBAR_SECTION_TYPE = "sidebar-section";
const SIDEBAR_ITEM_TYPE_PREFIX = "sidebar-item:";
const TRAFFIC_LIGHT_POSITION = { x: 18, y: 14 };
const SIDEBAR_PREVIEW_MAX_WIDTH = 320;
const SIDEBAR_PREVIEW_VIEWPORT_RATIO = 0.84;
const SIDEBAR_PREVIEW_EXIT_PADDING = 32;
const SIDEBAR_EDGE_HOTSPOT_WIDTH = 24;
let lastWindowControlsVisible: boolean | null = null;

function isMacWindow() {
  return typeof window !== "undefined" && window.api?.platform?.isMac === true;
}

function syncWindowControlsWithSidebar(trafficLightsVisible: boolean) {
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

function getSidebarPreviewWidth() {
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

function readAssetFilterOpenFromStorage() {
  if (typeof window === "undefined") {
    return false;
  }

  try {
    return window.localStorage.getItem(ASSET_FILTER_OPEN_STORAGE_KEY) === "true";
  } catch {
    return false;
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

function getTagHue(name: string): number {
  let hash = 0;
  for (let index = 0; index < name.length; index += 1) {
    hash = (hash * 31 + name.charCodeAt(index)) % 360;
  }

  return hash || 210;
}

function mapIndexedAssetKind(kind: IndexedAsset["kind"], extension?: string | null): AssetKind {
  if (kind === "markdown" || kind === "image" || kind === "video" || kind === "web") {
    return kind;
  }

  if (extension === "url" || extension === "webloc") {
    return "link";
  }

  return "file";
}

function mapIndexedAssetStatus(status: IndexedAsset["status"]): AssetStatus {
  if (status === "archived") {
    return "organized";
  }

  return status;
}

function formatBytes(sizeBytes: number) {
  if (sizeBytes < 1024) {
    return `${sizeBytes} B`;
  }

  if (sizeBytes < 1024 * 1024) {
    return `${Math.round(sizeBytes / 1024)} KB`;
  }

  return `${(sizeBytes / 1024 / 1024).toFixed(1)} MB`;
}

function formatAssetTime(value: unknown) {
  const date = value instanceof Date ? value : new Date(value as string | number);

  if (Number.isNaN(date.getTime())) {
    return "刚刚";
  }

  return new Intl.DateTimeFormat("zh-CN", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function getAssetTimestampMs(value: unknown) {
  const date = value instanceof Date ? value : new Date(value as string | number);
  return Number.isNaN(date.getTime()) ? Date.now() : date.getTime();
}

function mapIndexedAsset(asset: IndexedAsset): Asset {
  const tag = asset.tags[0]?.name ?? "待整理";
  const kind = mapIndexedAssetKind(asset.kind, asset.extension);
  const extension = asset.extension ?? asset.fileName.split(".").pop() ?? "file";
  const mediaUrl = kind === "image"
    ? `post-file://asset/${encodeURIComponent(asset.id)}/${encodeURIComponent(asset.fileName)}`
    : undefined;
  const usesOriginalAsThumbnail = kind === "image" && extension.toLowerCase() === "svg";
  const thumbnailUrl = usesOriginalAsThumbnail
    ? mediaUrl
    : kind === "image" && asset.image?.status === "ready" && asset.image.thumbnailPath
      ? `post-file://thumb/${encodeURIComponent(asset.id)}/${encodeURIComponent(asset.fileName)}.jpg`
      : undefined;
  const metaPrefix = {
    markdown: "Markdown",
    image: "图片",
    video: "视频",
    link: "链接",
    web: "网页",
    file: extension.toUpperCase(),
  } satisfies Record<AssetKind, string>;

  return {
    id: asset.id,
    kind,
    status: mapIndexedAssetStatus(asset.status),
    privacy: asset.privacy,
    title: asset.title,
    body: asset.description ?? `路径：${asset.relativePath}`,
    source: `${asset.vaultName} / ${asset.relativePath}`,
    sourceType: "vault",
    time: formatAssetTime(asset.mtimeMs),
    timestampMs: getAssetTimestampMs(asset.mtimeMs),
    tag,
    meta: `${metaPrefix[kind]} · ${formatBytes(asset.sizeBytes)}`,
    accent: getTagHue(tag),
    height: kind === "image" ? "medium" : "short",
    mediaUrl,
    thumbnailUrl,
    thumbnailStatus: asset.image?.status ?? (usesOriginalAsThumbnail ? "ready" : null),
    imageWidth: asset.image?.width,
    imageHeight: asset.image?.height,
    thumbnailWidth: asset.image?.thumbnailWidth,
    thumbnailHeight: asset.image?.thumbnailHeight,
    related: asset.relatedIds,
    fileExt: kind === "file" ? extension : undefined,
    imageCount: kind === "image" ? 1 : undefined,
  };
}

function getKindMeta(kind: AssetKind) {
  const map = {
    markdown: { label: "MD", icon: FileText },
    image: { label: "IMG", icon: ImageIcon },
    video: { label: "VIDEO", icon: Video },
    link: { label: "LINK", icon: LinkIcon },
    web: { label: "WEB", icon: Globe },
    file: { label: "FILE", icon: FileText },
  } satisfies Record<AssetKind, { label: string; icon: typeof FileText }>;

  return map[kind];
}

function getStatusLabel(status: AssetStatus) {
  return {
    inbox: "待整理",
    organized: "已整理",
    draft: "草稿",
    published: "已发布",
  }[status];
}

type AssetTypeFilter = "markdown" | "image" | "video" | "link" | "file";
type AssetFilterMatch = "and" | "or";
type AssetTimeFilter = "any" | "today" | "week" | "m30" | "custom";
type AssetStatusFilter = "any" | "inbox" | "draft" | "published";

type AssetFilterState = {
  types: AssetTypeFilter[];
  tags: string[];
  sources: string[];
  match: AssetFilterMatch;
  time: AssetTimeFilter;
  status: AssetStatusFilter;
};

const ASSET_TYPE_FILTERS = [
  { value: "markdown", label: "文字", icon: FileText },
  { value: "image", label: "图片", icon: ImageIcon },
  { value: "video", label: "视频", icon: Video },
  { value: "link", label: "链接", icon: LinkIcon },
  { value: "file", label: "文件", icon: FileText },
] satisfies Array<{ value: AssetTypeFilter; label: string; icon: typeof FileText }>;

const MATCH_FILTERS = [
  { value: "and", label: "全部条件" },
  { value: "or", label: "任意条件" },
] satisfies Array<{ value: AssetFilterMatch; label: string }>;

const TIME_FILTERS = [
  { value: "any", label: "不限" },
  { value: "today", label: "今天" },
  { value: "week", label: "本周" },
  { value: "m30", label: "近 30 天" },
  { value: "custom", label: "自定义" },
] satisfies Array<{ value: AssetTimeFilter; label: string }>;

const STATUS_FILTERS = [
  { value: "any", label: "不限" },
  { value: "inbox", label: "待整理" },
  { value: "draft", label: "草稿" },
  { value: "published", label: "已发布" },
] satisfies Array<{ value: AssetStatusFilter; label: string }>;

const TYPE_FILTER_LABELS = Object.fromEntries(
  ASSET_TYPE_FILTERS.map((item) => [item.value, item.label]),
) as Record<AssetTypeFilter, string>;
const TIME_FILTER_LABELS = Object.fromEntries(
  TIME_FILTERS.map((item) => [item.value, item.label]),
) as Record<AssetTimeFilter, string>;
const STATUS_FILTER_LABELS = Object.fromEntries(
  STATUS_FILTERS.map((item) => [item.value, item.label]),
) as Record<AssetStatusFilter, string>;

function getDefaultAssetFilters(): AssetFilterState {
  return getEmptyAssetFilters();
}

function getEmptyAssetFilters(match: AssetFilterMatch = "and"): AssetFilterState {
  return {
    types: [],
    tags: [],
    sources: [],
    match,
    time: "any",
    status: "any",
  };
}

function getActiveFilterCount(filters: AssetFilterState) {
  return (
    filters.types.length +
    filters.tags.length +
    filters.sources.length +
    (filters.time !== "any" ? 1 : 0) +
    (filters.status !== "any" ? 1 : 0)
  );
}

function getAssetSourceLabel(asset: Asset) {
  if (asset.sourceType === "vault") {
    return "资产库";
  }

  if (asset.sourceType === "external_file") {
    return "本地文件";
  }

  return "链接";
}

function getAssetTagNames(asset: Asset) {
  return asset.tag === "待整理" ? [] : [asset.tag];
}

function isAssetInTimeRange(asset: Asset, time: AssetTimeFilter) {
  if (time === "any" || time === "custom") {
    return true;
  }

  const date = new Date(asset.timestampMs);
  const now = new Date();
  const elapsedMs = Math.max(0, now.getTime() - asset.timestampMs);
  if (time === "today") {
    return date.toDateString() === now.toDateString();
  }

  if (time === "week") {
    return elapsedMs <= 7 * 24 * 60 * 60 * 1000;
  }

  return elapsedMs <= 30 * 24 * 60 * 60 * 1000;
}

function filterAssets(assetItems: readonly Asset[], filters: AssetFilterState) {
  const predicates: Array<(asset: Asset) => boolean> = [];

  if (filters.types.length > 0) {
    predicates.push((asset) => filters.types.some((type) => {
      if (type === "link") {
        return asset.kind === "link" || asset.kind === "web";
      }

      return asset.kind === type;
    }));
  }

  if (filters.tags.length > 0) {
    predicates.push((asset) => filters.tags.every((tag) => getAssetTagNames(asset).includes(tag)));
  }

  if (filters.sources.length > 0) {
    predicates.push((asset) => filters.sources.includes(getAssetSourceLabel(asset)));
  }

  if (filters.status !== "any") {
    predicates.push((asset) => asset.status === filters.status);
  }

  if (filters.time !== "any") {
    predicates.push((asset) => isAssetInTimeRange(asset, filters.time));
  }

  if (predicates.length === 0) {
    return [...assetItems];
  }

  return assetItems.filter((asset) => {
    const matches = predicates.map((predicate) => predicate(asset));
    return filters.match === "and" ? matches.every(Boolean) : matches.some(Boolean);
  });
}

function SourceBadge({ asset }: { asset: Asset }) {
  const label = {
    vault: "Vault",
    external_file: "外部路径",
    url: "链接",
  }[asset.sourceType];

  return (
    <Chip
      size="sm"
      className="border border-zinc-200 bg-white/75 text-[11px] text-zinc-600"
    >
      {label}
    </Chip>
  );
}

function TagPill({ name }: { name: string }) {
  return (
    <Chip size="sm" className="gap-1.5 bg-zinc-100 px-2 text-[11px] text-zinc-700">
      <span
        className="h-1.5 w-1.5 rounded-full"
        style={{ background: `oklch(0.62 0.14 ${getTagHue(name)})` }}
      />
      {name}
    </Chip>
  );
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

function VisualBlock({ asset }: { asset: Asset }) {
  const heightCls = { short: "h-32", medium: "h-44", tall: "h-72" }[asset.height ?? "medium"];
  const grad = `linear-gradient(135deg, oklch(0.96 0.03 ${asset.accent}), oklch(0.91 0.05 ${asset.accent + 28}))`;
  const hatch = `oklch(0.72 0.09 ${asset.accent})`;
  const Hatch = () => (
    <div
      className="absolute inset-0"
      style={{ backgroundImage: "repeating-linear-gradient(135deg, currentColor 0 1px, transparent 1px 14px)", color: hatch, opacity: 0.35 }}
    />
  );

  // Image (local or linked)
  if (asset.kind === "image") {
    if (asset.mediaUrl) {
      return (
        <div className="relative overflow-hidden border-b border-zinc-100 bg-zinc-100">
          <img
            src={asset.mediaUrl}
            alt={asset.title}
            className="block h-auto w-full"
            draggable={false}
          />
        </div>
      );
    }

    return (
      <div className={`relative ${heightCls} overflow-hidden border-b border-zinc-100`} style={{ background: grad }}>
        <Hatch />
        <div className="absolute inset-0 flex items-end p-3">
          <div className="flex items-center gap-1.5 rounded-md bg-white/70 px-2.5 py-1 text-[11px] font-medium text-zinc-700 shadow-sm backdrop-blur">
            <ImageIcon size={12} />
            {asset.sourceType === "url"
              ? `链接图片${asset.domain ? ` · ${asset.domain}` : ""}`
              : `本地图片${asset.imageCount ? ` · ${asset.imageCount} 张` : ""}`}
          </div>
        </div>
      </div>
    );
  }

  // Video (local or linked)
  if (asset.kind === "video") {
    return (
      <div className={`relative ${heightCls} overflow-hidden border-b border-zinc-100`} style={{ background: grad }}>
        <Hatch />
        <div className="absolute inset-0 flex items-center justify-center">
          <span className="grid h-11 w-11 place-items-center rounded-full bg-zinc-950/50 text-white shadow-lg backdrop-blur-sm">
            <Play size={18} fill="currentColor" />
          </span>
        </div>
        {asset.duration ? (
          <span className="absolute bottom-2 right-2 rounded bg-zinc-900/70 px-1.5 py-0.5 font-mono text-[11px] text-white">
            {asset.duration}
          </span>
        ) : null}
        {asset.domain ? (
          <span className="absolute bottom-2 left-2 rounded bg-zinc-900/50 px-1.5 py-0.5 text-[11px] text-white/80 backdrop-blur-sm">
            {asset.domain}
          </span>
        ) : (
          <span className="absolute bottom-2 left-2 rounded bg-zinc-900/50 px-1.5 py-0.5 text-[11px] text-white/80 backdrop-blur-sm">
            本地视频
          </span>
        )}
      </div>
    );
  }

  // Web with OG image cached
  if (asset.kind === "web" && asset.ogImage) {
    return (
      <div className={`relative ${heightCls} overflow-hidden border-b border-zinc-100`} style={{ background: grad }}>
        <Hatch />
        <div className="absolute inset-x-0 bottom-0 flex items-center gap-1.5 bg-black/30 px-3 py-2 backdrop-blur-sm">
          <Globe size={11} className="shrink-0 text-white/70" />
          <span className="truncate text-[11px] text-white/90">{asset.domain ?? asset.source}</span>
        </div>
      </div>
    );
  }

  // File (PDF / CSV / DOCX / …)
  if (asset.kind === "file") {
    const FileIcon = asset.fileExt === "csv" || asset.fileExt === "xls" || asset.fileExt === "xlsx"
      ? FileSpreadsheet
      : FileText;
    const extColorMap: Record<string, string> = {
      pdf: "oklch(0.55 0.18 25)",
      csv: "oklch(0.50 0.16 148)",
      xls: "oklch(0.50 0.16 148)",
      xlsx: "oklch(0.50 0.16 148)",
      docx: "oklch(0.48 0.16 230)",
      doc: "oklch(0.48 0.16 230)",
    };
    const extColor = extColorMap[asset.fileExt ?? ""] ?? "oklch(0.50 0.08 250)";
    return (
      <div className={`relative grid ${heightCls} place-items-center overflow-hidden border-b border-zinc-100 bg-zinc-50`}>
        <div className="flex flex-col items-center gap-2">
          <FileIcon size={38} style={{ color: extColor }} strokeWidth={1.5} />
          <span className="rounded-md bg-zinc-200/80 px-2 py-0.5 font-mono text-[10px] font-semibold uppercase tracking-wide text-zinc-500">
            .{asset.fileExt}
          </span>
        </div>
      </div>
    );
  }

  return null;
}

function AssetKindMark({ asset }: { asset: Asset }) {
  const { label, icon: Icon } = getKindMeta(asset.kind);

  return (
    <Chip
      size="sm"
      className="mt-0.5 h-auto min-h-0 shrink-0 gap-1 bg-transparent px-0 py-0 font-mono text-[9.5px] font-semibold tracking-wide text-zinc-400"
    >
      <Icon size={12} />
      {label}
    </Chip>
  );
}

function getAssetCoverLabel(asset: Asset) {
  if (asset.kind === "image") {
    return asset.sourceType === "url"
      ? `链接图片${asset.domain ? ` · ${asset.domain}` : ""}`
      : `本地图片${asset.imageCount ? ` · ${asset.imageCount} 张` : ""}`;
  }

  if (asset.kind === "video") {
    return asset.domain ? `视频链接 · ${asset.domain}` : "本地视频";
  }

  return "OG 图";
}

function AssetCardMedia({ asset }: { asset: Asset }) {
  const heightCls = { short: "h-32", medium: "h-44", tall: "h-72" }[asset.height ?? "medium"];
  const isVideo = asset.kind === "video";
  const Icon = asset.kind === "image" ? ImageIcon : asset.kind === "video" ? Play : LinkIcon;
  const imageAspectRatio = asset.kind === "image" && asset.imageWidth && asset.imageHeight
    ? `${asset.imageWidth} / ${asset.imageHeight}`
    : undefined;

  return (
    <div
      className={`relative ${imageAspectRatio ? "" : heightCls} overflow-hidden`}
      style={{
        ...(imageAspectRatio ? { aspectRatio: imageAspectRatio } : {}),
        background: `
          radial-gradient(120% 90% at 18% 12%, oklch(0.86 0.06 ${asset.accent}) 0%, transparent 62%),
          linear-gradient(150deg, oklch(0.76 0.08 ${asset.accent}) 0%, oklch(0.9 0.05 ${asset.accent + 34}) 100%)
        `,
      }}
    >
      {asset.kind === "image" && asset.thumbnailUrl ? (
        <img
          src={asset.thumbnailUrl}
          alt={asset.title}
          className="absolute inset-0 h-full w-full object-cover"
          loading="lazy"
          decoding="async"
          draggable={false}
        />
      ) : null}

      <Chip
        size="sm"
        className="absolute bottom-2.5 left-2.5 h-auto min-h-0 max-w-[calc(100%-20px)] gap-1.5 rounded-[7px] bg-white/82 px-2 py-1 text-[10.5px] font-medium text-[#37322c] shadow-[0_1px_1px_rgba(20,18,14,0.06)] backdrop-blur"
      >
        <Icon size={11} className="shrink-0" fill={isVideo ? "currentColor" : "none"} />
        <span className="truncate">{getAssetCoverLabel(asset)}</span>
      </Chip>

      {isVideo ? (
        <>
          <span className="absolute left-1/2 top-1/2 grid h-11 w-11 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full bg-[#1c1916]/45 text-white shadow-sm backdrop-blur-sm">
            <Play size={17} fill="currentColor" />
          </span>
          {asset.duration ? (
            <span className="absolute right-2.5 top-2.5 rounded-md bg-[#1c1916]/55 px-1.5 py-0.5 font-mono text-[10.5px] text-white">
              {asset.duration}
            </span>
          ) : null}
        </>
      ) : null}
    </div>
  );
}

function AssetFilePreview({ asset }: { asset: Asset }) {
  const FileIcon = asset.fileExt === "csv" || asset.fileExt === "xls" || asset.fileExt === "xlsx"
    ? FileSpreadsheet
    : FileText;
  const extHueMap: Record<string, number> = {
    pdf: 12,
    csv: 150,
    xls: 150,
    xlsx: 150,
    doc: 222,
    docx: 222,
  };
  const extHue = extHueMap[asset.fileExt ?? ""] ?? 230;

  return (
    <div
      className="mt-3 flex flex-col items-center justify-center gap-2 rounded-xl bg-white py-7"
      style={{ color: `oklch(0.52 0.16 ${extHue})` }}
    >
      <FileIcon size={30} strokeWidth={1.6} />
      <Chip
        size="sm"
        className="h-auto min-h-0 bg-transparent px-0 py-0 font-mono text-[11px] font-semibold uppercase tracking-wide"
      >
        .{asset.fileExt ?? "file"}
      </Chip>
    </div>
  );
}

function AssetUrlPreview({ asset }: { asset: Asset }) {
  const domain = asset.domain ?? asset.url ?? asset.source;

  return (
    <div className="mt-3 flex items-center gap-2.5 rounded-[10px] bg-white px-3 py-2.5">
      <span
        className="h-3.5 w-3.5 shrink-0 rounded"
        style={{
          background: `linear-gradient(135deg, oklch(0.56 0.14 ${asset.accent}), oklch(0.42 0.12 ${asset.accent}))`,
        }}
      />
      <span className="min-w-0 flex-1 truncate text-[12.5px] font-medium text-[#1c1b19]">
        {domain}
      </span>
      <ExternalLink size={12} className="shrink-0 text-zinc-400" />
    </div>
  );
}

function AssetCardTagRow({ asset }: { asset: Asset }) {
  return (
    <div className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-1.5">
      <Chip size="sm" className="h-auto min-h-0 gap-1.5 bg-transparent px-0 py-0 text-[11.5px] font-medium text-[#1c1b19]">
        <span
          className="h-[7px] w-[7px] rounded-full"
          style={{ background: `oklch(0.6 0.14 ${getTagHue(asset.tag)})` }}
        />
        {asset.tag}
      </Chip>
      <Chip size="sm" className="h-auto min-h-0 bg-transparent px-0 py-0 text-[11.5px] text-zinc-400 before:mr-2 before:text-zinc-300 before:content-['·']">
        {getAssetSourceLabel(asset)}
      </Chip>
      {asset.privacy === "private" ? (
        <Chip size="sm" className="h-auto min-h-0 gap-1 bg-transparent px-0 py-0 text-[10.5px] font-semibold text-amber-700">
          <ShieldCheck size={11} />
          私密
        </Chip>
      ) : null}
    </div>
  );
}

const AssetCard = React.memo(function AssetCard({ asset }: { asset: Asset }) {
  const hasCover =
    asset.kind === "image" ||
    asset.kind === "video" ||
    (asset.kind === "web" && asset.ogImage);
  const showUrlRow = asset.kind === "link" || (asset.kind === "web" && !asset.ogImage);

  return (
    <article className="overflow-hidden rounded-2xl bg-[#f6f5f2] transition-colors duration-150 hover:bg-[#f2f1ed]">
      <button
        type="button"
        className="block w-full text-left outline-none focus-visible:ring-2 focus-visible:ring-zinc-500/20"
        onClick={() => {
          window.location.hash = `/assets/${asset.id}`;
        }}
      >
        {hasCover ? <AssetCardMedia asset={asset} /> : null}

        <div className="px-4 py-3.5">
          <div className="flex items-start gap-2.5">
            <h2 className="min-w-0 flex-1 text-[15.5px] font-semibold leading-[1.4] tracking-normal text-[#1c1b19]">
              {asset.title}
            </h2>
            {!hasCover ? <AssetKindMark asset={asset} /> : null}
          </div>

          {asset.kind === "file" ? <AssetFilePreview asset={asset} /> : null}
          {showUrlRow ? <AssetUrlPreview asset={asset} /> : null}

          {asset.body ? (
            <p className="mt-2.5 line-clamp-5 whitespace-pre-line text-[13px] leading-[1.62] text-[#6c6a64]">
              {asset.body}
            </p>
          ) : null}

          <AssetCardTagRow asset={asset} />

          <div className="mt-3 flex items-center justify-between gap-3 border-t border-[#1c120e]/[0.06] pt-3 text-[11px] text-zinc-400">
            <span className="min-w-0 truncate">{asset.meta}</span>
            <span className="shrink-0">{asset.time}</span>
          </div>
        </div>
      </button>
    </article>
  );
});

function SidebarEdgeHotspot({ onOpen }: { onOpen: () => void }) {
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

function FloatingSidebarDragOverlay() {
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

function Sidebar({
  tagItems,
  viewItems,
  summary,
  onToggleSidebar,
  toggleMode = "collapse",
  floating = false,
}: {
  tagItems: SidebarTag[];
  viewItems: SidebarView[];
  summary: AssetSummary;
  onToggleSidebar: () => void;
  toggleMode?: "collapse" | "expand";
  floating?: boolean;
}) {
  const defaultSidebarOrder = useMemo(
    () => getDefaultSidebarOrder(viewItems, tagItems),
    [viewItems, tagItems],
  );
  const [sidebarOrder, setSidebarOrder] = useState(() => readSidebarOrderFromStorage(defaultSidebarOrder));

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

  const orderedViews = useMemo(
    () => orderByIds(viewItems, sidebarOrder.views, (view) => view.id).slice(0, 5),
    [sidebarOrder.views, viewItems],
  );
  const orderedTags = useMemo(
    () => orderByIds(tagItems, sidebarOrder.tags, (tag) => tag.id).slice(0, 10),
    [sidebarOrder.tags, tagItems],
  );

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
            {[
              { icon: Archive, label: "全部资产", count: summary.total, active: true },
              { icon: Inbox, label: "待整理", count: summary.inbox },
            ].map((item) => (
              <SidebarItem
                key={item.label}
                icon={item.icon}
                label={item.label}
                meta={item.count}
                active={"active" in item ? item.active : false}
                onClick={() => { window.location.hash = "/"; }}
              />
            ))}
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

type AssetBoardHeaderProps = {
  filterOpen: boolean;
  activeFilterCount: number;
  onToggleFilter: () => void;
  dragEnabled?: boolean;
};

function AssetBoardHeader({
  filterOpen,
  activeFilterCount,
  onToggleFilter,
  dragEnabled = true,
}: AssetBoardHeaderProps) {
  const filterActive = filterOpen || activeFilterCount > 0;
  const dragClassName = dragEnabled ? "window-drag" : "window-no-drag";

  return (
    <div className={`${dragClassName} relative z-[70] flex h-14 shrink-0 items-center gap-2.5 border-b border-zinc-100 bg-white px-6`}>
      <h1 className="mr-auto text-lg font-semibold tracking-normal text-zinc-950">全部资产</h1>
      <div className="window-no-drag relative z-[80] flex items-center gap-2.5 pointer-events-auto">
        <Button
          size="sm"
          variant={filterActive ? "secondary" : "ghost"}
          aria-controls="asset-filter-panel"
          aria-expanded={filterOpen}
          className={`window-no-drag h-7 min-h-0 gap-1.5 rounded-lg px-2.5 text-[11.5px] ${
            filterActive
              ? "border border-blue-200 bg-blue-50 text-blue-700"
              : "border border-zinc-200 bg-white text-zinc-600"
          }`}
          onPress={onToggleFilter}
        >
          <Filter size={14} />
          筛选
          {activeFilterCount > 0 ? (
            <span className="ml-0.5 grid h-3.5 min-w-3.5 place-items-center rounded-full bg-blue-600 px-1 text-[9px] font-bold leading-none text-white">
              {activeFilterCount}
            </span>
          ) : null}
          <ChevronDown
            size={13}
            className={`transition-transform duration-200 ${filterOpen ? "rotate-180" : ""}`}
          />
        </Button>
        <Button
          size="sm"
          variant="primary"
          className="window-no-drag h-7 min-h-0 gap-1.5 rounded-lg px-2.5 text-[11.5px] font-semibold"
          onPress={() => {}}
        >
          <Plus size={14} />
          新建
        </Button>
      </div>
    </div>
  );
}

type FilterSegmentProps<T extends string> = {
  options: Array<{ value: T; label: string }>;
  value: T;
  onChange: (value: T) => void;
};

function FilterSegment<T extends string>({ options, value, onChange }: FilterSegmentProps<T>) {
  return (
    <Tabs.Root
      selectedKey={value}
      onSelectionChange={(key) => onChange(String(key) as T)}
      className="gap-0"
    >
      <Tabs.ListContainer className="inline-flex">
        <Tabs.List className="w-auto rounded-lg bg-zinc-100 p-0.5">
          {options.map((option) => (
            <Tabs.Tab
              key={option.value}
              id={option.value}
              className="h-6 w-auto rounded-md px-2.5 text-[11.5px] font-medium text-zinc-500 data-[selected=true]:text-zinc-950"
            >
              <Tabs.Indicator className="rounded-md bg-white shadow-[0_1px_2px_rgba(20,18,14,0.06)]" />
              {option.label}
            </Tabs.Tab>
          ))}
        </Tabs.List>
      </Tabs.ListContainer>
    </Tabs.Root>
  );
}

type AssetFilterTagOption<T extends string = string> = {
  value: T;
  label: string;
  icon?: ComponentType<{ size?: number; className?: string }>;
  dotHue?: number;
};

type AssetFilterTagGroupProps<T extends string> = {
  label: string;
  options: readonly AssetFilterTagOption<T>[];
  selectedValues: readonly T[];
  onSelectedValuesChange: (values: T[]) => void;
};

function AssetFilterTagGroup<T extends string>({
  label,
  options,
  selectedValues,
  onSelectedValuesChange,
}: AssetFilterTagGroupProps<T>) {
  return (
    <TagGroup
      aria-label={label}
      size="sm"
      selectionMode="multiple"
      selectedKeys={new Set(selectedValues)}
      onSelectionChange={(keys) => {
        const nextValues = keys === "all"
          ? options.map((option) => option.value)
          : Array.from(keys, (key) => String(key) as T);

        onSelectedValuesChange(nextValues);
      }}
      className="gap-0"
    >
      <TagGroup.List className="flex flex-wrap gap-1.5">
        {options.map(({ value, label: optionLabel, icon: Icon, dotHue }) => (
          <Tag
            key={value}
            id={value}
            className="h-6 min-h-0 cursor-default gap-1.5 rounded-full bg-zinc-100 px-2.5 py-0 text-[11.5px] font-medium text-zinc-500 transition-colors hover:bg-zinc-200/70 hover:text-zinc-700 data-[selected=true]:bg-blue-50 data-[selected=true]:font-semibold data-[selected=true]:text-blue-700 data-[selected=true]:shadow-[inset_0_0_0_1px_rgba(37,99,235,0.24)]"
          >
            {Icon ? <Icon size={12} /> : null}
            {dotHue !== undefined ? (
              <span
                className="h-[7px] w-[7px] rounded-full"
                style={{ background: `oklch(0.6 0.14 ${dotHue})` }}
              />
            ) : null}
            {optionLabel}
          </Tag>
        ))}
      </TagGroup.List>
    </TagGroup>
  );
}

function AssetFilterField({ label, children, wide = true }: { label: string; children: ReactNode; wide?: boolean }) {
  return (
    <div className={`flex gap-3 ${wide ? "items-start" : "flex-col"}`}>
      <span className={`shrink-0 text-[10.5px] font-semibold tracking-wide text-zinc-400 ${wide ? "w-8 pt-1" : ""}`}>
        {label}
      </span>
      <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5">{children}</div>
    </div>
  );
}

type AssetFilterPanelProps = {
  filters: AssetFilterState;
  onFiltersChange: React.Dispatch<React.SetStateAction<AssetFilterState>>;
  tagOptions: SidebarTag[];
  sourceOptions: string[];
  resultCount: number;
};

function AssetFilterPanel({
  filters,
  onFiltersChange,
  tagOptions,
  sourceOptions,
  resultCount,
}: AssetFilterPanelProps) {
  return (
    <AccordionPanel id="asset-filter-panel" className="overflow-hidden border-b border-zinc-200 bg-[#fbfbfa]">
      <AccordionBody className="space-y-3 px-6 py-3">
        <div className="flex items-center gap-2.5">
          <span className="text-[10.5px] font-semibold tracking-wide text-zinc-400">符合</span>
          <FilterSegment
            options={MATCH_FILTERS}
            value={filters.match}
            onChange={(match) => onFiltersChange((current) => ({ ...current, match }))}
          />
        </div>

        <AssetFilterField label="类型">
          <AssetFilterTagGroup
            label="资产类型"
            options={ASSET_TYPE_FILTERS}
            selectedValues={filters.types}
            onSelectedValuesChange={(types) => onFiltersChange((current) => ({ ...current, types }))}
          />
        </AssetFilterField>

        <AssetFilterField label="标签">
          <AssetFilterTagGroup
            label="资产标签"
            options={tagOptions.map((tag) => ({
              value: tag.name,
              label: tag.name,
              dotHue: getTagHue(tag.name),
            }))}
            selectedValues={filters.tags}
            onSelectedValuesChange={(tags) => onFiltersChange((current) => ({ ...current, tags }))}
          />
        </AssetFilterField>

        <AssetFilterField label="来源">
          <AssetFilterTagGroup
            label="资产来源"
            options={sourceOptions.map((source) => ({ value: source, label: source }))}
            selectedValues={filters.sources}
            onSelectedValuesChange={(sources) => onFiltersChange((current) => ({ ...current, sources }))}
          />
        </AssetFilterField>

        <div className="grid gap-4 md:grid-cols-2">
          <AssetFilterField label="时间" wide={false}>
            <FilterSegment
              options={TIME_FILTERS}
              value={filters.time}
              onChange={(time) => onFiltersChange((current) => ({ ...current, time }))}
            />
          </AssetFilterField>
          <AssetFilterField label="状态" wide={false}>
            <FilterSegment
              options={STATUS_FILTERS}
              value={filters.status}
              onChange={(status) => onFiltersChange((current) => ({ ...current, status }))}
            />
          </AssetFilterField>
        </div>

        <div className="flex items-center border-t border-zinc-100 pt-2.5">
          <Button
            size="sm"
            variant="ghost"
            className="h-7 min-h-0 px-1 text-[11.5px] text-zinc-500"
            onPress={() => onFiltersChange((current) => getEmptyAssetFilters(current.match))}
          >
            重置全部
          </Button>
          <div className="ml-auto flex items-center gap-1.5">
            <Button
              size="sm"
              variant="secondary"
              className="h-7 min-h-0 rounded-lg border border-zinc-200 bg-white px-2.5 text-[11.5px] text-zinc-500"
              onPress={() => {}}
            >
              <Plus size={13} />
              存为视图
            </Button>
            <Button
              size="sm"
              variant="primary"
              className="h-7 min-h-0 rounded-lg px-3 text-[11.5px] font-semibold"
              onPress={() => {}}
            >
              应用筛选 · {resultCount} 项
            </Button>
          </div>
        </div>
      </AccordionBody>
    </AccordionPanel>
  );
}

type ActiveFilterChip = {
  key: string;
  label: string;
  group: "type" | "tag" | "source" | "time" | "status";
  value?: string;
  hue?: number;
};

function getActiveFilterChips(filters: AssetFilterState): ActiveFilterChip[] {
  return [
    ...filters.types.map((type) => ({
      key: `type-${type}`,
      label: TYPE_FILTER_LABELS[type],
      group: "type" as const,
      value: type,
    })),
    ...filters.tags.map((tag) => ({
      key: `tag-${tag}`,
      label: tag,
      group: "tag" as const,
      value: tag,
      hue: getTagHue(tag),
    })),
    ...filters.sources.map((source) => ({
      key: `source-${source}`,
      label: source,
      group: "source" as const,
      value: source,
    })),
    ...(filters.time !== "any"
      ? [{
        key: "time",
        label: TIME_FILTER_LABELS[filters.time],
        group: "time" as const,
      }]
      : []),
    ...(filters.status !== "any"
      ? [{
        key: "status",
        label: STATUS_FILTER_LABELS[filters.status],
        group: "status" as const,
      }]
      : []),
  ];
}

function AssetActiveFilterSummary({
  filters,
  onFiltersChange,
  resultCount,
  totalCount,
}: {
  filters: AssetFilterState;
  onFiltersChange: React.Dispatch<React.SetStateAction<AssetFilterState>>;
  resultCount: number;
  totalCount: number;
}) {
  const chips = getActiveFilterChips(filters);

  if (chips.length === 0) {
    return null;
  }

  const removeChips = (keys: Set<React.Key>) => {
    const chipsByKey = new Map(chips.map((chip) => [chip.key, chip]));

    onFiltersChange((current) => {
      return Array.from(keys).reduce<AssetFilterState>((nextFilters, key) => {
        const chip = chipsByKey.get(String(key));

        if (!chip) {
          return nextFilters;
        }

        if (chip.group === "type") {
          return { ...nextFilters, types: nextFilters.types.filter((type) => type !== chip.value) };
        }

        if (chip.group === "tag") {
          return { ...nextFilters, tags: nextFilters.tags.filter((tag) => tag !== chip.value) };
        }

        if (chip.group === "source") {
          return { ...nextFilters, sources: nextFilters.sources.filter((source) => source !== chip.value) };
        }

        if (chip.group === "time") {
          return { ...nextFilters, time: "any" };
        }

        return { ...nextFilters, status: "any" };
      }, current);
    });
  };

  return (
    <div className="flex shrink-0 flex-wrap items-center gap-1.5 border-b border-zinc-100 px-6 py-2">
      <span className="mr-1 text-[11.5px] font-semibold text-zinc-500">
        已筛选 · {resultCount} / {totalCount} 项
      </span>
      <TagGroup
        aria-label="已筛选条件"
        size="sm"
        onRemove={removeChips}
        className="gap-0"
      >
        <TagGroup.List className="flex flex-wrap gap-1.5">
          {chips.map((chip) => (
            <Tag
              key={chip.key}
              id={chip.key}
              className="h-5 min-h-0 cursor-default gap-1.5 rounded-full bg-[#f3f2ef] px-2 py-0 text-[11px] font-medium text-zinc-700"
            >
              {chip.hue !== undefined ? (
                <span
                  className="h-[7px] w-[7px] rounded-full"
                  style={{ background: `oklch(0.6 0.14 ${chip.hue})` }}
                />
              ) : null}
              {chip.label}
            </Tag>
          ))}
        </TagGroup.List>
      </TagGroup>
      <Button
        size="sm"
        variant="ghost"
        className="h-5 min-h-0 px-1 text-[11px] text-zinc-400 hover:text-zinc-700"
        onPress={() => onFiltersChange((current) => getEmptyAssetFilters(current.match))}
      >
        清除
      </Button>
    </div>
  );
}

const MasonryCard = React.memo(function MasonryCard({ data }: { index: number; data: Asset; width: number }) {
  return <AssetCard asset={data} />;
});

function AssetBoard({
  assetItems,
  tagOptions,
  vaultName,
  loading,
  importing,
  reconciling,
  conflictCount,
  errorMessage,
  onImportVault,
  onReconcileVault,
  dragEnabled = true,
}: {
  assetItems: Asset[];
  tagOptions: SidebarTag[];
  vaultName?: string;
  loading: boolean;
  importing: boolean;
  reconciling: boolean;
  conflictCount: number;
  errorMessage?: string;
  onImportVault: () => void;
  onReconcileVault: () => void;
  dragEnabled?: boolean;
}) {
  const scrollViewportRef = useRef<HTMLDivElement>(null);
  const masonryGridRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [scrollTop, setScrollTop] = useState(0);
  const [isScrolling, setIsScrolling] = useState(false);
  const [filterOpen, setFilterOpen] = useState(readAssetFilterOpenFromStorage);
  const [filters, setFilters] = useState(getDefaultAssetFilters);
  const scrollTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const scrollFrame = useRef<number | undefined>(undefined);
  const isScrollingRef = useRef(false);
  const activeFilterCount = getActiveFilterCount(filters);
  const sourceOptions = useMemo(
    () => Array.from(new Set(assetItems.map(getAssetSourceLabel))),
    [assetItems],
  );
  const filteredAssetItems = useMemo(
    () => filterAssets(assetItems, filters),
    [assetItems, filters],
  );

  useEffect(() => {
    try {
      window.localStorage.setItem(ASSET_FILTER_OPEN_STORAGE_KEY, String(filterOpen));
    } catch {
      // Ignore storage failures; filter UI should still work for the current session.
    }
  }, [filterOpen]);

  useEffect(() => {
    const el = scrollViewportRef.current;
    if (!el) return;

    const ro = new ResizeObserver(() => {
      setSize({ width: el.clientWidth, height: el.clientHeight });
    });
    ro.observe(el);
    setSize({ width: el.clientWidth, height: el.clientHeight });

    const onScroll = () => {
      if (scrollFrame.current === undefined) {
        scrollFrame.current = window.requestAnimationFrame(() => {
          scrollFrame.current = undefined;
          setScrollTop(el.scrollTop);
        });
      }

      if (!isScrollingRef.current) {
        isScrollingRef.current = true;
        setIsScrolling(true);
      }

      clearTimeout(scrollTimer.current);
      scrollTimer.current = setTimeout(() => {
        isScrollingRef.current = false;
        setIsScrolling(false);
      }, 150);
    };
    el.addEventListener("scroll", onScroll, { passive: true });

    return () => {
      ro.disconnect();
      el.removeEventListener("scroll", onScroll);
      clearTimeout(scrollTimer.current);
      if (scrollFrame.current !== undefined) {
        window.cancelAnimationFrame(scrollFrame.current);
      }
    };
  }, []);

  // subtract px-6 padding (24px × 2 = 48px)
  const innerWidth = Math.max(0, size.width - 48);
  const positioner = usePositioner(
    { width: innerWidth, columnGutter: 16, columnWidth: 260 },
    [innerWidth],
  );
  const resizeObserver = useMasonryResizeObserver(positioner);

  const masonry = useMasonry({
    positioner,
    scrollTop,
    isScrolling,
    height: size.height,
    containerRef: masonryGridRef,
    items: filteredAssetItems,
    render: MasonryCard,
    resizeObserver,
    itemHeightEstimate: 340,
    itemKey: (asset) => asset.id,
    overscanBy: 1,
  });

  return (
    <main className="flex h-full min-w-0 flex-col bg-white">
      <AccordionRoot
        hideSeparator
        expandedKeys={filterOpen ? ["asset-filters"] : []}
        onExpandedChange={(keys) => setFilterOpen(keys.has("asset-filters"))}
        className="shrink-0"
      >
        <AccordionItem id="asset-filters" className="border-none">
          <AssetBoardHeader
            filterOpen={filterOpen}
            activeFilterCount={activeFilterCount}
            onToggleFilter={() => setFilterOpen((open) => !open)}
            dragEnabled={dragEnabled}
          />
          <AssetFilterPanel
            filters={filters}
            onFiltersChange={setFilters}
            tagOptions={tagOptions}
            sourceOptions={sourceOptions}
            resultCount={filteredAssetItems.length}
          />
        </AccordionItem>
      </AccordionRoot>
      <AssetActiveFilterSummary
        filters={filters}
        onFiltersChange={setFilters}
        resultCount={filteredAssetItems.length}
        totalCount={assetItems.length}
      />
      <div className="flex shrink-0 items-center gap-2 border-b border-zinc-100 px-6 py-2">
        <span className="min-w-0 flex-1 truncate text-xs text-zinc-500">
          {vaultName ? `当前资产库：${vaultName}` : "还没有选择资产库"}
        </span>
        {conflictCount > 0 ? (
          <Chip size="sm" className="bg-amber-50 text-xs text-amber-700">
            {conflictCount} 个待确认冲突
          </Chip>
        ) : null}
        {vaultName ? (
          <Button
            size="sm"
            variant="ghost"
            className="h-7 px-2 text-xs"
            isDisabled={reconciling}
            onPress={onReconcileVault}
          >
            <Archive size={14} />
            {reconciling ? "同步中" : "同步"}
          </Button>
        ) : null}
        <Button
          size="sm"
          variant="secondary"
          className="h-7 px-2 text-xs"
          isDisabled={importing}
          onPress={onImportVault}
        >
          <FolderKanban size={14} />
          {importing ? "索引中" : "选择文件夹"}
        </Button>
      </div>
      {errorMessage ? (
        <div className="shrink-0 border-b border-red-100 bg-red-50 px-6 py-2 text-xs text-red-700">
          {errorMessage}
        </div>
      ) : null}
      <ScrollArea
        type="hover"
        scrollHideDelay={260}
        className="min-h-0 flex-1"
        viewportRef={scrollViewportRef}
        viewportClassName="px-6 py-[18px]"
        scrollbarClassName="w-2 border-l-0 bg-transparent p-[2px] opacity-0 transition-opacity duration-150 data-[state=visible]:opacity-100 hover:opacity-100"
        thumbClassName="bg-zinc-400/35 hover:bg-zinc-500/45"
      >
        {loading ? (
          <div className="grid h-56 place-items-center text-sm text-zinc-400">正在读取资产库</div>
        ) : filteredAssetItems.length ? (
          masonry
        ) : (
          <div className="grid h-72 place-items-center">
            <div className="text-center">
              <FolderKanban className="mx-auto text-zinc-300" size={36} />
              <h2 className="mt-3 text-sm font-semibold text-zinc-800">选择一个文件夹开始索引</h2>
              <p className="mt-1 text-xs text-zinc-500">文件留在原地，标签和关系写入 SQLite。</p>
            </div>
          </div>
        )}
      </ScrollArea>
    </main>
  );
}

function AssetDetail({ asset, dragEnabled = true }: { asset: Asset; dragEnabled?: boolean }) {
  const { label, icon: Icon } = getKindMeta(asset.kind);
  const hasVisual = asset.kind === "image" || asset.kind === "video";
  const isLinkAsset = asset.kind === "web" || asset.kind === "link";
  const dragClassName = dragEnabled ? "window-drag" : "window-no-drag";

  return (
    <main className="flex h-full min-w-0 flex-col bg-white">
      <div className={`${dragClassName} border-b border-zinc-100 px-7 pb-4 pt-16`}>
        <div className="flex items-center gap-2 text-sm text-zinc-500">
          <Button
            size="sm"
            variant="ghost"
            className="window-no-drag h-8 px-2"
            onPress={() => {
              window.location.hash = "/";
            }}
          >
            <ArrowLeft size={16} />
            返回
          </Button>
          <span>全部资产</span>
          <span>/</span>
          <span>{asset.tag}</span>
        </div>
        <div className="mt-4 flex flex-wrap items-start gap-3">
          <Chip className="border border-zinc-200 bg-white font-mono text-xs text-zinc-500">
            <Icon size={14} />
            {label}
          </Chip>
          <div className="min-w-0 flex-1">
            <h1 className="text-2xl font-semibold tracking-normal text-zinc-950">{asset.title}</h1>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <TagPill name={asset.tag} />
              <SourceBadge asset={asset} />
              <Chip size="sm" className="bg-zinc-100 text-xs text-zinc-600">
                {asset.meta}
              </Chip>
              {asset.privacy === "private" ? (
                <Chip size="sm" className="bg-amber-50 text-xs text-amber-700">
                  <ShieldCheck size={12} />
                  禁止外发
                </Chip>
              ) : null}
            </div>
          </div>
          <Button isIconOnly aria-label="更多资产操作" variant="secondary" className="window-no-drag">
            <MoreHorizontal size={17} />
          </Button>
        </div>
      </div>

      <ScrollArea className="min-h-0 flex-1" viewportClassName="px-10 py-8">
        <article className="mx-auto max-w-3xl space-y-8">
          {hasVisual ? (
            <div className="overflow-hidden rounded-lg">
              <VisualBlock asset={{ ...asset, height: "tall" }} />
            </div>
          ) : null}

          <section className="space-y-4">
            <div className="flex items-center gap-2 text-sm font-semibold text-zinc-950">
              <FileText size={16} className="text-blue-600" />
              内容预览
            </div>

            {isLinkAsset ? (
              <div className="space-y-4">
                <div className="border-y border-zinc-200 py-5">
                  <div className="flex items-center gap-2 text-sm font-medium text-zinc-900">
                    <Globe size={16} />
                    {asset.source}
                  </div>
                  <p className="mt-2 text-sm leading-6 text-zinc-600">
                    第一版链接资产只保存 URL、标题、备注、标签和关系，不做网页正文归档。
                  </p>
                </div>
                <Button variant="secondary">
                  <LinkIcon size={16} />
                  打开原链接
                </Button>
              </div>
            ) : (
              <p className="whitespace-pre-line text-[15px] leading-8 text-zinc-700">
                {asset.body}
              </p>
            )}
          </section>

          {asset.body && hasVisual ? (
            <section className="space-y-3 border-t border-zinc-100 pt-6">
              <h2 className="text-sm font-semibold text-zinc-950">备注</h2>
              <p className="whitespace-pre-line text-[15px] leading-8 text-zinc-700">
                {asset.body}
              </p>
            </section>
          ) : null}
        </article>
      </ScrollArea>
    </main>
  );
}

function InspectorSection({
  title,
  icon: Icon,
  children,
}: {
  title: string;
  icon: typeof Info;
  children: React.ReactNode;
}) {
  return (
    <section className="border-b border-zinc-200 px-5 py-4">
      <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-zinc-950">
        <Icon size={16} className="text-blue-600" />
        {title}
      </div>
      {children}
    </section>
  );
}

function AssetInspector({
  asset,
  allAssets,
  onAddTag,
  dragEnabled = true,
}: {
  asset: Asset;
  allAssets: Asset[];
  onAddTag: (assetId: string, name: string) => void;
  dragEnabled?: boolean;
}) {
  const relatedAssets = allAssets.filter((item) => asset.related.includes(item.id));
  const dragClassName = dragEnabled ? "window-drag" : "window-no-drag";

  return (
    <aside className="flex h-full w-full flex-col border-l border-zinc-200 bg-zinc-50/70">
      <div className={`${dragClassName} flex items-center gap-2 border-b border-zinc-200 px-5 py-4`}>
        <Info size={17} className="text-blue-600" />
        <span className="font-semibold text-zinc-950">资产信息</span>
        <Chip size="sm" className="ml-auto bg-white text-xs text-zinc-500">
          {getStatusLabel(asset.status)}
        </Chip>
      </div>

      <ScrollArea className="min-h-0 flex-1">
        <InspectorSection title="元数据" icon={Info}>
          <dl className="space-y-2 text-sm">
            {[
              ["来源", asset.source],
              ["类型", asset.meta],
              ["状态", getStatusLabel(asset.status)],
              ["隐私", asset.privacy === "private" ? "私密，禁止外发" : "普通资产"],
              ["更新时间", asset.time],
            ].map(([key, value]) => (
              <div key={key} className="grid grid-cols-[58px_minmax(0,1fr)] gap-2">
                <dt className="text-zinc-400">{key}</dt>
                <dd className="min-w-0 truncate text-zinc-700">{value}</dd>
              </div>
            ))}
          </dl>
        </InspectorSection>

        <InspectorSection title="关系与标签" icon={Tags}>
          <div className="flex flex-wrap gap-2">
            <TagPill name={asset.tag} />
            {asset.collection ? (
              <Chip size="sm" className="bg-blue-50 text-xs text-blue-700">
                <FolderKanban size={12} />
                {asset.collection}
              </Chip>
            ) : null}
            <button
              type="button"
              className="inline-flex h-6 items-center gap-1.5 rounded-full border border-dashed border-zinc-200 bg-white px-2 text-xs text-zinc-400 transition-colors hover:border-blue-200 hover:text-blue-600"
              onClick={() => {
                const name = window.prompt("输入标签名称");
                if (name?.trim()) {
                  onAddTag(asset.id, name.trim());
                }
              }}
            >
              <Plus size={12} />
              添加标签
            </button>
          </div>

          <div className="mt-4 space-y-2">
            {relatedAssets.map((related) => {
              const RelatedIcon = getKindMeta(related.kind).icon;

              return (
                <button
                  key={related.id}
                  type="button"
                  className="flex w-full items-center gap-3 rounded-lg border border-zinc-200 bg-white px-3 py-2 text-left text-sm hover:border-blue-200 hover:bg-blue-50/40"
                  onClick={() => {
                    window.location.hash = `/assets/${related.id}`;
                  }}
                >
                  <RelatedIcon size={16} className="shrink-0 text-zinc-400" />
                  <span className="min-w-0 flex-1 truncate font-medium text-zinc-800">{related.title}</span>
                  <span className="shrink-0 text-xs text-zinc-400">{related.tag}</span>
                </button>
              );
            })}
          </div>
        </InspectorSection>

      </ScrollArea>
    </aside>
  );
}

function getMainDefaultSize(activeAsset: Asset | undefined, sidebarCollapsed: boolean) {
  if (!activeAsset) {
    return sidebarCollapsed ? 100 : 80;
  }

  return sidebarCollapsed ? 80 : 60;
}

export function AssetManagerPage({ assetId }: { assetId?: string }) {
  const queryClient = useQueryClient();
  const assetsQuery = useQuery(trpc.assets.list.queryOptions());
  const indexedAssets = useMemo(
    () => assetsQuery.data?.assets.map(mapIndexedAsset) ?? [],
    [assetsQuery.data?.assets],
  );
  const assetItems = indexedAssets;
  const activeAsset = assetId ? assetItems.find((asset) => asset.id === assetId) : undefined;
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [sidebarPreviewOpen, setSidebarPreviewOpen] = useState(false);
  const sidebarPanelRef = useRef<PanelImperativeHandle | null>(null);
  const sidebarCollapseIntentRef = useRef<"collapsed" | "expanded" | null>(null);
  const importVault = useMutation(
    trpc.assets.selectFolderAndScan.mutationOptions({
      onSuccess: async () => {
        await queryClient.invalidateQueries(trpc.assets.list.queryFilter());
        await queryClient.invalidateQueries(trpc.assets.vaults.queryFilter());
      },
    }),
  );
  const reconcileVault = useMutation(
    trpc.assets.reconcile.mutationOptions({
      onSuccess: async () => {
        await queryClient.invalidateQueries(trpc.assets.list.queryFilter());
      },
    }),
  );
  const addTag = useMutation(
    trpc.assets.addTag.mutationOptions({
      onSuccess: async () => {
        await queryClient.invalidateQueries(trpc.assets.list.queryFilter());
      },
    }),
  );

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
    syncWindowControlsWithSidebar(!sidebarCollapsed || sidebarPreviewOpen);
  }, [sidebarCollapsed, sidebarPreviewOpen]);

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

  return (
      <div className="relative h-full min-h-0 overflow-hidden text-zinc-950">
        {sidebarCollapsed && !sidebarPreviewOpen ? (
          <div
            aria-hidden="true"
            className="window-drag absolute left-6 right-48 top-0 z-[74] h-14"
          />
        ) : null}
        {sidebarCollapsed ? <SidebarEdgeHotspot onOpen={() => setSidebarPreviewOpen(true)} /> : null}
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
              tagItems={assetsQuery.data?.tags ?? []}
              viewItems={assetsQuery.data?.views ?? []}
              onToggleSidebar={handleToggleSidebar}
              toggleMode="expand"
              floating
              summary={assetsQuery.data?.summary ?? {
                total: 0,
                inbox: 0,
                organized: 0,
                draft: 0,
                published: 0,
                archived: 0,
              }}
            />
          </motion.div>
        ) : null}
        {sidebarCollapsed && sidebarPreviewOpen ? <FloatingSidebarDragOverlay /> : null}
        <ResizablePanelGroup
          id={activeAsset ? "asset-detail-layout" : "asset-board-layout"}
          direction="horizontal"
          className="panel-layout h-full min-h-0 overflow-hidden bg-transparent"
          resizeTargetMinimumSize={{ coarse: 32, fine: 12 }}
        >
        <ResizablePanel
          panelRef={sidebarPanelRef}
          id="sidebar"
          defaultSize={20}
          minSize={16}
          maxSize={28}
          collapsible
          collapsedSize={0}
          onResize={(size) => {
            const nextCollapsed = size.asPercentage <= 0.01;

            if (sidebarCollapseIntentRef.current === "collapsed") {
              setSidebarCollapsed(true);
              if (nextCollapsed) {
                sidebarCollapseIntentRef.current = null;
              }
              return;
            }

            if (sidebarCollapseIntentRef.current === "expanded") {
              setSidebarCollapsed(false);
              if (!nextCollapsed) {
                sidebarCollapseIntentRef.current = null;
              }
              return;
            }

            setSidebarCollapsed(nextCollapsed);
            if (!nextCollapsed) {
              setSidebarPreviewOpen(false);
            }
          }}
          className={`overflow-hidden transition-opacity duration-150 ${
            sidebarCollapsed ? "pointer-events-none opacity-0" : "opacity-100"
          }`}
        >
          {!sidebarCollapsed ? (
            <Sidebar
              tagItems={assetsQuery.data?.tags ?? []}
              viewItems={assetsQuery.data?.views ?? []}
              onToggleSidebar={handleToggleSidebar}
              summary={assetsQuery.data?.summary ?? {
                total: 0,
                inbox: 0,
                organized: 0,
                draft: 0,
                published: 0,
                archived: 0,
              }}
            />
          ) : null}
        </ResizablePanel>
        <ResizableHandle
          withHandle
          className={sidebarCollapsed ? "opacity-0 pointer-events-none" : ""}
        />

        <ResizablePanel
          id="main"
          defaultSize={getMainDefaultSize(activeAsset, sidebarCollapsed)}
          minSize={activeAsset ? 34 : 42}
          className="relative z-[60]"
        >
          {activeAsset ? (
            <AssetDetail asset={activeAsset} dragEnabled={backgroundWindowDragEnabled} />
          ) : (
            <AssetBoard
              assetItems={assetItems}
              tagOptions={assetsQuery.data?.tags ?? []}
              dragEnabled={backgroundWindowDragEnabled}
              vaultName={assetsQuery.data?.vault?.name}
              loading={assetsQuery.isLoading}
              importing={importVault.isPending}
              reconciling={reconcileVault.isPending}
              conflictCount={assetsQuery.data?.conflictCount ?? 0}
              errorMessage={
                importVault.error?.message ?? reconcileVault.error?.message ?? assetsQuery.error?.message
              }
              onImportVault={() => importVault.mutate()}
              onReconcileVault={() => {
                const vaultId = assetsQuery.data?.vault?.id;
                if (vaultId) {
                  reconcileVault.mutate({ vaultId });
                }
              }}
            />
          )}
        </ResizablePanel>

        {activeAsset ? (
          <>
            <ResizableHandle withHandle />
            <ResizablePanel id="inspector" defaultSize={20} minSize={18} maxSize={32}>
              <AssetInspector
                asset={activeAsset}
                allAssets={assetItems}
                dragEnabled={backgroundWindowDragEnabled}
                onAddTag={(targetAssetId, name) => addTag.mutate({ assetId: targetAssetId, name })}
              />
            </ResizablePanel>
          </>
        ) : null}
        </ResizablePanelGroup>
      </div>
  );
}
