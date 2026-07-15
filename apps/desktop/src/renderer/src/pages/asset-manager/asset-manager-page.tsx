/**
 * @purpose Render the asset manager surface for the desktop renderer.
 * @role    App-level React component composed by routes, shell, or shared workflows.
 * @deps    React, HeroUI/local UI primitives, tRPC hooks, and shared renderer modules as needed.
 * @gotcha  Soft detail uses home search `asset=<id>` and keeps the board mounted under the overlay
 *          so Back preserves scroll without URL `i`/`o` restore. Keep layouts dense per design.md.
 */

import React, {
  useState,
  useRef,
  useEffect,
  useLayoutEffect,
  useMemo,
  useId,
  useCallback,
  type ComponentType,
  type SVGProps,
} from "react";
import { useReducedMotion } from "motion/react";
import { useAtom, useAtomValue, useSetAtom } from "jotai";
import {
  assetFiltersAtom,
  activeSidebarItemAtom,
  getEmptyAssetFilters,
  type ActiveSidebarItem,
  type AssetFilterState,
} from "@/store/asset-manager-atoms";
import {
  OPEN_VAULT_TARGET_STORAGE_KEY,
  readAssetFilterOpenFromStorage,
  writeAssetFilterOpenToStorage,
} from "@/lib/asset-manager/storage";
import {
  getActiveFilterCount,
  getTagHue,
  mapIndexedAsset,
  formatVideoDuration,
} from "@/lib/asset-manager/asset-model";
import { resolveMarkdownAssetUrl, buildAssetThumbnailUrl } from "@/lib/asset-manager/asset-url";
import type {
  Asset,
  AssetKind,
  AssetLayoutIndexItem,
  SidebarTag,
  SidebarView,
} from "@/lib/asset-manager/types";
import { isMacWindow } from "@/lib/platform";
import { keepPreviousData, useMutation, useQuery } from "@tanstack/react-query";
import { useVirtualizer, type Virtualizer } from "@tanstack/react-virtual";
import { useSearch } from "@tanstack/react-router";
import { Plyr, type PlyrOptions, type PlyrSource } from "plyr-react";
import "plyr-react/plyr.css";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { FitAddon } from "@xterm/addon-fit";
import { Terminal as XTermTerminal } from "@xterm/xterm";
import "@xterm/xterm/css/xterm.css";
import {
  AlignLeft,
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
  Link as LinkIcon,
  MessageSquareQuote,
  PanelRightOpen,
  Play,
  ShieldCheck,
  SquareTerminal,
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
} from "@heroui/react";
import { toast } from "@/lib/toast";
import { useTranslation } from "react-i18next";
import { openAssetDetail } from "@/lib/asset-manager/open-asset-detail";

import { AssetDetailTags } from "@/components/asset-manager/asset-detail-tags";
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useAppLayout } from "@/components/layout/app-layout-context";
import { useToolbarClearance } from "@/components/layout/window-chrome-nav";
import { emitAssetProfile, roundProfileNumber } from "@/lib/asset-profile";
import { trpc, trpcClient, type RouterInputs } from "@/lib/trpc";
import { load as yamlLoad } from "js-yaml";
import {
  AssetFilterPanel,
  getSortOptionLabel,
  getStatusFilterLabel,
  getTimeFilterLabel,
  getTypeFilterLabel,
  assetFiltersToSavedViewFilters,
  savedViewFiltersToAssetFilters,
  sourceLabelsToTypes,
} from "@/components/asset-manager/asset-filter-controls";
import { ViewFormModal } from "@/components/asset-manager/asset-management-modals";
import {
  AssetCardContextMenu,
  type AssetCardContextMenuState,
} from "@/components/asset-manager/asset-card-context-menu";
import { ViewIconRenderer } from "@/components/asset-manager/view-icon-picker";

type OpenVaultTarget = "vscode" | "cursor" | "zed" | "finder";
type OpenVaultIcon = ComponentType<SVGProps<SVGSVGElement>>;

