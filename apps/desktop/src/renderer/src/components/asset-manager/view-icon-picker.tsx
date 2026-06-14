/**
 * @purpose Support asset manager view icon picker behavior and data shaping.
 * @role    Reusable asset manager component shared by saved view forms and sidebar rendering.
 * @deps    Asset tRPC types, React/HeroUI where UI is present, local storage or URL helpers as needed.
 * @gotcha  Keep asset kind/status/tag/view contracts synchronized with packages/db schema and saved-view JSON.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { Input } from "@heroui/react";
import { FolderKanban, RotateCcw, Search, X } from "lucide-react";
import { DynamicIcon, iconNames, type IconName } from "lucide-react/dynamic";

import { ScrollArea } from "@/components/ui/scroll-area";

export const DEFAULT_VIEW_ICON = "lucide:folder-kanban";

const LUCIDE_ICON_PREFIX = "lucide:";
const ICON_VALUE_PATTERN = /^[a-z][\w-]*:/i;
const LUCIDE_ICON_NAMES = new Set<string>(iconNames);
const COMMON_VIEW_ICON_NAMES = [
  "folder-kanban",
  "bookmark",
  "star",
  "archive",
  "inbox",
  "image",
  "video",
  "link",
  "file-text",
  "layout-dashboard",
  "layout-grid",
  "list-filter",
  "tags",
  "sparkles",
  "lightbulb",
  "brain",
  "rocket",
  "globe",
  "book-open",
  "layers",
  "package",
  "camera",
  "palette",
  "settings",
  "zap",
] as const satisfies readonly IconName[];

const COMMON_VIEW_ICON_NAME_SET = new Set<string>(COMMON_VIEW_ICON_NAMES);
// Show the curated common icons first, then the full Lucide set behind them.
const ORDERED_VIEW_ICON_NAMES: IconName[] = [
  ...COMMON_VIEW_ICON_NAMES,
  ...iconNames.filter((name) => !COMMON_VIEW_ICON_NAME_SET.has(name)),
];

const ICON_GRID_COLUMNS = 6;
const ICON_CELL_HEIGHT = 48; // h-12
const ICON_ROW_GAP = 6; // gap-1.5
const ICON_ROW_HEIGHT = ICON_CELL_HEIGHT + ICON_ROW_GAP;
const ICON_VIEWPORT_HEIGHT = 224; // h-56
const ICON_ROW_OVERSCAN = 3;

function isLucideIconName(value: string): value is IconName {
  return LUCIDE_ICON_NAMES.has(value);
}

function parseLucideIconName(value: string | null | undefined) {
  const icon = value?.trim();
  if (!icon?.startsWith(LUCIDE_ICON_PREFIX)) return null;

  const name = icon.slice(LUCIDE_ICON_PREFIX.length);
  return isLucideIconName(name) ? name : null;
}

export function getIconLabel(value: string) {
  const lucideName = parseLucideIconName(value);
  if (lucideName) return lucideName;

  const trimmed = value.trim();
  if (ICON_VALUE_PATTERN.test(trimmed)) return "folder-kanban";
  return trimmed || "#";
}

function toViewIconValue(name: IconName) {
  return `${LUCIDE_ICON_PREFIX}${name}`;
}

type ViewIconRendererProps = {
  value?: string | null;
  size?: number;
  className?: string;
};

export function ViewIconRenderer({ value, size = 16, className }: ViewIconRendererProps) {
  const lucideName = parseLucideIconName(value);

  if (lucideName) {
    return (
      <DynamicIcon
        name={lucideName}
        size={size}
        className={className}
        fallback={() => <FolderKanban size={size} className={className} />}
      />
    );
  }

  const trimmed = value?.trim();
  if (trimmed && ICON_VALUE_PATTERN.test(trimmed)) {
    return <FolderKanban size={size} className={className} />;
  }

  if (trimmed) {
    return (
      <span
        aria-hidden="true"
        className={`inline-grid shrink-0 place-items-center font-semibold leading-none ${className ?? ""}`}
        style={{ width: size, height: size, fontSize: Math.max(11, size - 1) }}
      >
        {trimmed.slice(0, 2)}
      </span>
    );
  }

  return <FolderKanban size={size} className={className} />;
}

type ViewIconPickerProps = {
  value: string;
  onChange: (value: string) => void;
  isDisabled?: boolean;
};

export function ViewIconPicker({ value, onChange, isDisabled = false }: ViewIconPickerProps) {
  const [query, setQuery] = useState("");
  const [scrollTop, setScrollTop] = useState(0);
  const viewportRef = useRef<HTMLDivElement>(null);
  const currentLucideName = parseLucideIconName(value);
  const normalizedQuery = query.trim().toLowerCase();

  const visibleIconNames = useMemo<IconName[]>(() => {
    if (normalizedQuery) {
      return iconNames.filter((name) => name.includes(normalizedQuery));
    }

    return ORDERED_VIEW_ICON_NAMES;
  }, [normalizedQuery]);

  // Keep a live scrollTop so we can window the (very long) icon list.
  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;

    const handleScroll = () => setScrollTop(viewport.scrollTop);
    viewport.addEventListener("scroll", handleScroll, { passive: true });
    return () => viewport.removeEventListener("scroll", handleScroll);
  }, []);

  // Reset to the top whenever the result set changes (e.g. on search).
  useEffect(() => {
    setScrollTop(0);
    if (viewportRef.current) viewportRef.current.scrollTop = 0;
  }, [normalizedQuery]);

  const totalRows = Math.ceil(visibleIconNames.length / ICON_GRID_COLUMNS);
  const totalHeight = totalRows * ICON_ROW_HEIGHT;
  const startRow = Math.max(0, Math.floor(scrollTop / ICON_ROW_HEIGHT) - ICON_ROW_OVERSCAN);
  const endRow = Math.min(
    totalRows,
    Math.ceil((scrollTop + ICON_VIEWPORT_HEIGHT) / ICON_ROW_HEIGHT) + ICON_ROW_OVERSCAN,
  );
  const visibleRows: number[] = [];
  for (let row = startRow; row < endRow; row += 1) {
    visibleRows.push(row);
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <Search
            size={13}
            className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-zinc-400"
          />
          <Input.Root
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="搜索 Lucide icon"
            className="h-8 w-full rounded-lg border border-zinc-200 bg-white pl-8 pr-2 text-[12px] outline-none"
            disabled={isDisabled}
          />
        </div>
        <button
          type="button"
          className="grid h-8 w-8 shrink-0 cursor-pointer place-items-center rounded-lg text-zinc-400 transition-colors hover:bg-white hover:text-zinc-700 disabled:pointer-events-none disabled:opacity-35"
          disabled={isDisabled || value === DEFAULT_VIEW_ICON}
          aria-label="恢复默认 Icon"
          onClick={() => onChange(DEFAULT_VIEW_ICON)}
        >
          <RotateCcw size={13} />
        </button>
        <button
          type="button"
          className="grid h-8 w-8 shrink-0 cursor-pointer place-items-center rounded-lg text-zinc-400 transition-colors hover:bg-white hover:text-zinc-700 disabled:pointer-events-none disabled:opacity-35"
          disabled={isDisabled || value === "#"}
          aria-label="清除 Icon"
          onClick={() => onChange("#")}
        >
          <X size={13} />
        </button>
      </div>

      <div className="rounded-xl border border-zinc-200 bg-white p-2">
        <ScrollArea className="h-56 rounded-lg" viewportClassName="pr-2" viewportRef={viewportRef}>
          {visibleIconNames.length > 0 ? (
            <div className="relative" style={{ height: totalHeight }}>
              {visibleRows.map((row) => {
                const start = row * ICON_GRID_COLUMNS;
                const rowNames = visibleIconNames.slice(start, start + ICON_GRID_COLUMNS);
                return (
                  <div
                    key={row}
                    className="absolute inset-x-0 grid grid-cols-6 gap-1.5"
                    style={{ top: row * ICON_ROW_HEIGHT, height: ICON_CELL_HEIGHT }}
                  >
                    {rowNames.map((name) => {
                      const selected = currentLucideName === name;
                      return (
                        <button
                          key={name}
                          type="button"
                          className={`grid h-12 cursor-pointer place-items-center rounded-lg border text-zinc-500 transition-colors ${
                            selected
                              ? "border-[var(--accent)] bg-[var(--accent-soft)] text-[var(--accent)]"
                              : "border-zinc-100 hover:border-zinc-200 hover:bg-zinc-50 hover:text-zinc-800"
                          }`}
                          aria-label={`选择 ${name}`}
                          title={name}
                          onClick={() => onChange(toViewIconValue(name))}
                        >
                          <DynamicIcon name={name} size={17} />
                        </button>
                      );
                    })}
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="grid h-28 place-items-center text-[12px] text-zinc-400">
              没有匹配的 Icon
            </div>
          )}
        </ScrollArea>
      </div>
    </div>
  );
}
