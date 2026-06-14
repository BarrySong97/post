/**
 * @purpose Support asset manager asset filter controls behavior and data shaping.
 * @role    Reusable asset manager component shared by asset browsing and saved view forms.
 * @deps    Asset tRPC types, React/HeroUI where UI is present, local storage or URL helpers as needed.
 * @gotcha  Keep asset kind/status/tag/view contracts synchronized with packages/db schema and saved-view JSON.
 */

import type { ComponentType, Dispatch, ReactNode, SetStateAction } from "react";
import { AccordionBody, AccordionPanel, Button, Tag, TagGroup, Tabs } from "@heroui/react";
import { FileText, Image as ImageIcon, Link as LinkIcon, Plus, Video } from "lucide-react";

import {
  getEmptyAssetFilters,
  type AssetFilterMatch,
  type AssetFilterState,
  type AssetSortOrder,
  type AssetStatusFilter,
  type AssetTimeFilter,
  type AssetTypeFilter,
} from "@/store/asset-manager-atoms";
import { getTagHue } from "@/lib/asset-manager/asset-model";
import type { SidebarTag } from "@/lib/asset-manager/types";
import type { RouterInputs, RouterOutputs } from "@/lib/trpc";

export const ASSET_TYPE_FILTERS = [
  { value: "markdown", label: "文字", icon: FileText },
  { value: "image", label: "图片", icon: ImageIcon },
  { value: "video", label: "视频", icon: Video },
  { value: "link", label: "链接", icon: LinkIcon },
  { value: "file", label: "文件", icon: FileText },
] satisfies Array<{ value: AssetTypeFilter; label: string; icon: typeof FileText }>;

export const MATCH_FILTERS = [
  { value: "and", label: "全部条件" },
  { value: "or", label: "任意条件" },
] satisfies Array<{ value: AssetFilterMatch; label: string }>;

export const TIME_FILTERS = [
  { value: "any", label: "不限" },
  { value: "today", label: "今天" },
  { value: "week", label: "本周" },
  { value: "m30", label: "近 30 天" },
  { value: "custom", label: "自定义" },
] satisfies Array<{ value: AssetTimeFilter; label: string }>;

export const STATUS_FILTERS = [
  { value: "any", label: "不限" },
  { value: "inbox", label: "待整理" },
  { value: "draft", label: "草稿" },
  { value: "published", label: "已发布" },
] satisfies Array<{ value: AssetStatusFilter; label: string }>;

export const SORT_OPTIONS = [
  { value: "updated_desc", label: "更新时间 · 降序" },
  { value: "updated_asc", label: "更新时间 · 升序" },
  { value: "created_desc", label: "创建时间 · 降序" },
  { value: "created_asc", label: "创建时间 · 升序" },
] satisfies Array<{ value: AssetSortOrder; label: string }>;

export const TYPE_FILTER_LABELS = Object.fromEntries(
  ASSET_TYPE_FILTERS.map((item) => [item.value, item.label]),
) as Record<AssetTypeFilter, string>;
export const TIME_FILTER_LABELS = Object.fromEntries(
  TIME_FILTERS.map((item) => [item.value, item.label]),
) as Record<AssetTimeFilter, string>;
export const STATUS_FILTER_LABELS = Object.fromEntries(
  STATUS_FILTERS.map((item) => [item.value, item.label]),
) as Record<AssetStatusFilter, string>;
export const SORT_OPTION_LABELS = Object.fromEntries(
  SORT_OPTIONS.map((item) => [item.value, item.label]),
) as Record<AssetSortOrder, string>;

type AssetListInput = Extract<NonNullable<RouterInputs["assets"]["list"]>, Record<string, unknown>>;
type AssetSourceType = NonNullable<AssetListInput["sourceTypes"]>[number];
export type SavedViewFiltersInput = RouterInputs["assets"]["createSavedView"]["filters"];
export type SavedViewSortInput = RouterInputs["assets"]["createSavedView"]["sort"];
export type SavedViewFiltersOutput =
  RouterOutputs["assets"]["sidebarMeta"]["views"][number]["filters"];