const CursorEditorIcon: OpenVaultIcon = ({ className, ...props }) => (
  <svg {...props} viewBox="0 0 466.73 532.09" className={className} fill="currentColor">
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

function getKindMeta(kind: AssetKind) {
  const map = {
    markdown: { label: "MD", icon: FileText },
    post: { label: "POST", icon: MessageSquareQuote },
    image: { label: "IMG", icon: ImageIcon },
    video: { label: "VIDEO", icon: Video },
    link: { label: "LINK", icon: LinkIcon },
    web: { label: "WEB", icon: Globe },
    file: { label: "FILE", icon: FileText },
  } satisfies Record<AssetKind, { label: string; icon: typeof FileText }>;

  return map[kind];
}

type AssetListInput = Extract<NonNullable<RouterInputs["assets"]["list"]>, Record<string, unknown>>;

const ASSET_HYDRATE_BATCH_SIZE = 180;
const ASSET_HYDRATE_RENDER_BUFFER = 60;
const ASSET_PROFILE_SKIP_INTERVAL_MS = 500;
const ASSET_COLUMN_WIDTH = 260;
const ASSET_COLUMN_GUTTER = 16;
const ASSET_GRID_PADDING_X = 24; // px-6 viewport padding, both sides
const ASSET_GRID_PADDING_Y = 18; // vertical padding, applied via the virtualizer
// Per-lane overscan in ITEMS-PER-COLUMN (each lane has its own virtualizer): 3 rows per
// column is the row-count equivalent of the old single-virtualizer `overscan: 8` items.
const ASSET_LANE_OVERSCAN = 3;
// Reflow animation: how long after the last resize tick to keep the card transition enabled. Must
// exceed the transition duration + a couple frames so clearing the flag never snaps a mid-flight card.
const ASSET_REFLOW_SETTLE_MS = 400;
const ASSET_REFLOW_EASE = "cubic-bezier(0.22, 1, 0.36, 1)";
// In-band reflow (same column count): only translateY (vertical repack) moves.
const ASSET_REFLOW_TRANSITION = `transform 0.24s ${ASSET_REFLOW_EASE}`;
// Cross-column FLIP: slide each on-screen card from its captured old position to the new one.
const ASSET_FLIP_DURATION_MS = 300;
const ASSET_FLIP_TRANSITION = `transform ${ASSET_FLIP_DURATION_MS}ms ${ASSET_REFLOW_EASE}`;

function prefersReducedMotion(): boolean {
  return (
    typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}
const EMPTY_ASSET_LAYOUT_INDEX: AssetLayoutIndexItem[] = [];
const MISSING_TAG_ID = "__missing_tag__";
// Temporarily hidden: the terminal side-panel toggle isn't surfaced in the UI for now. Flip to
// re-enable the toggle in both the asset board header and the asset detail header. The underlying
// terminal panel/state is left wired so this is a one-line restore.
const SHOW_TERMINAL_TOGGLE = false as boolean;

function getTagIdsFromNames(tagNames: readonly string[], tagOptions: readonly SidebarTag[]) {
  if (tagNames.length === 0) {
    return [];
  }

  const tagIds = tagNames
    .map((tagName) => tagOptions.find((tag) => tag.name === tagName)?.id)
    .filter((tagId): tagId is string => Boolean(tagId));
  return tagIds.length === tagNames.length ? tagIds : [MISSING_TAG_ID];
}

function getSidebarSelectionTagIds(
  activeSidebarItem: ActiveSidebarItem,
  tagOptions: readonly SidebarTag[],
  viewOptions: readonly SidebarView[],
) {
  if (activeSidebarItem.kind === "tag") {
    return tagOptions.some((tag) => tag.id === activeSidebarItem.id)
      ? [activeSidebarItem.id]
      : [MISSING_TAG_ID];
  }

  if (activeSidebarItem.kind !== "view") {
    return [];
  }

  const view = viewOptions.find((item) => item.id === activeSidebarItem.id);
  return (
    view?.conditions
      .filter((condition) => condition.startsWith("tag:"))
      .map((condition) => condition.slice(4)) ?? []
  );
}

function getSourceTypes(sources: readonly string[]) {
  return sourceLabelsToTypes(sources);
}

function buildAssetListInput({
  activeSidebarItem,
  filters,
  tagOptions,
  viewOptions,
  vaultId,
}: {
  activeSidebarItem: ActiveSidebarItem;
  filters: AssetFilterState;
  tagOptions: readonly SidebarTag[];
  viewOptions: readonly SidebarView[];
  vaultId?: string;
}): AssetListInput {
  const filterTagIds = getTagIdsFromNames(filters.tags, tagOptions);
  const selectionTagIds = getSidebarSelectionTagIds(activeSidebarItem, tagOptions, viewOptions);
  const tagIds = filterTagIds.length > 0 ? filterTagIds : selectionTagIds;
  const untagged =
    tagIds.length === 0 && activeSidebarItem.kind === "mgmt" && activeSidebarItem.id === "inbox";

  return {
    vaultId,
    tagIds: tagIds.length > 0 ? tagIds : undefined,
    tagMatch: filters.match,
    statusFilter: filters.status === "any" ? undefined : filters.status,
    untagged: untagged || undefined,
    typeFilters: filters.types.length > 0 ? filters.types : undefined,
    timeFilter: filters.time === "custom" ? "any" : filters.time,
    sourceTypes: getSourceTypes(filters.sources),
    sort: filters.sort,
  };
}

function VisualBlock({ asset }: { asset: Asset }) {
  const { t } = useTranslation();
  const heightCls = { short: "h-32", medium: "h-44", tall: "h-72" }[asset.height ?? "medium"];
  const grad = `linear-gradient(135deg, oklch(0.96 0.03 ${asset.accent}), oklch(0.91 0.05 ${asset.accent + 28}))`;
  const hatch = `oklch(0.72 0.09 ${asset.accent})`;
  const Hatch = () => (
    <div
      className="absolute inset-0"
      style={{
        backgroundImage:
          "repeating-linear-gradient(135deg, currentColor 0 1px, transparent 1px 14px)",
        color: hatch,
        opacity: 0.35,
      }}
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
      <div
        className={`relative ${heightCls} overflow-hidden border-b border-zinc-100`}
        style={{ background: grad }}
      >
        <Hatch />
        <div className="absolute inset-0 flex items-end p-3">
          <div className="flex items-center gap-1.5 rounded-md bg-white/70 px-2.5 py-1 text-[11px] font-medium text-zinc-700 shadow-sm backdrop-blur">
            <ImageIcon size={12} />
            {asset.sourceType === "url"
              ? t("assets.linkImage", {
                  domain: asset.domain ? t("assets.linkImageDomain", { domain: asset.domain }) : "",
                })
              : t("assets.localImage", {
                  count: asset.imageCount
                    ? t("assets.localImageCount", { count: asset.imageCount })
                    : "",
                })}
          </div>
        </div>
      </div>
    );
  }

  // Video (local or linked)
  if (asset.kind === "video") {
    return (
      <div
        className={`relative ${heightCls} overflow-hidden border-b border-zinc-100`}
        style={{ background: grad }}
      >
        {asset.thumbnailUrl ? (
          <img
            src={asset.thumbnailUrl}
            alt={asset.title}
            className="absolute inset-0 h-full w-full object-cover"
            draggable={false}
          />
        ) : (
          <Hatch />
        )}
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
            {t("assets.localVideo")}
          </span>
        )}
      </div>
    );
  }

  // Web with OG image cached
  if (asset.kind === "web" && asset.ogImage) {
    return (
      <div
        className={`relative ${heightCls} overflow-hidden border-b border-zinc-100`}
        style={{ background: grad }}
      >
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
    const FileIcon =
      asset.fileExt === "csv" || asset.fileExt === "xls" || asset.fileExt === "xlsx"
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
      <div
        className={`relative grid ${heightCls} place-items-center overflow-hidden border-b border-zinc-100 bg-zinc-50`}
      >
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

function AssetCardMedia({ asset }: { asset: Asset }) {
  const heightCls = { short: "h-32", medium: "h-44", tall: "h-72" }[asset.height ?? "medium"];
  const isVideo = asset.kind === "video";
  const hasMediaThumbnail =
    (asset.kind === "image" || asset.kind === "video" || asset.kind === "web") &&
    asset.thumbnailUrl;
  const imageAspectRatio =
    hasMediaThumbnail && asset.imageWidth && asset.imageHeight
      ? `${asset.imageWidth} / ${asset.imageHeight}`
      : undefined;

  const reduceMotion = useReducedMotion();
  const canPreview = isVideo && Boolean(asset.mediaUrl) && !reduceMotion;
  const videoRef = useRef<HTMLVideoElement>(null);
  const hoveringRef = useRef(false);
  const [previewing, setPreviewing] = useState(false);
  const [durationLabel, setDurationLabel] = useState(asset.duration);

  useEffect(() => {
    setDurationLabel(asset.duration);
  }, [asset.duration]);

  const startPreview = useCallback(() => {
    const video = videoRef.current;
    if (!canPreview || !video) {
      return;
    }

    hoveringRef.current = true;
    video.muted = true;
    // play() rejects if the tab is backgrounded or autoplay is blocked; the thumbnail
    // simply stays visible in that case, so swallow the rejection.
    void video.play().catch(() => undefined);
  }, [canPreview]);

  const stopPreview = useCallback(() => {
    hoveringRef.current = false;
    const video = videoRef.current;
    setPreviewing(false);
    setDurationLabel(asset.duration);
    if (video) {
      video.pause();
      video.currentTime = 0;
    }
  }, [asset.duration]);

  // Reveal the video only once it actually has frames, so preload="none"'s loading gap
  // shows the thumbnail rather than a black flash. Guard against a pointer that already left.
  const handlePlaying = useCallback(() => {
    if (hoveringRef.current) {
      setPreviewing(true);
    }
  }, []);

  const handleTimeUpdate = useCallback(() => {
    const video = videoRef.current;
    if (!video || !hoveringRef.current || asset.durationMs === undefined) {
      return;
    }

    const remainingMs = Math.max(0, asset.durationMs - video.currentTime * 1000);
    setDurationLabel(formatVideoDuration(remainingMs));
  }, [asset.durationMs]);

  return (
    <div
      className={`relative ${imageAspectRatio ? "" : heightCls} overflow-hidden`}
      onMouseEnter={canPreview ? startPreview : undefined}
      onMouseLeave={canPreview ? stopPreview : undefined}
      style={{
        ...(imageAspectRatio ? { aspectRatio: imageAspectRatio } : {}),
        // Neutral gray loading placeholder shown behind lazy-loaded thumbnails (no accent hue).
        background: `
          radial-gradient(120% 90% at 18% 12%, oklch(0.93 0 0) 0%, transparent 62%),
          linear-gradient(150deg, oklch(0.87 0 0) 0%, oklch(0.92 0 0) 100%)
        `,
      }}
    >
      {hasMediaThumbnail ? (
        <img
          src={asset.thumbnailUrl}
          alt={asset.title}
          className="absolute inset-0 h-full w-full object-cover"
          loading="lazy"
          decoding="async"
          draggable={false}
        />
      ) : null}

      {canPreview ? (
        <video
          ref={videoRef}
          src={asset.mediaUrl}
          muted
          loop
          playsInline
          preload="none"
          tabIndex={-1}
          aria-hidden
          onPlaying={handlePlaying}
          onTimeUpdate={asset.durationMs !== undefined ? handleTimeUpdate : undefined}
          className={`absolute inset-0 h-full w-full object-cover transition-opacity duration-200 ${
            previewing ? "opacity-100" : "opacity-0"
          }`}
        />
      ) : null}

      {isVideo ? (
        <>
          <span
            className={`absolute left-1/2 top-1/2 grid h-11 w-11 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full bg-[#1c1916]/45 text-white shadow-sm backdrop-blur-sm transition-opacity duration-200 ${
              previewing ? "opacity-0" : "opacity-100"
            }`}
          >
            <Play size={17} fill="currentColor" />
          </span>
          {durationLabel ? (
            <span className="absolute right-2.5 top-2.5 rounded-md bg-[#1c1916]/55 px-1.5 py-0.5 font-mono text-[10.5px] text-white tabular-nums">
              {durationLabel}
            </span>
          ) : null}
        </>
      ) : null}

      <AssetCardMediaOverlay asset={asset} />
    </div>
  );
}

// Always-on info layer embedded in a cover's bottom edge: primary tag (left) and, when
// present, source (right). Pressed into the media so it never adds card height. Renders
// nothing when there is nothing to say (untagged local media stays a clean image).
// Web OG covers are designed text images, so subtitle text would collide with the
// artwork's own type: they get a soft scrim with always-white text. Photo and video
// covers stay scrim-free and flip via luma instead — dark-on-light for light covers,
// light-on-dark (with a glyph-hugging shadow) otherwise, including unknown luma.
function AssetCardMediaOverlay({ asset }: { asset: Asset }) {
  const hasTag = asset.tagIds.length > 0;
  const source = asset.domain;

  if (!hasTag && !source) {
    return null;
  }

  const useScrim = asset.kind === "web";
  const isLight = !useScrim && asset.coverIsLight === true;
  const textColor = isLight ? "text-[#3a3833]" : "text-white";
  const textShadow =
    useScrim || isLight ? "none" : "0 1px 3px rgba(20,17,14,0.65), 0 0 1px rgba(20,17,14,0.55)";
  const dotLightness = isLight ? 0.58 : 0.8;

  return (
    <>
      {useScrim ? (
        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-0 bottom-0 h-16"
          style={{
            background:
              "linear-gradient(to top, rgba(20,17,14,0.55) 0%, rgba(20,17,14,0.22) 55%, rgba(20,17,14,0) 100%)",
          }}
        />
      ) : null}
      <div
        className={`pointer-events-none absolute inset-x-0 bottom-0 flex items-center justify-between gap-2 px-3 pb-2.5 pt-2 text-[11px] font-medium ${textColor}`}
        style={{ textShadow }}
      >
        {hasTag ? (
          <span className="flex min-w-0 items-center gap-1.5">
            <span
              className="h-[7px] w-[7px] shrink-0 rounded-full"
              style={{
                background: `oklch(${dotLightness} 0.15 ${getTagHue(asset.tag)})`,
                boxShadow: useScrim || isLight ? "none" : "0 1px 2px rgba(20,17,14,0.4)",
              }}
            />
            <span className="min-w-0 truncate">{asset.tag}</span>
          </span>
        ) : (
          <span />
        )}
        {source ? <span className="min-w-0 shrink-0 truncate opacity-90">{source}</span> : null}
      </div>
    </>
  );
}

// Markdown note cards only: a compact 44px strip of vault-resolved embeds, capped at
// three thumbs with a +N overflow cell. Cover-mode notes skip this for a top cover.
function AssetCardThumbnailStrip({ asset }: { asset: Asset }) {
  const images = asset.noteImages ?? [];
  if (images.length === 0) {
    return null;
  }

  const overflow =
    typeof asset.noteImageCount === "number" && asset.noteImageCount > images.length
      ? asset.noteImageCount - images.length
      : 0;

  return (
    <div className="mt-2.5 flex gap-1.5">
      {images.map((image) => (
        <img
          key={image.assetId}
          src={buildAssetThumbnailUrl(image.assetId, image.fileName)}
          alt=""
          loading="lazy"
          decoding="async"
          className="h-11 w-11 shrink-0 rounded-md object-cover"
          style={{
            boxShadow: "inset 0 0 0 1px rgba(28,25,22,0.06)",
            background: `
              radial-gradient(120% 90% at 18% 12%, oklch(0.93 0 0) 0%, transparent 62%),
              linear-gradient(150deg, oklch(0.87 0 0) 0%, oklch(0.92 0 0) 100%)
            `,
          }}
        />
      ))}
      {overflow > 0 ? (
        <span className="grid h-11 w-11 shrink-0 place-items-center rounded-md bg-[#ecebe6] text-[12px] font-semibold text-[#6c6a64]">
          +{overflow}
        </span>
      ) : null}
    </div>
  );
}

function AssetCardNoteCover({ asset }: { asset: Asset }) {
  const cover = asset.noteImages?.[0];
  if (!cover) {
    return null;
  }

  return (
    <div
      className="relative aspect-[3/2] overflow-hidden"
      style={{
        background: `
          radial-gradient(120% 90% at 18% 12%, oklch(0.93 0 0) 0%, transparent 62%),
          linear-gradient(150deg, oklch(0.87 0 0) 0%, oklch(0.92 0 0) 100%)
        `,
      }}
    >
      <img
        src={buildAssetThumbnailUrl(cover.assetId, cover.fileName)}
        alt=""
        loading="lazy"
        decoding="async"
        className="absolute inset-0 h-full w-full object-cover"
      />
    </div>
  );
}

function AssetFilePreview({ asset }: { asset: Asset }) {
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

function AssetCardPrimaryTagChip({ asset, className }: { asset: Asset; className?: string }) {
  return (
    <Chip
      size="sm"
      className={`h-auto min-h-0 max-w-full gap-1.5 px-0 py-0 text-[11.5px] font-medium text-[#1c1b19] ${className ?? "bg-transparent"}`}
    >
      <span
        className="h-[7px] w-[7px] shrink-0 rounded-full"
        style={{ background: `oklch(0.6 0.14 ${getTagHue(asset.tag)})` }}
      />
      <span className="min-w-0 truncate">{asset.tag}</span>
    </Chip>
  );
}

function AssetCardTagRow({ asset }: { asset: Asset }) {
  const { t } = useTranslation();
  const hasTag = asset.tagIds.length > 0;
  const isPrivate = asset.privacy === "private";

  // Untagged assets only carry the untagged placeholder (no real tag), so show nothing.
  if (!hasTag && !isPrivate) {
    return null;
  }

  return (
    <div
      className={`mt-3 flex flex-wrap items-center gap-x-2 gap-y-1.5 ${
        // Reserve room for the platform glyph anchored at the post card's bottom-right.
        asset.kind === "post" ? "pr-5" : ""
      }`}
    >
      {hasTag ? <AssetCardPrimaryTagChip asset={asset} /> : null}
      {isPrivate ? (
        <Chip
          size="sm"
          className="h-auto min-h-0 gap-1 bg-transparent px-0 py-0 text-[10.5px] font-semibold text-amber-700"
        >
          <ShieldCheck size={11} />
          {t("assets.private")}
        </Chip>
      ) : null}
    </div>
  );
}

function PostBrandGlyph({ platform, size = 13 }: { platform?: string; size?: number }) {
  if (platform === "x" || platform === "twitter") {
    return (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden>
        <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
      </svg>
    );
  }

  return <MessageSquareQuote size={size} aria-hidden />;
}

// Small round author avatar. Remote profile photos fall back to an author-derived initial
// when absent or unavailable. The platform marker lives at the card corner.
function AssetCardAvatar({ asset }: { asset: Asset }) {
  const [imageFailed, setImageFailed] = useState(false);
  const seed = asset.authorHandle ?? asset.authorName ?? asset.platform ?? "post";
  const initial =
    (asset.authorName ?? asset.authorHandle ?? "")
      .replace(/^@/, "")
      .trim()
      .charAt(0)
      .toUpperCase() || "·";

  useEffect(() => setImageFailed(false), [asset.authorAvatarUrl]);

  if (asset.authorAvatarUrl && !imageFailed) {
    return (
      <img
        src={asset.authorAvatarUrl}
        alt=""
        className="h-5 w-5 shrink-0 rounded-full bg-zinc-100 object-cover"
        loading="lazy"
        draggable={false}
        referrerPolicy="no-referrer"
        onError={() => setImageFailed(true)}
      />
    );
  }

  return (
    <span
      className="grid h-5 w-5 shrink-0 place-items-center rounded-full text-[10px] font-semibold text-white"
      style={{ background: `oklch(0.62 0.15 ${getTagHue(seed)})` }}
    >
      {initial}
    </span>
  );
}

// Attribution header for "quote"-style assets: avatar + author name on the left, published
// date pushed to the far right. The source is part of the content, so it renders inline.
function AssetCardAttribution({ asset }: { asset: Asset }) {
  const { t } = useTranslation();
  const name =
    asset.authorName ??
    asset.authorHandle ??
    (asset.platform === "x" || asset.platform === "twitter"
      ? "X Post"
      : (asset.domain ?? t("assets.postFallback")));

  return (
    <div className="flex items-center gap-2 text-[12px] text-[#6c6a64]">
      <AssetCardAvatar asset={asset} />
      <span className="min-w-0 flex-1 truncate font-semibold text-[#1c1b19]">{name}</span>
      {asset.publishedTime ? (
        <time className="shrink-0 whitespace-nowrap">{asset.publishedTime}</time>
      ) : null}
    </div>
  );
}

const AssetCard = React.memo(function AssetCard({
  asset,
  selected = false,
  onToggleSelected,
  onOpenContextMenu,
}: {
  asset: Asset;
  selected?: boolean;
  onToggleSelected?: (assetId: string) => void;
  onOpenContextMenu?: (state: AssetCardContextMenuState) => void;
}) {
  const { t } = useTranslation();
  const hasCover =
    asset.kind === "image" || asset.kind === "video" || (asset.kind === "web" && asset.ogImage);
  const showUrlRow = asset.kind === "link" || (asset.kind === "web" && !asset.ogImage);
  const selectable = asset.kind === "image" && onToggleSelected;

  return (
    <article
      className="relative overflow-hidden rounded-xl bg-[#f6f5f2] transition-colors duration-150 hover:bg-[#f2f1ed]"
      onContextMenu={(event) => {
        event.preventDefault();
        event.stopPropagation();
        onOpenContextMenu?.({ asset, x: event.clientX, y: event.clientY });
      }}
    >
      {selectable ? (
        <button
          type="button"
          aria-label={selected ? t("assets.deselectImage") : t("assets.selectImage")}
          className={`absolute right-2.5 top-2.5 z-10 grid h-6 w-6 place-items-center rounded-lg border shadow-sm backdrop-blur transition-colors ${
            selected
              ? "border-zinc-900 bg-zinc-900 text-white"
              : "border-white/70 bg-white/80 text-zinc-500 hover:text-zinc-900"
          }`}
          onClick={(event) => {
            event.stopPropagation();
            onToggleSelected(asset.id);
          }}
        >
          <Check size={13} />
        </button>
      ) : null}
      <button
        type="button"
        className="block w-full text-left outline-none focus-visible:ring-2 focus-visible:ring-zinc-500/20"
        onClick={() => {
          openAssetDetail(asset.id);
        }}
      >
        {hasCover ? (
          <AssetCardMedia asset={asset} />
        ) : (
          <>
            {asset.coverMode ? <AssetCardNoteCover asset={asset} /> : null}
            <div className="px-4 py-3.5">
              {asset.kind === "post" ? (
                <AssetCardAttribution asset={asset} />
              ) : (
                <h2 className="line-clamp-2 text-[14px] font-semibold leading-[1.4] text-[#1c1b19]">
                  {asset.title}
                </h2>
              )}

              {asset.kind === "file" ? <AssetFilePreview asset={asset} /> : null}
              {showUrlRow ? <AssetUrlPreview asset={asset} /> : null}

              {asset.body ? (
                <p
                  className={`whitespace-pre-line text-[13px] leading-[1.6] ${
                    // Note excerpts span paragraphs (indexer joins them with \n), so give
                    // them more clamp room than the single-utterance post body. Cover-mode
                    // notes keep a short caption under the hero image.
                    asset.kind === "post"
                      ? "line-clamp-4 mt-2.5 text-[#1c1b19]"
                      : asset.coverMode
                        ? "line-clamp-2 mt-2 text-[#6c6a64]"
                        : "line-clamp-6 mt-2 text-[#6c6a64]"
                  }`}
                >
                  {asset.body}
                </p>
              ) : null}

              {!asset.coverMode && asset.kind === "markdown" ? (
                <AssetCardThumbnailStrip asset={asset} />
              ) : null}

              <AssetCardTagRow asset={asset} />
            </div>
          </>
        )}
      </button>
      {asset.kind === "post" ? (
        <span className="pointer-events-none absolute bottom-3 right-3.5 text-[#8a8478]">
          <PostBrandGlyph platform={asset.platform} size={13} />
        </span>
      ) : null}
    </article>
  );
});

function getLayoutIndexMediaHeight(item: AssetLayoutIndexItem) {
  if (item.kind !== "image" && item.kind !== "video") {
    return 0;
  }

  const width = item.imageWidth ?? item.thumbnailWidth;
  const height = item.imageHeight ?? item.thumbnailHeight;
  if (!width || !height || width <= 0 || height <= 0) {
    return 176;
  }

  // Match the real cover render, which fills the column at the image's natural aspect
  // ratio with no max-height. Capping this at 260 is what unbalanced the masonry columns:
  // lane assignment (estimate mode) treated every tall image as <=260px tall.
  return Math.max(128, Math.round((height / width) * 260));
}

function getAssetCardHeightEstimate(item: AssetLayoutIndexItem) {
  const mediaHeight = getLayoutIndexMediaHeight(item);
  // Cover cards are pure media (no chrome); text cards reserve ~190px for title + a
  // multi-paragraph excerpt (clamp-6) + tags. Add the column gutter because each cell's
  // wrapper padding is measured into its height.
  return (mediaHeight > 0 ? mediaHeight : 190) + ASSET_COLUMN_GUTTER;
}

const AssetCardPlaceholder = React.memo(function AssetCardPlaceholder({
  item,
}: {
  item: AssetLayoutIndexItem;
}) {
  const mediaHeight = getLayoutIndexMediaHeight(item);
  const hasMedia = mediaHeight > 0;

  return (
    <article
      aria-busy="true"
      className="relative overflow-hidden rounded-xl bg-[#f6f5f2]"
      style={{ minHeight: hasMedia ? mediaHeight : 140 }}
    >
      {hasMedia ? (
        <div className="relative overflow-hidden bg-zinc-200/60" style={{ height: mediaHeight }} />
      ) : (
        <div className="px-4 py-3.5">
          <div className="h-4 w-3/4 rounded bg-zinc-200/80" />
          <div className="mt-2.5 space-y-1.5">
            <div className="h-3 w-full rounded bg-zinc-200/60" />
            <div className="h-3 w-11/12 rounded bg-zinc-200/60" />
            <div className="h-3 w-2/3 rounded bg-zinc-200/60" />
          </div>
          <div className="mt-3 flex items-center gap-2">
            <span className="h-2 w-2 rounded-full bg-zinc-300/80" />
            <span className="h-3 w-20 rounded bg-zinc-200/70" />
          </div>
        </div>
      )}
    </article>
  );
});

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
  const { t } = useTranslation();
  const headerRef = useToolbarClearance();
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
    <div
      ref={headerRef}
      className={`${dragClassName} relative z-[75] flex h-10 shrink-0 items-center gap-2.5 border-b border-zinc-100 bg-white px-6`}
    >
      <h1 className="mr-auto text-[13.5px] font-semibold tracking-normal text-zinc-950">
        {t("assets.allAssets")}
      </h1>
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
          {t("assets.filter")}
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
              aria-label={t("assets.openVaultWith", { label: preferredOpenTarget.label })}
              disabled={openVaultLocation.isPending}
              onClick={() => openVaultWithTarget(preferredOpenTarget.id, false)}
            >
              <PreferredOpenIcon
                aria-hidden="true"
                className={`${HEADER_ICON_CLASS_NAME} text-zinc-600`}
              />
            </button>
            <Dropdown isOpen={openWithMenuOpen} onOpenChange={setOpenWithMenuOpen}>
              <Dropdown.Trigger
                className="window-no-drag inline-grid h-6 w-6 place-items-center outline-none transition-colors hover:bg-zinc-50"
                aria-label={t("assets.chooseOpenMethod")}
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
                  aria-label={t("assets.openVault")}
                  className="min-w-36 p-0 outline-none"
                  disabledKeys={
                    openVaultLocation.isPending ? OPEN_VAULT_TARGETS.map((target) => target.id) : []
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
                        <Icon
                          aria-hidden="true"
                          className={`${HEADER_ICON_CLASS_NAME} text-zinc-500`}
                        />
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
            title={t("assets.noVaultSelected")}
          >
            <FolderOpen className={HEADER_ICON_CLASS_NAME} />
            <ChevronDown className={HEADER_ICON_CLASS_NAME} />
          </span>
        )}
        {SHOW_TERMINAL_TOGGLE ? (
          <Button
            size="sm"
            variant={terminalOpen ? "secondary" : "ghost"}
            isDisabled={!terminalAvailable}
            aria-label={
              terminalAvailable ? t("assets.openTerminal") : t("assets.terminalUnsupported")
            }
            className={`window-no-drag h-6 min-h-0 rounded-lg border px-2 text-[11px] ${
              terminalOpen
                ? "border-zinc-300 bg-zinc-100 text-zinc-900"
                : "border-zinc-200 bg-white text-zinc-600 hover:bg-zinc-50"
            }`}
            onPress={onToggleTerminal}
          >
            <PanelRightOpen className={HEADER_ICON_CLASS_NAME} />
          </Button>
        ) : null}
      </div>
    </div>
  );
}

