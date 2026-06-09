import React, {
  useState,
  useRef,
  useEffect,
  useMemo,
  useId,
  type ComponentType,
  type ReactNode,
  type SVGProps,
} from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { DragDropProvider, type DragEndEvent } from "@dnd-kit/react";
import { isSortable, useSortable } from "@dnd-kit/react/sortable";
import { PointerActivationConstraints, PointerSensor } from "@dnd-kit/dom";
import { arrayMove } from "@dnd-kit/helpers";
import { AnimatePresence, motion } from "motion/react";
import { useMasonry, usePositioner, useResizeObserver as useMasonryResizeObserver } from "masonic";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { FitAddon } from "@xterm/addon-fit";
import { Terminal as XTermTerminal } from "@xterm/xterm";
import "@xterm/xterm/css/xterm.css";
import { Collapsible, CollapsibleTrigger } from "@/components/ui/collapsible";
import {
  AlignLeft,
  Archive,
  ArrowLeft,
  Calendar,
  Check,
  ChevronDown,
  Copy,
  ExternalLink,
  FileSpreadsheet,
  FileText,
  Filter,
  FolderClosed,
  FolderOpen,
  FolderKanban,
  Globe,
  Hash,
  Image as ImageIcon,
  Inbox,
  Link as LinkIcon,
  PanelLeftOpen,
  PanelLeftClose,
  PanelRightOpen,
  Pencil,
  Play,
  Plus,
  ShieldCheck,
  SquareTerminal,
  Trash2,
  User,
  Video,
  X,
} from "lucide-react";
import {
  AccordionBody,
  AccordionItem,
  AccordionPanel,
  AccordionRoot,
  Button,
  Chip,
  Dropdown,
  Label,
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
import { load as yamlLoad } from "js-yaml";

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
  createdTimestampMs: number;
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
const OPEN_VAULT_TARGET_STORAGE_KEY = "post.assetManager.openVaultTarget.v1";
const SIDEBAR_SECTION_IDS: SidebarSectionId[] = ["views", "tags"];
const SIDEBAR_SECTION_TYPE = "sidebar-section";
const SIDEBAR_ITEM_TYPE_PREFIX = "sidebar-item:";
const TRAFFIC_LIGHT_POSITION = { x: 18, y: 14 };
const SIDEBAR_PREVIEW_MAX_WIDTH = 320;
const SIDEBAR_PREVIEW_VIEWPORT_RATIO = 0.84;
const SIDEBAR_PREVIEW_EXIT_PADDING = 32;
const SIDEBAR_EDGE_HOTSPOT_WIDTH = 24;
let lastWindowControlsVisible: boolean | null = null;

type OpenVaultTarget = "vscode" | "cursor" | "zed" | "finder";
type OpenVaultIcon = ComponentType<SVGProps<SVGSVGElement>>;

const CursorEditorIcon: OpenVaultIcon = ({ className, ...props }) => (
  <svg
    {...props}
    viewBox="0 0 466.73 532.09"
    className={className}
    fill="currentColor"
  >
    <path d="M457.43,125.94L244.42,2.96c-6.84-3.95-15.28-3.95-22.12,0L9.3,125.94c-5.75,3.32-9.3,9.46-9.3,16.11v247.99c0,6.65,3.55,12.79,9.3,16.11l213.01,122.98c6.84,3.95,15.28,3.95,22.12,0l213.01-122.98c5.75-3.32,9.3-9.46,9.3-16.11v-247.99c0-6.65-3.55-12.79-9.3-16.11h-.01ZM444.05,151.99l-205.63,356.16c-1.39,2.4-5.06,1.42-5.06-1.36v-233.21c0-4.66-2.49-8.97-6.53-11.31L24.87,145.67c-2.4-1.39-1.42-5.06,1.36-5.06h411.26c5.84,0,9.49,6.33,6.57,11.39h-.01Z" />
  </svg>
);

const VisualStudioCodeIcon: OpenVaultIcon = (props) => {
  const id = useId().replaceAll(":", "");
  const maskId = `${id}-vscode-a`;
  const topShadowFilterId = `${id}-vscode-b`;
  const sideShadowFilterId = `${id}-vscode-c`;
  const overlayGradientId = `${id}-vscode-d`;

  return (
    <svg {...props} fill="none" viewBox="0 0 100 100">
      <mask id={maskId} width="100" height="100" x="0" y="0" maskUnits="userSpaceOnUse">
        <path
          fill="#fff"
          fillRule="evenodd"
          d="M70.912 99.317a6.223 6.223 0 0 0 4.96-.19l20.589-9.907A6.25 6.25 0 0 0 100 83.587V16.413a6.25 6.25 0 0 0-3.54-5.632L75.874.874a6.226 6.226 0 0 0-7.104 1.21L29.355 38.04 12.187 25.01a4.162 4.162 0 0 0-5.318.236l-5.506 5.009a4.168 4.168 0 0 0-.004 6.162L16.247 50 1.36 63.583a4.168 4.168 0 0 0 .004 6.162l5.506 5.01a4.162 4.162 0 0 0 5.318.236l17.168-13.032L68.77 97.917a6.217 6.217 0 0 0 2.143 1.4ZM75.015 27.3 45.11 50l29.906 22.701V27.3Z"
          clipRule="evenodd"
        />
      </mask>
      <g mask={`url(#${maskId})`}>
        <path
          fill="#0065A9"
          d="M96.461 10.796 75.857.876a6.23 6.23 0 0 0-7.107 1.207l-67.451 61.5a4.167 4.167 0 0 0 .004 6.162l5.51 5.009a4.167 4.167 0 0 0 5.32.236l81.228-61.62c2.725-2.067 6.639-.124 6.639 3.297v-.24a6.25 6.25 0 0 0-3.539-5.63Z"
        />
        <g filter={`url(#${topShadowFilterId})`}>
          <path
            fill="#007ACC"
            d="m96.461 89.204-20.604 9.92a6.229 6.229 0 0 1-7.107-1.207l-67.451-61.5a4.167 4.167 0 0 1 .004-6.162l5.51-5.009a4.167 4.167 0 0 1 5.32-.236l81.228 61.62c2.725 2.067 6.639.124 6.639-3.297v.24a6.25 6.25 0 0 1-3.539 5.63Z"
          />
        </g>
        <g filter={`url(#${sideShadowFilterId})`}>
          <path
            fill="#1F9CF0"
            d="M75.858 99.126a6.232 6.232 0 0 1-7.108-1.21c2.306 2.307 6.25.674 6.25-2.588V4.672c0-3.262-3.944-4.895-6.25-2.589a6.232 6.232 0 0 1 7.108-1.21l20.6 9.908A6.25 6.25 0 0 1 100 16.413v67.174a6.25 6.25 0 0 1-3.541 5.633l-20.601 9.906Z"
          />
        </g>
        <path
          fill={`url(#${overlayGradientId})`}
          fillRule="evenodd"
          d="M70.851 99.317a6.224 6.224 0 0 0 4.96-.19L96.4 89.22a6.25 6.25 0 0 0 3.54-5.633V16.413a6.25 6.25 0 0 0-3.54-5.632L75.812.874a6.226 6.226 0 0 0-7.104 1.21L29.294 38.04 12.126 25.01a4.162 4.162 0 0 0-5.317.236l-5.507 5.009a4.168 4.168 0 0 0-.004 6.162L16.186 50 1.298 63.583a4.168 4.168 0 0 0 .004 6.162l5.507 5.009a4.162 4.162 0 0 0 5.317.236L29.294 61.96l39.414 35.958a6.218 6.218 0 0 0 2.143 1.4ZM74.954 27.3 45.048 50l29.906 22.701V27.3Z"
          clipRule="evenodd"
          opacity=".25"
          style={{ mixBlendMode: "overlay" }}
        />
      </g>
      <defs>
        <filter
          id={topShadowFilterId}
          width="116.727"
          height="92.246"
          x="-8.394"
          y="15.829"
          colorInterpolationFilters="sRGB"
          filterUnits="userSpaceOnUse"
        >
          <feFlood floodOpacity="0" result="BackgroundImageFix" />
          <feColorMatrix in="SourceAlpha" values="0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 127 0" />
          <feOffset />
          <feGaussianBlur stdDeviation="4.167" />
          <feColorMatrix values="0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0.25 0" />
          <feBlend in2="BackgroundImageFix" mode="overlay" result="effect1_dropShadow" />
          <feBlend in="SourceGraphic" in2="effect1_dropShadow" result="shape" />
        </filter>
        <filter
          id={sideShadowFilterId}
          width="47.917"
          height="116.151"
          x="60.417"
          y="-8.076"
          colorInterpolationFilters="sRGB"
          filterUnits="userSpaceOnUse"
        >
          <feFlood floodOpacity="0" result="BackgroundImageFix" />
          <feColorMatrix in="SourceAlpha" values="0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 127 0" />
          <feOffset />
          <feGaussianBlur stdDeviation="4.167" />
          <feColorMatrix values="0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0.25 0" />
          <feBlend in2="BackgroundImageFix" mode="overlay" result="effect1_dropShadow" />
          <feBlend in="SourceGraphic" in2="effect1_dropShadow" result="shape" />
        </filter>
        <linearGradient
          id={overlayGradientId}
          x1="49.939"
          x2="49.939"
          y1=".258"
          y2="99.742"
          gradientUnits="userSpaceOnUse"
        >
          <stop stopColor="#fff" />
          <stop offset="1" stopColor="#fff" stopOpacity="0" />
        </linearGradient>
      </defs>
    </svg>
  );
};

const ZedEditorIcon: OpenVaultIcon = (props) => {
  const id = useId().replaceAll(":", "");
  const clipPathId = `${id}-zed-logo-a`;

  return (
    <svg {...props} fill="none" viewBox="0 0 96 96">
      <g clipPath={`url(#${clipPathId})`}>
        <path
          fill="currentColor"
          fillRule="evenodd"
          d="M9 6a3 3 0 0 0-3 3v66H0V9a9 9 0 0 1 9-9h80.379c4.009 0 6.016 4.847 3.182 7.682L43.055 57.187H57V51h6v7.688a4.5 4.5 0 0 1-4.5 4.5H37.055L26.743 73.5H73.5V36h6v37.5a6 6 0 0 1-6 6H20.743L10.243 90H87a3 3 0 0 0 3-3V21h6v66a9 9 0 0 1-9 9H6.621c-4.009 0-6.016-4.847-3.182-7.682L52.757 39H39v6h-6v-7.5a4.5 4.5 0 0 1 4.5-4.5h21.257l10.5-10.5H22.5V60h-6V22.5a6 6 0 0 1 6-6h52.757L85.757 6H9Z"
          clipRule="evenodd"
        />
      </g>
      <defs>
        <clipPath id={clipPathId}>
          <path fill="#fff" d="M0 0h96v96H0z" />
        </clipPath>
      </defs>
    </svg>
  );
};

const OPEN_VAULT_TARGETS: Array<{
  id: OpenVaultTarget;
  label: string;
  icon: OpenVaultIcon;
}> = [
  { id: "vscode", label: "VS Code", icon: VisualStudioCodeIcon },
  { id: "cursor", label: "Cursor", icon: CursorEditorIcon },
  { id: "zed", label: "Zed", icon: ZedEditorIcon },
  { id: "finder", label: "Finder", icon: FolderClosed },
];
const DEFAULT_OPEN_VAULT_TARGET = OPEN_VAULT_TARGETS[0];
const HEADER_ICON_CLASS_NAME = "size-3.5 shrink-0";

function isOpenVaultTarget(value: unknown): value is OpenVaultTarget {
  return OPEN_VAULT_TARGETS.some((target) => target.id === value);
}

function getOpenVaultTarget(id: OpenVaultTarget) {
  return OPEN_VAULT_TARGETS.find((target) => target.id === id) ?? DEFAULT_OPEN_VAULT_TARGET;
}

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

function getAssetTimestampMs(value: unknown, fallbackMs = Date.now()) {
  if (value === null || value === undefined) {
    return fallbackMs;
  }

  const date = value instanceof Date ? value : new Date(value as string | number);
  return Number.isNaN(date.getTime()) ? fallbackMs : date.getTime();
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

  const updatedTimestampMs = getAssetTimestampMs(asset.mtimeMs);

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
    timestampMs: updatedTimestampMs,
    createdTimestampMs: getAssetTimestampMs(asset.ctimeMs, updatedTimestampMs),
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


type AssetTypeFilter = "markdown" | "image" | "video" | "link" | "file";
type AssetFilterMatch = "and" | "or";
type AssetTimeFilter = "any" | "today" | "week" | "m30" | "custom";
type AssetStatusFilter = "any" | "inbox" | "draft" | "published";
type AssetSortOrder = "updated_desc" | "updated_asc" | "created_desc" | "created_asc";

type AssetFilterState = {
  types: AssetTypeFilter[];
  tags: string[];
  sources: string[];
  match: AssetFilterMatch;
  time: AssetTimeFilter;
  status: AssetStatusFilter;
  sort: AssetSortOrder;
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

const SORT_OPTIONS = [
  { value: "updated_desc", label: "更新时间 · 降序" },
  { value: "updated_asc", label: "更新时间 · 升序" },
  { value: "created_desc", label: "创建时间 · 降序" },
  { value: "created_asc", label: "创建时间 · 升序" },
] satisfies Array<{ value: AssetSortOrder; label: string }>;

const TYPE_FILTER_LABELS = Object.fromEntries(
  ASSET_TYPE_FILTERS.map((item) => [item.value, item.label]),
) as Record<AssetTypeFilter, string>;
const TIME_FILTER_LABELS = Object.fromEntries(
  TIME_FILTERS.map((item) => [item.value, item.label]),
) as Record<AssetTimeFilter, string>;
const STATUS_FILTER_LABELS = Object.fromEntries(
  STATUS_FILTERS.map((item) => [item.value, item.label]),
) as Record<AssetStatusFilter, string>;
const SORT_OPTION_LABELS = Object.fromEntries(
  SORT_OPTIONS.map((item) => [item.value, item.label]),
) as Record<AssetSortOrder, string>;

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
    sort: "updated_desc",
  };
}

function getActiveFilterCount(filters: AssetFilterState) {
  return (
    filters.types.length +
    filters.tags.length +
    filters.sources.length +
    (filters.time !== "any" ? 1 : 0) +
    (filters.status !== "any" ? 1 : 0) +
    (filters.sort !== "updated_desc" ? 1 : 0)
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

function compareAssetTitles(a: Asset, b: Asset) {
  return a.title.localeCompare(b.title, "zh-Hans-CN");
}

function sortAssets(assetItems: readonly Asset[], sort: AssetSortOrder) {
  const [field, direction] = sort.split("_") as ["updated" | "created", "asc" | "desc"];
  const multiplier = direction === "asc" ? 1 : -1;

  return [...assetItems].sort((a, b) => {
    const aTimestamp = field === "created" ? a.createdTimestampMs : a.timestampMs;
    const bTimestamp = field === "created" ? b.createdTimestampMs : b.timestampMs;
    const timestampDelta = aTimestamp - bTimestamp;

    if (timestampDelta !== 0) {
      return timestampDelta * multiplier;
    }

    return compareAssetTitles(a, b);
  });
}

function filterAndSortAssets(assetItems: readonly Asset[], filters: AssetFilterState) {
  return sortAssets(filterAssets(assetItems, filters), filters.sort);
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
  vaultAvailable: boolean;
  terminalAvailable: boolean;
  terminalOpen: boolean;
  onToggleFilter: () => void;
  onToggleTerminal: () => void;
  dragEnabled?: boolean;
};

function AssetBoardHeader({
  filterOpen,
  activeFilterCount,
  vaultAvailable,
  terminalAvailable,
  terminalOpen,
  onToggleFilter,
  onToggleTerminal,
  dragEnabled = true,
}: AssetBoardHeaderProps) {
  const filterActive = filterOpen || activeFilterCount > 0;
  const dragClassName = dragEnabled ? "window-drag" : "window-no-drag";
  const [openWithMenuOpen, setOpenWithMenuOpen] = useState(false);
  const [preferredOpenTargetId, setPreferredOpenTargetId] = useState<OpenVaultTarget>(() => {
    if (typeof window === "undefined") {
      return DEFAULT_OPEN_VAULT_TARGET.id;
    }

    const storedTarget = window.localStorage.getItem(OPEN_VAULT_TARGET_STORAGE_KEY);
    return isOpenVaultTarget(storedTarget) ? storedTarget : DEFAULT_OPEN_VAULT_TARGET.id;
  });
  const openVaultLocation = useMutation(
    trpc.assets.openVaultLocation.mutationOptions({
      onSuccess: () => setOpenWithMenuOpen(false),
    }),
  );
  const smallButtonClassName = "window-no-drag h-6 min-h-0 gap-1.5 rounded-lg px-2 text-[11px]";
  const preferredOpenTarget = getOpenVaultTarget(preferredOpenTargetId);
  const PreferredOpenIcon = preferredOpenTarget.icon;

  const openVaultWithTarget = (targetId: OpenVaultTarget, persistTarget: boolean) => {
    if (persistTarget) {
      setPreferredOpenTargetId(targetId);
      window.localStorage.setItem(OPEN_VAULT_TARGET_STORAGE_KEY, targetId);
    }

    openVaultLocation.mutate({ target: targetId });
  };

  return (
    <div className={`${dragClassName} relative z-[75] flex h-14 shrink-0 items-center gap-2.5 border-b border-zinc-100 bg-white px-6`}>
      <h1 className="mr-auto text-[15px] font-semibold tracking-normal text-zinc-950">全部资产</h1>
      <div className="window-no-drag relative z-[80] flex items-center gap-2.5 pointer-events-auto">
        <Button
          size="sm"
          variant={filterActive ? "secondary" : "ghost"}
          aria-controls="asset-filter-panel"
          aria-expanded={filterOpen}
          className={`${smallButtonClassName} ${
            filterActive
              ? "border border-blue-200 bg-blue-50 text-blue-700"
              : "border border-zinc-200 bg-white text-zinc-600"
          }`}
          onPress={onToggleFilter}
        >
          <Filter className={HEADER_ICON_CLASS_NAME} />
          筛选
          {activeFilterCount > 0 ? (
            <span className="ml-0.5 grid h-3.5 min-w-3.5 place-items-center rounded-full bg-blue-600 px-1 text-[9px] font-bold leading-none text-white">
              {activeFilterCount}
            </span>
          ) : null}
          <ChevronDown
            className={`${HEADER_ICON_CLASS_NAME} transition-transform duration-200 ${
              filterOpen ? "rotate-180" : ""
            }`}
          />
        </Button>
        {vaultAvailable ? (
          <div className="window-no-drag inline-flex h-6 overflow-hidden rounded-lg border border-zinc-200 bg-white text-zinc-600 shadow-[0_1px_1px_rgba(24,24,27,0.03)]">
            <button
              type="button"
              className="window-no-drag inline-grid h-6 w-7 place-items-center border-r border-zinc-200 transition-colors hover:bg-zinc-50 disabled:pointer-events-none disabled:opacity-45"
              aria-label={`用 ${preferredOpenTarget.label} 打开资产库`}
              disabled={openVaultLocation.isPending}
              onClick={() => openVaultWithTarget(preferredOpenTarget.id, false)}
            >
              <PreferredOpenIcon aria-hidden="true" className={`${HEADER_ICON_CLASS_NAME} text-zinc-600`} />
            </button>
            <Dropdown isOpen={openWithMenuOpen} onOpenChange={setOpenWithMenuOpen}>
              <Dropdown.Trigger
                className="window-no-drag inline-grid h-6 w-6 place-items-center outline-none transition-colors hover:bg-zinc-50"
                aria-label="选择打开方式"
              >
                <ChevronDown
                  className={`${HEADER_ICON_CLASS_NAME} transition-transform duration-200 ${
                    openWithMenuOpen ? "rotate-180" : ""
                  }`}
                />
              </Dropdown.Trigger>
              <Dropdown.Popover
                className="z-[120] overflow-hidden rounded-xl border border-zinc-200 bg-white p-1 shadow-[0_14px_34px_rgba(20,18,16,0.14),0_2px_7px_rgba(20,18,16,0.07)]"
                offset={6}
                placement="bottom end"
              >
                <Dropdown.Menu
                  aria-label="打开资产库"
                  className="min-w-36 p-0 outline-none"
                  disabledKeys={
                    openVaultLocation.isPending
                      ? OPEN_VAULT_TARGETS.map((target) => target.id)
                      : []
                  }
                  onAction={(key) => openVaultWithTarget(key as OpenVaultTarget, true)}
                >
                  {OPEN_VAULT_TARGETS.map((target) => {
                    const Icon = target.icon;

                    return (
                      <Dropdown.Item
                        key={target.id}
                        id={target.id}
                        textValue={target.label}
                        className={[
                          "flex h-7 cursor-default items-center gap-2 rounded-lg px-2",
                          "text-[12.5px] font-medium text-zinc-700 outline-none transition-colors",
                          "data-[focused]:bg-zinc-100 data-[hovered]:bg-zinc-100",
                          "data-[disabled]:opacity-45",
                        ].join(" ")}
                      >
                        <Icon aria-hidden="true" className={`${HEADER_ICON_CLASS_NAME} text-zinc-500`} />
                        <Label className="cursor-default text-[12.5px] font-medium text-inherit">
                          {target.label}
                        </Label>
                      </Dropdown.Item>
                    );
                  })}
                </Dropdown.Menu>
                {openVaultLocation.error ? (
                  <div className="mt-1 border-t border-zinc-100 px-2 py-1.5 text-[10.5px] leading-4 text-red-600">
                    {openVaultLocation.error.message}
                  </div>
                ) : null}
              </Dropdown.Popover>
            </Dropdown>
          </div>
        ) : (
          <span
            className={`${smallButtonClassName} inline-flex cursor-default items-center border border-zinc-200 bg-white text-zinc-300`}
            title="还没有选择资产库"
          >
            <FolderOpen className={HEADER_ICON_CLASS_NAME} />
            <ChevronDown className={HEADER_ICON_CLASS_NAME} />
          </span>
        )}
        <Button
          size="sm"
          variant={terminalOpen ? "secondary" : "ghost"}
          isDisabled={!terminalAvailable}
          aria-label={terminalAvailable ? "打开终端侧栏" : "当前平台暂不支持终端侧栏"}
          className={`window-no-drag h-6 min-h-0 rounded-lg border px-2 text-[11px] ${
            terminalOpen
              ? "border-zinc-300 bg-zinc-100 text-zinc-900"
              : "border-zinc-200 bg-white text-zinc-600 hover:bg-zinc-50"
          }`}
          onPress={onToggleTerminal}
        >
          <PanelRightOpen className={HEADER_ICON_CLASS_NAME} />
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
              className="h-5 w-auto whitespace-nowrap rounded-md px-2 text-[10.5px] font-medium text-zinc-500 data-[selected=true]:text-zinc-950"
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
      <TagGroup.List className="flex flex-wrap gap-1">
        {options.map(({ value, label: optionLabel, icon: Icon, dotHue }) => (
          <Tag
            key={value}
            id={value}
            className="h-5 min-h-0 cursor-default gap-1 rounded-full bg-zinc-100 px-2 py-0 text-[10.5px] font-medium text-zinc-500 transition-colors hover:bg-zinc-200/70 hover:text-zinc-700 data-[selected=true]:bg-blue-50 data-[selected=true]:font-semibold data-[selected=true]:text-blue-700 data-[selected=true]:shadow-[inset_0_0_0_1px_rgba(37,99,235,0.24)]"
          >
            {Icon ? <Icon size={11} /> : null}
            {dotHue !== undefined ? (
              <span
                className="h-1.5 w-1.5 rounded-full"
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

        <AssetFilterField label="时间">
          <FilterSegment
            options={TIME_FILTERS}
            value={filters.time}
            onChange={(time) => onFiltersChange((current) => ({ ...current, time }))}
          />
        </AssetFilterField>

        <AssetFilterField label="状态">
          <FilterSegment
            options={STATUS_FILTERS}
            value={filters.status}
            onChange={(status) => onFiltersChange((current) => ({ ...current, status }))}
          />
        </AssetFilterField>

        <AssetFilterField label="排序">
          <FilterSegment
            options={SORT_OPTIONS}
            value={filters.sort}
            onChange={(sort) => onFiltersChange((current) => ({ ...current, sort }))}
          />
        </AssetFilterField>

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
  group: "type" | "tag" | "source" | "time" | "status" | "sort";
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
    ...(filters.sort !== "updated_desc"
      ? [{
        key: "sort",
        label: SORT_OPTION_LABELS[filters.sort],
        group: "sort" as const,
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

        if (chip.group === "sort") {
          return { ...nextFilters, sort: "updated_desc" };
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
  vaultAvailable,
  terminalAvailable,
  terminalOpen,
  loading,
  errorMessage,
  onToggleTerminal,
  dragEnabled = true,
}: {
  assetItems: Asset[];
  tagOptions: SidebarTag[];
  vaultAvailable: boolean;
  terminalAvailable: boolean;
  terminalOpen: boolean;
  loading: boolean;
  errorMessage?: string;
  onToggleTerminal: () => void;
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
    () => filterAndSortAssets(assetItems, filters),
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
            vaultAvailable={vaultAvailable}
            terminalAvailable={terminalAvailable}
            terminalOpen={terminalOpen}
            onToggleFilter={() => setFilterOpen((open) => !open)}
            onToggleTerminal={onToggleTerminal}
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

function writeTerminalSystemMessage(terminal: XTermTerminal, message: string) {
  terminal.write(`\r\n[post] ${message}\r\n`);
}

function getTerminalErrorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

const ASSET_TERMINAL_THEME = {
  background: "#ffffff",
  foreground: "#24292f",
  cursor: "#24292f",
  cursorAccent: "#ffffff",
  selectionBackground: "#dbeafe",
  selectionInactiveBackground: "#eef2ff",
  scrollbarSliderBackground: "rgba(36, 41, 47, 0.12)",
  scrollbarSliderHoverBackground: "rgba(36, 41, 47, 0.24)",
  scrollbarSliderActiveBackground: "rgba(36, 41, 47, 0.34)",
  black: "#24292f",
  red: "#ff2d2d",
  green: "#16a34a",
  yellow: "#f59f00",
  blue: "#2488ff",
  magenta: "#8b5cf6",
  cyan: "#0891b2",
  white: "#eaeef2",
  brightBlack: "#6e7781",
  brightRed: "#ff2d2d",
  brightGreen: "#13b84a",
  brightYellow: "#f5a400",
  brightBlue: "#2f96ff",
  brightMagenta: "#8b5cf6",
  brightCyan: "#06b6d4",
  brightWhite: "#ffffff",
};

function AssetTerminalPanel({
  dragEnabled = true,
  onHide,
}: {
  dragEnabled?: boolean;
  onHide: () => void;
}) {
  const terminalHostRef = useRef<HTMLDivElement>(null);
  const terminalRef = useRef<XTermTerminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const sessionIdRef = useRef<string | null>(null);
  const resizeFrameRef = useRef<number | null>(null);

  useEffect(() => {
    const host = terminalHostRef.current;
    if (!host) {
      return;
    }

    let disposed = false;
    const terminal = new XTermTerminal({
      cursorBlink: true,
      cursorStyle: "bar",
      cursorWidth: 1,
      fontFamily: '"JetBrains Mono", "SF Mono", "SFMono-Regular", Menlo, Monaco, Consolas, monospace',
      fontSize: 10,
      fontWeight: 400,
      fontWeightBold: 700,
      letterSpacing: 0,
      lineHeight: 1.24,
      scrollback: 5000,
      theme: ASSET_TERMINAL_THEME,
    });
    const fitAddon = new FitAddon();
    terminal.loadAddon(fitAddon);
    terminal.open(host);
    terminalRef.current = terminal;
    fitAddonRef.current = fitAddon;
    writeTerminalSystemMessage(terminal, "Starting terminal...");

    const fitAndResize = () => {
      resizeFrameRef.current = null;
      if (disposed) {
        return;
      }

      try {
        fitAddon.fit();
      } catch {
        return;
      }

      const sessionId = sessionIdRef.current;
      if (!sessionId || terminal.cols <= 0 || terminal.rows <= 0) {
        return;
      }

      void window.api.terminal.resize({
        sessionId,
        cols: terminal.cols,
        rows: terminal.rows,
      }).catch(() => undefined);
    };

    const scheduleFitAndResize = () => {
      if (resizeFrameRef.current !== null) {
        return;
      }
      resizeFrameRef.current = window.requestAnimationFrame(fitAndResize);
    };

    const resizeObserver = new ResizeObserver(scheduleFitAndResize);
    resizeObserver.observe(host);

    const inputDisposable = terminal.onData((data) => {
      const sessionId = sessionIdRef.current;
      if (!sessionId) {
        return;
      }

      void window.api.terminal.write({ sessionId, data }).catch((error) => {
        writeTerminalSystemMessage(terminal, getTerminalErrorMessage(error, "Terminal write failed"));
      });
    });

    const unsubscribeData = window.api.terminal.onData((event) => {
      if (event.sessionId !== sessionIdRef.current) {
        return;
      }
      terminal.write(event.data);
    });

    const unsubscribeExit = window.api.terminal.onExit((event) => {
      if (event.sessionId !== sessionIdRef.current) {
        return;
      }
      const details = [
        typeof event.exitCode === "number" ? `code ${event.exitCode}` : null,
        event.signal ? `signal ${event.signal}` : null,
      ].filter(Boolean).join(", ");
      writeTerminalSystemMessage(terminal, details ? `Process exited (${details})` : "Process exited");
    });

    const startFrame = window.requestAnimationFrame(() => {
      try {
        fitAddon.fit();
      } catch {
        // The host can briefly report zero size while the side panel is mounting.
      }

      void window.api.terminal.start({ cols: terminal.cols, rows: terminal.rows })
        .then((snapshot) => {
          if (disposed) {
            return;
          }

          sessionIdRef.current = snapshot.sessionId;
          terminal.clear();
          terminal.write("\u001bc");
          if (snapshot.history) {
            terminal.write(snapshot.history);
          }
          scheduleFitAndResize();
          window.requestAnimationFrame(() => terminal.focus());
        })
        .catch((error) => {
          if (disposed) {
            return;
          }
          const message = getTerminalErrorMessage(error, "Terminal failed to start");
          terminal.clear();
          terminal.write("\u001bc");
          writeTerminalSystemMessage(terminal, message);
        });
    });

    return () => {
      disposed = true;
      window.cancelAnimationFrame(startFrame);
      if (resizeFrameRef.current !== null) {
        window.cancelAnimationFrame(resizeFrameRef.current);
      }
      resizeObserver.disconnect();
      unsubscribeData();
      unsubscribeExit();
      inputDisposable.dispose();
      terminalRef.current = null;
      fitAddonRef.current = null;
      terminal.dispose();
    };
  }, []);

  const dragClassName = dragEnabled ? "window-drag" : "window-no-drag";

  return (
    <aside className="flex h-full min-w-0 flex-col border-l border-zinc-100 bg-white">
      <div className={`${dragClassName} flex h-14 shrink-0 items-center gap-2 border-b border-zinc-100 px-3`}>
        <SquareTerminal size={14} className="shrink-0 text-zinc-500" />
        <div className="min-w-0 flex-1">
          <div className="truncate text-[13px] font-semibold text-zinc-900">Terminal</div>
        </div>
        <div className="window-no-drag flex items-center gap-1">
          <button
            type="button"
            className="grid h-6 w-6 place-items-center rounded-md text-zinc-400 transition-colors hover:bg-zinc-100 hover:text-zinc-700"
            title="隐藏终端侧栏"
            onClick={onHide}
          >
            <X size={13} />
          </button>
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-hidden bg-white p-1">
        <div
          ref={terminalHostRef}
          className="h-full min-h-0 overflow-hidden rounded-sm bg-white p-1 [&_.xterm]:h-full [&_.xterm-screen]:!bg-white [&_.xterm-viewport]:!bg-white"
        />
      </div>
    </aside>
  );
}

// ---- detail page helpers ----

function DetailSideMetaList({ list }: { list: [string, string][] }) {
  return (
    <div className="flex flex-col">
      {list.map(([k, v], i) => (
        <div key={i} className="flex justify-between border-t border-zinc-100 py-2 text-[12.5px]">
          <span className="text-zinc-500">{k}</span>
          <span className="font-medium text-zinc-800">{v}</span>
        </div>
      ))}
    </div>
  );
}

function DocPreviewSkeleton({ fileExt }: { fileExt?: string }) {
  const ext = (fileExt ?? "FILE").toUpperCase();
  const extColorMap: Record<string, string> = {
    PDF: "oklch(0.55 0.18 25)",
    CSV: "oklch(0.50 0.16 148)",
    XLS: "oklch(0.50 0.16 148)",
    XLSX: "oklch(0.50 0.16 148)",
    DOCX: "oklch(0.48 0.16 230)",
    DOC: "oklch(0.48 0.16 230)",
  };
  const extColor = extColorMap[ext] ?? "oklch(0.50 0.08 250)";
  return (
    <div className="overflow-hidden rounded-[13px] border border-zinc-200 shadow-sm">
      <div className="bg-zinc-100 px-[30px] pb-0 pt-[30px]">
        <div className="rounded-t-md border border-zinc-200/60 bg-white px-10 pb-10 pt-8" style={{ boxShadow: "0 -8px 24px rgba(20,18,16,.06)" }}>
          <div className="mb-5 flex items-center gap-2.5">
            <span className="rounded-[5px] px-[7px] py-[3px] font-mono text-[10.5px] font-semibold tracking-wider text-white" style={{ background: extColor }}>
              {ext}
            </span>
            <div className="h-3 w-3/5 rounded-sm bg-gradient-to-r from-zinc-200 to-transparent" />
          </div>
          <div className="flex flex-col gap-2.5">
            {[96, 90, 99, 72].map((w, i) => (
              <div key={i} className="h-2 rounded-sm bg-zinc-100" style={{ width: `${w}%` }} />
            ))}
          </div>
          <div className="my-5 flex h-28 items-end gap-2.5 rounded-lg border border-zinc-100 bg-zinc-50 p-3.5">
            {[42, 58, 50, 71, 64, 88, 80].map((h, i) => (
              <div
                key={i}
                className="flex-1 rounded-t-sm"
                style={{
                  height: `${h}%`,
                  background: i === 6
                    ? "oklch(0.55 0.13 256)"
                    : "color-mix(in oklch, oklch(0.55 0.13 256), transparent 55%)",
                }}
              />
            ))}
          </div>
          <div className="flex flex-col gap-2.5">
            {[99, 94, 86, 97, 60].map((w, i) => (
              <div key={i} className="h-2 rounded-sm bg-zinc-100" style={{ width: `${w}%` }} />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function getFrontmatterIcon(key: string, value: unknown) {
  const k = key.toLowerCase();
  if (k === "source" || k === "url" || k === "link" || k === "href") return LinkIcon;
  if (k === "author" || k === "authors" || k === "creator" || k === "by") return User;
  if (k === "tags" || k === "categories" || k === "labels" || k === "keywords") return Hash;
  if (
    k === "published" ||
    k === "date" ||
    k === "created" ||
    k === "updated" ||
    k === "modified" ||
    k.endsWith("_at") ||
    k.endsWith("_date")
  )
    return Calendar;
  if (Array.isArray(value)) return Hash;
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}/.test(value)) return Calendar;
  return AlignLeft;
}

function FrontmatterFieldValue({ fieldKey, value }: { fieldKey: string; value: unknown }) {
  if (Array.isArray(value)) {
    if (value.length === 0) return <span className="italic text-zinc-400">—</span>;
    const isTagLike =
      fieldKey.toLowerCase() === "tags" ||
      fieldKey.toLowerCase() === "categories" ||
      fieldKey.toLowerCase() === "labels" ||
      fieldKey.toLowerCase() === "keywords";
    return (
      <div className="flex flex-wrap gap-1">
        {value.map((v, i) => (
          <span
            key={i}
            className="rounded-md bg-zinc-100 px-1.5 py-0.5 text-[12px] font-medium text-zinc-600"
          >
            {isTagLike ? "#" : ""}
            {typeof v === "string" ? v : String(v)}
          </span>
        ))}
      </div>
    );
  }

  if (typeof value === "string") {
    if (/^https?:\/\//.test(value)) {
      return (
        <a
          href={value}
          className="break-all text-blue-500 hover:text-blue-600 hover:underline"
          target="_blank"
          rel="noreferrer"
        >
          {value}
        </a>
      );
    }
    if (/^\[\[.*\]\]$/.test(value.trim())) {
      return (
        <span className="inline-flex items-center rounded border border-sky-200 bg-sky-50 px-1.5 py-0.5 text-[12px] font-medium text-sky-600">
          {value}
        </span>
      );
    }
    if (/^\d{4}-\d{2}-\d{2}/.test(value)) {
      return (
        <span className="flex items-center gap-1.5 text-zinc-700">
          <Calendar size={12} className="shrink-0 text-zinc-400" />
          {value}
        </span>
      );
    }
    return <span className="whitespace-pre-wrap text-zinc-700">{value}</span>;
  }

  if (value === null || value === undefined) return <span className="italic text-zinc-400">—</span>;
  return <span className="text-zinc-700">{String(value)}</span>;
}

function FrontmatterPanel({ data }: { data: Record<string, unknown> }) {
  const [expanded, setExpanded] = useState(true);
  const entries = Object.entries(data);
  if (entries.length === 0) return null;

  return (
    <AccordionRoot
      hideSeparator
      expandedKeys={expanded ? ["frontmatter"] : []}
      onExpandedChange={(keys) => setExpanded(keys.has("frontmatter"))}
      className="mb-8 overflow-hidden rounded-xl border border-zinc-200 text-[13px]"
    >
      <AccordionItem id="frontmatter" className="border-none">
        {/* Header trigger */}
        <button
          type="button"
          className="flex w-full items-center gap-1.5 border-b border-zinc-100 bg-zinc-50/60 px-4 py-2.5 text-left hover:bg-zinc-100/50"
          onClick={() => setExpanded((v) => !v)}
        >
          <ChevronDown
            size={12}
            className={`shrink-0 text-zinc-400 transition-transform ${expanded ? "" : "-rotate-90"}`}
          />
          <span className="font-medium text-zinc-600">属性</span>
          <span className="ml-0.5 text-zinc-400">{entries.length}</span>
          <div className="flex-1" />
          <span className="text-[12px] text-zinc-300">— YAML frontmatter</span>
        </button>

        <AccordionPanel id="frontmatter-panel">
          <AccordionBody className="p-0">
            <div className="bg-white">
              {entries.map(([key, value], i) => {
                const Icon = getFrontmatterIcon(key, value);
                return (
                  <div
                    key={key}
                    className={`flex items-start gap-3 px-4 py-2 ${i < entries.length - 1 ? "border-b border-zinc-100" : ""}`}
                  >
                    <div className="flex w-4 shrink-0 items-center justify-center pt-[3px]">
                      <Icon size={13} className="text-zinc-400" />
                    </div>
                    <div className="w-24 shrink-0 pt-[1px] text-zinc-500">{key}</div>
                    <div className="min-w-0 flex-1">
                      <FrontmatterFieldValue fieldKey={key} value={value} />
                    </div>
                  </div>
                );
              })}
            </div>
          </AccordionBody>
        </AccordionPanel>
      </AccordionItem>
    </AccordionRoot>
  );
}

function resolveMarkdownImage(src: string | undefined, vaultId: string, fileDir: string): string {
  if (!src || /^(https?:|data:)/.test(src)) return src ?? "";

  function normalizeParts(parts: string[]): string {
    const out: string[] = [];
    for (const p of parts) {
      if (p === "" || p === ".") continue;
      if (p === "..") out.pop();
      else out.push(p);
    }
    return out.join("/");
  }

  const base = fileDir ? fileDir.split("/") : [];
  const srcParts = src.startsWith("/") ? src.slice(1).split("/") : [...base, ...src.split("/")];
  const relPath = normalizeParts(srcParts);
  const encoded = relPath.split("/").map(encodeURIComponent).join("/");
  return `post-file://vault/${vaultId}/${encoded}`;
}

function MarkdownDetailBody({ asset }: { asset: Asset }) {
  const markdownQuery = useQuery(trpc.assets.markdownContent.queryOptions({ id: asset.id }));
  const rawContent = markdownQuery.data?.content ?? "";

  const parsed = useMemo(() => {
    const empty = { data: {} as Record<string, unknown>, content: rawContent };
    if (!rawContent.trimStart().startsWith("---")) return empty;
    const end = rawContent.indexOf("\n---", 3);
    if (end === -1) return empty;
    const yamlBlock = rawContent.slice(3, end).trim();
    const body = rawContent.slice(end + 4).replace(/^\r?\n/, "");
    try {
      const data = yamlLoad(yamlBlock);
      if (data && typeof data === "object" && !Array.isArray(data)) {
        return { data: data as Record<string, unknown>, content: body };
      }
    } catch {
      // malformed YAML — show as plain content
    }
    return empty;
  }, [rawContent]);

  if (markdownQuery.isPending) {
    return (
      <div className="max-w-[760px]">
        <div className="space-y-3">
          <div className="h-6 w-2/5 rounded bg-zinc-100" />
          <div className="h-3 w-full rounded bg-zinc-100" />
          <div className="h-3 w-[92%] rounded bg-zinc-100" />
          <div className="h-3 w-[74%] rounded bg-zinc-100" />
        </div>
      </div>
    );
  }

  if (markdownQuery.isError) {
    return (
      <div className="max-w-[760px] rounded-[12px] border border-red-100 bg-red-50 px-4 py-3 text-[13px] leading-6 text-red-700">
        Markdown 预览读取失败：{markdownQuery.error.message}
      </div>
    );
  }

  if (!rawContent.trim()) {
    return (
      <div className="max-w-[760px] rounded-[12px] border border-zinc-100 bg-zinc-50 px-4 py-3 text-[13px] text-zinc-500">
        这个 Markdown 文件是空的。
      </div>
    );
  }

  const hasFrontmatter = Object.keys(parsed.data).length > 0;
  const bodyContent = parsed.content.trim();

  return (
    <div className="max-w-[760px]">
      {hasFrontmatter && <FrontmatterPanel data={parsed.data} />}
      {bodyContent ? (
        <article className="text-[15px] leading-[1.78] text-zinc-800 [&_a]:font-medium [&_a]:text-blue-600 [&_a:hover]:text-blue-700 [&_blockquote]:my-5 [&_blockquote]:border-l-2 [&_blockquote]:border-zinc-200 [&_blockquote]:pl-4 [&_blockquote]:text-zinc-600 [&_code]:rounded [&_code]:bg-zinc-100 [&_code]:px-1 [&_code]:py-0.5 [&_code]:font-mono [&_code]:text-[0.88em] [&_h1]:mb-5 [&_h1]:mt-0 [&_h1]:text-[28px] [&_h1]:font-bold [&_h1]:leading-tight [&_h1]:text-zinc-950 [&_h2]:mb-3 [&_h2]:mt-8 [&_h2]:text-[22px] [&_h2]:font-bold [&_h2]:leading-tight [&_h2]:text-zinc-950 [&_h3]:mb-2.5 [&_h3]:mt-6 [&_h3]:text-[18px] [&_h3]:font-semibold [&_h3]:text-zinc-950 [&_hr]:my-8 [&_hr]:border-zinc-200 [&_li]:my-1 [&_ol]:my-4 [&_ol]:list-decimal [&_ol]:pl-6 [&_p]:my-4 [&_pre]:my-5 [&_pre]:overflow-x-auto [&_pre]:rounded-[10px] [&_pre]:bg-zinc-950 [&_pre]:p-4 [&_pre_code]:bg-transparent [&_pre_code]:p-0 [&_pre_code]:text-[13px] [&_pre_code]:text-zinc-100 [&_strong]:font-semibold [&_strong]:text-zinc-950 [&_table]:my-5 [&_table]:w-full [&_table]:border-collapse [&_td]:border [&_td]:border-zinc-200 [&_td]:px-3 [&_td]:py-2 [&_th]:border [&_th]:border-zinc-200 [&_th]:bg-zinc-50 [&_th]:px-3 [&_th]:py-2 [&_th]:text-left [&_ul]:my-4 [&_ul]:list-disc [&_ul]:pl-6">
          <ReactMarkdown
            remarkPlugins={[remarkGfm]}
            components={{
              img({ src, alt }) {
                const resolved = resolveMarkdownImage(
                  src,
                  markdownQuery.data!.vaultId,
                  markdownQuery.data!.fileDir,
                );
                return <img src={resolved} alt={alt ?? ""} className="my-5 max-w-full rounded-lg" />;
              },
            }}
          >
            {bodyContent}
          </ReactMarkdown>
        </article>
      ) : hasFrontmatter ? null : (
        <div className="rounded-[12px] border border-zinc-100 bg-zinc-50 px-4 py-3 text-[13px] text-zinc-500">
          这个 Markdown 文件是空的。
        </div>
      )}
    </div>
  );
}

function ImageDetailBody({ asset }: { asset: Asset }) {
  const dims =
    asset.imageWidth && asset.imageHeight
      ? `${asset.imageWidth} × ${asset.imageHeight}`
      : undefined;
  const ext = (asset.fileExt ?? "").toUpperCase() || "IMG";
  const metaList: [string, string][] = [
    ["来源", asset.source.split(" / ")[0] ?? "—"],
    ...(dims ? ([["尺寸", dims]] as [string, string][]) : []),
    ["格式", ext],
    ["采集", asset.time],
  ];
  return (
    <div className="flex gap-6">
      <div className="min-w-0 flex-1">
        <div className="overflow-hidden rounded-[13px] border border-zinc-200 shadow-sm">
          <VisualBlock asset={asset} />
        </div>
      </div>
      <div className="w-[248px] shrink-0">
        <DetailSideMetaList list={metaList} />
      </div>
    </div>
  );
}

function VideoDetailBody({ asset }: { asset: Asset }) {
  return (
    <div className="max-w-[780px]">
      <div className="overflow-hidden rounded-[13px] border border-zinc-200 shadow-sm">
        <VisualBlock asset={asset} />
      </div>
    </div>
  );
}

function LinkDetailBody({ asset, onOpen }: { asset: Asset; onOpen: () => void }) {
  const metaList: [string, string][] = [
    ...(asset.domain ? ([["域名", asset.domain]] as [string, string][]) : []),
    ["快照", "整页已缓存"],
    ["采集", asset.time],
  ];
  return (
    <div className="flex gap-6">
      <div className="min-w-0 flex-1">
        <div className="max-w-[660px] overflow-hidden rounded-[13px] border border-zinc-200 bg-white shadow-sm">
          <VisualBlock asset={asset} />
          <div className="flex items-center gap-2.5 border-t border-zinc-100 px-3.5 py-3">
            <Globe size={14} className="shrink-0 text-zinc-500" />
            <span className="min-w-0 flex-1 overflow-hidden text-ellipsis whitespace-nowrap font-mono text-xs text-zinc-500">
              <b className="font-semibold text-zinc-900">{asset.domain}</b>
              {asset.url && asset.domain ? asset.url.replace(asset.domain, "") : (asset.url ?? "")}
            </span>
            <button type="button" className="shrink-0 text-[11.5px] font-semibold text-blue-600" onClick={onOpen}>
              ↗ 打开
            </button>
          </div>
        </div>
      </div>
      <div className="w-[248px] shrink-0">
        <button
          type="button"
          className="flex w-full items-center justify-center gap-2 rounded-[10px] bg-blue-600 px-4 py-[11px] text-[13px] font-semibold text-white shadow-sm"
          onClick={onOpen}
        >
          <ExternalLink size={14} />
          访问原网页
        </button>
        <div className="mt-5">
          <span className="mb-2.5 block text-[10.5px] font-semibold uppercase tracking-[.06em] text-zinc-400">
            网页信息
          </span>
          <DetailSideMetaList list={metaList} />
        </div>
      </div>
    </div>
  );
}

function FileDetailBody({
  asset,
  onOpen,
  onShowInFinder,
}: {
  asset: Asset;
  onOpen: () => void;
  onShowInFinder: () => void;
}) {
  const [fmt, ...rest] = asset.meta.split(" · ");
  const metaList: [string, string][] = [
    ["格式", fmt ?? "—"],
    ["大小", rest.join(" · ") || "—"],
    ["位置", asset.sourceType === "vault" ? "Vault 内" : "外部路径"],
    ["修改", asset.time],
  ];
  return (
    <div className="flex gap-6">
      <div className="min-w-0 flex-1">
        <DocPreviewSkeleton fileExt={asset.fileExt} />
      </div>
      <div className="w-[248px] shrink-0">
        <button
          type="button"
          className="flex w-full items-center justify-center gap-2 rounded-[10px] bg-blue-600 px-4 py-[11px] text-[13px] font-semibold text-white shadow-sm"
          onClick={onOpen}
        >
          <ExternalLink size={14} />
          用默认应用打开
        </button>
        <button
          type="button"
          className="mt-2 flex w-full items-center justify-center rounded-[10px] border border-zinc-200 bg-white px-4 py-[10px] text-[13px] text-zinc-900"
          onClick={onShowInFinder}
        >
          在访达中显示
        </button>
        {asset.body ? (
          <p className="mt-3.5 rounded-[11px] border border-zinc-100 bg-zinc-50 px-4 py-3.5 text-[13.5px] leading-[1.7] text-zinc-700">
            {asset.body}
          </p>
        ) : null}
        <div className="mt-5">
          <span className="mb-2.5 block text-[10.5px] font-semibold uppercase tracking-[.06em] text-zinc-400">
            文件信息
          </span>
          <DetailSideMetaList list={metaList} />
        </div>
      </div>
    </div>
  );
}

function AssetDetail({
  asset,
  dragEnabled = true,
  terminalAvailable,
  terminalOpen,
  onToggleTerminal,
}: {
  asset: Asset;
  dragEnabled?: boolean;
  terminalAvailable: boolean;
  terminalOpen: boolean;
  onToggleTerminal: () => void;
}) {
  const { label } = getKindMeta(asset.kind);
  const dragClassName = dragEnabled ? "window-drag" : "window-no-drag";
  const openFileMutation = useMutation(trpc.assets.openFile.mutationOptions());
  const openVaultLocationMutation = useMutation(trpc.assets.openVaultLocation.mutationOptions());
  const openAssetInEditorMutation = useMutation(trpc.assets.openAssetInEditor.mutationOptions());
  const copyAssetPathMutation = useMutation(trpc.assets.copyAssetPath.mutationOptions());
  const [pathCopied, setPathCopied] = useState(false);
  const [openWithMenuOpen, setOpenWithMenuOpen] = useState(false);
  const [preferredOpenTargetId, setPreferredOpenTargetId] = useState<OpenVaultTarget>(() => {
    const stored = window.localStorage.getItem(OPEN_VAULT_TARGET_STORAGE_KEY);
    return isOpenVaultTarget(stored) ? stored : DEFAULT_OPEN_VAULT_TARGET.id;
  });
  const preferredOpenTarget = getOpenVaultTarget(preferredOpenTargetId);
  const PreferredOpenIcon = preferredOpenTarget.icon;

  // text/file assets → open specific file in editor; media/link → open vault root
  const shouldOpenFileInEditor = asset.kind === "markdown" || asset.kind === "file";

  const openVaultWithTarget = (targetId: OpenVaultTarget, persistTarget: boolean) => {
    if (persistTarget) {
      setPreferredOpenTargetId(targetId);
      window.localStorage.setItem(OPEN_VAULT_TARGET_STORAGE_KEY, targetId);
    }
    if (targetId === "finder") {
      openVaultLocationMutation.mutate({ target: "finder" });
    } else if (shouldOpenFileInEditor) {
      openAssetInEditorMutation.mutate({ id: asset.id, target: targetId });
    } else {
      openVaultLocationMutation.mutate({ target: targetId });
    }
  };

  return (
    <main className="flex h-full min-w-0 flex-col bg-white">
      {/* ── Top bar: breadcrumb + actions on one line ── */}
      <div className={`${dragClassName} relative z-[75] flex h-14 shrink-0 items-center gap-2 border-b border-zinc-100 bg-white px-6`}>
        <Button
          size="sm"
          variant="ghost"
          className="window-no-drag h-7 gap-1 px-2 text-[12.5px] font-semibold text-zinc-800"
          onPress={() => { window.location.hash = "/"; }}
        >
          <ArrowLeft size={13} />
          返回
        </Button>
        <span className="text-xs text-zinc-400">全部资产 / {asset.tag}</span>
        <div className="flex-1" />
        <div className="window-no-drag flex items-center gap-2">
          {/* Editor split button — same as board header */}
          <div className="inline-flex h-6 overflow-hidden rounded-lg border border-zinc-200 bg-white text-zinc-600 shadow-[0_1px_1px_rgba(24,24,27,0.03)]">
            <button
              type="button"
              className="inline-grid h-6 w-7 place-items-center border-r border-zinc-200 transition-colors hover:bg-zinc-50 disabled:pointer-events-none disabled:opacity-45"
              aria-label={`用 ${preferredOpenTarget.label} 打开资产库`}
              disabled={openVaultLocationMutation.isPending}
              onClick={() => openVaultWithTarget(preferredOpenTarget.id, false)}
            >
              <PreferredOpenIcon aria-hidden="true" className={HEADER_ICON_CLASS_NAME} />
            </button>
            <Dropdown isOpen={openWithMenuOpen} onOpenChange={setOpenWithMenuOpen}>
              <Dropdown.Trigger
                className="inline-grid h-6 w-6 place-items-center outline-none transition-colors hover:bg-zinc-50"
                aria-label="选择打开方式"
              >
                <ChevronDown
                  className={`${HEADER_ICON_CLASS_NAME} transition-transform duration-200 ${openWithMenuOpen ? "rotate-180" : ""}`}
                />
              </Dropdown.Trigger>
              <Dropdown.Popover
                className="z-[120] overflow-hidden rounded-xl border border-zinc-200 bg-white p-1 shadow-[0_14px_34px_rgba(20,18,16,0.14),0_2px_7px_rgba(20,18,16,0.07)]"
                offset={6}
                placement="bottom end"
              >
                <Dropdown.Menu
                  aria-label="打开资产库"
                  className="min-w-36 p-0 outline-none"
                  disabledKeys={openVaultLocationMutation.isPending ? OPEN_VAULT_TARGETS.map((t) => t.id) : []}
                  onAction={(key) => openVaultWithTarget(key as OpenVaultTarget, true)}
                >
                  {OPEN_VAULT_TARGETS.map((target) => {
                    const Icon = target.icon;
                    return (
                      <Dropdown.Item
                        key={target.id}
                        id={target.id}
                        textValue={target.label}
                        className="flex h-7 cursor-default items-center gap-2 rounded-lg px-2 text-[12.5px] font-medium text-zinc-700 outline-none transition-colors data-[focused]:bg-zinc-100 data-[hovered]:bg-zinc-100 data-[disabled]:opacity-45"
                      >
                        <Icon aria-hidden="true" className={`${HEADER_ICON_CLASS_NAME} text-zinc-500`} />
                        <Label className="cursor-default text-[12.5px] font-medium text-inherit">{target.label}</Label>
                      </Dropdown.Item>
                    );
                  })}
                </Dropdown.Menu>
              </Dropdown.Popover>
            </Dropdown>
          </div>
          {/* Copy path button */}
          <Button
            size="sm"
            isIconOnly
            aria-label="复制文件路径"
            className="window-no-drag h-6 min-h-0 rounded-lg border border-zinc-200 bg-white px-2 text-[11px] text-zinc-600 hover:bg-zinc-50"
            onPress={() => {
              copyAssetPathMutation.mutate(
                { id: asset.id },
                {
                  onSuccess: () => {
                    setPathCopied(true);
                    setTimeout(() => setPathCopied(false), 1500);
                  },
                },
              );
            }}
          >
            {pathCopied ? (
              <Check className={HEADER_ICON_CLASS_NAME} />
            ) : (
              <Copy className={HEADER_ICON_CLASS_NAME} />
            )}
          </Button>
          {/* Terminal button */}
          <Button
            size="sm"
            isIconOnly
            isDisabled={!terminalAvailable}
            aria-label={terminalAvailable ? "打开终端侧栏" : "当前平台暂不支持终端侧栏"}
            className={`window-no-drag h-6 min-h-0 rounded-lg border px-2 text-[11px] ${
              terminalOpen
                ? "border-zinc-300 bg-zinc-100 text-zinc-900"
                : "border-zinc-200 bg-white text-zinc-600 hover:bg-zinc-50"
            }`}
            onPress={onToggleTerminal}
          >
            <PanelRightOpen className={HEADER_ICON_CLASS_NAME} />
          </Button>
        </div>
      </div>

      {/* ── Sub-header: kind badge + title + meta + tags ── */}
      <div className="shrink-0 border-b border-zinc-100 px-10 pb-5 pt-6">
        {/* kind badge + title */}
        <div className="flex items-start gap-2.5">
          <span className="mt-[7px] shrink-0 rounded border border-zinc-200 px-1 py-px font-mono text-[8.5px] font-semibold uppercase tracking-wider text-zinc-400">
            {label}
          </span>
          <h1 className="max-w-[760px] text-[25px] font-bold leading-[1.28] tracking-[0.005em] text-zinc-950">
            {asset.title}
          </h1>
        </div>
        {/* meta row */}
        <div className="mt-3.5 flex flex-wrap items-center gap-[9px] text-xs text-zinc-500">
          <span>{asset.source.split(" / ")[0]}</span>
          <span className="opacity-60">·</span>
          <span>{asset.time}</span>
          <span className="opacity-60">·</span>
          <span>{asset.meta}</span>
          <span className="opacity-60">·</span>
          <span className="text-zinc-400">只读预览</span>
        </div>
        {/* tags row */}
        <div className="mt-3.5 flex flex-wrap items-center gap-2">
          <TagPill name={asset.tag} />
          <button
            type="button"
            className="flex h-6 w-6 items-center justify-center rounded-[7px] border border-dashed border-zinc-200 text-zinc-400 hover:border-blue-200 hover:text-blue-500"
          >
            <Plus size={13} />
          </button>
        </div>
      </div>

      {/* ── Body ── */}
      <ScrollArea className="min-h-0 flex-1" viewportClassName="px-10 py-7">
        {asset.kind === "markdown" && <MarkdownDetailBody asset={asset} />}
        {asset.kind === "image" && <ImageDetailBody asset={asset} />}
        {asset.kind === "video" && <VideoDetailBody asset={asset} />}
        {(asset.kind === "web" || asset.kind === "link") && (
          <LinkDetailBody asset={asset} onOpen={() => openFileMutation.mutate({ id: asset.id })} />
        )}
        {asset.kind === "file" && (
          <FileDetailBody
            asset={asset}
            onOpen={() => openFileMutation.mutate({ id: asset.id })}
            onShowInFinder={() => openVaultLocationMutation.mutate({ target: "finder" })}
          />
        )}
      </ScrollArea>
    </main>
  );
}


function getMainDefaultSize(_activeAsset: Asset | undefined, sidebarCollapsed: boolean) {
  return sidebarCollapsed ? 100 : 80;
}

export function AssetManagerPage({ assetId }: { assetId?: string }) {
  const assetsQuery = useQuery(trpc.assets.list.queryOptions());
  const indexedAssets = useMemo(
    () => assetsQuery.data?.assets.map(mapIndexedAsset) ?? [],
    [assetsQuery.data?.assets],
  );
  const assetItems = indexedAssets;
  const activeAsset = assetId ? assetItems.find((asset) => asset.id === assetId) : undefined;
  const [sidebarCollapsed, setSidebarCollapsed] = useState(
    () => localStorage.getItem("post.assetManager.sidebarCollapsed") === "true",
  );
  const [sidebarPreviewOpen, setSidebarPreviewOpen] = useState(false);
  const [terminalOpen, setTerminalOpen] = useState(false);
  const sidebarPanelRef = useRef<PanelImperativeHandle | null>(null);
  const sidebarCollapseIntentRef = useRef<"collapsed" | "expanded" | null>(null);

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
    localStorage.setItem("post.assetManager.sidebarCollapsed", String(sidebarCollapsed));
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
  const vaultAvailable = Boolean(assetsQuery.data?.vault);
  const terminalAvailable = vaultAvailable && isMacWindow();

  return (
      <div className="relative h-full min-h-0 overflow-hidden text-zinc-950">
        {sidebarCollapsed && !sidebarPreviewOpen ? (
          <div
            aria-hidden="true"
            className="window-drag pointer-events-none absolute left-6 right-48 top-0 z-[74] h-14"
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
          id="asset-layout"
          direction="horizontal"
          className="panel-layout h-full min-h-0 overflow-hidden bg-transparent"
          resizeTargetMinimumSize={{ coarse: 32, fine: 12 }}
          defaultLayout={sidebarCollapsed ? { sidebar: 0, main: 100 } : undefined}
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
            <AssetDetail
              asset={activeAsset}
              dragEnabled={backgroundWindowDragEnabled}
              terminalAvailable={terminalAvailable}
              terminalOpen={terminalOpen}
              onToggleTerminal={() => setTerminalOpen((open) => !open)}
            />
          ) : (
            <AssetBoard
              assetItems={assetItems}
              tagOptions={assetsQuery.data?.tags ?? []}
              dragEnabled={backgroundWindowDragEnabled}
              vaultAvailable={vaultAvailable}
              terminalAvailable={terminalAvailable}
              terminalOpen={terminalOpen}
              onToggleTerminal={() => setTerminalOpen((open) => !open)}
              loading={assetsQuery.isLoading}
              errorMessage={assetsQuery.error?.message}
            />
          )}
        </ResizablePanel>

        {!activeAsset && terminalOpen ? (
          <>
            <ResizableHandle withHandle />
            <ResizablePanel id="asset-terminal" defaultSize={30} minSize={20} maxSize={48}>
              <AssetTerminalPanel
                dragEnabled={backgroundWindowDragEnabled}
                onHide={() => setTerminalOpen(false)}
              />
            </ResizablePanel>
          </>
        ) : null}

        </ResizablePanelGroup>
      </div>
  );
}
