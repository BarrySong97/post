/**
 * @purpose Provide pure React presentation components for Post desktop product previews.
 * @role    Shared UI layer consumed by marketing mocks and future desktop display extraction.
 * @deps    react, lucide-react, shared Tailwind theme classes.
 * @gotcha  Keep this file free of Electron, tRPC, router, Jotai, localStorage, and database imports.
 */
import React, {
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ComponentType,
  type CSSProperties,
  type Dispatch,
  type Ref,
  type ReactNode,
  type SetStateAction,
  type SVGProps,
} from "react";
import {
  AccordionBody,
  AccordionItem,
  AccordionPanel,
  AccordionRoot,
  Button,
  Chip,
  Dropdown,
  Input,
  Label,
  ListBox,
  Popover,
  Select,
  Tag,
  TagGroup,
  Tabs,
} from "@heroui/react";
import { PointerActivationConstraints, PointerSensor } from "@dnd-kit/dom";
import { arrayMove } from "@dnd-kit/helpers";
import { DragDropProvider, type DragEndEvent } from "@dnd-kit/react";
import { isSortable, useSortable } from "@dnd-kit/react/sortable";
import { AnimatePresence, motion } from "motion/react";
import * as ScrollAreaPrimitive from "@radix-ui/react-scroll-area";
import { useVirtualizer } from "@tanstack/react-virtual";
import type { ForceGraphMethods, LinkObject, NodeObject } from "react-force-graph-2d";
import { Group, Panel, Separator, type PanelImperativeHandle } from "react-resizable-panels";
import {
  Archive,
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  ArrowUpToLine,
  ChevronDown,
  Code2,
  Copy,
  Check,
  ExternalLink,
  FileArchive,
  FileSpreadsheet,
  FileText,
  Filter,
  FolderClosed,
  FolderKanban,
  Globe,
  GripVertical,
  Image as ImageIcon,
  Inbox,
  MoreHorizontal,
  Network,
  PanelLeftClose,
  PanelLeftOpen,
  Pencil,
  Play,
  Plus,
  Settings,
  ShieldCheck,
  Settings2,
  Sparkles,
  Trash2,
  type LucideIcon,
  X,
} from "lucide-react";

export type PostPreviewSidebarItemId =
  | "all"
  | "inbox"
  | "graph"
  | `view:${string}`
  | `tag:${string}`;

export type PostPreviewView = {
  id: string;
  name: string;
  count: number;
  icon?: "folder" | "code" | "sparkles" | "image" | "archive";
};

export type PostPreviewTag = {
  id: string;
  name: string;
  count: number;
  color: string;
};

export type PostPreviewSidebarData = {
  summary: {
    total: number;
    inbox: number;
  };
  views: PostPreviewView[];
  tags: PostPreviewTag[];
};

export type PostPreviewAssetKind = "image" | "video" | "file" | "link" | "web" | "markdown";

export type PostPreviewAsset = {
  id: string;
  title: string;
  kind: PostPreviewAssetKind;
  source: string;
  time: string;
  meta: string;
  tag: string;
  tagColor: string;
  isPrivate?: boolean;
  body?: string;
  thumbnailUrl?: string;
  url?: string;
  domain?: string;
  fileExt?: string;
  duration?: string;
  imageWidth?: number;
  imageHeight?: number;
  height?: "short" | "medium" | "tall";
  aspect?: string;
};

export type PostPreviewStatusTask = {
  id: string;
  title: string;
  detail: string;
  type: "sync" | "indexing" | "reconcile" | "publish";
  state: "running" | "queued" | "failed" | "completed";
  progress?: string;
};

export type PostPreviewStatusData = {
  appVersion: string;
  vaultName: string;
  syncState: string;
  staleState: string;
  tasks?: PostPreviewStatusTask[];
};

export type PostPreviewSettingsData = {
  sections: Array<{
    title: string;
    rows: Array<{ title: string; description: string; value: string }>;
  }>;
};

export type PostPreviewGraphNode = {
  id: string;
  label: string;
  kind: PostPreviewAssetKind;
};

export type PostPreviewGraphEdgeRelation =
  | "wiki_link"
  | "embed"
  | "markdown_link"
  | "markdown_image"
  | "external_url";

export type PostPreviewGraphEdge = {
  source: string;
  target: string;
  relationType: PostPreviewGraphEdgeRelation;
};

export type PostPreviewGraphData = {
  title: string;
  nodes: PostPreviewGraphNode[];
  edges: PostPreviewGraphEdge[];
};

export type PostPreviewFilterState = {
  match: "and" | "or";
  types: string[];
  tags: string[];
  sources: string[];
  time: "any" | "today" | "week" | "m30" | "custom";
  status: "any" | "inbox" | "draft" | "published";
  sort: "updated_desc" | "updated_asc" | "created_desc" | "created_asc";
};

export type PostPreviewFilterOptions = {
  types: Array<{ value: string; label: string }>;
  tags: Array<{ value: string; label: string; color?: string }>;
  sources: Array<{ value: string; label: string }>;
  times: Array<{ value: string; label: string }>;
  statuses: Array<{ value: string; label: string }>;
  sorts: Array<{ value: string; label: string }>;
};

export type PostPreviewOpenTarget = {
  id: "vscode" | "cursor" | "zed" | "finder";
  label: string;
};

const iconClass = "h-[14px] w-[14px]";
const toolbarIconClass = "size-3.5 shrink-0";
const trafficLightSafeZonePx = 100;
const toolbarButtonsPx = 104;
const titleGapPx = 12;
const headerNaturalPaddingPx = 24;
const collapsedHeaderInsetPx = trafficLightSafeZonePx + toolbarButtonsPx + titleGapPx;
const sidebarMinWidthPx = 320;
const sidebarMaxWidthPx = 560;
type SidebarSectionId = "views" | "tags";
const sidebarSectionIds: SidebarSectionId[] = ["views", "tags"];
const sidebarSectionType = "sidebar-section";
const sidebarItemTypePrefix = "sidebar-item:";
const sidebarItemBase =
  "group/item relative flex w-full select-none items-center gap-2 rounded-lg px-3 py-1.5 text-left text-[13px] outline-none transition-colors focus-visible:ring-2 focus-visible:ring-zinc-500/25";
const activeSidebarItem =
  "bg-[var(--sidebar-item-selected,rgb(24_24_27/0.07))] font-medium text-zinc-950 shadow-[inset_0_0_0_1px_var(--sidebar-item-selected-border,rgb(24_24_27/0.065))] hover:bg-[var(--sidebar-item-selected-hover,rgb(24_24_27/0.09))] active:bg-[var(--sidebar-item-pressed,rgb(24_24_27/0.075))]";
const inactiveSidebarItem =
  "text-zinc-600 hover:bg-[var(--sidebar-item-hover,rgb(24_24_27/0.045))] hover:text-zinc-800 active:bg-[var(--sidebar-item-pressed,rgb(24_24_27/0.075))]";
const sidebarActionButtonClass =
  "grid h-5 w-5 cursor-pointer place-items-center rounded-md text-zinc-400 transition-colors hover:bg-black/5 hover:text-zinc-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-500/25 disabled:pointer-events-none disabled:cursor-default disabled:opacity-35";
const sidebarMoreTriggerClass =
  "grid h-5 w-5 cursor-pointer place-items-center rounded-md text-zinc-400 outline-none transition-colors hover:bg-black/5 hover:text-zinc-700 data-[focus-visible]:ring-2 data-[focus-visible]:ring-zinc-500/25";
const previewHeaderPaddingStyle = {
  paddingLeft: "var(--post-preview-header-padding-left, 24px)",
} satisfies CSSProperties;
const assetColumnWidth = 260;
const assetColumnGutter = 16;
const assetGridPaddingX = 24;
const assetGridPaddingY = 18;
const assetCardOverscan = 8;

function cn(...classes: Array<string | false | null | undefined>) {
  return classes.filter(Boolean).join(" ");
}

export function getTagHue(name: string): number {
  let hash = 0;
  for (let index = 0; index < name.length; index += 1) {
    hash = (hash * 31 + name.charCodeAt(index)) % 360;
  }

  return hash || 210;
}

type ScrollAreaProps = React.ComponentProps<typeof ScrollAreaPrimitive.Root> & {
  viewportClassName?: string;
  viewportRef?: Ref<HTMLDivElement>;
  scrollbarClassName?: string;
  thumbClassName?: string;
};

function ScrollArea({
  className,
  children,
  viewportClassName,
  viewportRef,
  scrollbarClassName,
  thumbClassName,
  ...props
}: ScrollAreaProps) {
  return (
    <ScrollAreaPrimitive.Root className={cn("relative overflow-hidden", className)} {...props}>
      <ScrollAreaPrimitive.Viewport
        ref={viewportRef}
        className={cn("h-full w-full rounded-[inherit]", viewportClassName)}
      >
        {children}
      </ScrollAreaPrimitive.Viewport>
      <ScrollAreaPrimitive.ScrollAreaScrollbar
        orientation="vertical"
        className={cn(
          "flex h-full w-2.5 touch-none select-none border-l border-l-transparent p-px transition-colors",
          scrollbarClassName,
        )}
      >
        <ScrollAreaPrimitive.ScrollAreaThumb
          className={cn("relative flex-1 rounded-full bg-zinc-300/75", thumbClassName)}
        />
      </ScrollAreaPrimitive.ScrollAreaScrollbar>
      <ScrollAreaPrimitive.Corner />
    </ScrollAreaPrimitive.Root>
  );
}

type ResizablePanelGroupProps = React.ComponentProps<typeof Group> & {
  direction?: React.ComponentProps<typeof Group>["orientation"];
};

function ResizablePanelGroup({
  className,
  direction,
  orientation,
  ...props
}: ResizablePanelGroupProps) {
  return (
    <Group
      className={cn("h-full w-full", className)}
      orientation={orientation ?? direction ?? "horizontal"}
      {...props}
    />
  );
}

function ResizablePanel(props: React.ComponentProps<typeof Panel>) {
  return <Panel {...props} />;
}