type ActiveFilterChip = {
  key: string;
  label: string;
  group: "type" | "tag" | "source" | "time" | "status" | "sort";
  value?: string;
  hue?: number;
};

function getActiveFilterChips(
  filters: AssetFilterState,
  t: (key: string) => string,
): ActiveFilterChip[] {
  return [
    ...filters.types.map((type) => ({
      key: `type-${type}`,
      label: getTypeFilterLabel(type, t),
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
      ? [
          {
            key: "time",
            label: getTimeFilterLabel(filters.time, t),
            group: "time" as const,
          },
        ]
      : []),
    ...(filters.status !== "any"
      ? [
          {
            key: "status",
            label: getStatusFilterLabel(filters.status, t),
            group: "status" as const,
          },
        ]
      : []),
    ...(filters.sort !== "added_desc"
      ? [
          {
            key: "sort",
            label: getSortOptionLabel(filters.sort, t),
            group: "sort" as const,
          },
        ]
      : []),
  ];
}

const ACTIVE_FILTER_COLLAPSE_THRESHOLD = 5;

function AssetActiveFilterSummary({
  filters,
  onFiltersChange,
  onClearFilters,
  resultCount,
  totalCount,
  activeViewName,
  activeViewIcon,
}: {
  filters: AssetFilterState;
  onFiltersChange: React.Dispatch<React.SetStateAction<AssetFilterState>>;
  onClearFilters: () => void;
  resultCount: number;
  totalCount: number;
  activeViewName?: string;
  activeViewIcon?: string | null;
}) {
  const { t } = useTranslation();
  const chips = getActiveFilterChips(filters, t);

  if (chips.length === 0) {
    return null;
  }

  const removeChips = (keys: Set<React.Key>) => {
    const chipsByKey = new Map(chips.map((chip) => [chip.key, chip]));

    const nextFilters = Array.from(keys).reduce<AssetFilterState>((accFilters, key) => {
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
        return { ...accFilters, sort: "added_desc" };
      }

      return { ...accFilters, status: "any" };
    }, filters);

    // Removing the last chip is the same as "clear" — also drop the sidebar selection so the query
    // stops falling back to the active view/tag (otherwise the content would stay filtered).
    if (getActiveFilterCount(nextFilters) === 0) {
      onClearFilters();
      return;
    }

    onFiltersChange(nextFilters);
  };

  return (
    <div className="flex shrink-0 flex-wrap items-center gap-1.5 border-b border-zinc-100 px-6 py-2">
      <span className="mr-1 text-[11.5px] font-semibold text-zinc-500">
        {t("assets.filteredSummary", { result: resultCount, total: totalCount })}
      </span>
      {chips.length > ACTIVE_FILTER_COLLAPSE_THRESHOLD ? (
        <span className="inline-flex h-5 items-center gap-1.5 rounded-full bg-[#f3f2ef] px-2.5 text-[11px] font-medium text-zinc-700">
          {activeViewName ? (
            <>
              <ViewIconRenderer
                value={activeViewIcon}
                size={12}
                className="shrink-0 text-zinc-500"
              />
              {activeViewName}
            </>
          ) : (
            t("assets.conditionsCount", { count: chips.length })
          )}
        </span>
      ) : (
        <TagGroup
          aria-label={t("assets.filteredConditions")}
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
      )}
      <Button
        size="sm"
        variant="ghost"
        className="h-5 min-h-0 px-1 text-[11px] text-zinc-400 hover:text-zinc-700"
        onPress={onClearFilters}
      >
        {t("assets.clear")}
      </Button>
    </div>
  );
}

type MasonryVirtualizerHandle = {
  getVirtualItems: () => Array<{ index: number; start: number; end: number }>;
  scrollToIndex: (index: number, options?: { align?: "start" | "center" | "end" | "auto" }) => void;
};

type LaneVirtualizer = Virtualizer<HTMLDivElement, Element>;

type MasonryLaneItem = {
  item: AssetLayoutIndexItem;
  // Position in the full indexItems array, for hydrate-range and scroll-index mapping
  // (originalIndex = inLaneIndex * columnCount + laneIndex).
  originalIndex: number;
};

// One column of the masonry with its own virtualizer. Lane membership is decided by the
// parent's round-robin split, so card placement is a pure function of list order — height
// estimates only affect in-lane scroll positioning, never which column a card lands in.
function MasonryLane({
  laneIndex,
  columnCount,
  laneItems,
  scrollViewportRef,
  hydratedAssetsById,
  wrapperTransition,
  onOpenContextMenu,
  onRangeChange,
  registerVirtualizer,
}: {
  laneIndex: number;
  columnCount: number;
  laneItems: MasonryLaneItem[];
  scrollViewportRef: React.RefObject<HTMLDivElement | null>;
  hydratedAssetsById: ReadonlyMap<string, Asset>;
  wrapperTransition: string | undefined;
  onOpenContextMenu: (state: AssetCardContextMenuState) => void;
  onRangeChange: (laneIndex: number, start: number, end: number) => void;
  registerVirtualizer: (laneIndex: number, virtualizer: LaneVirtualizer) => void;
}) {
  const virtualizer = useVirtualizer({
    count: laneItems.length,
    getScrollElement: () => scrollViewportRef.current,
    estimateSize: (index) => getAssetCardHeightEstimate(laneItems[index].item),
    getItemKey: (index) => laneItems[index].item.id,
    overscan: ASSET_LANE_OVERSCAN,
    paddingStart: ASSET_GRID_PADDING_Y,
    paddingEnd: ASSET_GRID_PADDING_Y,
    // A fresh virtualizer scrolls its element to initialOffset on attach (virtual-core
    // _willUpdate). All lanes share one viewport, so read the live scrollTop: the attach
    // write becomes a no-op and the first render windows from the correct offset.
    initialOffset: () => scrollViewportRef.current?.scrollTop ?? 0,
  });
  registerVirtualizer(laneIndex, virtualizer);

  const range = virtualizer.range;
  const rangeStart = range?.startIndex ?? -1;
  const rangeEnd = range?.endIndex ?? -1;

  // Report the visible in-lane range up for cross-lane hydrate batching. `laneItems` is a
  // dependency so a data identity change re-reports even when the numeric range is unchanged.
  useEffect(() => {
    onRangeChange(laneIndex, rangeStart, rangeEnd);
  }, [laneIndex, rangeStart, rangeEnd, laneItems, onRangeChange]);

  return (
    <div
      style={{
        position: "relative",
        width: `${100 / columnCount}%`,
        flexShrink: 0,
        height: virtualizer.getTotalSize(),
      }}
    >
      {virtualizer.getVirtualItems().map((virtualItem) => {
        const laneItem = laneItems[virtualItem.index];
        if (!laneItem) {
          return null;
        }

        const hydratedAsset = hydratedAssetsById.get(laneItem.item.id);

        return (
          <div
            key={virtualItem.key}
            data-index={virtualItem.index}
            ref={virtualizer.measureElement}
            style={{
              position: "absolute",
              top: 0,
              left: 0,
              width: "100%",
              transform: `translateY(${virtualItem.start}px)`,
              padding: ASSET_COLUMN_GUTTER / 2,
              boxSizing: "border-box",
              transition: wrapperTransition,
              willChange: wrapperTransition ? "transform" : undefined,
            }}
          >
            {/* FLIP layer: its transform is driven imperatively across a column-count remount to
                slide each card from its old to new position. Kept separate from the wrapper so it
                never fights the virtualizer's translateY (and its transform is layout-neutral, so it
                doesn't retrigger measurement). */}
            <div data-flip-id={laneItem.item.id}>
              {hydratedAsset ? (
                <AssetCard asset={hydratedAsset} onOpenContextMenu={onOpenContextMenu} />
              ) : (
                <AssetCardPlaceholder item={laneItem.item} />
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function AssetMasonryColumns({
  scrollViewportRef,
  columnCount,
  indexItems,
  hydratedAssetsById,
  onHydrateAssets,
  virtualizerRef,
  reflowing,
  onOpenContextMenu,
}: {
  scrollViewportRef: React.RefObject<HTMLDivElement | null>;
  columnCount: number;
  indexItems: AssetLayoutIndexItem[];
  hydratedAssetsById: ReadonlyMap<string, Asset>;
  onHydrateAssets: (assetIds: readonly string[]) => void;
  virtualizerRef: React.RefObject<MasonryVirtualizerHandle | null>;
  reflowing: boolean;
  onOpenContextMenu: (state: AssetCardContextMenuState) => void;
}) {
  const hydrateFrame = useRef<number | undefined>(undefined);
  const laneRangesRef = useRef<Array<{ start: number; end: number } | null>>([]);
  const laneVirtualizersRef = useRef<Array<LaneVirtualizer | null>>([]);
  const columnCountRef = useRef(columnCount);
  const indexItemsRef = useRef(indexItems);
  columnCountRef.current = columnCount;
  indexItemsRef.current = indexItems;
  // Drop stale per-lane slots when the column count shrinks.
  laneRangesRef.current.length = columnCount;
  laneVirtualizersRef.current.length = columnCount;

  const reduceMotion = useReducedMotion();
  // Gate the card transition to resize-driven reflows only — a persistent virtual item's translateY
  // is otherwise constant during scroll, so an always-on transition would animate scroll-time repacks
  // (hydration / measurement settling). `reflowing` is cleared on a column-count change (animated by
  // the FLIP layer instead), so this transition only covers the same-column-count vertical repack.
  const wrapperTransition = reflowing && !reduceMotion ? ASSET_REFLOW_TRANSITION : undefined;

  // Strict Z-order: card i always lands in lane i % N, so the grid reads left-to-right in
  // list order and the layout is identical on every visit regardless of estimate accuracy.
  const laneItemsList = useMemo(() => {
    const lanes: MasonryLaneItem[][] = Array.from({ length: columnCount }, () => []);
    indexItems.forEach((item, originalIndex) => {
      lanes[originalIndex % columnCount].push({ item, originalIndex });
    });
    return lanes;
  }, [indexItems, columnCount]);

  // Lazily hydrate the union of the lanes' visible ranges (plus a buffer). Lane callbacks
  // only write refs — a single rAF per frame folds all N lanes into one hydrate request,
  // and scrolling never re-renders this parent. The contiguous [min, max] span (instead of
  // an exact per-lane union) over-includes at most ~N edge cards, which the ±buffer already
  // dwarfs, and keeps the top-down priority order that hydrate batching truncates by.
  const handleLaneRange = useCallback(
    (laneIndex: number, start: number, end: number) => {
      laneRangesRef.current[laneIndex] = start < 0 ? null : { start, end };
      if (hydrateFrame.current !== undefined) {
        return;
      }
      hydrateFrame.current = window.requestAnimationFrame(() => {
        hydrateFrame.current = undefined;
        const laneCount = columnCountRef.current;
        const items = indexItemsRef.current;
        if (items.length === 0) {
          return;
        }
        let lo = Infinity;
        let hi = -1;
        for (let lane = 0; lane < laneCount; lane++) {
          const laneRange = laneRangesRef.current[lane];
          if (!laneRange) {
            continue;
          }
          lo = Math.min(lo, laneRange.start * laneCount + lane);
          hi = Math.max(hi, laneRange.end * laneCount + lane);
        }
        if (hi < 0) {
          return;
        }
        const first = Math.max(0, lo - ASSET_HYDRATE_RENDER_BUFFER);
        const last = Math.min(items.length - 1, hi + ASSET_HYDRATE_RENDER_BUFFER);
        if (first > last) {
          return;
        }
        onHydrateAssets(items.slice(first, last + 1).map((item) => item.id));
      });
    },
    [onHydrateAssets],
  );

  useEffect(() => {
    return () => {
      if (hydrateFrame.current !== undefined) {
        window.cancelAnimationFrame(hydrateFrame.current);
      }
    };
  }, []);

  const registerLaneVirtualizer = useCallback((laneIndex: number, virtualizer: LaneVirtualizer) => {
    laneVirtualizersRef.current[laneIndex] = virtualizer;
  }, []);

  // Expose an aggregate handle to the parent grid for index-based scroll save/restore.
  // scrollToIndex targets one lane's virtualizer, but it writes the shared viewport's
  // scrollTop, so the whole grid scrolls.
  virtualizerRef.current = {
    getVirtualItems: () => {
      const out: Array<{ index: number; start: number; end: number }> = [];
      for (let lane = 0; lane < columnCount; lane++) {
        const laneVirtualizer = laneVirtualizersRef.current[lane];
        if (!laneVirtualizer) {
          continue;
        }
        for (const virtualItem of laneVirtualizer.getVirtualItems()) {
          out.push({
            index: virtualItem.index * columnCount + lane,
            start: virtualItem.start,
            end: virtualItem.end,
          });
        }
      }
      return out.sort((a, b) => a.index - b.index);
    },
    scrollToIndex: (index, options) => {
      laneVirtualizersRef.current[index % columnCount]?.scrollToIndex(
        Math.floor(index / columnCount),
        options,
      );
    },
  };

  return (
    <div style={{ display: "flex", alignItems: "flex-start", width: "100%" }}>
      {laneItemsList.map((laneItems, laneIndex) => (
        <MasonryLane
          key={laneIndex}
          laneIndex={laneIndex}
          columnCount={columnCount}
          laneItems={laneItems}
          scrollViewportRef={scrollViewportRef}
          hydratedAssetsById={hydratedAssetsById}
          wrapperTransition={wrapperTransition}
          onOpenContextMenu={onOpenContextMenu}
          onRangeChange={handleLaneRange}
          registerVirtualizer={registerLaneVirtualizer}
        />
      ))}
    </div>
  );
}

function AssetMasonryGrid({
  indexItems,
  hydratedAssetsById,
  loading,
  vaultAvailable,
  onHydrateAssets,
  queryResetKey,
}: {
  indexItems: AssetLayoutIndexItem[];
  hydratedAssetsById: ReadonlyMap<string, Asset>;
  loading: boolean;
  vaultAvailable: boolean;
  onHydrateAssets: (assetIds: readonly string[]) => void;
  queryResetKey: string;
}) {
  const { t } = useTranslation();
  const scrollViewportRef = useRef<HTMLDivElement>(null);
  const [columnCount, setColumnCount] = useState(1);
  const [contextMenu, setContextMenu] = useState<AssetCardContextMenuState | null>(null);
  const closeContextMenu = useCallback(() => setContextMenu(null), []);
  const virtualizerRef = useRef<MasonryVirtualizerHandle | null>(null);
  const firstResetRef = useRef(true);
  // Reflow animation. In-band (same column count): pulse `reflowing` so the vertical repack
  // transitions on the wrapper's translateY. Column-count change: a manual FLIP slides each on-screen
  // card from its old to new position. Lanes keyed by laneIndex persist across a column change; only
  // a newly added lane mounts a fresh virtualizer, which scrolls the shared viewport to its
  // initialOffset on attach (virtual-core _willUpdate) — every lane passes the live scrollTop as
  // initialOffset so that write is a no-op instead of a jump to the top.
  const [reflowing, setReflowing] = useState(false);
  const columnCountRef = useRef(1);
  const firstRecomputeRef = useRef(true);
  const reflowTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const flipFromRef = useRef<Map<string, { x: number; y: number }> | null>(null);

  // Derive the column COUNT from a fixed ~260px column width, responsive to container width.
  useLayoutEffect(() => {
    const el = scrollViewportRef.current;
    if (!el) return;

    const recompute = () => {
      const innerWidth = el.clientWidth - ASSET_GRID_PADDING_X * 2;
      const next = Math.max(
        1,
        Math.floor((innerWidth + ASSET_COLUMN_GUTTER) / (ASSET_COLUMN_WIDTH + ASSET_COLUMN_GUTTER)),
      );
      const columnChanged = next !== columnCountRef.current;
      const isFirst = firstRecomputeRef.current;
      firstRecomputeRef.current = false;

      if (columnChanged) {
        // FLIP "first": capture on-screen card positions BEFORE the re-layout (old columns are
        // still rendered); the play step slides them after the lanes change. Off-screen cards aren't
        // rendered, so they're skipped — which is exactly why this avoids the virtualization blank.
        if (!isFirst && !prefersReducedMotion()) {
          const from = new Map<string, { x: number; y: number }>();
          el.querySelectorAll<HTMLElement>("[data-flip-id]").forEach((node) => {
            const id = node.dataset.flipId;
            if (!id) return;
            const rect = node.getBoundingClientRect();
            from.set(id, { x: rect.left, y: rect.top });
          });
          flipFromRef.current = from;
        }
        columnCountRef.current = next;
        setColumnCount(next);
        // The remount + FLIP own the column change; drop any in-flight in-band pulse.
        setReflowing(false);
        clearTimeout(reflowTimerRef.current);
        return;
      }

      if (isFirst) {
        return; // never animate the initial layout
      }

      // Same column count → animate the vertical repack.
      setReflowing(true);
      clearTimeout(reflowTimerRef.current);
      reflowTimerRef.current = setTimeout(() => setReflowing(false), ASSET_REFLOW_SETTLE_MS);
    };

    const ro = new ResizeObserver(recompute);
    ro.observe(el);
    recompute();

    return () => {
      ro.disconnect();
      clearTimeout(reflowTimerRef.current);
    };
  }, []);

  // FLIP "play": after a column-count change re-packs the columns, slide each matched card from its
  // captured old screen position to the new one. Runs pre-paint so the invert holds the cards at their
  // old positions before the release transition; unmatched (newly-visible) cards simply appear.
  useLayoutEffect(() => {
    const from = flipFromRef.current;
    if (!from) return;
    flipFromRef.current = null;
    const el = scrollViewportRef.current;
    if (!el) return;

    const moved: HTMLElement[] = [];
    el.querySelectorAll<HTMLElement>("[data-flip-id]").forEach((node) => {
      const id = node.dataset.flipId;
      if (!id) return;
      const start = from.get(id);
      if (!start) return;
      const rect = node.getBoundingClientRect();
      const dx = start.x - rect.left;
      const dy = start.y - rect.top;
      if (Math.abs(dx) < 1 && Math.abs(dy) < 1) return;
      node.style.transition = "none";
      node.style.transform = `translate(${dx}px, ${dy}px)`;
      // Promote to its own compositor layer so the slide is GPU-composited (no per-frame main-thread
      // repaint of the card's image/text). Cleared after the animation to release the layer.
      node.style.willChange = "transform";
      moved.push(node);
    });

    if (moved.length === 0) return;

    // Flush the inverted transforms as the transition's "from" value. Without this forced reflow the
    // browser collapses invert→release into a single paint (esp. since React commits + this layout
    // effect run in the same frame as a plain rAF) and nothing animates.
    void el.getBoundingClientRect();

    for (const node of moved) {
      node.style.transition = ASSET_FLIP_TRANSITION;
      node.style.transform = "translate(0px, 0px)";
    }

    const clear = setTimeout(() => {
      for (const node of moved) {
        node.style.transition = "";
        node.style.transform = "";
        node.style.willChange = "";
      }
    }, ASSET_FLIP_DURATION_MS + 80);

    return () => clearTimeout(clear);
  }, [columnCount]);

  // Reset scroll to the top when the active query (filters/sidebar) changes — skip initial mount.
  useEffect(() => {
    if (firstResetRef.current) {
      firstResetRef.current = false;
      return;
    }
    const el = scrollViewportRef.current;
    if (el) {
      el.scrollTop = 0;
    }
    emitAssetProfile("board.resetScroll", {
      queryResetKeyLength: queryResetKey.length,
      indexItems: indexItems.length,
      hydrated: hydratedAssetsById.size,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [queryResetKey]);

  return (
    <>
      <ScrollArea
        type="hover"
        scrollHideDelay={260}
        className="min-h-0 flex-1"
        viewportRef={scrollViewportRef}
        viewportClassName="px-6"
        scrollbarClassName="w-2 border-l-0 bg-transparent p-[2px] opacity-0 transition-opacity duration-150 data-[state=visible]:opacity-100 hover:opacity-100"
        thumbClassName="bg-zinc-400/35 hover:bg-zinc-500/45"
      >
        {loading ? (
          <div className="grid h-56 place-items-center text-sm text-zinc-400">
            {t("assets.loadingVault")}
          </div>
        ) : indexItems.length ? (
          <AssetMasonryColumns
            scrollViewportRef={scrollViewportRef}
            columnCount={columnCount}
            indexItems={indexItems}
            hydratedAssetsById={hydratedAssetsById}
            onHydrateAssets={onHydrateAssets}
            virtualizerRef={virtualizerRef}
            reflowing={reflowing}
            onOpenContextMenu={setContextMenu}
          />
        ) : (
          <div className="grid h-72 place-items-center">
            <div className="text-center">
              <FolderKanban className="mx-auto text-zinc-300" size={36} />
              <h2 className="mt-3 text-sm font-semibold text-zinc-800">
                {vaultAvailable ? t("assets.noMatch") : t("assets.pickFolder")}
              </h2>
              <p className="mt-1 text-xs text-zinc-500">
                {vaultAvailable ? t("assets.tryAdjustFilters") : t("assets.filesStay")}
              </p>
            </div>
          </div>
        )}
      </ScrollArea>
      {contextMenu ? <AssetCardContextMenu state={contextMenu} onClose={closeContextMenu} /> : null}
    </>
  );
}

function AssetBoard({
  indexItems,
  hydratedAssetsById,
  tagOptions,
  sourceOptions,
  resultCount,
  totalCount,
  vaultAvailable,
  terminalAvailable,
  terminalOpen,
  loading,
  errorMessage,
  hydrationErrorMessage,
  onToggleTerminal,
  onHydrateAssets,
  onSaveView,
  dragEnabled = true,
  queryResetKey,
  activeViewName,
  activeViewIcon,
}: {
  indexItems: AssetLayoutIndexItem[];
  hydratedAssetsById: ReadonlyMap<string, Asset>;
  tagOptions: SidebarTag[];
  sourceOptions: string[];
  resultCount: number;
  totalCount: number;
  vaultAvailable: boolean;
  terminalAvailable: boolean;
  terminalOpen: boolean;
  loading: boolean;
  errorMessage?: string;
  hydrationErrorMessage?: string;
  onToggleTerminal: () => void;
  onHydrateAssets: (assetIds: readonly string[]) => void;
  onSaveView: (filters: AssetFilterState) => void;
  dragEnabled?: boolean;
  queryResetKey: string;
  activeViewName?: string;
  activeViewIcon?: string | null;
}) {
  const [filters, setFilters] = useAtom(assetFiltersAtom);
  const setActiveSidebarItem = useSetAtom(activeSidebarItemAtom);
  const [filterOpen, setFilterOpen] = useState(readAssetFilterOpenFromStorage);
  const activeFilterCount = getActiveFilterCount(filters);

  // Clearing filters must also drop the sidebar selection. The displayed list is derived from BOTH
  // the filter atom and `activeSidebarItem` (buildAssetListInput falls back to the selection's tag
  // ids when no filter tags are set), so resetting filters alone would hide the chips while the query
  // stays scoped to the still-active view/tag.
  const clearAllFilters = useCallback(() => {
    setFilters((current) => getEmptyAssetFilters(current.match));
    setActiveSidebarItem({ kind: "mgmt", id: "all" });
  }, [setFilters, setActiveSidebarItem]);

  useEffect(() => {
    writeAssetFilterOpenToStorage(filterOpen);
  }, [filterOpen]);

  useEffect(() => {
    if (
      typeof PerformanceObserver === "undefined" ||
      !PerformanceObserver.supportedEntryTypes.includes("longtask")
    ) {
      return;
    }

    const observer = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        emitAssetProfile("browser.longtask", {
          durationMs: roundProfileNumber(entry.duration),
          startTimeMs: roundProfileNumber(entry.startTime),
          name: entry.name,
        });
      }
    });

    try {
      observer.observe({ entryTypes: ["longtask"] });
    } catch {
      return;
    }

    return () => observer.disconnect();
  }, []);

  return (
    <>
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
              onClearFilters={clearAllFilters}
              tagOptions={tagOptions}
              sourceOptions={sourceOptions}
              resultCount={resultCount}
              onSaveView={() => onSaveView(filters)}
            />
          </AccordionItem>
        </AccordionRoot>
        <AssetActiveFilterSummary
          filters={filters}
          onFiltersChange={setFilters}
          onClearFilters={clearAllFilters}
          resultCount={resultCount}
          totalCount={totalCount}
          activeViewName={activeViewName}
          activeViewIcon={activeViewIcon}
        />
        {errorMessage ? (
          <div className="shrink-0 border-b border-red-100 bg-red-50 px-6 py-2 text-xs text-red-700">
            {errorMessage}
          </div>
        ) : null}
        {hydrationErrorMessage ? (
          <div className="shrink-0 border-b border-amber-100 bg-amber-50 px-6 py-2 text-xs text-amber-700">
            {hydrationErrorMessage}
          </div>
        ) : null}
        <AssetMasonryGrid
          indexItems={indexItems}
          hydratedAssetsById={hydratedAssetsById}
          loading={loading}
          vaultAvailable={vaultAvailable}
          onHydrateAssets={onHydrateAssets}
          queryResetKey={queryResetKey}
        />
      </main>
    </>
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
  const { t } = useTranslation();
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
      fontFamily:
        '"JetBrains Mono", "SF Mono", "SFMono-Regular", Menlo, Monaco, Consolas, monospace',
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

      void window.api.terminal
        .resize({
          sessionId,
          cols: terminal.cols,
          rows: terminal.rows,
        })
        .catch(() => undefined);
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
        writeTerminalSystemMessage(
          terminal,
          getTerminalErrorMessage(error, "Terminal write failed"),
        );
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
      ]
        .filter(Boolean)
        .join(", ");
      writeTerminalSystemMessage(
        terminal,
        details ? `Process exited (${details})` : "Process exited",
      );
    });

    const startFrame = window.requestAnimationFrame(() => {
      try {
        fitAddon.fit();
      } catch {
        // The host can briefly report zero size while the side panel is mounting.
      }

      void window.api.terminal
        .start({ cols: terminal.cols, rows: terminal.rows })
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
      <div
        className={`${dragClassName} flex h-14 shrink-0 items-center gap-2 border-b border-zinc-100 px-3`}
      >
        <SquareTerminal size={14} className="shrink-0 text-zinc-500" />
        <div className="min-w-0 flex-1">
          <div className="truncate text-[13px] font-semibold text-zinc-900">
            {t("assets.terminal")}
          </div>
        </div>
        <div className="window-no-drag flex items-center gap-1">
          <button
            type="button"
            className="grid h-6 w-6 place-items-center rounded-md text-zinc-400 transition-colors hover:bg-zinc-100 hover:text-zinc-700"
            title={t("assets.hideTerminal")}
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
                  background:
                    i === 6
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
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(true);
  const entries = Object.entries(data);
  if (entries.length === 0) return null;

  return (
    <AccordionRoot
      hideSeparator
      expandedKeys={expanded ? ["frontmatter"] : []}
      onExpandedChange={(keys) => setExpanded(keys.has("frontmatter"))}
      className="user-select-text mb-8 overflow-hidden rounded-xl border border-zinc-200 text-[13px]"
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
          <span className="font-medium text-zinc-600">{t("assets.properties")}</span>
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

function MarkdownDetailBody({ asset }: { asset: Asset }) {
  const { t } = useTranslation();
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
        {t("assets.markdownReadFailed", { message: markdownQuery.error.message })}
      </div>
    );
  }

  if (!rawContent.trim()) {
    return (
      <div className="max-w-[760px] rounded-[12px] border border-zinc-100 bg-zinc-50 px-4 py-3 text-[13px] text-zinc-500">
        {t("assets.markdownEmpty")}
      </div>
    );
  }

  const hasFrontmatter = Object.keys(parsed.data).length > 0;
  const bodyContent = parsed.content
    .replace(/(?:&lt;|<)!--\s*post:generated:(?:start|end)\s*--(?:&gt;|>)/g, "")
    .trim();

  return (
    <div className="max-w-[760px]">
      {hasFrontmatter && <FrontmatterPanel data={parsed.data} />}
      {bodyContent ? (
        <article className="user-select-text text-[15px] leading-[1.78] text-zinc-800 [&_a]:font-medium [&_a]:text-blue-600 [&_a:hover]:text-blue-700 [&_blockquote]:my-5 [&_blockquote]:border-l-2 [&_blockquote]:border-zinc-200 [&_blockquote]:pl-4 [&_blockquote]:text-zinc-600 [&_code]:rounded [&_code]:bg-zinc-100 [&_code]:px-1 [&_code]:py-0.5 [&_code]:font-mono [&_code]:text-[0.88em] [&_h1]:mb-5 [&_h1]:mt-0 [&_h1]:text-[28px] [&_h1]:font-bold [&_h1]:leading-tight [&_h1]:text-zinc-950 [&_h2]:mb-3 [&_h2]:mt-8 [&_h2]:text-[22px] [&_h2]:font-bold [&_h2]:leading-tight [&_h2]:text-zinc-950 [&_h3]:mb-2.5 [&_h3]:mt-6 [&_h3]:text-[18px] [&_h3]:font-semibold [&_h3]:text-zinc-950 [&_hr]:my-8 [&_hr]:border-zinc-200 [&_li]:my-1 [&_ol]:my-4 [&_ol]:list-decimal [&_ol]:pl-6 [&_p]:my-4 [&_pre]:my-5 [&_pre]:overflow-x-auto [&_pre]:rounded-[10px] [&_pre]:bg-zinc-950 [&_pre]:p-4 [&_pre_code]:bg-transparent [&_pre_code]:p-0 [&_pre_code]:text-[13px] [&_pre_code]:text-zinc-100 [&_strong]:font-semibold [&_strong]:text-zinc-950 [&_table]:my-5 [&_table]:w-full [&_table]:border-collapse [&_td]:border [&_td]:border-zinc-200 [&_td]:px-3 [&_td]:py-2 [&_th]:border [&_th]:border-zinc-200 [&_th]:bg-zinc-50 [&_th]:px-3 [&_th]:py-2 [&_th]:text-left [&_ul]:my-4 [&_ul]:list-disc [&_ul]:pl-6">
          <ReactMarkdown
            remarkPlugins={[remarkGfm]}
            components={{
              p({ children }) {
                const items = React.Children.toArray(children);
                const onlyChild = items.length === 1 ? items[0] : undefined;
                const videoHref =
                  React.isValidElement<{ href?: string }>(onlyChild) &&
                  getLocalVideoExtension(onlyChild.props.href)
                    ? onlyChild.props.href
                    : undefined;

                return videoHref ? <>{children}</> : <p>{children}</p>;
              },
              img({ src, alt }) {
                const resolved = resolveMarkdownAssetUrl(
                  src,
                  markdownQuery.data!.vaultId,
                  markdownQuery.data!.fileDir,
                );
                return (
                  <img
                    src={resolved}
                    alt={alt ?? ""}
                    className="my-5 block max-h-[640px] w-full rounded-lg bg-zinc-50 object-contain"
                  />
                );
              },
              a({ href, children }) {
                const extension = getLocalVideoExtension(href);
                if (href && extension) {
                  const resolved = resolveMarkdownAssetUrl(
                    href,
                    markdownQuery.data!.vaultId,
                    markdownQuery.data!.fileDir,
                  );
                  return (
                    <div className="my-5 overflow-hidden rounded-lg border border-zinc-200 bg-black shadow-sm">
                      <LocalVideoPlayer
                        src={resolved}
                        title={typeof children === "string" ? children : "Post video"}
                        mimeType={getVideoMimeType(extension)}
                      />
                    </div>
                  );
                }

                return <a href={href}>{children}</a>;
              },
            }}
          >
            {bodyContent}
          </ReactMarkdown>
        </article>
      ) : hasFrontmatter ? null : (
        <div className="rounded-[12px] border border-zinc-100 bg-zinc-50 px-4 py-3 text-[13px] text-zinc-500">
          {t("assets.markdownEmpty")}
        </div>
      )}
    </div>
  );
}

function ImageDetailBody({ asset }: { asset: Asset }) {
  const { t } = useTranslation();
  const dims =
    asset.imageWidth && asset.imageHeight
      ? `${asset.imageWidth} × ${asset.imageHeight}`
      : undefined;
  const ext = (asset.fileExt ?? "").toUpperCase() || "IMG";
  const metaList: [string, string][] = [
    [t("assets.fieldSource"), asset.source.split(" / ")[0] ?? "—"],
    ...(dims ? ([[t("assets.fieldSize"), dims]] as [string, string][]) : []),
    [t("assets.fieldFormat"), ext],
    [t("assets.fieldCaptured"), asset.time],
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

function getVideoMimeType(extension: string | undefined) {
  const normalized = extension?.toLowerCase();
  if (!normalized) {
    return "video/mp4";
  }

  const mimeByExtension: Record<string, string> = {
    mp4: "video/mp4",
    m4v: "video/mp4",
    mov: "video/quicktime",
    webm: "video/webm",
    ogv: "video/ogg",
    mkv: "video/x-matroska",
    avi: "video/x-msvideo",
  };

  return mimeByExtension[normalized] ?? `video/${normalized}`;
}

function getLocalVideoExtension(href: string | undefined) {
  if (!href || /^(?:https?:|mailto:)/i.test(href)) {
    return undefined;
  }

  const extension = href.split(/[?#]/)[0]?.split(".").pop()?.toLowerCase();
  return extension && ["mp4", "m4v", "mov", "webm", "ogv", "mkv", "avi"].includes(extension)
    ? extension
    : undefined;
}

function getAssetMediaRatio(asset: Asset) {
  const width = asset.imageWidth ?? asset.thumbnailWidth;
  const height = asset.imageHeight ?? asset.thumbnailHeight;
  if (!width || !height || width <= 0 || height <= 0) {
    return undefined;
  }

  return {
    css: `${width} / ${height}`,
    plyr: `${width}:${height}`,
  };
}

const LOCAL_VIDEO_PLAYER_CONTROLS: PlyrOptions["controls"] = [
  "play-large",
  "play",
  "progress",
  "current-time",
  "mute",
  "volume",
  "settings",
  "pip",
  "airplay",
  "fullscreen",
];

function LocalVideoPlayer({
  src,
  title,
  mimeType,
  poster,
  ratio,
}: {
  src: string;
  title: string;
  mimeType: string;
  poster?: string;
  ratio?: string;
}) {
  const source = useMemo<PlyrSource>(
    () => ({
      type: "video",
      title,
      sources: [{ src, type: mimeType }],
      ...(poster ? { poster } : {}),
    }),
    [mimeType, poster, src, title],
  );
  const options = useMemo<PlyrOptions>(
    () => ({
      ...(ratio ? { ratio } : {}),
      controls: LOCAL_VIDEO_PLAYER_CONTROLS,
    }),
    [ratio],
  );

  return <Plyr source={source} options={options} />;
}

function VideoDetailBody({ asset }: { asset: Asset }) {
  const mediaRatio = useMemo(
    () => getAssetMediaRatio(asset),
    [asset.imageHeight, asset.imageWidth, asset.thumbnailHeight, asset.thumbnailWidth],
  );
  return (
    <div className="max-w-[780px]">
      <div
        className="overflow-hidden rounded-[13px] border border-zinc-200 bg-black shadow-sm"
        style={mediaRatio ? { aspectRatio: mediaRatio.css } : undefined}
      >
        {asset.mediaUrl ? (
          <LocalVideoPlayer
            src={asset.mediaUrl}
            title={asset.title}
            mimeType={getVideoMimeType(asset.fileExt)}
            poster={asset.thumbnailUrl}
            ratio={mediaRatio?.plyr}
          />
        ) : (
          <VisualBlock asset={asset} />
        )}
      </div>
    </div>
  );
}

function LinkDetailBody({ asset, onOpen }: { asset: Asset; onOpen: () => void }) {
  const { t } = useTranslation();
  const metaList: [string, string][] = [
    ...(asset.domain ? ([[t("assets.fieldDomain"), asset.domain]] as [string, string][]) : []),
    [t("assets.fieldSnapshot"), t("assets.fieldSnapshotValue")],
    [t("assets.fieldCaptured"), asset.time],
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
            <button
              type="button"
              className="shrink-0 text-[11.5px] font-semibold text-blue-600"
              onClick={onOpen}
            >
              {t("assets.openExternal")}
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
          {t("assets.openOriginal")}
        </button>
        <div className="mt-5">
          <span className="mb-2.5 block text-[10.5px] font-semibold uppercase tracking-[.06em] text-zinc-400">
            {t("assets.webInfo")}
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
  const { t } = useTranslation();
  const [fmt, ...rest] = asset.meta.split(" · ");
  const metaList: [string, string][] = [
    [t("assets.fieldFormat"), fmt ?? "—"],
    [t("assets.fieldFileSize"), rest.join(" · ") || "—"],
    [
      t("assets.fieldLocation"),
      asset.sourceType === "vault"
        ? t("assets.fieldLocationVault")
        : t("assets.fieldLocationExternal"),
    ],
    [t("assets.fieldModified"), asset.time],
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
          {t("assets.openDefault")}
        </button>
        <button
          type="button"
          className="mt-2 flex w-full items-center justify-center rounded-[10px] border border-zinc-200 bg-white px-4 py-[10px] text-[13px] text-zinc-900"
          onClick={onShowInFinder}
        >
          {t("assets.showInFinder")}
        </button>
        {asset.body ? (
          <p className="mt-3.5 rounded-[11px] border border-zinc-100 bg-zinc-50 px-4 py-3.5 text-[13.5px] leading-[1.7] text-zinc-700">
            {asset.body}
          </p>
        ) : null}
        <div className="mt-5">
          <span className="mb-2.5 block text-[10.5px] font-semibold uppercase tracking-[.06em] text-zinc-400">
            {t("assets.fileInfo")}
          </span>
          <DetailSideMetaList list={metaList} />
        </div>
      </div>
    </div>
  );
}

function AssetDetail({
  asset,
  vaultTags,
  dragEnabled = true,
  terminalAvailable,
  terminalOpen,
  onToggleTerminal,
}: {
  asset: Asset;
  vaultTags: readonly SidebarTag[];
  dragEnabled?: boolean;
  terminalAvailable: boolean;
  terminalOpen: boolean;
  onToggleTerminal: () => void;
}) {
  const { t } = useTranslation();
  const { label } = getKindMeta(asset.kind);
  const headerRef = useToolbarClearance();
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
  const shouldOpenFileInEditor =
    asset.kind === "markdown" || asset.kind === "post" || asset.kind === "file";
  const canOpenInDefaultMediaApp = asset.kind === "image" || asset.kind === "video";
  const DefaultMediaOpenIcon = asset.kind === "image" ? ImageIcon : Play;

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
      <div
        ref={headerRef}
        className={`${dragClassName} relative z-[75] flex h-10 shrink-0 items-center gap-2 border-b border-zinc-100 bg-white px-6`}
      >
        <span className="text-xs text-zinc-400">{t("assets.breadcrumb", { tag: asset.tag })}</span>
        <div className="flex-1" />
        <div className="window-no-drag flex items-center gap-2">
          {canOpenInDefaultMediaApp ? (
            <Button
              size="sm"
              isIconOnly
              aria-label={
                asset.kind === "image"
                  ? t("assets.openInSystemImage")
                  : t("assets.openInSystemVideo")
              }
              isDisabled={openFileMutation.isPending}
              className="window-no-drag h-6 min-h-0 rounded-lg border border-zinc-200 bg-white px-2 text-[11px] text-zinc-600 hover:bg-zinc-50"
              onPress={() => openFileMutation.mutate({ id: asset.id })}
            >
              <DefaultMediaOpenIcon className={HEADER_ICON_CLASS_NAME} />
            </Button>
          ) : null}
          {/* Editor split button — same as board header */}
          <div className="inline-flex h-6 overflow-hidden rounded-lg border border-zinc-200 bg-white text-zinc-600 shadow-[0_1px_1px_rgba(24,24,27,0.03)]">
            <button
              type="button"
              className="inline-grid h-6 w-7 place-items-center border-r border-zinc-200 transition-colors hover:bg-zinc-50 disabled:pointer-events-none disabled:opacity-45"
              aria-label={t("assets.openVaultWith", { label: preferredOpenTarget.label })}
              disabled={openVaultLocationMutation.isPending}
              onClick={() => openVaultWithTarget(preferredOpenTarget.id, false)}
            >
              <PreferredOpenIcon aria-hidden="true" className={HEADER_ICON_CLASS_NAME} />
            </button>
            <Dropdown isOpen={openWithMenuOpen} onOpenChange={setOpenWithMenuOpen}>
              <Dropdown.Trigger
                className="inline-grid h-6 w-6 place-items-center outline-none transition-colors hover:bg-zinc-50"
                aria-label={t("assets.chooseOpenMethod")}
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
                  aria-label={t("assets.openVault")}
                  className="min-w-36 p-0 outline-none"
                  disabledKeys={
                    openVaultLocationMutation.isPending ? OPEN_VAULT_TARGETS.map((t) => t.id) : []
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
                        className="flex h-7 cursor-default items-center gap-2 rounded-lg px-2 text-[12.5px] font-medium text-zinc-700 outline-none transition-colors data-[focused]:bg-zinc-100 data-[hovered]:bg-zinc-100 data-[disabled]:opacity-45"
                      >
                        <Icon
                          aria-hidden="true"
                          className={`${HEADER_ICON_CLASS_NAME} text-zinc-500`}
                        />
                        <Label className="cursor-default text-[12.5px] font-medium text-inherit">
                          {target.label}
                        </Label>
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
            aria-label={t("assets.copyPath")}
            className="window-no-drag h-6 min-h-0 rounded-lg border border-zinc-200 bg-white px-2 text-[11px] text-zinc-600 hover:bg-zinc-50"
            onPress={() => {
              copyAssetPathMutation.mutate(
                { id: asset.id },
                {
                  onSuccess: () => {
                    toast.success(t("assets.pathCopied"));
                    setPathCopied(true);
                    setTimeout(() => setPathCopied(false), 2000);
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
          {SHOW_TERMINAL_TOGGLE ? (
            <Button
              size="sm"
              isIconOnly
              isDisabled={!terminalAvailable}
              aria-label={
                terminalAvailable ? t("assets.openTerminal") : t("assets.terminalUnsupported")
              }
              className={`window-no-drag h-6 min-h-0 rounded-lg border px-2 text-[11px] ${
                terminalOpen
                  ? "border-zinc-300 bg-zinc-100 text-zinc-900"
                  : "border-zinc-200 bg-white text-zinc-600 hover:bg-zinc-50"
              }`}
              onPress={onToggleTerminal}
            >
              <PanelRightOpen className={HEADER_ICON_CLASS_NAME} />
            </Button>
          ) : null}
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
          <span className="text-zinc-400">{t("assets.readonlyPreview")}</span>
        </div>
        {/* tags row */}
        <AssetDetailTags asset={asset} vaultTags={vaultTags} />
      </div>

      {/* ── Body ── */}
      <ScrollArea className="min-h-0 flex-1" viewportClassName="px-10 py-7">
        {(asset.kind === "markdown" || asset.kind === "post") && (
          <MarkdownDetailBody asset={asset} />
        )}
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

export function AssetManagerPage() {
  const { t } = useTranslation();
  const search = useSearch({ from: "/_app/" });
  const assetId =
    typeof search.asset === "string" && search.asset.length > 0 ? search.asset : undefined;
  const filters = useAtomValue(assetFiltersAtom);
  const activeSidebarItem = useAtomValue(activeSidebarItemAtom);
  const { backgroundWindowDragEnabled } = useAppLayout();
  const [viewModalFilters, setViewModalFilters] = useState<AssetFilterState | null>(null);

  const sidebarQuery = useQuery({
    ...trpc.assets.sidebarMeta.queryOptions(),
    refetchOnWindowFocus: false,
    staleTime: 30_000,
  });

  // Report the current live filter (canonical, id-based) to main so the CLI `filter get` can read
  // it back. Debounced so rapid hand edits don't spam the mutation.
  useEffect(() => {
    const tagOptions = sidebarQuery.data?.tags ?? [];
    const timer = window.setTimeout(() => {
      void trpcClient.events.reportFilterState.mutate({
        filters: assetFiltersToSavedViewFilters(filters, tagOptions),
        sort: filters.sort,
        activeItem: activeSidebarItem,
      });
    }, 200);
    return () => window.clearTimeout(timer);
  }, [filters, activeSidebarItem, sidebarQuery.data?.tags]);

  const listQueryInput = useMemo(
    () =>
      buildAssetListInput({
        activeSidebarItem,
        filters,
        tagOptions: sidebarQuery.data?.tags ?? [],
        viewOptions: sidebarQuery.data?.views ?? [],
        vaultId: sidebarQuery.data?.vault?.id,
      }),
    [
      activeSidebarItem,
      filters,
      sidebarQuery.data?.tags,
      sidebarQuery.data?.vault?.id,
      sidebarQuery.data?.views,
    ],
  );
  const listQueryResetKey = useMemo(() => JSON.stringify(listQueryInput), [listQueryInput]);
  // Soft detail keeps the board mounted under the overlay — list queries stay enabled so scroll
  // and hydrate state are warm when the user closes detail.
  const layoutIndexQuery = useQuery({
    ...trpc.assets.layoutIndex.queryOptions(listQueryInput),
    staleTime: 30_000,
    // Switching views/tags swaps the query key. Keep the previous result on screen while the next
    // one loads so the masonry grid doesn't flash blank (white) during the brief fetch gap.
    placeholderData: keepPreviousData,
  });
  const layoutIndexItems = layoutIndexQuery.data?.items ?? EMPTY_ASSET_LAYOUT_INDEX;
  const resultCount = layoutIndexQuery.data?.total ?? 0;
  const [hydratedAssetsById, setHydratedAssetsById] = useState<Map<string, Asset>>(() => new Map());
  const hydratedAssetsRef = useRef(hydratedAssetsById);
  const pendingHydrateIdsRef = useRef(new Set<string>());
  const hydrateBusyRef = useRef(false);
  const layoutFetchStartRef = useRef<number | null>(null);
  const hydrateFetchStartRef = useRef<number | null>(null);
  const hydrateSequenceRef = useRef(0);
  const lastHydrateSkipProfileAtRef = useRef(0);
  const lastHydrateRequestKeyRef = useRef("");
  const [hydrateRequestIds, setHydrateRequestIds] = useState<string[]>([]);
  const hydrateQuery = useQuery({
    ...trpc.assets.hydrate.queryOptions({ ids: hydrateRequestIds }),
    enabled: hydrateRequestIds.length > 0,
    staleTime: 5 * 60_000,
  });
  const requestAssetHydration = useCallback((assetIds: readonly string[]) => {
    if (hydrateBusyRef.current) {
      const now = performance.now();
      if (now - lastHydrateSkipProfileAtRef.current >= ASSET_PROFILE_SKIP_INTERVAL_MS) {
        lastHydrateSkipProfileAtRef.current = now;
        emitAssetProfile("hydrate.skipBusy", {
          candidates: assetIds.length,
          hydrated: hydratedAssetsRef.current.size,
          pending: pendingHydrateIdsRef.current.size,
        });
      }
      return;
    }

    const uniqueIds = Array.from(new Set(assetIds));
    const missingIds = uniqueIds
      .filter((id) => !hydratedAssetsRef.current.has(id) && !pendingHydrateIdsRef.current.has(id))
      .slice(0, ASSET_HYDRATE_BATCH_SIZE);

    if (missingIds.length > 0) {
      const key = missingIds.join("\0");
      if (key === lastHydrateRequestKeyRef.current) {
        const now = performance.now();
        if (now - lastHydrateSkipProfileAtRef.current >= ASSET_PROFILE_SKIP_INTERVAL_MS) {
          lastHydrateSkipProfileAtRef.current = now;
          emitAssetProfile("hydrate.skipDuplicate", {
            candidates: assetIds.length,
            unique: uniqueIds.length,
            batch: missingIds.length,
          });
        }
        return;
      }

      for (const id of missingIds) {
        pendingHydrateIdsRef.current.add(id);
      }
      hydrateSequenceRef.current += 1;
      hydrateFetchStartRef.current = performance.now();
      lastHydrateRequestKeyRef.current = key;
      emitAssetProfile("hydrate.request", {
        sequence: hydrateSequenceRef.current,
        candidates: assetIds.length,
        unique: uniqueIds.length,
        batch: missingIds.length,
        hydrated: hydratedAssetsRef.current.size,
        pending: pendingHydrateIdsRef.current.size,
      });
      setHydrateRequestIds(missingIds);
    }
  }, []);
  const activeAssetFromList = assetId ? hydratedAssetsById.get(assetId) : undefined;
  const detailQuery = useQuery({
    ...trpc.assets.byId.queryOptions({ id: assetId ?? MISSING_TAG_ID }),
    enabled: Boolean(assetId),
  });
  const activeAsset = assetId
    ? detailQuery.data
      ? mapIndexedAsset(detailQuery.data)
      : activeAssetFromList
    : undefined;

  useEffect(() => {
    if (layoutIndexQuery.fetchStatus !== "fetching") {
      return;
    }

    layoutFetchStartRef.current = performance.now();
    emitAssetProfile("layout.fetchStart", {
      queryResetKeyLength: listQueryResetKey.length,
    });
  }, [layoutIndexQuery.fetchStatus, listQueryResetKey]);

  useEffect(() => {
    if (!layoutIndexQuery.data) {
      return;
    }

    const durationMs =
      layoutFetchStartRef.current === null
        ? undefined
        : roundProfileNumber(performance.now() - layoutFetchStartRef.current);
    layoutFetchStartRef.current = null;
    emitAssetProfile("layout.fetchSuccess", {
      durationMs,
      items: layoutIndexQuery.data.items.length,
      total: layoutIndexQuery.data.total,
      queryResetKeyLength: listQueryResetKey.length,
    });
  }, [layoutIndexQuery.data, listQueryResetKey]);

  useEffect(() => {
    if (!layoutIndexQuery.isError) {
      return;
    }

    const durationMs =
      layoutFetchStartRef.current === null
        ? undefined
        : roundProfileNumber(performance.now() - layoutFetchStartRef.current);
    layoutFetchStartRef.current = null;
    emitAssetProfile("layout.fetchError", {
      durationMs,
      message: layoutIndexQuery.error.message,
    });
  }, [layoutIndexQuery.error, layoutIndexQuery.isError]);

  useEffect(() => {
    const emptyAssets = new Map<string, Asset>();
    hydratedAssetsRef.current = emptyAssets;
    pendingHydrateIdsRef.current = new Set();
    lastHydrateRequestKeyRef.current = "";
    hydrateFetchStartRef.current = null;
    emitAssetProfile("hydrate.reset", {
      queryResetKeyLength: listQueryResetKey.length,
    });
    setHydratedAssetsById(emptyAssets);
    setHydrateRequestIds([]);
  }, [listQueryResetKey]);

  useEffect(() => {
    hydrateBusyRef.current = hydrateQuery.isFetching;
  }, [hydrateQuery.isFetching]);

  useEffect(() => {
    if (layoutIndexItems.length === 0) {
      return;
    }

    requestAssetHydration(
      layoutIndexItems.slice(0, ASSET_HYDRATE_BATCH_SIZE).map((item) => item.id),
    );
  }, [layoutIndexItems, requestAssetHydration]);

  useEffect(() => {
    if (!hydrateQuery.data) {
      return;
    }

    const nextAssets = new Map(hydratedAssetsRef.current);
    for (const asset of hydrateQuery.data.items) {
      nextAssets.set(asset.id, mapIndexedAsset(asset));
    }
    for (const id of hydrateRequestIds) {
      pendingHydrateIdsRef.current.delete(id);
    }
    lastHydrateRequestKeyRef.current = "";
    hydratedAssetsRef.current = nextAssets;
    const durationMs =
      hydrateFetchStartRef.current === null
        ? undefined
        : roundProfileNumber(performance.now() - hydrateFetchStartRef.current);
    hydrateFetchStartRef.current = null;
    emitAssetProfile("hydrate.success", {
      sequence: hydrateSequenceRef.current,
      durationMs,
      requested: hydrateRequestIds.length,
      returned: hydrateQuery.data.items.length,
      hydratedTotal: nextAssets.size,
      pending: pendingHydrateIdsRef.current.size,
    });
    setHydratedAssetsById(nextAssets);
  }, [hydrateQuery.data, hydrateRequestIds]);

  useEffect(() => {
    if (!hydrateQuery.isError) {
      return;
    }

    for (const id of hydrateRequestIds) {
      pendingHydrateIdsRef.current.delete(id);
    }
    lastHydrateRequestKeyRef.current = "";
    const durationMs =
      hydrateFetchStartRef.current === null
        ? undefined
        : roundProfileNumber(performance.now() - hydrateFetchStartRef.current);
    hydrateFetchStartRef.current = null;
    emitAssetProfile("hydrate.error", {
      sequence: hydrateSequenceRef.current,
      durationMs,
      requested: hydrateRequestIds.length,
      message: hydrateQuery.error.message,
    });
  }, [hydrateQuery.error, hydrateQuery.isError, hydrateRequestIds]);

  const setWatcherScope = useMutation(trpc.watcher.setScope.mutationOptions());
  const auditWatcher = useMutation(trpc.watcher.audit.mutationOptions());
  const watcherScope = useMemo(() => {
    if (activeAsset) {
      return {
        key: `note:${activeAsset.id}:${activeAsset.source}`,
        input: {
          type: "note" as const,
          assetId: activeAsset.id,
        },
      };
    }

    if (sidebarQuery.data?.vault) {
      return {
        key: `vault:${sidebarQuery.data.vault.id}:${sidebarQuery.data.vault.rootPath}`,
        input: {
          type: "vault" as const,
          vaultId: sidebarQuery.data.vault.id,
        },
      };
    }

    return {
      key: "idle",
      input: {
        type: "idle" as const,
      },
    };
  }, [activeAsset, sidebarQuery.data?.vault]);
  const [terminalOpen, setTerminalOpen] = useState(false);
  const getSaveViewInitialFilters = useCallback(
    (currentFilters: AssetFilterState) => {
      if (getActiveFilterCount(currentFilters) > 0) {
        return currentFilters;
      }

      if (activeSidebarItem.kind === "tag") {
        const tagName = sidebarQuery.data?.tags.find(
          (tag) => tag.id === activeSidebarItem.id,
        )?.name;
        return tagName ? { ...currentFilters, tags: [tagName] } : currentFilters;
      }

      if (activeSidebarItem.kind === "view") {
        const view = sidebarQuery.data?.views.find((item) => item.id === activeSidebarItem.id);
        return view
          ? savedViewFiltersToAssetFilters(view.filters, sidebarQuery.data?.tags ?? [], view.sort)
          : currentFilters;
      }

      return currentFilters;
    },
    [activeSidebarItem, sidebarQuery.data?.tags, sidebarQuery.data?.views],
  );

  useEffect(() => {
    setWatcherScope.mutate(watcherScope.input);
  }, [watcherScope.key]);

  useEffect(() => {
    const handleFocus = () => {
      auditWatcher.mutate();
    };

    window.addEventListener("focus", handleFocus);
    return () => {
      window.removeEventListener("focus", handleFocus);
    };
  }, []);

  const vaultAvailable = Boolean(sidebarQuery.data?.vault);
  const terminalAvailable = vaultAvailable && isMacWindow();
  const boardErrorMessage =
    layoutIndexQuery.isError && layoutIndexItems.length === 0
      ? layoutIndexQuery.error.message
      : undefined;
  const hydrationErrorMessage =
    hydrateQuery.isError && layoutIndexItems.length > 0 ? hydrateQuery.error.message : undefined;

  const activeView =
    activeSidebarItem.kind === "view"
      ? sidebarQuery.data?.views.find((view) => view.id === activeSidebarItem.id)
      : undefined;
  const activeViewName = activeView?.name;
  const activeViewIcon = activeView?.icon;

  return (
    <>
      <ResizablePanelGroup
        id="asset-main-layout"
        direction="horizontal"
        className="panel-layout h-full min-h-0 overflow-hidden bg-transparent"
        resizeTargetMinimumSize={{ coarse: 32, fine: 12 }}
      >
        <ResizablePanel
          id="main"
          defaultSize={100}
          minSize={42}
          className="relative z-[60] h-full min-h-0"
        >
          {/* Board stays mounted under soft detail so scroll/virtualizer state survives Back. */}
          <div
            className={
              assetId
                ? "invisible pointer-events-none absolute inset-0 overflow-hidden"
                : "relative h-full min-h-0"
            }
            aria-hidden={Boolean(assetId)}
          >
            <AssetBoard
              indexItems={layoutIndexItems}
              hydratedAssetsById={hydratedAssetsById}
              tagOptions={sidebarQuery.data?.tags ?? []}
              sourceOptions={sidebarQuery.data?.sourceOptions ?? []}
              resultCount={resultCount}
              totalCount={sidebarQuery.data?.summary.total ?? resultCount}
              dragEnabled={backgroundWindowDragEnabled}
              vaultAvailable={vaultAvailable}
              terminalAvailable={terminalAvailable}
              terminalOpen={terminalOpen}
              onToggleTerminal={() => setTerminalOpen((open) => !open)}
              loading={layoutIndexQuery.isLoading && layoutIndexItems.length === 0}
              errorMessage={boardErrorMessage}
              hydrationErrorMessage={hydrationErrorMessage}
              onHydrateAssets={requestAssetHydration}
              onSaveView={(currentFilters) =>
                setViewModalFilters(getSaveViewInitialFilters(currentFilters))
              }
              queryResetKey={listQueryResetKey}
              activeViewName={activeViewName}
              activeViewIcon={activeViewIcon}
            />
          </div>
          {assetId ? (
            <div className="absolute inset-0 z-[70] bg-white">
              {activeAsset ? (
                <AssetDetail
                  asset={activeAsset}
                  vaultTags={sidebarQuery.data?.tags ?? []}
                  dragEnabled={backgroundWindowDragEnabled}
                  terminalAvailable={terminalAvailable}
                  terminalOpen={terminalOpen}
                  onToggleTerminal={() => setTerminalOpen((open) => !open)}
                />
              ) : (
                <main className="grid h-full place-items-center bg-white text-sm text-zinc-400">
                  {detailQuery.error ? detailQuery.error.message : t("assets.readingAsset")}
                </main>
              )}
            </div>
          ) : null}
        </ResizablePanel>

        {!assetId && terminalOpen ? (
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
      <ViewFormModal
        isOpen={viewModalFilters !== null}
        mode={{ kind: "create", initialFilters: viewModalFilters ?? filters }}
        vaultId={sidebarQuery.data?.vault?.id}
        tagOptions={sidebarQuery.data?.tags ?? []}
        sourceOptions={sidebarQuery.data?.sourceOptions ?? []}
        onOpenChange={(open) => {
          if (!open) setViewModalFilters(null);
        }}
      />
    </>
  );
}