export const SOURCE_LABEL_TO_TYPE = {
  资产库: "vault",
  本地文件: "external_file",
  链接: "url",
} satisfies Record<string, AssetSourceType>;

const SOURCE_TYPE_TO_LABEL = Object.fromEntries(
  Object.entries(SOURCE_LABEL_TO_TYPE).map(([label, sourceType]) => [sourceType, label]),
) as Record<AssetSourceType, string>;

type FilterSegmentProps<T extends string> = {
  options: Array<{ value: T; label: string }>;
  value: T;
  onChange: (value: T) => void;
};

export function sourceLabelsToTypes(sources: readonly string[]) {
  if (sources.length === 0) {
    return undefined;
  }

  return sources.map((source) => SOURCE_LABEL_TO_TYPE[source] ?? "external_file");
}

export function sourceTypesToLabels(sources: readonly AssetSourceType[]) {
  return sources.map((source) => SOURCE_TYPE_TO_LABEL[source] ?? source);
}

export function assetFiltersToSavedViewFilters(
  filters: AssetFilterState,
  tagOptions: readonly SidebarTag[],
): SavedViewFiltersInput {
  return {
    match: filters.match,
    tagIds: filters.tags
      .map((tagName) => tagOptions.find((tag) => tag.name === tagName)?.id)
      .filter((tagId): tagId is string => Boolean(tagId)),
    types: filters.types,
    sources: sourceLabelsToTypes(filters.sources) ?? [],
    time: filters.time === "custom" ? "any" : filters.time,
    status: filters.status,
  };
}

export function savedViewFiltersToAssetFilters(
  filters: SavedViewFiltersOutput,
  tagOptions: readonly SidebarTag[],
  sort: AssetSortOrder = "updated_desc",
): AssetFilterState {
  return {
    types: filters.types,
    tags: filters.tagIds
      .map((tagId) => tagOptions.find((tag) => tag.id === tagId)?.name)
      .filter((name): name is string => Boolean(name)),
    sources: sourceTypesToLabels(filters.sources),
    match: filters.match,
    time: filters.time,
    status:
      filters.status === "inbox" || filters.status === "draft" || filters.status === "published"
        ? filters.status
        : "any",
    sort,
  };
}

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
        const nextValues =
          keys === "all"
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

function AssetFilterField({
  label,
  children,
  wide = true,
}: {
  label: string;
  children: ReactNode;
  wide?: boolean;
}) {
  return (
    <div className={`flex gap-3 ${wide ? "items-start" : "flex-col"}`}>
      <span
        className={`shrink-0 text-[10.5px] font-semibold tracking-wide text-zinc-400 ${wide ? "w-8 pt-1" : ""}`}
      >
        {label}
      </span>
      <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5">{children}</div>
    </div>
  );
}

type AssetFilterFieldsProps = {
  filters: AssetFilterState;
  onFiltersChange: Dispatch<SetStateAction<AssetFilterState>>;
  tagOptions: SidebarTag[];
  sourceOptions: string[];
};

export function AssetFilterFields({
  filters,
  onFiltersChange,
  tagOptions,
  sourceOptions,
}: AssetFilterFieldsProps) {
  return (
    <>
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
          onSelectedValuesChange={(sources) =>
            onFiltersChange((current) => ({ ...current, sources }))
          }
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
    </>
  );
}

type AssetFilterPanelProps = AssetFilterFieldsProps & {
  resultCount: number;
  onSaveView?: () => void;
};

export function AssetFilterPanel({
  filters,
  onFiltersChange,
  tagOptions,
  sourceOptions,
  resultCount,
  onSaveView,
}: AssetFilterPanelProps) {
  return (
    <AccordionPanel
      id="asset-filter-panel"
      className="overflow-hidden border-b border-zinc-200 bg-[#fbfbfa]"
    >
      <AccordionBody className="space-y-3 px-6 py-3">
        <AssetFilterFields
          filters={filters}
          onFiltersChange={onFiltersChange}
          tagOptions={tagOptions}
          sourceOptions={sourceOptions}
        />

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