function ResizableHandle({
  className,
  withHandle,
  ...props
}: React.ComponentProps<typeof Separator> & { withHandle?: boolean }) {
  return (
    <Separator
      className={cn(
        "relative flex w-px items-center justify-center bg-zinc-200/80 transition-colors hover:bg-blue-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500",
        className,
      )}
      {...props}
    >
      {withHandle ? (
        <span className="z-10 grid h-6 w-3 place-items-center rounded-sm border border-zinc-200 bg-white shadow-sm">
          <GripVertical size={12} className="text-zinc-400" />
        </span>
      ) : null}
    </Separator>
  );
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function previewFrameStyle(sidebarCollapsed: boolean, sidebarWidth: number) {
  return {
    "--post-preview-header-padding-left": `${sidebarCollapsed ? collapsedHeaderInsetPx : headerNaturalPaddingPx}px`,
    "--post-preview-sidebar-width": `${sidebarWidth}px`,
  } as CSSProperties;
}

function viewIcon(icon: PostPreviewView["icon"], className: string) {
  const Icon =
    icon === "code"
      ? Code2
      : icon === "sparkles"
        ? Sparkles
        : icon === "image"
          ? ImageIcon
          : icon === "archive"
            ? FileArchive
            : FolderKanban;

  return <Icon className={className} />;
}

function isSidebarSectionId(value: unknown): value is SidebarSectionId {
  return typeof value === "string" && sidebarSectionIds.includes(value as SidebarSectionId);
}

function getSidebarItemType(sectionId: SidebarSectionId) {
  return `${sidebarItemTypePrefix}${sectionId}`;
}

function getSectionIdFromItemType(type: unknown): SidebarSectionId | null {
  if (typeof type !== "string" || !type.startsWith(sidebarItemTypePrefix)) {
    return null;
  }

  const sectionId = type.slice(sidebarItemTypePrefix.length);
  return isSidebarSectionId(sectionId) ? sectionId : null;
}

type OpenTargetIconComponent = ComponentType<SVGProps<SVGSVGElement>>;

const CursorEditorIcon: OpenTargetIconComponent = ({ className, ...props }) => (
  <svg {...props} viewBox="0 0 466.73 532.09" className={className} fill="currentColor">
    <path d="M457.43,125.94L244.42,2.96c-6.84-3.95-15.28-3.95-22.12,0L9.3,125.94c-5.75,3.32-9.3,9.46-9.3,16.11v247.99c0,6.65,3.55,12.79,9.3,16.11l213.01,122.98c6.84,3.95,15.28,3.95,22.12,0l213.01-122.98c5.75-3.32,9.3-9.46,9.3-16.11v-247.99c0-6.65-3.55-12.79-9.3-16.11h-.01ZM444.05,151.99l-205.63,356.16c-1.39,2.4-5.06,1.42-5.06-1.36v-233.21c0-4.66-2.49-8.97-6.53-11.31L24.87,145.67c-2.4-1.39-1.42-5.06,1.36-5.06h411.26c5.84,0,9.49,6.33,6.57,11.39h-.01Z" />
  </svg>
);

const VisualStudioCodeIcon: OpenTargetIconComponent = (props) => {
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

const ZedEditorIcon: OpenTargetIconComponent = (props) => {
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

const openTargetIcons: Record<PostPreviewOpenTarget["id"], OpenTargetIconComponent> = {
  vscode: VisualStudioCodeIcon,
  cursor: CursorEditorIcon,
  zed: ZedEditorIcon,
  finder: FolderClosed,
};

function OpenTargetIcon({ id, className }: { id: PostPreviewOpenTarget["id"]; className: string }) {
  const Icon = openTargetIcons[id] ?? VisualStudioCodeIcon;
  return <Icon aria-hidden="true" className={className} />;
}

function PreviewPageChrome({ children }: { children: ReactNode }) {
  return (
    <div
      style={previewHeaderPaddingStyle}
      className="relative z-[75] flex h-10 shrink-0 items-center gap-2.5 border-b border-zinc-100 bg-white pr-6"
    >
      {children}
    </div>
  );
}

function SidebarItemActionButton({
  label,
  icon: Icon,
  disabled,
  onClick,
}: {
  label: string;
  icon: LucideIcon;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      data-no-drag
      disabled={disabled}
      className={sidebarActionButtonClass}
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

function SidebarMoreMenu({
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
  return (
    <Dropdown>
      <Dropdown.Trigger
        data-no-drag
        className={sidebarMoreTriggerClass}
        aria-label={`${itemName} 更多操作`}
        onClick={(event) => {
          event.stopPropagation();
        }}
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
          aria-label={`${itemName} 操作`}
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
            textValue="移到最前"
            className="flex h-7 cursor-default items-center gap-2 rounded-lg px-2 text-[12.5px] font-medium text-zinc-700 outline-none transition-colors data-[disabled]:opacity-45 data-[focused]:bg-zinc-100 data-[hovered]:bg-zinc-100"
          >
            <ArrowUpToLine size={13} className="text-zinc-500" />
            <span>移到最前</span>
          </Dropdown.Item>
          <Dropdown.Item
            key="edit"
            id="edit"
            textValue="编辑"
            className="flex h-7 cursor-default items-center gap-2 rounded-lg px-2 text-[12.5px] font-medium text-zinc-700 outline-none transition-colors data-[focused]:bg-zinc-100 data-[hovered]:bg-zinc-100"
          >
            <Pencil size={13} className="text-zinc-500" />
            <span>编辑</span>
          </Dropdown.Item>
          <Dropdown.Item
            key="delete"
            id="delete"
            textValue="删除"
            className="flex h-7 cursor-default items-center gap-2 rounded-lg px-2 text-[12.5px] font-medium text-red-600 outline-none transition-colors data-[focused]:bg-red-50 data-[hovered]:bg-red-50"
          >
            <Trash2 size={13} />
            <span>删除</span>
          </Dropdown.Item>
        </Dropdown.Menu>
      </Dropdown.Popover>
    </Dropdown>
  );
}

function SidebarRow({
  id,
  activeId,
  label,
  meta,
  icon,
  color,
  actions,
  onSelect,
}: {
  id: PostPreviewSidebarItemId;
  activeId: PostPreviewSidebarItemId;
  label: string;
  meta?: number;
  icon?: ReactNode;
  color?: string;
  actions?: ReactNode;
  onSelect: (id: PostPreviewSidebarItemId) => void;
}) {
  const active = activeId === id;
  const iconColor = active
    ? "shrink-0 text-zinc-700"
    : "shrink-0 text-zinc-400 group-hover/item:text-zinc-500";
  return (
    <div
      role="button"
      tabIndex={0}
      className={`${sidebarItemBase} cursor-pointer ${active ? activeSidebarItem : inactiveSidebarItem}`}
      onClick={() => onSelect(id)}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onSelect(id);
        }
      }}
    >
      {icon ? <span className={iconColor}>{icon}</span> : null}
      {color ? (
        <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: color }} />
      ) : null}
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {meta !== undefined || actions ? (
        <span className="relative ml-auto flex h-5 min-w-[70px] shrink-0 items-center justify-end overflow-hidden">
          {meta !== undefined ? (
            <span
              className={cn(
                active ? "text-xs text-zinc-500" : "text-xs text-zinc-400",
                actions
                  ? "transition-all duration-150 ease-out group-hover/item:-translate-y-1 group-hover/item:opacity-0 group-focus-within/item:-translate-y-1 group-focus-within/item:opacity-0"
                  : "",
              )}
            >
              {meta}
            </span>
          ) : null}
          {actions ? (
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
    type: sidebarSectionType,
    accept: sidebarSectionType,
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

function SidebarSection({
  title,
  children,
  action,
  defaultOpen = true,
  dragHandleRef,
}: {
  title: string;
  children: ReactNode;
  action?: ReactNode;
  defaultOpen?: boolean;
  dragHandleRef?: (element: Element | null) => void;
}) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <div className="rounded-lg transition-colors duration-150">
      <div
        ref={dragHandleRef}
        className="group/section flex select-none items-center gap-1 px-2 py-1"
      >
        <span className="flex-1 text-[11px] font-semibold uppercase tracking-wide text-zinc-400">
          {title}
        </span>
        <div className="flex items-center gap-0.5 opacity-0 transition-opacity group-hover/section:opacity-100">
          {action}
          <button
            type="button"
            className="flex h-5 w-5 items-center justify-center rounded text-zinc-400 hover:bg-black/5"
            onClick={() => setOpen((value) => !value)}
          >
            <ChevronDown
              size={12}
              className={`transition-transform duration-200 ${open ? "" : "-rotate-90"}`}
            />
          </button>
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
    </div>
  );
}

export function PostPreviewSidebar({
  data,
  activeId,
  onSelect,
  onMoveView,
  onMoveTag,
  onCreateView,
  onManageViews,
  onCreateTag,
  onManageTags,
  onMockAction,
  floating = false,
}: {
  data: PostPreviewSidebarData;
  activeId: PostPreviewSidebarItemId;
  onSelect: (id: PostPreviewSidebarItemId) => void;
  onMoveView?: (fromIndex: number, toIndex: number) => void;
  onMoveTag?: (fromIndex: number, toIndex: number) => void;
  onCreateView?: () => void;
  onManageViews?: () => void;
  onCreateTag?: () => void;
  onManageTags?: () => void;
  onMockAction?: (label: string) => void;
  floating?: boolean;
}) {
  const [sectionOrder, setSectionOrder] = useState<SidebarSectionId[]>(sidebarSectionIds);

  const viewActions = (view: PostPreviewView, index: number) => (
    <>
      <SidebarItemActionButton
        label={`${view.name} 往前移一格`}
        icon={ArrowUp}
        disabled={index === 0}
        onClick={() => onMoveView?.(index, index - 1)}
      />
      <SidebarItemActionButton
        label={`${view.name} 往后移一格`}
        icon={ArrowDown}
        disabled={index === data.views.length - 1}
        onClick={() => onMoveView?.(index, index + 1)}
      />
      <SidebarMoreMenu
        itemName={view.name}
        isFirst={index === 0}
        onMoveFirst={() => onMoveView?.(index, 0)}
        onEdit={() => onMockAction?.(`编辑 View「${view.name}」`)}
        onDelete={() => onMockAction?.(`删除 View「${view.name}」`)}
      />
    </>
  );

  const tagActions = (tag: PostPreviewTag, index: number) => (
    <>
      <SidebarItemActionButton
        label={`${tag.name} 往前移一格`}
        icon={ArrowUp}
        disabled={index === 0}
        onClick={() => onMoveTag?.(index, index - 1)}
      />
      <SidebarItemActionButton
        label={`${tag.name} 往后移一格`}
        icon={ArrowDown}
        disabled={index === data.tags.length - 1}
        onClick={() => onMoveTag?.(index, index + 1)}
      />
      <SidebarMoreMenu
        itemName={tag.name}
        isFirst={index === 0}
        onMoveFirst={() => onMoveTag?.(index, 0)}
        onEdit={() => onMockAction?.(`编辑 Tag「${tag.name}」`)}
        onDelete={() => onMockAction?.(`删除 Tag「${tag.name}」`)}
      />
    </>
  );

  const handleSidebarDragEnd = (event: DragEndEvent) => {
    if (event.canceled) {
      return;
    }

    const { source } = event.operation;
    if (!isSortable(source) || source.initialIndex === source.index) {
      return;
    }

    if (source.type === sidebarSectionType) {
      setSectionOrder((current) => arrayMove([...current], source.initialIndex, source.index));
      return;
    }

    const sectionId = getSectionIdFromItemType(source.type);
    if (!sectionId || source.initialGroup !== source.group) {
      return;
    }

    if (sectionId === "views") {
      onMoveView?.(source.initialIndex, source.index);
      return;
    }

    onMoveTag?.(source.initialIndex, source.index);
  };

  const renderSortableSection = (
    sectionId: SidebarSectionId,
    dragHandleRef: (element: Element | null) => void,
  ) => {
    if (sectionId === "views") {
      return (
        <SidebarSection
          title="Views"
          dragHandleRef={dragHandleRef}
          action={
            <>
              <button
                type="button"
                aria-label="新建 View"
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
                onClick={onManageViews}
              >
                管理
              </button>
            </>
          }
        >
          <div className="space-y-0.5">
            {data.views.slice(0, 10).map((view, index) => (
              <SortableSidebarItem key={view.id} sectionId="views" itemId={view.id} index={index}>
                <SidebarRow
                  id={`view:${view.id}`}
                  activeId={activeId}
                  label={view.name}
                  meta={view.count}
                  icon={viewIcon(view.icon, iconClass)}
                  actions={viewActions(view, index)}
                  onSelect={onSelect}
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
          <>
            <button
              type="button"
              aria-label="新建 Tag"
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
              onClick={onManageTags}
            >
              管理
            </button>
          </>
        }
      >
        <div className="space-y-0.5">
          {data.tags.slice(0, 10).map((tag, index) => (
            <SortableSidebarItem key={tag.id} sectionId="tags" itemId={tag.id} index={index}>
              <SidebarRow
                id={`tag:${tag.id}`}
                activeId={activeId}
                label={tag.name}
                meta={tag.count}
                color={tag.color}
                actions={tagActions(tag, index)}
                onSelect={onSelect}
              />
            </SortableSidebarItem>
          ))}
        </div>
      </SidebarSection>
    );
  };

  return (
    <aside
      className={cn(
        "flex h-full w-full flex-col border-r shadow-[inset_-1px_0_0_rgba(255,255,255,0.45)]",
        floating
          ? "overflow-hidden rounded-r-2xl border-zinc-200 bg-white shadow-2xl shadow-black/15"
          : "border-white/45 bg-white/45 backdrop-blur-2xl backdrop-saturate-150",
      )}
    >
      <div className="relative mt-[10.5px] h-12 shrink-0 pl-[100px]" />

      <div className="shrink-0 px-3 pb-1">
        <SidebarSection
          title="资产管理"
          action={
            <button
              type="button"
              data-no-drag
              className="flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] text-zinc-400 hover:bg-black/5"
              onClick={() => onMockAction?.("新建资产管理项")}
            >
              <Plus size={11} />
              新建
            </button>
          }
        >
          <div className="space-y-0.5">
            <SidebarRow
              id="all"
              activeId={activeId}
              label="全部资产"
              meta={data.summary.total}
              icon={<Archive className={iconClass} />}
              onSelect={onSelect}
            />
            <SidebarRow
              id="inbox"
              activeId={activeId}
              label="待整理"
              meta={data.summary.inbox}
              icon={<Inbox className={iconClass} />}
              onSelect={onSelect}
            />
            <SidebarRow
              id="graph"
              activeId={activeId}
              label="知识图谱"
              icon={<Network className={iconClass} />}
              onSelect={onSelect}
            />
          </div>
        </SidebarSection>
      </div>

      <ScrollArea
        className="min-h-0 flex-1"
        viewportClassName="px-3 pb-4 pt-2"
        scrollbarClassName="w-2 border-l-0 bg-transparent p-[2px] opacity-0 transition-opacity duration-150 data-[state=visible]:opacity-100 hover:opacity-100"
        thumbClassName="bg-zinc-400/35 hover:bg-zinc-500/45"
      >
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
            {sectionOrder.map((sectionId, index) => (
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

export function PostDesktopPreviewFrame({
  sidebar,
  statusLine,
  children,
  sidebarCollapsed,
  sidebarPreviewOpen,
  previewSidebar,
  sidebarWidth = sidebarMinWidthPx,
  hideSidebar = false,
  chromeNavVisible = true,
  canGoBack,
  canGoForward,
  onSidebarWidthChange,
  onToggleSidebar,
  onBack,
  onForward,
  onOpenSidebarPreview,
  onCloseSidebarPreview,
}: {
  sidebar: ReactNode;
  statusLine: ReactNode;
  children: ReactNode;
  sidebarCollapsed: boolean;
  sidebarPreviewOpen: boolean;
  previewSidebar: ReactNode;
  sidebarWidth?: number;
  hideSidebar?: boolean;
  chromeNavVisible?: boolean;
  canGoBack: boolean;
  canGoForward: boolean;
  onSidebarWidthChange?: (width: number) => void;
  onToggleSidebar: () => void;
  onBack: () => void;
  onForward: () => void;
  onOpenSidebarPreview: () => void;
  onCloseSidebarPreview: () => void;
}) {
  const ToggleIcon = sidebarCollapsed ? PanelLeftOpen : PanelLeftClose;
  const frameRef = useRef<HTMLDivElement | null>(null);
  const sidebarPanelRef = useRef<PanelImperativeHandle | null>(null);
  const normalizedSidebarWidth = clamp(sidebarWidth, sidebarMinWidthPx, sidebarMaxWidthPx);
  // Mirrors the desktop `panel-animating` gate: the flex-grow transition is only enabled for the
  // duration of an intentional collapse/expand toggle so panel resizes stay instant.
  const [sidebarAnimating, setSidebarAnimating] = useState(false);
  const sidebarAnimationTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const sidebarCollapsedRef = useRef(sidebarCollapsed);

  useEffect(() => {
    const panel = sidebarPanelRef.current;
    if (!panel || hideSidebar) return;
    if (sidebarCollapsed !== sidebarCollapsedRef.current) {
      sidebarCollapsedRef.current = sidebarCollapsed;
      if (sidebarAnimationTimerRef.current !== null) {
        clearTimeout(sidebarAnimationTimerRef.current);
      }
      setSidebarAnimating(true);
      sidebarAnimationTimerRef.current = setTimeout(() => {
        setSidebarAnimating(false);
        sidebarAnimationTimerRef.current = null;
      }, 300);
    }
    if (sidebarCollapsed) {
      panel.collapse();
      return;
    }
    panel.expand();
  }, [hideSidebar, sidebarCollapsed]);

  useEffect(() => {
    return () => {
      if (sidebarAnimationTimerRef.current !== null) {
        clearTimeout(sidebarAnimationTimerRef.current);
      }
    };
  }, []);

  // Desktop keeps the floating sidebar preview open until the pointer travels 32px past its
  // bounds; mirror that instead of closing on a bare mouseleave.
  useEffect(() => {
    if (!sidebarCollapsed || !sidebarPreviewOpen || hideSidebar) {
      return;
    }

    const exitPadding = 32;
    const handlePointerMove = (event: PointerEvent) => {
      const frame = frameRef.current;
      if (!frame) return;
      const rect = frame.getBoundingClientRect();
      const previewWidth = Math.min(320, rect.width * 0.84);
      const x = event.clientX - rect.left;
      const y = event.clientY - rect.top;
      const outsideHorizontalBounds = x < -exitPadding || x > previewWidth + exitPadding;
      const outsideVerticalBounds = y < -exitPadding || y > rect.height + exitPadding;

      if (outsideHorizontalBounds || outsideVerticalBounds) {
        onCloseSidebarPreview();
      }
    };

    window.addEventListener("pointermove", handlePointerMove, { passive: true });
    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
    };
  }, [hideSidebar, onCloseSidebarPreview, sidebarCollapsed, sidebarPreviewOpen]);

  return (
    <div
      ref={frameRef}
      className="relative aspect-[16/10] w-full overflow-visible rounded-[1.35rem]"
      style={previewFrameStyle(sidebarCollapsed || hideSidebar, normalizedSidebarWidth)}
    >
      {/* Shadow deliberately has no bottom component (each layer's blur stays within its negative
          spread) so the frame doesn't cast a visible line into whatever content sits below it. */}
      <div className="absolute inset-0 overflow-hidden rounded-[1.35rem] border border-zinc-200/80 bg-white shadow-[0_-18px_32px_-16px_rgba(15,23,42,0.18),-16px_0_14px_-16px_rgba(15,23,42,0.12),16px_0_14px_-16px_rgba(15,23,42,0.12)]">
        <div className="absolute left-[18px] top-[15.5px] z-[120] flex items-center gap-2.5">
          <span className="h-[9px] w-[9px] rounded-full bg-[#ff5f57]" />
          <span className="h-[9px] w-[9px] rounded-full bg-[#ffbd2e]" />
          <span className="h-[9px] w-[9px] rounded-full bg-[#28c840]" />
        </div>

        {chromeNavVisible ? (
          <div className="pointer-events-none absolute left-0 top-0 z-[90] flex h-10 items-center pl-[100px]">
            <div className="pointer-events-auto -ml-1 inline-flex items-center gap-1">
              <button
                type="button"
                aria-label={sidebarCollapsed ? "展开左侧栏" : "收起左侧栏"}
                className="grid h-8 w-8 place-items-center rounded-lg text-zinc-500 transition-colors hover:bg-black/5"
                onClick={onToggleSidebar}
              >
                <ToggleIcon size={19} />
              </button>
              <button
                type="button"
                aria-label="后退"
                disabled={!canGoBack}
                className="grid h-8 w-8 place-items-center rounded-lg text-zinc-500 transition-colors hover:bg-black/5 disabled:opacity-35"
                onClick={onBack}
              >
                <ArrowLeft size={18} />
              </button>
              <button
                type="button"
                aria-label="前进"
                disabled={!canGoForward}
                className="grid h-8 w-8 place-items-center rounded-lg text-zinc-500 transition-colors hover:bg-black/5 disabled:opacity-35"
                onClick={onForward}
              >
                <ArrowRight size={18} />
              </button>
            </div>
          </div>
        ) : null}

        {sidebarCollapsed && !hideSidebar ? (
          <button
            type="button"
            aria-label="显示左侧栏预览"
            className="absolute inset-y-0 left-0 z-[75] w-6"
            onClick={onOpenSidebarPreview}
            onMouseEnter={onOpenSidebarPreview}
            onPointerEnter={onOpenSidebarPreview}
            onFocus={onOpenSidebarPreview}
          />
        ) : null}
        {sidebarCollapsed && !hideSidebar ? (
          <div
            className={`absolute inset-y-0 left-0 z-[85] w-[min(320px,84%)] transition-transform duration-[220ms] ease-[cubic-bezier(0.22,1,0.36,1)] ${
              sidebarPreviewOpen ? "translate-x-0" : "-translate-x-full"
            }`}
            onMouseEnter={onOpenSidebarPreview}
          >
            {previewSidebar}
          </div>
        ) : null}

        {hideSidebar ? (
          <div className="h-[calc(100%-30px)] min-h-0">{children}</div>
        ) : (
          <ResizablePanelGroup
            id="post-preview-layout"
            direction="horizontal"
            className={cn(
              "panel-layout h-[calc(100%-30px)] min-h-0 overflow-hidden bg-transparent",
              sidebarAnimating && "panel-animating",
            )}
            resizeTargetMinimumSize={{ coarse: 32, fine: 12 }}
            defaultLayout={{
              sidebar: sidebarCollapsed ? 0 : 20,
              main: sidebarCollapsed ? 100 : 80,
            }}
          >
            <ResizablePanel
              panelRef={sidebarPanelRef}
              id="sidebar"
              defaultSize={`${normalizedSidebarWidth}px`}
              minSize={`${sidebarMinWidthPx}px`}
              maxSize={`${sidebarMaxWidthPx}px`}
              groupResizeBehavior="preserve-pixel-size"
              collapsible
              collapsedSize={0}
              onResize={(size) => {
                if (size.inPixels > 0) onSidebarWidthChange?.(size.inPixels);
              }}
              className={cn(
                "overflow-hidden transition-opacity duration-150",
                sidebarCollapsed ? "pointer-events-none opacity-0" : "opacity-100",
              )}
            >
              {!sidebarCollapsed ? sidebar : null}
            </ResizablePanel>

            <ResizableHandle
              withHandle
              className={sidebarCollapsed ? "pointer-events-none opacity-0" : ""}
            />

            <ResizablePanel
              id="main"
              defaultSize={80}
              minSize={42}
              className="relative z-[60] min-w-0"
            >
              {children}
            </ResizablePanel>
          </ResizablePanelGroup>
        )}
        {statusLine}
      </div>
    </div>
  );
}

function FilterSegment<T extends string>({
  options,
  value,
  onChange,
}: {
  options: Array<{ value: T; label: string }>;
  value: T;
  onChange: (value: T) => void;
}) {
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

function FilterField({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-start gap-3">
      <span className="w-8 shrink-0 pt-1 text-[10.5px] font-semibold tracking-wide text-zinc-400">
        {label}
      </span>
      <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5">{children}</div>
    </div>
  );
}

const assetTagRowPx = 24;
const assetTagRowsStep = 2;
const assetTagsPerRowEstimate = 20;

function AssetFilterTagGroup({
  label,
  options,
  selectedValues,
  onSelectedValuesChange,
  collapsible = false,
}: {
  label: string;
  options: ReadonlyArray<{ value: string; label: string; color?: string }>;
  selectedValues: readonly string[];
  onSelectedValuesChange: (values: string[]) => void;
  collapsible?: boolean;
}) {
  const [visibleRows, setVisibleRows] = useState(assetTagRowsStep);
  const clampRef = useRef<HTMLDivElement | null>(null);
  const [overflowing, setOverflowing] = useState(false);
  const selectedSet = useMemo(() => new Set(selectedValues), [selectedValues]);

  const orderedOptions = useMemo(() => {
    if (!collapsible || selectedSet.size === 0) {
      return options;
    }
    const selected = options.filter((option) => selectedSet.has(option.value));
    const unselected = options.filter((option) => !selectedSet.has(option.value));
    return [...selected, ...unselected];
  }, [collapsible, options, selectedSet]);

  const renderLimit = selectedSet.size + (visibleRows + 1) * assetTagsPerRowEstimate;
  const renderedOptions =
    collapsible && renderLimit < orderedOptions.length
      ? orderedOptions.slice(0, renderLimit)
      : orderedOptions;
  const hasHiddenOptions = renderedOptions.length < orderedOptions.length;
  const maxHeight = assetTagRowPx * visibleRows;

  useLayoutEffect(() => {
    if (!collapsible) return;
    const el = clampRef.current;
    if (!el) return;
    const measure = () => setOverflowing(el.scrollHeight - el.clientHeight > 1);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [collapsible, maxHeight, renderedOptions.length]);

  const canExpand = collapsible && (hasHiddenOptions || overflowing);
  const canCollapse = collapsible && !canExpand && visibleRows > assetTagRowsStep;

  const tagGroup = (
    <TagGroup
      aria-label={label}
      size="sm"
      selectionMode="multiple"
      selectedKeys={selectedSet}
      onSelectionChange={(keys) => {
        const nextValues =
          keys === "all"
            ? options.map((option) => option.value)
            : Array.from(keys, (key) => String(key));
        onSelectedValuesChange(nextValues);
      }}
      className="gap-0"
    >
      <TagGroup.List className="flex flex-wrap gap-1">
        {renderedOptions.map((option) => (
          <Tag
            key={option.value}
            id={option.value}
            className="h-5 min-h-0 cursor-default gap-1 rounded-full bg-zinc-100 px-2 py-0 text-[10.5px] font-medium text-zinc-500 transition-colors hover:bg-zinc-200/70 hover:text-zinc-700 data-[selected=true]:bg-blue-50 data-[selected=true]:font-semibold data-[selected=true]:text-blue-700 data-[selected=true]:shadow-[inset_0_0_0_1px_rgba(37,99,235,0.24)]"
          >
            {option.color ? (
              <span className="h-1.5 w-1.5 rounded-full" style={{ background: option.color }} />
            ) : null}
            {option.label}
          </Tag>
        ))}
      </TagGroup.List>
    </TagGroup>
  );

  if (!collapsible) {
    return tagGroup;
  }

  return (
    <div className="flex w-full min-w-0 flex-col items-start gap-1">
      <div ref={clampRef} className="w-full" style={{ maxHeight, overflow: "hidden" }}>
        {tagGroup}
      </div>
      {canExpand || canCollapse ? (
        <button
          type="button"
          className="rounded px-1 text-[10.5px] font-medium text-zinc-400 transition-colors hover:text-zinc-600"
          onClick={() =>
            setVisibleRows((rows) => (canExpand ? rows + assetTagRowsStep : assetTagRowsStep))
          }
        >
          {canExpand ? "显示更多" : "收起"}
        </button>
      ) : null}
    </div>
  );
}

function PostPreviewFilterPanel({
  filters,
  options,
  resultCount,
  onFiltersChange,
  onClearFilters,
  onSaveView,
}: {
  filters: PostPreviewFilterState;
  options: PostPreviewFilterOptions;
  resultCount: number;
  onFiltersChange: Dispatch<SetStateAction<PostPreviewFilterState>>;
  onClearFilters: () => void;
  onSaveView?: () => void;
}) {
  return (
    // Unlike desktop, no custom id on the panel: a static id on AccordionPanel breaks Next SSR
    // hydration (react-aria generates its own id on the server).
    <AccordionPanel className="overflow-hidden border-b border-zinc-200 bg-[#fbfbfa]">
      <AccordionBody className="space-y-3 px-6 py-3">
        <div className="flex items-center gap-2.5">
          <span className="text-[10.5px] font-semibold tracking-wide text-zinc-400">符合</span>
          <FilterSegment
            options={[
              { value: "and", label: "全部条件" },
              { value: "or", label: "任意条件" },
            ]}
            value={filters.match}
            onChange={(match) => onFiltersChange((current) => ({ ...current, match }))}
          />
        </div>

        <FilterField label="类型">
          <AssetFilterTagGroup
            label="资产类型"
            options={options.types}
            selectedValues={filters.types}
            onSelectedValuesChange={(types) =>
              onFiltersChange((current) => ({ ...current, types }))
            }
          />
        </FilterField>

        <FilterField label="标签">
          <AssetFilterTagGroup
            label="资产标签"
            collapsible
            options={options.tags}
            selectedValues={filters.tags}
            onSelectedValuesChange={(tags) => onFiltersChange((current) => ({ ...current, tags }))}
          />
        </FilterField>

        <FilterField label="来源">
          <AssetFilterTagGroup
            label="资产来源"
            options={options.sources}
            selectedValues={filters.sources}
            onSelectedValuesChange={(sources) =>
              onFiltersChange((current) => ({ ...current, sources }))
            }
          />
        </FilterField>

        <FilterField label="时间">
          <FilterSegment
            options={options.times}
            value={filters.time}
            onChange={(time) =>
              onFiltersChange((current) => ({
                ...current,
                time: time as PostPreviewFilterState["time"],
              }))
            }
          />
        </FilterField>

        <FilterField label="状态">
          <FilterSegment
            options={options.statuses}
            value={filters.status}
            onChange={(status) =>
              onFiltersChange((current) => ({
                ...current,
                status: status as PostPreviewFilterState["status"],
              }))
            }
          />
        </FilterField>

        <FilterField label="排序">
          <FilterSegment
            options={options.sorts}
            value={filters.sort}
            onChange={(sort) =>
              onFiltersChange((current) => ({
                ...current,
                sort: sort as PostPreviewFilterState["sort"],
              }))
            }
          />
        </FilterField>

        <div className="flex items-center border-t border-zinc-100 pt-2.5">
          <Button
            size="sm"
            variant="ghost"
            className="h-7 min-h-0 px-1 text-[11.5px] text-zinc-500"
            onPress={onClearFilters}
          >
            重置全部
          </Button>
          <div className="ml-auto flex items-center gap-1.5">
            <Button
              size="sm"
              variant="secondary"
              className="h-7 min-h-0 rounded-lg border border-zinc-200 bg-white px-2.5 text-[11.5px] text-zinc-500"
              onPress={onSaveView}
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

function EditorSplitButton({
  openTargets,
  activeOpenTargetId,
  openerOpen,
  onToggleOpener,
  onSelectOpenTarget,
}: {
  openTargets: PostPreviewOpenTarget[];
  activeOpenTargetId: PostPreviewOpenTarget["id"];
  openerOpen: boolean;
  onToggleOpener: () => void;
  onSelectOpenTarget: (target: PostPreviewOpenTarget["id"]) => void;
}) {
  const activeTarget =
    openTargets.find((target) => target.id === activeOpenTargetId) ?? openTargets[0];

  return (
    <div className="inline-flex h-6 overflow-hidden rounded-lg border border-zinc-200 bg-white text-zinc-600 shadow-[0_1px_1px_rgba(24,24,27,0.03)]">
      <button
        type="button"
        aria-label={`用 ${activeTarget?.label ?? "编辑器"} 打开资产库`}
        className="inline-grid h-6 w-7 place-items-center border-r border-zinc-200 transition-colors hover:bg-zinc-50 disabled:pointer-events-none disabled:opacity-45"
        onClick={() => activeTarget && onSelectOpenTarget(activeTarget.id)}
      >
        {activeTarget ? (
          <OpenTargetIcon id={activeTarget.id} className={`${toolbarIconClass} text-zinc-600`} />
        ) : null}
      </button>
      <Dropdown
        isOpen={openerOpen}
        onOpenChange={(isOpen) => {
          if (isOpen !== openerOpen) onToggleOpener();
        }}
      >
        <Dropdown.Trigger
          className="inline-grid h-6 w-6 place-items-center outline-none transition-colors hover:bg-zinc-50"
          aria-label="选择打开方式"
        >
          <ChevronDown
            className={`${toolbarIconClass} transition-transform duration-200 ${
              openerOpen ? "rotate-180" : ""
            }`}
          />
        </Dropdown.Trigger>
        <Dropdown.Popover
          className="z-[120] overflow-hidden rounded-xl border border-zinc-200 bg-white p-1 shadow-[0_14px_34px_rgba(20,18,16,0.14),0_2px_7px_rgba(20,18,16,0.07)]"
          offset={6}
          placement="bottom end"
        >
          <Dropdown.Menu
            className="min-w-36 p-0 outline-none"
            aria-label="打开资产库"
            onAction={(key) => onSelectOpenTarget(key as PostPreviewOpenTarget["id"])}
          >
            {openTargets.map((target) => (
              <Dropdown.Item
                key={target.id}
                id={target.id}
                textValue={target.label}
                className="flex h-7 cursor-default items-center gap-2 rounded-lg px-2 text-[12.5px] font-medium text-zinc-700 outline-none transition-colors data-[disabled]:opacity-45 data-[focused]:bg-zinc-100 data-[hovered]:bg-zinc-100"
              >
                <OpenTargetIcon id={target.id} className={`${toolbarIconClass} text-zinc-500`} />
                <Label className="cursor-default text-[12.5px] font-medium text-inherit">
                  {target.label}
                </Label>
              </Dropdown.Item>
            ))}
          </Dropdown.Menu>
        </Dropdown.Popover>
      </Dropdown>
    </div>
  );
}

function getActiveFilterCount(filters: PostPreviewFilterState) {
  return (
    filters.types.length +
    filters.tags.length +
    filters.sources.length +
    (filters.time !== "any" ? 1 : 0) +
    (filters.status !== "any" ? 1 : 0) +
    (filters.sort !== "updated_desc" ? 1 : 0)
  );
}

type PreviewActiveFilterChip = {
  key: string;
  label: string;
  group: "type" | "tag" | "source" | "time" | "status" | "sort";
  value?: string;
  hue?: number;
};

function getPreviewOptionLabel(
  options: ReadonlyArray<{ value: string; label: string }>,
  value: string,
) {
  return options.find((option) => option.value === value)?.label ?? value;
}

function getPreviewActiveFilterChips(
  filters: PostPreviewFilterState,
  options: PostPreviewFilterOptions,
): PreviewActiveFilterChip[] {
  return [
    ...filters.types.map((type) => ({
      key: `type-${type}`,
      label: getPreviewOptionLabel(options.types, type),
      group: "type" as const,
      value: type,
    })),
    ...filters.tags.map((tag) => {
      const label = getPreviewOptionLabel(options.tags, tag);
      return {
        key: `tag-${tag}`,
        label,
        group: "tag" as const,
        value: tag,
        hue: getTagHue(label),
      };
    }),
    ...filters.sources.map((source) => ({
      key: `source-${source}`,
      label: getPreviewOptionLabel(options.sources, source),
      group: "source" as const,
      value: source,
    })),
    ...(filters.time !== "any"
      ? [
          {
            key: "time",
            label: getPreviewOptionLabel(options.times, filters.time),
            group: "time" as const,
          },
        ]
      : []),
    ...(filters.status !== "any"
      ? [
          {
            key: "status",
            label: getPreviewOptionLabel(options.statuses, filters.status),
            group: "status" as const,
          },
        ]
      : []),
    ...(filters.sort !== "updated_desc"
      ? [
          {
            key: "sort",
            label: getPreviewOptionLabel(options.sorts, filters.sort),
            group: "sort" as const,
          },
        ]
      : []),
  ];
}

const activeFilterCollapseThreshold = 5;

function PostPreviewActiveFilterSummary({
  filters,
  options,
  onFiltersChange,
  onClearFilters,
  resultCount,
  totalCount,
  activeViewName,
  activeViewIcon,
}: {
  filters: PostPreviewFilterState;
  options: PostPreviewFilterOptions;
  onFiltersChange: Dispatch<SetStateAction<PostPreviewFilterState>>;
  onClearFilters: () => void;
  resultCount: number;
  totalCount: number;
  activeViewName?: string;
  activeViewIcon?: PostPreviewView["icon"];
}) {
  const chips = getPreviewActiveFilterChips(filters, options);

  if (chips.length === 0) {
    return null;
  }

  const removeChips = (keys: Set<React.Key>) => {
    const chipsByKey = new Map(chips.map((chip) => [chip.key, chip]));

    const nextFilters = Array.from(keys).reduce<PostPreviewFilterState>((accFilters, key) => {
      const chip = chipsByKey.get(String(key));

      if (!chip) {
        return accFilters;
      }

      if (chip.group === "type") {
        return { ...accFilters, types: accFilters.types.filter((type) => type !== chip.value) };
      }

      if (chip.group === "tag") {
        return { ...accFilters, tags: accFilters.tags.filter((tag) => tag !== chip.value) };
      }

      if (chip.group === "source") {
        return {
          ...accFilters,
          sources: accFilters.sources.filter((source) => source !== chip.value),
        };
      }

      if (chip.group === "time") {
        return { ...accFilters, time: "any" };
      }

      if (chip.group === "sort") {
        return { ...accFilters, sort: "updated_desc" };
      }

      return { ...accFilters, status: "any" };
    }, filters);

    // Removing the last chip is the same as "clear" — keep parity with the desktop behavior.
    if (getActiveFilterCount(nextFilters) === 0) {
      onClearFilters();
      return;
    }

    onFiltersChange(nextFilters);
  };

  return (
    <div className="flex shrink-0 flex-wrap items-center gap-1.5 border-b border-zinc-100 px-6 py-2">
      <span className="mr-1 text-[11.5px] font-semibold text-zinc-500">
        已筛选 · {resultCount} / {totalCount} 项
      </span>
      {chips.length > activeFilterCollapseThreshold ? (
        <span className="inline-flex h-5 items-center gap-1.5 rounded-full bg-[#f3f2ef] px-2.5 text-[11px] font-medium text-zinc-700">
          {activeViewName ? (
            <>
              {viewIcon(activeViewIcon, "h-3 w-3 shrink-0 text-zinc-500")}
              {activeViewName}
            </>
          ) : (
            `${chips.length} 个条件`
          )}
        </span>
      ) : (
        <TagGroup aria-label="已筛选条件" size="sm" onRemove={removeChips} className="gap-0">
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
      )}
      <Button
        size="sm"
        variant="ghost"
        className="h-5 min-h-0 px-1 text-[11px] text-zinc-400 hover:text-zinc-700"
        onPress={onClearFilters}
      >
        清除
      </Button>
    </div>
  );
}

function getPreviewAssetMediaHeight(asset: PostPreviewAsset | undefined) {
  if (!asset) return 0;
  if (
    asset.kind !== "image" &&
    asset.kind !== "video" &&
    !(asset.kind === "web" && asset.thumbnailUrl)
  ) {
    return 0;
  }

  if (asset.aspect) {
    const [rawWidth, rawHeight] = asset.aspect
      .split("/")
      .map((part) => Number.parseFloat(part.trim()));
    if (rawWidth && rawHeight) {
      return Math.max(128, Math.round((rawHeight / rawWidth) * assetColumnWidth));
    }
  }

  // Match the card media classes: h-32 / h-44 / h-72.
  return { short: 128, medium: 176, tall: 288 }[asset.height ?? "medium"];
}

function getPreviewAssetCardHeightEstimate(asset: PostPreviewAsset | undefined) {
  const mediaHeight = getPreviewAssetMediaHeight(asset);
  return (mediaHeight > 0 ? mediaHeight : 170) + assetColumnGutter;
}

type PreviewMasonryVirtualizerHandle = {
  getVirtualItems: () => Array<{ index: number; start: number; end: number }>;
};

function PostPreviewMasonryColumns({
  scrollViewportRef,
  columnCount,
  assets,
  onOpenAsset,
  virtualizerRef,
}: {
  scrollViewportRef: React.RefObject<HTMLDivElement | null>;
  columnCount: number;
  assets: PostPreviewAsset[];
  onOpenAsset: (assetId: string) => void;
  virtualizerRef: React.RefObject<PreviewMasonryVirtualizerHandle | null>;
}) {
  const virtualizer = useVirtualizer({
    count: assets.length,
    getScrollElement: () => scrollViewportRef.current,
    estimateSize: (index) => getPreviewAssetCardHeightEstimate(assets[index]),
    getItemKey: (index) => assets[index]?.id ?? index,
    lanes: columnCount,
    overscan: assetCardOverscan,
    paddingStart: assetGridPaddingY,
    paddingEnd: assetGridPaddingY,
  });
  virtualizerRef.current = virtualizer;

  return (
    <div style={{ position: "relative", width: "100%", height: virtualizer.getTotalSize() }}>
      {virtualizer.getVirtualItems().map((virtualItem) => {
        const asset = assets[virtualItem.index];
        if (!asset) return null;
        const lane = virtualItem.lane < columnCount ? virtualItem.lane : 0;

        return (
          <div
            key={virtualItem.key}
            data-index={virtualItem.index}
            ref={virtualizer.measureElement}
            style={{
              position: "absolute",
              top: 0,
              left: `${(lane / columnCount) * 100}%`,
              width: `${100 / columnCount}%`,
              transform: `translateY(${virtualItem.start}px)`,
              padding: assetColumnGutter / 2,
              boxSizing: "border-box",
            }}
          >
            <div data-flip-id={asset.id}>
              <PostPreviewAssetCard asset={asset} onOpen={onOpenAsset} />
            </div>
          </div>
        );
      })}
    </div>
  );
}

function PostPreviewMasonryGrid({
  assets,
  boardState,
  errorMessage,
  onOpenAsset,
}: {
  assets: PostPreviewAsset[];
  boardState: "ready" | "loading" | "empty" | "error";
  errorMessage: string;
  onOpenAsset: (assetId: string) => void;
}) {
  const scrollViewportRef = useRef<HTMLDivElement>(null);
  const [columnCount, setColumnCount] = useState(1);
  const virtualizerRef = useRef<PreviewMasonryVirtualizerHandle | null>(null);

  useLayoutEffect(() => {
    const el = scrollViewportRef.current;
    if (!el) return;

    const recompute = () => {
      const innerWidth = el.clientWidth - assetGridPaddingX * 2;
      setColumnCount(
        Math.max(
          1,
          Math.floor((innerWidth + assetColumnGutter) / (assetColumnWidth + assetColumnGutter)),
        ),
      );
    };

    const observer = new ResizeObserver(recompute);
    observer.observe(el);
    recompute();
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const first = virtualizerRef.current?.getVirtualItems()[0];
    if (first && scrollViewportRef.current) {
      scrollViewportRef.current.scrollTop = 0;
    }
  }, [assets]);

  return (
    <ScrollArea
      type="hover"
      scrollHideDelay={260}
      className="min-h-0 flex-1"
      viewportRef={scrollViewportRef}
      viewportClassName="px-6"
      scrollbarClassName="w-2 border-l-0 bg-transparent p-[2px] opacity-0 transition-opacity duration-150 data-[state=visible]:opacity-100 hover:opacity-100"
      thumbClassName="bg-zinc-400/35 hover:bg-zinc-500/45"
    >
      {boardState === "loading" ? (
        <div className="grid h-56 place-items-center text-sm text-zinc-400">正在读取资产库</div>
      ) : boardState === "error" ? (
        <div className="grid h-72 place-items-center">
          <div className="text-center">
            <X className="mx-auto text-red-300" size={36} />
            <h2 className="mt-3 text-sm font-semibold text-zinc-800">没有读到资产</h2>
            <p className="mt-1 text-xs text-zinc-500">{errorMessage}</p>
          </div>
        </div>
      ) : boardState === "empty" || assets.length === 0 ? (
        <div className="grid h-72 place-items-center">
          <div className="text-center">
            <FolderKanban className="mx-auto text-zinc-300" size={36} />
            <h2 className="mt-3 text-sm font-semibold text-zinc-800">没有匹配的资产</h2>
            <p className="mt-1 text-xs text-zinc-500">调整筛选条件后再试一次。</p>
          </div>
        </div>
      ) : (
        <PostPreviewMasonryColumns
          scrollViewportRef={scrollViewportRef}
          columnCount={columnCount}
          assets={assets}
          onOpenAsset={onOpenAsset}
          virtualizerRef={virtualizerRef}
        />
      )}
    </ScrollArea>
  );
}

export function PostPreviewAssetBoard({
  title,
  assets,
  resultCount = assets.length,
  totalCount = assets.length,
  activeViewName,
  activeViewIcon,
  filterOpen,
  openerOpen,
  filters,
  filterOptions,
  openTargets,
  activeOpenTargetId,
  boardState = "ready",
  errorMessage = "资产读取失败，请稍后再试。",
  onFiltersChange,
  onClearFilters,
  onToggleFilter,
  onToggleOpener,
  onSelectOpenTarget,
  onSaveView,
  onOpenAsset,
}: {
  title: string;
  assets: PostPreviewAsset[];
  resultCount?: number;
  totalCount?: number;
  activeViewName?: string;
  activeViewIcon?: PostPreviewView["icon"];
  filterOpen: boolean;
  openerOpen: boolean;
  filters: PostPreviewFilterState;
  filterOptions: PostPreviewFilterOptions;
  openTargets: PostPreviewOpenTarget[];
  activeOpenTargetId: PostPreviewOpenTarget["id"];
  boardState?: "ready" | "loading" | "empty" | "error";
  errorMessage?: string;
  onFiltersChange: Dispatch<SetStateAction<PostPreviewFilterState>>;
  onClearFilters: () => void;
  onToggleFilter: () => void;
  onToggleOpener: () => void;
  onSelectOpenTarget: (target: PostPreviewOpenTarget["id"]) => void;
  onSaveView?: () => void;
  onOpenAsset: (assetId: string) => void;
}) {
  const activeFilterCount = getActiveFilterCount(filters);

  return (
    <main className="flex h-full min-w-0 flex-col bg-white">
      <AccordionRoot
        hideSeparator
        expandedKeys={filterOpen ? ["asset-filters"] : []}
        onExpandedChange={(keys) => {
          if (keys.has("asset-filters") !== filterOpen) onToggleFilter();
        }}
        className="shrink-0"
      >
        <AccordionItem id="asset-filters" className="border-none">
          <PreviewPageChrome>
            <h1 className="mr-auto text-[13.5px] font-semibold tracking-normal text-zinc-950">
              {title}
            </h1>
            <div className="relative z-[80] flex items-center gap-2.5">
              <Button
                size="sm"
                variant={filterOpen || activeFilterCount > 0 ? "secondary" : "ghost"}
                aria-expanded={filterOpen}
                className={cn(
                  "h-6 min-h-0 gap-1.5 rounded-lg px-2 text-[11px]",
                  filterOpen || activeFilterCount > 0
                    ? "border border-blue-200 bg-blue-50 text-blue-700"
                    : "border border-zinc-200 bg-white text-zinc-600",
                )}
                onPress={onToggleFilter}
              >
                <Filter className={toolbarIconClass} />
                筛选
                {activeFilterCount > 0 ? (
                  <span className="ml-0.5 grid h-3.5 min-w-3.5 place-items-center rounded-full bg-blue-600 px-1 text-[9px] font-bold leading-none text-white">
                    {activeFilterCount}
                  </span>
                ) : null}
                <ChevronDown
                  className={`${toolbarIconClass} transition-transform duration-200 ${
                    filterOpen ? "rotate-180" : ""
                  }`}
                />
              </Button>
              <EditorSplitButton
                openTargets={openTargets}
                activeOpenTargetId={activeOpenTargetId}
                openerOpen={openerOpen}
                onToggleOpener={onToggleOpener}
                onSelectOpenTarget={onSelectOpenTarget}
              />
            </div>
          </PreviewPageChrome>
          <PostPreviewFilterPanel
            filters={filters}
            options={filterOptions}
            resultCount={resultCount}
            onFiltersChange={onFiltersChange}
            onClearFilters={onClearFilters}
            onSaveView={onSaveView}
          />
        </AccordionItem>
      </AccordionRoot>

      <PostPreviewActiveFilterSummary
        filters={filters}
        options={filterOptions}
        onFiltersChange={onFiltersChange}
        onClearFilters={onClearFilters}
        resultCount={resultCount}
        totalCount={totalCount}
        activeViewName={activeViewName}
        activeViewIcon={activeViewIcon}
      />

      <PostPreviewMasonryGrid
        assets={assets}
        boardState={boardState}
        errorMessage={errorMessage}
        onOpenAsset={onOpenAsset}
      />
    </main>
  );
}

const previewGraphNodeColors: Record<string, string> = {
  markdown: "#6366f1",
  image: "#10b981",
  video: "#f59e0b",
  link: "#3b82f6",
  web: "#06b6d4",
  file: "#94a3b8",
};

const previewGraphLinkColors: Record<string, string> = {
  wiki_link: "rgba(99,102,241,0.55)",
  embed: "rgba(16,185,129,0.45)",
  markdown_link: "rgba(59,130,246,0.45)",
  markdown_image: "rgba(245,158,11,0.4)",
  external_url: "rgba(148,163,184,0.3)",
};

type ForceGraph2DComponent = (typeof import("react-force-graph-2d"))["default"];

export function PostPreviewKnowledgeGraph({
  data,
  onSelectNode,
}: {
  data: PostPreviewGraphData;
  onSelectNode?: (nodeId: string) => void;
}) {
  const canvasRef = useRef<HTMLDivElement>(null);
  const graphRef = useRef<ForceGraphMethods | undefined>(undefined);
  const hasFitRef = useRef(false);
  const [canvasSize, setCanvasSize] = useState({ width: 800, height: 600 });
  const [ForceGraph, setForceGraph] = useState<ForceGraph2DComponent | null>(null);

  useEffect(() => {
    const node = canvasRef.current;
    if (!node) return;
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;
      setCanvasSize({ width: entry.contentRect.width, height: entry.contentRect.height });
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    let active = true;
    void import("react-force-graph-2d").then((module) => {
      if (active) setForceGraph(() => module.default);
    });
    return () => {
      active = false;
    };
  }, []);

  const graphData = useMemo(
    () => ({
      nodes: data.nodes.map((node) => ({
        ...node,
        title: node.label,
        status: "ready",
      })) as NodeObject[],
      links: data.edges.map((edge) => ({ ...edge })) as LinkObject[],
    }),
    [data.edges, data.nodes],
  );

  return (
    <main className="flex h-full min-h-0 flex-col bg-zinc-50">
      <PreviewPageChrome>
        <h1 className="text-[13.5px] font-semibold tracking-normal text-zinc-950">{data.title}</h1>
        {data.nodes.length > 0 ? (
          <span className="text-xs text-zinc-400">
            {data.nodes.length} 个节点 · {data.edges.length} 条链接
          </span>
        ) : null}
      </PreviewPageChrome>
      <div ref={canvasRef} className="relative min-h-0 flex-1 w-full bg-zinc-50">
        {data.nodes.length === 0 ? (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-sm text-zinc-400">
            <Network size={32} className="text-zinc-300" />
            <span>当前资产库暂无链接数据</span>
          </div>
        ) : !ForceGraph ? (
          <div className="absolute inset-0 flex items-center justify-center text-sm text-zinc-400">
            加载中…
          </div>
        ) : (
          <ForceGraph
            ref={graphRef}
            graphData={graphData}
            width={canvasSize.width}
            height={canvasSize.height}
            nodeColor={(node) => {
              const graphNode = node as unknown as PostPreviewGraphNode;
              return previewGraphNodeColors[graphNode.kind] ?? "#94a3b8";
            }}
            nodeLabel={(node) => {
              const graphNode = node as unknown as PostPreviewGraphNode;
              return graphNode.label ?? graphNode.id;
            }}
            nodeRelSize={5}
            warmupTicks={200}
            cooldownTicks={0}
            linkColor={(link) => {
              const relationType = (link as unknown as PostPreviewGraphEdge).relationType;
              return previewGraphLinkColors[relationType] ?? "rgba(148,163,184,0.3)";
            }}
            linkWidth={1.2}
            linkDirectionalArrowLength={4}
            linkDirectionalArrowRelPos={1}
            backgroundColor="#f9fafb"
            onNodeClick={(node) => {
              const id = (node as unknown as PostPreviewGraphNode).id;
              if (id) onSelectNode?.(id);
            }}
            onEngineStop={() => {
              if (hasFitRef.current) return;
              hasFitRef.current = true;
              const graph = graphRef.current;
              if (!graph) return;
              const bbox = graph.getGraphBbox();
              if (!bbox) return;
              const cx = (bbox.x[0] + bbox.x[1]) / 2;
              const cy = (bbox.y[0] + bbox.y[1]) / 2;
              const graphW = bbox.x[1] - bbox.x[0];
              const graphH = bbox.y[1] - bbox.y[0];
              const padding = 80;
              const zoom = Math.min(
                (canvasSize.width - padding * 2) / Math.max(graphW, 1),
                (canvasSize.height - padding * 2) / Math.max(graphH, 1),
                1.2,
              );
              graph.centerAt(cx, cy, 400);
              graph.zoom(zoom, 400);
            }}
            nodeCanvasObjectMode={() => "after"}
            nodeCanvasObject={(node, ctx, globalScale) => {
              const label = (node as unknown as PostPreviewGraphNode).label ?? "";
              if (globalScale < 1.4) return;
              const fontSize = 10 / globalScale;
              ctx.font = `${fontSize}px Inter, sans-serif`;
              ctx.fillStyle = "rgba(63,63,70,0.85)";
              ctx.textAlign = "center";
              ctx.textBaseline = "top";
              ctx.fillText(label.slice(0, 24), node.x ?? 0, (node.y ?? 0) + 7);
            }}
          />
        )}
      </div>
    </main>
  );
}

function PostPreviewAssetFilePreview({ asset }: { asset: PostPreviewAsset }) {
  const FileIcon =
    asset.fileExt === "csv" || asset.fileExt === "xls" || asset.fileExt === "xlsx"
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

function PostPreviewAssetCardTagRow({ asset }: { asset: PostPreviewAsset }) {
  const hasTag = asset.tag.length > 0;
  const isPrivate = asset.isPrivate === true;

  // Untagged assets only carry the "待整理" placeholder (no real tag), so show nothing.
  if (!hasTag && !isPrivate) {
    return null;
  }

  return (
    <div className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-1.5">
      {hasTag ? (
        <Chip
          size="sm"
          className="h-auto min-h-0 gap-1.5 bg-transparent px-0 py-0 text-[11.5px] font-medium text-[#1c1b19]"
        >
          <span
            className="h-[7px] w-[7px] rounded-full"
            style={{ background: `oklch(0.6 0.14 ${getTagHue(asset.tag)})` }}
          />
          {asset.tag}
        </Chip>
      ) : null}
      {isPrivate ? (
        <Chip
          size="sm"
          className="h-auto min-h-0 gap-1 bg-transparent px-0 py-0 text-[10.5px] font-semibold text-amber-700"
        >
          <ShieldCheck size={11} />
          私密
        </Chip>
      ) : null}
    </div>
  );
}

export function PostPreviewAssetCard({
  asset,
  onOpen,
}: {
  asset: PostPreviewAsset;
  onOpen: (assetId: string) => void;
}) {
  const hasCover =
    asset.kind === "image" ||
    asset.kind === "video" ||
    (asset.kind === "web" && asset.thumbnailUrl);
  const showUrlRow = asset.kind === "link" || (asset.kind === "web" && !asset.thumbnailUrl);
  const mediaHeight = asset.height === "tall" ? "h-72" : asset.height === "short" ? "h-32" : "h-44";
  const domain =
    asset.domain ?? asset.url?.replace(/^https?:\/\//, "").split("/")[0] ?? asset.source;

  return (
    <article className="relative overflow-hidden rounded-xl bg-[#f6f5f2] transition-colors duration-150 hover:bg-[#f2f1ed]">
      <button
        type="button"
        className="block w-full text-left outline-none focus-visible:ring-2 focus-visible:ring-zinc-500/20"
        onClick={() => onOpen(asset.id)}
      >
        {hasCover && asset.thumbnailUrl ? (
          <div
            className={`relative ${asset.aspect ? "" : mediaHeight} overflow-hidden bg-zinc-200`}
            style={{
              ...(asset.aspect ? { aspectRatio: asset.aspect } : {}),
              background:
                "radial-gradient(120% 90% at 18% 12%, oklch(0.93 0 0) 0%, transparent 62%), linear-gradient(150deg, oklch(0.87 0 0) 0%, oklch(0.92 0 0) 100%)",
            }}
          >
            <img
              src={asset.thumbnailUrl}
              alt=""
              className="absolute inset-0 h-full w-full object-cover"
              draggable={false}
            />
            {asset.kind === "video" ? (
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
        ) : (
          <div className="px-4 py-3.5">
            <h2 className="line-clamp-2 text-[14px] font-semibold leading-[1.4] text-[#1c1b19]">
              {asset.title}
            </h2>
            {asset.kind === "file" ? <PostPreviewAssetFilePreview asset={asset} /> : null}
            {showUrlRow ? (
              <div className="mt-3 flex items-center gap-2.5 rounded-[10px] bg-white px-3 py-2.5">
                <span
                  className="h-3.5 w-3.5 shrink-0 rounded"
                  style={{
                    background: `linear-gradient(135deg, oklch(0.56 0.14 ${getTagHue(asset.tag)}), oklch(0.42 0.12 ${getTagHue(asset.tag)}))`,
                  }}
                />
                <span className="min-w-0 flex-1 truncate text-[12.5px] font-medium text-[#1c1b19]">
                  {domain}
                </span>
                <ExternalLink size={12} className="shrink-0 text-zinc-400" />
              </div>
            ) : null}
            {asset.body ? (
              <p className="mt-2 line-clamp-4 whitespace-pre-line text-[13px] leading-[1.6] text-[#6c6a64]">
                {asset.body}
              </p>
            ) : null}
            <PostPreviewAssetCardTagRow asset={asset} />
          </div>
        )}
      </button>
    </article>
  );
}

function getPostPreviewKindLabel(kind: PostPreviewAssetKind) {
  if (kind === "markdown") return "MD";
  if (kind === "image") return "IMG";
  if (kind === "video") return "VIDEO";
  if (kind === "link") return "LINK";
  if (kind === "web") return "WEB";
  return "FILE";
}

function DetailSideMetaList({ list }: { list: Array<[string, string]> }) {
  return (
    <div className="flex flex-col">
      {list.map(([label, value], index) => (
        <div
          key={`${label}-${index}`}
          className="flex justify-between border-t border-zinc-100 py-2 text-[12.5px]"
        >
          <span className="text-zinc-500">{label}</span>
          <span className="font-medium text-zinc-800">{value}</span>
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
    DOC: "oklch(0.48 0.16 230)",
    DOCX: "oklch(0.48 0.16 230)",
  };
  const extColor = extColorMap[ext] ?? "oklch(0.50 0.08 250)";

  return (
    <div className="overflow-hidden rounded-[13px] border border-zinc-200 shadow-sm">
      <div className="bg-zinc-100 px-[30px] pb-0 pt-[30px]">
        <div
          className="rounded-t-md border border-zinc-200/60 bg-white px-10 pb-10 pt-8"
          style={{ boxShadow: "0 -8px 24px rgba(20,18,16,.06)" }}
        >
          <div className="mb-5 flex items-center gap-2.5">
            <span
              className="rounded-[5px] px-[7px] py-[3px] font-mono text-[10.5px] font-semibold tracking-wider text-white"
              style={{ background: extColor }}
            >
              {ext}
            </span>
            <div className="h-3 w-3/5 rounded-sm bg-gradient-to-r from-zinc-200 to-transparent" />
          </div>
          <div className="flex flex-col gap-2.5">
            {[96, 90, 99, 72].map((width, index) => (
              <div
                key={`top-${index}`}
                className="h-2 rounded-sm bg-zinc-100"
                style={{ width: `${width}%` }}
              />
            ))}
          </div>
          <div className="my-5 flex h-28 items-end gap-2.5 rounded-lg border border-zinc-100 bg-zinc-50 p-3.5">
            {[42, 58, 50, 71, 64, 88, 80].map((height, index) => (
              <div
                key={`bar-${index}`}
                className="flex-1 rounded-t-sm"
                style={{
                  height: `${height}%`,
                  background:
                    index === 6
                      ? "oklch(0.55 0.13 256)"
                      : "color-mix(in oklch, oklch(0.55 0.13 256), transparent 55%)",
                }}
              />
            ))}
          </div>
          <div className="flex flex-col gap-2.5">
            {[99, 94, 86, 97, 60].map((width, index) => (
              <div
                key={`bottom-${index}`}
                className="h-2 rounded-sm bg-zinc-100"
                style={{ width: `${width}%` }}
              />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function DetailVisualBlock({ asset }: { asset: PostPreviewAsset }) {
  const aspect = asset.aspect ? { aspectRatio: asset.aspect.replace("/", " / ") } : undefined;

  if (asset.kind === "image" && asset.thumbnailUrl) {
    return (
      <div className="relative overflow-hidden border-b border-zinc-100 bg-zinc-100">
        <img
          src={asset.thumbnailUrl}
          alt={asset.title}
          className="block h-auto w-full"
          draggable={false}
        />
      </div>
    );
  }

  if (asset.thumbnailUrl) {
    return (
      <div className="relative overflow-hidden bg-zinc-100" style={aspect}>
        <img
          src={asset.thumbnailUrl}
          alt=""
          className="h-full max-h-[520px] w-full object-cover"
          draggable={false}
        />
        {asset.kind === "video" ? (
          <>
            <span className="absolute left-1/2 top-1/2 grid h-14 w-14 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full bg-[#1c1916]/50 text-white shadow-sm backdrop-blur-sm">
              <Play size={20} fill="currentColor" />
            </span>
            {asset.duration ? (
              <span className="absolute right-3 top-3 rounded-md bg-[#1c1916]/55 px-2 py-1 font-mono text-[10.5px] text-white">
                {asset.duration}
              </span>
            ) : null}
          </>
        ) : null}
      </div>
    );
  }

  if (asset.kind === "file") {
    return <DocPreviewSkeleton fileExt={asset.fileExt} />;
  }

  return (
    <div className="rounded-[13px] border border-zinc-100 bg-zinc-50 px-4 py-3 text-[13.5px] leading-[1.7] text-zinc-700">
      {asset.body ?? "这是一个本地资产的预览摘要。Post 会保留文件上下文、标签和关联视图。"}
    </div>
  );
}

function MarkdownDetailBody({ asset }: { asset: PostPreviewAsset }) {
  const paragraphs = (
    asset.body ?? "这个 Markdown 文件用于记录项目上下文、素材来源和后续整理动作。"
  )
    .split("\n")
    .filter(Boolean);

  return (
    <div className="max-w-[760px]">
      <article className="text-[15px] leading-[1.78] text-zinc-800 [&_a]:font-medium [&_a]:text-blue-600 [&_a:hover]:text-blue-700 [&_blockquote]:my-5 [&_blockquote]:border-l-2 [&_blockquote]:border-zinc-200 [&_blockquote]:pl-4 [&_blockquote]:text-zinc-600 [&_code]:rounded [&_code]:bg-zinc-100 [&_code]:px-1 [&_code]:py-0.5 [&_code]:font-mono [&_code]:text-[0.88em] [&_h1]:mb-5 [&_h1]:mt-0 [&_h1]:text-[28px] [&_h1]:font-bold [&_h1]:leading-tight [&_h1]:text-zinc-950 [&_h2]:mb-3 [&_h2]:mt-8 [&_h2]:text-[22px] [&_h2]:font-bold [&_h2]:leading-tight [&_h2]:text-zinc-950 [&_h3]:mb-2.5 [&_h3]:mt-6 [&_h3]:text-[18px] [&_h3]:font-semibold [&_h3]:text-zinc-950 [&_hr]:my-8 [&_hr]:border-zinc-200 [&_li]:my-1 [&_ol]:my-4 [&_ol]:list-decimal [&_ol]:pl-6 [&_p]:my-4 [&_pre]:my-5 [&_pre]:overflow-x-auto [&_pre]:rounded-[10px] [&_pre]:bg-zinc-950 [&_pre]:p-4 [&_pre_code]:bg-transparent [&_pre_code]:p-0 [&_pre_code]:text-[13px] [&_pre_code]:text-zinc-100 [&_strong]:font-semibold [&_strong]:text-zinc-950 [&_ul]:my-4 [&_ul]:list-disc [&_ul]:pl-6">
        <h2 className="!mt-0">{asset.title}</h2>
        {paragraphs.map((paragraph, index) => (
          <p key={`${asset.id}-paragraph-${index}`}>{paragraph}</p>
        ))}
      </article>
    </div>
  );
}

function ImageDetailBody({ asset }: { asset: PostPreviewAsset }) {
  const dims =
    asset.imageWidth && asset.imageHeight
      ? `${asset.imageWidth} × ${asset.imageHeight}`
      : undefined;
  const ext = (asset.fileExt ?? "").toUpperCase() || "IMG";
  const metaList: Array<[string, string]> = [
    ["来源", asset.source.split(" / ")[0] ?? "—"],
    ...(dims ? ([["尺寸", dims]] as Array<[string, string]>) : []),
    ["格式", ext],
    ["采集", asset.time],
  ];

  return (
    <div className="flex gap-6">
      <div className="min-w-0 flex-1">
        <div className="overflow-hidden rounded-[13px] border border-zinc-200 shadow-sm">
          <DetailVisualBlock asset={asset} />
        </div>
      </div>
      <div className="w-[248px] shrink-0">
        <DetailSideMetaList list={metaList} />
      </div>
    </div>
  );
}

function VideoDetailBody({ asset }: { asset: PostPreviewAsset }) {
  return (
    <div className="max-w-[780px]">
      <div
        className="overflow-hidden rounded-[13px] border border-zinc-200 bg-black shadow-sm"
        style={asset.aspect ? { aspectRatio: asset.aspect.replace("/", " / ") } : undefined}
      >
        <DetailVisualBlock asset={asset} />
      </div>
    </div>
  );
}

function LinkDetailBody({ asset, onOpen }: { asset: PostPreviewAsset; onOpen: () => void }) {
  const domain =
    asset.domain ?? asset.url?.replace(/^https?:\/\//, "").split("/")[0] ?? "post.local";
  const url = asset.url ?? `https://${domain}/`;
  const metaList: Array<[string, string]> = [
    ...(asset.domain ? ([["域名", asset.domain]] as Array<[string, string]>) : []),
    ["快照", "整页已缓存"],
    ["采集", asset.time],
  ];

  return (
    <div className="flex gap-6">
      <div className="min-w-0 flex-1">
        <div className="max-w-[660px] overflow-hidden rounded-[13px] border border-zinc-200 bg-white shadow-sm">
          <DetailVisualBlock asset={asset} />
          <div className="flex items-center gap-2.5 border-t border-zinc-100 px-3.5 py-3">
            <Globe size={14} className="shrink-0 text-zinc-500" />
            <span className="min-w-0 flex-1 overflow-hidden text-ellipsis whitespace-nowrap font-mono text-xs text-zinc-500">
              <b className="font-semibold text-zinc-900">{domain}</b>
              {url.replace(`https://${domain}`, "").replace(`http://${domain}`, "")}
            </span>
            <button
              type="button"
              className="shrink-0 text-[11.5px] font-semibold text-blue-600"
              onClick={onOpen}
            >
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
  asset: PostPreviewAsset;
  onOpen: () => void;
  onShowInFinder: () => void;
}) {
  const [format, ...rest] = asset.meta.split(" · ");
  const metaList: Array<[string, string]> = [
    ["格式", format ?? "—"],
    ["大小", rest.join(" · ") || "—"],
    ["位置", "Vault 内"],
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

function DetailTagPill({ name }: { name: string }) {
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

export function PostPreviewAssetDetail({
  asset,
  openTargets,
  activeOpenTargetId,
  openerOpen,
  onToggleOpener,
  onSelectOpenTarget,
  onCopyPath,
}: {
  asset: PostPreviewAsset;
  openTargets: PostPreviewOpenTarget[];
  activeOpenTargetId: PostPreviewOpenTarget["id"];
  openerOpen: boolean;
  onToggleOpener: () => void;
  onSelectOpenTarget: (target: PostPreviewOpenTarget["id"]) => void;
  onCopyPath?: () => void;
}) {
  const canOpenInDefaultMediaApp = asset.kind === "image" || asset.kind === "video";
  const DefaultMediaOpenIcon = asset.kind === "image" ? ImageIcon : Play;
  const [pathCopied, setPathCopied] = useState(false);

  const handleCopyPath = () => {
    onCopyPath?.();
    setPathCopied(true);
    window.setTimeout(() => setPathCopied(false), 2000);
  };

  return (
    <main className="flex h-full min-w-0 flex-col bg-white">
      <PreviewPageChrome>
        <span className="text-xs text-zinc-400">全部资产 / {asset.tag}</span>
        <div className="flex-1" />
        <div className="flex items-center gap-2">
          {canOpenInDefaultMediaApp ? (
            <Button
              size="sm"
              isIconOnly
              aria-label={asset.kind === "image" ? "用系统图片预览打开" : "用系统视频播放器打开"}
              className="h-6 min-h-0 rounded-lg border border-zinc-200 bg-white px-2 text-[11px] text-zinc-600 hover:bg-zinc-50"
              onPress={() => onCopyPath?.()}
            >
              <DefaultMediaOpenIcon className={toolbarIconClass} />
            </Button>
          ) : null}
          <EditorSplitButton
            openTargets={openTargets}
            activeOpenTargetId={activeOpenTargetId}
            openerOpen={openerOpen}
            onToggleOpener={onToggleOpener}
            onSelectOpenTarget={onSelectOpenTarget}
          />
          <Button
            size="sm"
            isIconOnly
            aria-label="复制文件路径"
            className="h-6 min-h-0 rounded-lg border border-zinc-200 bg-white px-2 text-[11px] text-zinc-600 hover:bg-zinc-50"
            onPress={handleCopyPath}
          >
            {pathCopied ? (
              <Check className={toolbarIconClass} />
            ) : (
              <Copy className={toolbarIconClass} />
            )}
          </Button>
        </div>
      </PreviewPageChrome>
      <div className="shrink-0 border-b border-zinc-100 px-10 pb-5 pt-6">
        <div className="flex items-start gap-2.5">
          <span className="mt-[7px] shrink-0 rounded border border-zinc-200 px-1 py-px font-mono text-[8.5px] font-semibold uppercase tracking-wider text-zinc-400">
            {getPostPreviewKindLabel(asset.kind)}
          </span>
          <h1 className="max-w-[760px] text-[25px] font-bold leading-[1.28] tracking-[0.005em] text-zinc-950">
            {asset.title}
          </h1>
        </div>
        <div className="mt-3.5 flex flex-wrap items-center gap-[9px] text-xs text-zinc-500">
          <span>{asset.source.split(" / ")[0]}</span>
          <span className="opacity-60">·</span>
          <span>{asset.time}</span>
          <span className="opacity-60">·</span>
          <span>{asset.meta}</span>
          <span className="opacity-60">·</span>
          <span className="text-zinc-400">只读预览</span>
        </div>
        <div className="mt-3.5 flex flex-wrap items-center gap-2">
          <DetailTagPill name={asset.tag} />
          <button
            type="button"
            className="flex h-6 w-6 items-center justify-center rounded-[7px] border border-dashed border-zinc-200 text-zinc-400 hover:border-blue-200 hover:text-blue-500"
          >
            <Plus size={13} />
          </button>
        </div>
      </div>
      <ScrollArea
        type="hover"
        scrollHideDelay={260}
        className="min-h-0 flex-1"
        viewportClassName="px-10 py-7"
        scrollbarClassName="w-2 border-l-0 bg-transparent p-[2px] opacity-0 transition-opacity duration-150 data-[state=visible]:opacity-100 hover:opacity-100"
        thumbClassName="bg-zinc-400/35 hover:bg-zinc-500/45"
      >
        {asset.kind === "markdown" ? <MarkdownDetailBody asset={asset} /> : null}
        {asset.kind === "image" ? <ImageDetailBody asset={asset} /> : null}
        {asset.kind === "video" ? <VideoDetailBody asset={asset} /> : null}
        {asset.kind === "web" || asset.kind === "link" ? (
          <LinkDetailBody asset={asset} onOpen={() => onCopyPath?.()} />
        ) : null}
        {asset.kind === "file" ? (
          <FileDetailBody
            asset={asset}
            onOpen={() => onCopyPath?.()}
            onShowInFinder={() => onCopyPath?.()}
          />
        ) : null}
      </ScrollArea>
    </main>
  );
}

function SettingsSectionTitle({ children }: { children: string }) {
  return <h1 className="mb-7 text-[22px] font-bold tracking-tight text-zinc-900">{children}</h1>;
}

function SettingGroup({ children }: { children: ReactNode }) {
  return (
    <div className="mb-5 overflow-hidden rounded-xl border border-zinc-200 bg-white">
      {children}
    </div>
  );
}

function SettingRow({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: ReactNode;
}) {
  return (
    <div className="flex items-center gap-4 border-t border-zinc-100 px-4 py-3.5 first:border-t-0">
      <div className="min-w-0 flex-1">
        <div className="text-[13.5px] font-medium text-zinc-800">{title}</div>
        {description ? (
          <div className="mt-0.5 text-[12px] leading-relaxed text-zinc-500">{description}</div>
        ) : null}
      </div>
      <div className="flex shrink-0 items-center">{children}</div>
    </div>
  );
}

function SettingSelect({
  value,
  options,
  className = "w-36",
}: {
  value: string;
  options: string[];
  className?: string;
}) {
  return (
    <Select.Root defaultSelectedKey={value} className={className}>
      <Select.Trigger className="flex h-8 items-center gap-2 rounded-lg border border-zinc-200 bg-white px-3 text-[12.5px] text-zinc-700 hover:bg-zinc-50">
        <Select.Value />
        <Select.Indicator />
      </Select.Trigger>
      <Select.Popover>
        <ListBox.Root className="rounded-xl border border-zinc-200 bg-white py-1 shadow-lg">
          {options.map((option) => (
            <ListBox.Item
              key={option}
              id={option}
              className="cursor-pointer px-3 py-1.5 text-[12.5px] text-zinc-700 hover:bg-zinc-50"
            >
              {option}
            </ListBox.Item>
          ))}
        </ListBox.Root>
      </Select.Popover>
    </Select.Root>
  );
}

function getSettingOptions(value: string) {
  if (value === "跟随系统") return ["跟随系统", "中文", "English"];
  if (value === "开启") return ["开启", "关闭"];
  if (value === "自动") return ["自动", "紧凑", "宽松"];
  if (value === "收件箱优先") return ["收件箱优先", "直接归档", "按规则处理"];
  if (value === "中等") return ["低", "中等", "高"];
  if (value === "VS Code") return ["VS Code", "Cursor", "Zed", "Finder"];
  if (value === "完整路径") return ["完整路径", "相对 Vault", "文件名"];
  return [value];
}

export function PostPreviewSettings({
  data,
  onBack,
}: {
  data: PostPreviewSettingsData;
  onBack: () => void;
}) {
  return (
    <div className="flex h-full overflow-hidden bg-white">
      <aside
        style={{ width: "var(--post-preview-sidebar-width, 320px)", minWidth: sidebarMinWidthPx }}
        className="flex h-full flex-none flex-col border-r border-white/45 bg-white/45 shadow-[inset_-1px_0_0_rgba(255,255,255,0.45)] backdrop-blur-2xl backdrop-saturate-150"
      >
        <div className="relative mt-[10.5px] h-12 pl-[100px]">
          <div className="pointer-events-auto relative z-10 inline-flex -ml-1 -translate-y-1.5">
            <Button
              isIconOnly
              variant="ghost"
              size="sm"
              aria-label="返回应用"
              className="h-8 w-8 text-zinc-500 hover:bg-black/5"
              onPress={onBack}
            >
              <ArrowLeft size={16} />
            </Button>
          </div>
        </div>
        <div className="shrink-0 px-3 pb-2">
          <Input.Root
            placeholder="搜索设置…"
            className="h-7 w-full rounded-lg border-none bg-black/[0.045] px-2 text-[12px] text-zinc-700 outline-none ring-0 placeholder:text-zinc-400"
          />
        </div>
        <nav className="min-h-0 flex-1 overflow-y-auto px-2 pb-4 pt-1">
          <div className="mb-1">
            <div className="px-2 py-1 text-[11px] font-semibold uppercase tracking-wide text-zinc-400">
              偏好
            </div>
            <div className="space-y-0.5">
              <button className={`${sidebarItemBase} ${activeSidebarItem}`} type="button">
                <Settings size={14} className="shrink-0 text-zinc-700" />
                通用
              </button>
            </div>
          </div>
        </nav>
      </aside>
      <main className="flex min-w-0 flex-1 flex-col overflow-hidden bg-white">
        <div className="relative mt-[10.5px] h-12 shrink-0" />
        <div className="min-h-0 flex-1 overflow-y-auto">
          <div className="mx-auto max-w-[660px] px-12 pb-10 pt-4">
            {data.sections.map((section) => (
              <React.Fragment key={section.title}>
                <SettingsSectionTitle>{section.title}</SettingsSectionTitle>
                <SettingGroup>
                  {section.rows.map((row) => (
                    <SettingRow key={row.title} title={row.title} description={row.description}>
                      <SettingSelect value={row.value} options={getSettingOptions(row.value)} />
                    </SettingRow>
                  ))}
                </SettingGroup>
              </React.Fragment>
            ))}
          </div>
        </div>
      </main>
    </div>
  );
}

function statusTaskGroups(tasks: PostPreviewStatusTask[]) {
  return {
    running: tasks.filter((task) => task.state === "running"),
    queued: tasks.filter((task) => task.state === "queued"),
    failed: tasks.filter((task) => task.state === "failed"),
    completed: tasks.filter((task) => task.state === "completed"),
  };
}

function statusTypeLabel(type: PostPreviewStatusTask["type"]) {
  if (type === "indexing") return "索引";
  if (type === "reconcile") return "整理";
  if (type === "publish") return "发布";
  return "同步";
}

function getPreviewTaskProgressLabel(task: PostPreviewStatusTask) {
  return task.progress ?? null;
}

function PFCheck({ s = 12 }: { s?: number }) {
  return (
    <svg
      width={s}
      height={s}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M3.5 8.5l3 3 6-6.5" />
    </svg>
  );
}

function PFFolderIco() {
  return (
    <svg
      width="13"
      height="13"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.3"
      strokeLinejoin="round"
    >
      <path d="M2.2 4.4c0-.6.5-1 1-1h3l1.3 1.4h4.3c.6 0 1 .5 1 1v5.4c0 .6-.5 1-1 1H3.2c-.6 0-1-.5-1-1V4.4z" />
    </svg>
  );
}

function PFTaskIco({ t, size = 13 }: { t: PostPreviewStatusTask["type"]; size?: number }) {
  const iconProps = {
    width: size,
    height: size,
    viewBox: "0 0 16 16",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.4,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
  };

  if (t === "indexing") {
    return (
      <svg {...iconProps}>
        <line x1="3" y1="4" x2="11" y2="4" />
        <line x1="3" y1="7.2" x2="8" y2="7.2" />
        <circle cx="9.6" cy="10.2" r="2.5" />
        <line x1="11.5" y1="12.1" x2="13.3" y2="13.9" />
      </svg>
    );
  }

  if (t === "reconcile") {
    return (
      <svg {...iconProps}>
        <path d="M3.3 6.4a4.6 4.6 0 0 1 8-1.6" />
        <path d="M11.3 3.6v2.1h-2.1" />
        <path d="M12.7 9.6a4.6 4.6 0 0 1-8 1.6" />
        <path d="M4.7 12.4v-2.1h2.1" />
      </svg>
    );
  }

  return (
    <svg {...iconProps}>
      <rect x="2.6" y="2.6" width="4.6" height="4.6" rx="1" />
      <rect x="8.8" y="2.6" width="4.6" height="4.6" rx="1" />
      <rect x="2.6" y="8.8" width="4.6" height="4.6" rx="1" />
      <rect x="8.8" y="8.8" width="4.6" height="4.6" rx="1" />
    </svg>
  );
}

function PFPill({
  kind,
  active,
  count,
  others,
  open,
}: {
  kind: "run" | "queue" | "bad" | "good";
  active: PostPreviewStatusTask | null;
  count: number | null;
  others: number;
  open: boolean;
}) {
  const activeTypeLabel = active ? statusTypeLabel(active.type) : "任务";
  const label =
    kind === "run"
      ? `正在${activeTypeLabel}`
      : kind === "queue"
        ? `${count ?? 0} 项排队`
        : kind === "bad"
          ? `${count ?? 0} 项失败`
          : `${activeTypeLabel}已完成`;
  const countStr = kind === "run" && active ? getPreviewTaskProgressLabel(active) : null;
  const glyph =
    kind === "run" ? (
      <span className="pf-spin h-3 w-3 shrink-0 animate-spin rounded-full border-[1.6px] border-blue-200 border-t-blue-600" />
    ) : (
      <span
        className={cn(
          "pf-dot h-[7px] w-[7px] shrink-0 rounded-full",
          kind === "bad"
            ? "pf-dot--bad bg-red-500 shadow-[0_0_0_3px_rgba(239,68,68,0.16)]"
            : kind === "good"
              ? "pf-dot--good bg-emerald-500 shadow-[0_0_0_3px_rgba(16,185,129,0.18)]"
              : "pf-dot--queue bg-zinc-300",
        )}
      />
    );

  return (
    <span
      className={cn(
        `pf-pill pf-pill--${kind}`,
        "flex cursor-pointer items-center gap-[7px] rounded-full px-[7px] py-[3px] leading-none text-[#8c8c88] hover:bg-[#f4f4f2]",
        open && "is-open bg-[#f4f4f2]",
      )}
    >
      <span className="pf-pill-glyph flex shrink-0 items-center">{glyph}</span>
      <span
        title={kind === "run" ? label : undefined}
        className={cn(
          "pf-pill-label whitespace-nowrap font-medium text-[#1b1b1a]",
          kind === "bad" && "text-red-600",
          kind === "good" && "text-emerald-600",
        )}
      >
        {label}
      </span>
      {countStr ? (
        <span className="pf-pill-count font-mono text-[10px] text-[#b6b6b2]">{countStr}</span>
      ) : null}
      {others > 0 ? (
        <span className="pf-pill-more rounded-[5px] bg-[#f4f4f2] px-1 py-px font-mono text-[9.5px] text-[#b6b6b2]">
          +{others}
        </span>
      ) : null}
      <span className="pf-caret ml-px translate-y-[-0.5px] text-[8px] text-[#b6b6b2]">▲</span>
    </span>
  );
}

function PFPopover({
  running,
  queued,
  failed,
  completed,
  onDismiss,
}: {
  running: PostPreviewStatusTask[];
  queued: PostPreviewStatusTask[];
  failed: PostPreviewStatusTask[];
  completed: PostPreviewStatusTask[];
  onDismiss: (id: string) => void;
}) {
  const groups = [
    { key: "running", title: "进行中", items: running },
    { key: "queued", title: "排队中", items: queued },
    { key: "failed", title: "失败", items: failed },
    { key: "completed", title: "近期完成", items: completed },
  ].filter((group) => group.items.length > 0);
  const total = running.length + queued.length + failed.length + completed.length;

  return (
    <div
      className="pf-pop w-[300px] overflow-hidden rounded-[13px] border border-[#ececea] bg-white shadow-[0_16px_40px_rgba(20,18,16,0.2),0_2px_8px_rgba(20,18,16,0.1)]"
      style={{ width: 300 }}
      onClick={(event) => event.stopPropagation()}
    >
      <div className="pf-pop-head flex items-center gap-2 px-3.5 pb-[9px] pt-3">
        <span className="pf-pop-title text-[12px] font-semibold tracking-normal text-[#1b1b1a]">
          后台任务
        </span>
        <span className="pf-pop-n ml-auto rounded-md bg-[#f4f4f2] px-1.5 py-0.5 font-mono text-[10px] text-[#b6b6b2]">
          {total}
        </span>
      </div>
      <div className="pf-pop-body max-h-[340px] overflow-auto px-[7px] pb-[7px]">
        {groups.map((group) => (
          <div
            className="pf-grp border-t border-[#f3f3f1] py-[5px] first:border-t-0"
            key={group.key}
          >
            <div className="pf-grp-head flex items-center gap-[7px] px-2 pb-[5px] pt-1.5 text-[9.5px] font-semibold uppercase tracking-[0.07em] text-[#b6b6b2]">
              <span
                className={cn(
                  "pf-grp-dot h-1.5 w-1.5 shrink-0 rounded-full",
                  group.key === "running"
                    ? "bg-blue-600"
                    : group.key === "failed"
                      ? "bg-red-500"
                      : group.key === "completed"
                        ? "bg-emerald-500"
                        : "bg-zinc-300",
                )}
              />
              {group.title}
              <span className="pf-grp-n ml-auto font-mono tracking-normal text-[#b6b6b2]">
                {group.items.length}
              </span>
            </div>
            {group.items.map((task) => (
              <PFRow key={task.id} t={task} group={group.key} onDismiss={onDismiss} />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

function PFRow({
  t,
  group,
  onDismiss,
}: {
  t: PostPreviewStatusTask;
  group: string;
  onDismiss: (id: string) => void;
}) {
  const [done = 0, total = 0] =
    t.progress?.split("/").map((value) => Number.parseInt(value, 10)) ?? [];
  const progress = total > 0 ? Math.round((done / total) * 100) : 0;

  return (
    <div
      className={`pf-trow pf-trow--${group} flex items-center gap-2.5 rounded-[9px] px-2 py-[7px] hover:bg-[#f4f4f2]`}
    >
      <span
        className={cn(
          "pf-tico flex h-6 w-6 shrink-0 items-center justify-center rounded-[7px] bg-[#f4f4f2] text-[#8c8c88]",
          group === "failed" && "bg-red-50 text-red-600",
          group === "running" && "bg-blue-50 text-blue-600",
        )}
      >
        <PFTaskIco t={t.type} />
      </span>
      <div className="pf-tmain min-w-0 flex-1">
        <div className="pf-tlabel text-[12.5px] font-medium text-[#1b1b1a]">
          {statusTypeLabel(t.type)}
        </div>
        {group === "running" ? (
          <div className="pf-tbar mt-1.5 h-[3px] overflow-hidden rounded-full bg-[#f4f4f2]">
            <i
              className="block h-full rounded-full bg-blue-600"
              style={{ width: `${progress}%` }}
            />
          </div>
        ) : (
          <div
            className={cn(
              "pf-tsub mt-0.5 text-[11px] text-[#b6b6b2]",
              group === "failed" && "pf-tsub--bad text-red-600",
            )}
          >
            {group === "queued" ? "排队中" : group === "failed" ? t.detail : "已完成"}
          </div>
        )}
      </div>
      <div
        className={cn(
          "pf-tright flex shrink-0 items-center gap-1.5 font-mono text-[10.5px] text-[#8c8c88]",
          group === "completed" && "pf-tright--good text-emerald-600",
        )}
      >
        {group === "running" ? <span>{getPreviewTaskProgressLabel(t)}</span> : null}
        {group === "queued" ? <span style={{ color: "var(--faint,#b6b6b2)" }}>等待</span> : null}
        {group === "completed" ? <PFCheck s={13} /> : null}
        {group === "failed" ? (
          <button
            type="button"
            className="pf-tdismiss flex h-5 w-5 items-center justify-center rounded-md border-0 bg-transparent text-xs text-[#b6b6b2] hover:bg-red-50 hover:text-red-600"
            title="忽略"
            onClick={() => onDismiss(t.id)}
          >
            x
          </button>
        ) : null}
      </div>
    </div>
  );
}

export function PostPreviewStatusLine({
  data,
  folderOpen,
  tasksOpen,
  onToggleFolder,
  onToggleTasks,
  onOpenSettings,
  onSync,
}: {
  data: PostPreviewStatusData;
  folderOpen: boolean;
  tasksOpen: boolean;
  onToggleFolder: () => void;
  onToggleTasks: () => void;
  onOpenSettings: () => void;
  onSync?: () => void;
}) {
  const [dismissed, setDismissed] = useState<Set<string>>(() => new Set());
  const live = useMemo(
    () => (data.tasks ?? []).filter((task) => !dismissed.has(task.id)),
    [data.tasks, dismissed],
  );
  const grouped = statusTaskGroups(live);
  const completed = grouped.completed[0] ?? null;
  let kind: "run" | "queue" | "bad" | "good" | null = null;
  let active: PostPreviewStatusTask | null = null;
  let shown = 0;

  if (grouped.running.length > 0) {
    kind = "run";
    active = grouped.running[0] ?? null;
    shown = 1;
  } else if (grouped.queued.length > 0) {
    kind = "queue";
    shown = grouped.queued.length;
  } else if (grouped.failed.length > 0) {
    kind = "bad";
    shown = grouped.failed.length;
  } else if (grouped.completed.length > 0) {
    kind = "good";
    active = completed;
    shown = 1;
  }

  const others = Math.max(0, live.length - shown);
  const hasPop = live.length > 0;
  const syncRunning = grouped.running.some(
    (task) => task.type === "sync" || task.type === "indexing" || task.type === "reconcile",
  );
  const statusTrigger = kind ? (
    <PFPill
      kind={kind}
      active={active}
      others={others}
      open={tasksOpen}
      count={
        kind === "queue" ? grouped.queued.length : kind === "bad" ? grouped.failed.length : null
      }
    />
  ) : hasPop ? (
    <span
      className={cn(
        "pf-pill pf-pill--stale flex cursor-pointer items-center gap-[7px] rounded-full px-[7px] py-[3px] leading-none hover:bg-[#f4f4f2]",
        tasksOpen && "is-open bg-[#f4f4f2]",
      )}
    >
      <span className="pf-pill-glyph flex shrink-0 items-center">
        <span className="pf-dot pf-dot--stale h-[7px] w-[7px] rounded-full bg-emerald-500 opacity-55" />
      </span>
      <span className="pf-pill-label whitespace-nowrap font-medium text-[#8c8c88]">近期完成</span>
      <span className="pf-caret ml-px translate-y-[-0.5px] text-[8px] text-[#b6b6b2]">▲</span>
    </span>
  ) : (
    <span className="pf-idle flex items-center gap-1.5 px-1 py-[3px] text-[11.5px] text-[#b6b6b2]">
      <PFCheck s={12} /> {data.staleState}
    </span>
  );
  const dismissTask = (id: string) => {
    setDismissed((current) => new Set(current).add(id));
  };

  return (
    <footer
      className="pf-footer absolute inset-x-0 bottom-0 z-[90] box-border flex h-[30px] select-none items-center gap-[14px] border-t border-[#ececea] bg-[#fbfbfa] py-0 pl-[13px] pr-[10px] text-[11.5px] text-[#8c8c88]"
      // theme.css's un-layered `.pf-footer { position: relative }` (needed by the desktop shell's
      // flow layout) outranks the Tailwind `absolute` utility, so pin the preview footer inline.
      style={{ position: "absolute" }}
    >
      <div className="pf-foot-left flex min-w-0 items-center gap-[10px]">
        <Button
          isIconOnly
          variant="ghost"
          size="sm"
          aria-label="设置"
          className="h-6 w-6 min-w-6 rounded-md text-zinc-400"
          onPress={onOpenSettings}
        >
          <Settings2 size={13} />
        </Button>
        <span className="pf-sep h-[13px] w-px shrink-0 bg-[#ececea]" />
        <div className="pf-appmeta flex flex-none items-center gap-[7px]">
          <span className="pf-appname font-semibold tracking-normal text-[#1b1b1a]">Post</span>
          <span className="pf-ver font-mono text-[10px] tracking-normal text-[#b6b6b2]">
            v{data.appVersion}
          </span>
        </div>
        <span className="pf-sep h-[13px] w-px shrink-0 bg-[#ececea]" />
        <Popover
          isOpen={folderOpen}
          onOpenChange={(isOpen) => {
            if (isOpen !== folderOpen) onToggleFolder();
          }}
        >
          <Popover.Trigger className="pf-folder-trigger flex min-w-0 outline-none">
            <span
              className="pf-folder -ml-1 flex min-w-0 cursor-default items-center gap-1.5 rounded-md px-[7px] py-[3px] hover:bg-[#f4f4f2]"
              title={data.vaultName}
            >
              <span className="pf-folder-ico flex shrink-0 text-[#b6b6b2]">
                <PFFolderIco />
              </span>
              <span className="pf-folder-name truncate whitespace-nowrap font-medium text-[#1b1b1a]">
                {data.vaultName}
              </span>
            </span>
          </Popover.Trigger>
          <Popover.Content
            className="pf-menu-content !z-[120] !overflow-visible !border-0 !bg-transparent !p-0 !shadow-none"
            offset={7}
            placement="top start"
          >
            <Popover.Dialog className="pf-menu-dialog outline-none">
              <div
                className="pf-folder-menu w-[300px] overflow-hidden rounded-[13px] border border-[#ececea] bg-white shadow-[0_16px_40px_rgba(20,18,16,0.2),0_2px_8px_rgba(20,18,16,0.1)]"
                style={{ width: 300 }}
              >
                <div className="pf-menu-head px-3.5 pb-2 pt-3 text-[12px] font-semibold text-[#1b1b1a]">
                  资产库
                </div>
                <div className="pf-menu-list max-h-[260px] overflow-auto px-[7px] pb-1.5">
                  <button
                    type="button"
                    className="pf-menu-item is-active flex w-full items-center gap-2.5 rounded-[9px] border-0 bg-[#f4f4f2] px-2 py-[7px] text-left text-[#1b1b1a] hover:bg-[#f4f4f2]"
                    onClick={onToggleFolder}
                  >
                    <span className="pf-menu-item-main min-w-0 flex-1">
                      <span className="pf-menu-item-name block truncate text-[12px] font-medium text-[#1b1b1a]">
                        {data.vaultName}
                      </span>
                      <span className="pf-menu-item-path block truncate text-[10.5px] text-[#b6b6b2]">
                        ~/Documents/Post/{data.vaultName}
                      </span>
                    </span>
                    <PFCheck s={12} />
                  </button>
                </div>
                <div className="pf-menu-actions border-t border-[#f3f3f1] p-[7px]">
                  <button
                    type="button"
                    className="pf-menu-action w-full rounded-[9px] border-0 bg-transparent px-2 py-[7px] text-left font-medium text-blue-600 hover:bg-[#f4f4f2]"
                    onClick={onToggleFolder}
                  >
                    选择其他文件夹
                  </button>
                </div>
              </div>
            </Popover.Dialog>
          </Popover.Content>
        </Popover>
      </div>

      <div className="pf-foot-right relative ml-auto flex items-center">
        <button
          type="button"
          className={cn(
            "pf-sync mr-1.5 flex items-center gap-1.5 rounded-full border-0 bg-transparent px-[7px] py-[3px] leading-none text-[#1b1b1a] hover:bg-[#f4f4f2] disabled:cursor-default disabled:opacity-70",
            syncRunning && "is-running hover:bg-transparent",
          )}
          disabled={syncRunning}
          onClick={onSync}
          title={syncRunning ? "正在同步" : "点击重新同步"}
        >
          <span
            className={
              syncRunning
                ? "pf-spin pf-spin--sync h-2.5 w-2.5 shrink-0 animate-spin rounded-full border-[1.4px] border-blue-200 border-t-blue-600"
                : "pf-dot pf-dot--good h-[7px] w-[7px] shrink-0 rounded-full bg-emerald-500 shadow-[0_0_0_3px_rgba(16,185,129,0.18)]"
            }
          />
          <span>{syncRunning ? "同步中" : data.syncState}</span>
        </button>
        {hasPop ? (
          <Popover
            isOpen={tasksOpen}
            onOpenChange={(isOpen) => {
              if (isOpen !== tasksOpen) onToggleTasks();
            }}
          >
            <Popover.Trigger className="pf-popover-trigger flex items-center outline-none">
              {statusTrigger}
            </Popover.Trigger>
            <Popover.Content
              className="pf-pop-content !z-[120] !overflow-visible !border-0 !bg-transparent !p-0 !shadow-none"
              offset={6}
              placement="top end"
            >
              <Popover.Dialog className="pf-pop-dialog outline-none">
                <PFPopover
                  running={grouped.running}
                  queued={grouped.queued}
                  failed={grouped.failed}
                  completed={grouped.completed}
                  onDismiss={dismissTask}
                />
              </Popover.Dialog>
            </Popover.Content>
          </Popover>
        ) : (
          statusTrigger
        )}
      </div>
    </footer>
  );
}
