import React, { useState, useRef, useEffect, useMemo, type ComponentType, type ReactNode } from "react";
import { DragDropProvider, type DragEndEvent } from "@dnd-kit/react";
import { isSortable, useSortable } from "@dnd-kit/react/sortable";
import { PointerActivationConstraints, PointerSensor } from "@dnd-kit/dom";
import { arrayMove } from "@dnd-kit/helpers";
import { AnimatePresence, motion } from "motion/react";
import { useMasonry, usePositioner, useResizeObserver as useMasonryResizeObserver } from "masonic";
import { Collapsible, CollapsibleTrigger } from "@/components/ui/collapsible";
import {
  AlertCircle,
  Archive,
  ArrowLeft,
  Bot,
  CalendarClock,
  CheckCircle2,
  ChevronDown,
  Circle,
  Clock3,
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
  ListFilter,
  MoreHorizontal,
  PanelLeftOpen,
  PanelLeftClose,
  PanelRightOpen,
  PanelRightClose,
  PanelsTopLeft,
  Pencil,
  Pin,
  Play,
  Plus,
  Send,
  ShieldCheck,
  Sparkles,
  Tags,
  Trash2,
  Video,
} from "lucide-react";
import { Button, Chip, TextArea } from "@heroui/react";

import type { PanelImperativeHandle } from "react-resizable-panels";
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/components/ui/resizable";
import { ScrollArea } from "@/components/ui/scroll-area";

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
  tag: string;
  collection?: string;
  meta: string;
  accent: number;
  height?: "short" | "medium" | "tall";
  duration?: string;
  url?: string;
  related: string[];
  // subtype helpers
  ogImage?: boolean;    // web: whether an OG image is cached
  fileExt?: string;     // file: "pdf" | "csv" | "docx" | "xls" …
  domain?: string;      // web/video/link: display domain
  imageCount?: number;  // image: images in the collection
};

type SmartView = {
  id: string;
  name: string;
  count: number;
  icon: typeof Inbox;
  conditions: string[];
};

type PanelControls = {
  sidebarCollapsed: boolean;
  agentCollapsed: boolean;
  onToggleSidebar: () => void;
  onToggleAgent: () => void;
};

const tags = [
  { name: "待整理", count: 18, hue: 25 },
  { name: "灵感采集", count: 38, hue: 205 },
  { name: "竞品分析", count: 23, hue: 148 },
  { name: "文案素材", count: 19, hue: 275 },
  { name: "视频脚本", count: 7, hue: 8 },
  { name: "客户案例", count: 14, hue: 42 },
  { name: "行业报告", count: 9, hue: 188 },
  { name: "品牌资产", count: 26, hue: 315 },
  { name: "已发布", count: 31, hue: 232 },
];

const smartViews: SmartView[] = [
  {
    id: "this-week",
    name: "本周新增",
    count: 18,
    icon: Clock3,
    conditions: ["时间在本周", "状态不是已发布"],
  },
  {
    id: "untagged",
    name: "未打标签",
    count: 7,
    icon: Circle,
    conditions: ["标签为空", "来源包含 Vault"],
  },
  {
    id: "competitor-video",
    name: "竞品 · 视频精选",
    count: 11,
    icon: Play,
    conditions: ["类型是视频", "标签包含竞品分析", "时间在近 30 天"],
  },
  {
    id: "inspiration-wall",
    name: "灵感 · 图片墙",
    count: 38,
    icon: PanelsTopLeft,
    conditions: ["类型是图片", "标签包含灵感采集"],
  },
];

const conversations = [
  { id: "clash-config", title: "查找 Clash 配置对话", time: "1 小时" },
  { id: "ymtc-market", title: "确认长江存储是否创业板", time: "5 小时" },
  { id: "margin-trading", title: "查询融资交易资格", time: "1 天" },
  { id: "get-started", title: "Get started", time: "2 天" },
  { id: "etf-return", title: "计算 ETF 收益", time: "2 天" },
  { id: "sendgrid-alternatives", title: "查找类似 SendGrid 验证服务", time: "2 天" },
  { id: "sendgrid-auth", title: "修复 SendGrid 邮件认证", time: "2 天" },
  { id: "ai-dependency-regression", title: "防止 AI 依赖退化", time: "3 天" },
  { id: "codex-account-switch", title: "切换本地 Codex 账户", time: "3 天", active: true },
  { id: "submail-inbox", title: "确认子邮箱 inbox 支持", time: "3 天" },
  { id: "subdomain-dns-docs", title: "编写子域 DNS 配置文档", time: "4 天" },
];

type SidebarSectionId = "views" | "conversations" | "tags";

type SidebarOrderState = {
  sections: SidebarSectionId[];
  views: string[];
  conversations: string[];
  tags: string[];
};

const SIDEBAR_ORDER_STORAGE_KEY = "post.assetManager.sidebarOrder.v1";
const SIDEBAR_SECTION_IDS: SidebarSectionId[] = ["views", "conversations", "tags"];
const SIDEBAR_SECTION_TYPE = "sidebar-section";
const SIDEBAR_ITEM_TYPE_PREFIX = "sidebar-item:";

const getDefaultSidebarOrder = (): SidebarOrderState => ({
  sections: [...SIDEBAR_SECTION_IDS],
  views: smartViews.map((view) => view.id),
  conversations: conversations.map((conversation) => conversation.id),
  tags: tags.map((tag) => tag.name),
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

function normalizeSidebarOrder(value: unknown): SidebarOrderState {
  const defaults = getDefaultSidebarOrder();
  const stored = value && typeof value === "object" ? value as Partial<SidebarOrderState> : {};

  return {
    sections: mergeKnownOrder(stored.sections, defaults.sections, isSidebarSectionId),
    views: mergeKnownOrder(stored.views, defaults.views),
    conversations: mergeKnownOrder(stored.conversations, defaults.conversations),
    tags: mergeKnownOrder(stored.tags, defaults.tags),
  };
}

function readSidebarOrderFromStorage() {
  if (typeof window === "undefined") {
    return getDefaultSidebarOrder();
  }

  try {
    const raw = window.localStorage.getItem(SIDEBAR_ORDER_STORAGE_KEY);
    return normalizeSidebarOrder(raw ? JSON.parse(raw) : null);
  } catch {
    return getDefaultSidebarOrder();
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

const assets: Asset[] = [
  // ── Markdown ────────────────────────────────────────────
  {
    id: "md-interview-04",
    kind: "markdown",
    status: "inbox",
    privacy: "normal",
    title: "用户访谈摘录 · 第 4 位",
    body: "我不想再建一堆文件夹了。我永远记不住东西放在哪个夹子里，只想搜一下，或者让它自己归类。最好的状态是什么都不用记，东西自己就到了对的地方。",
    source: "Vault / interviews/user-04.md",
    sourceType: "vault",
    time: "今天 09:14",
    tag: "待整理",
    collection: "竞品分析包",
    meta: "Markdown · 612 字",
    accent: 150,
    height: "short",
    related: ["web-competitor-pricing", "video-q2-launch"],
  },
  {
    id: "md-home-copy",
    kind: "markdown",
    status: "draft",
    privacy: "normal",
    title: "首页主文案 v3",
    body: "管理你收集的一切。文字、图片、视频、链接，都作为一级资产进入一个库。AI 自动整理，随时检索，不再有遗失的灵感。",
    source: "Vault / drafts/home-copy.md",
    sourceType: "vault",
    time: "今天 11:02",
    tag: "文案素材",
    meta: "Markdown · 248 字",
    accent: 275,
    height: "short",
    related: ["md-interview-04"],
  },
  // ── Image · 本地 ─────────────────────────────────────────
  {
    id: "image-packaging",
    kind: "image",
    status: "organized",
    privacy: "normal",
    title: "极简包装设计参考集",
    body: "日本无印风格的留白与材质，留意瓶身比例与字号层级。",
    source: "外部文件夹 / packaging",
    sourceType: "external_file",
    time: "2 小时前",
    tag: "灵感采集",
    collection: "品牌视觉素材",
    meta: "本地图片 · 9 张 · JPG",
    accent: 204,
    height: "medium",
    imageCount: 9,
    related: [],
  },
  // ── Image · 链接 ─────────────────────────────────────────
  {
    id: "image-color-board",
    kind: "image",
    status: "organized",
    privacy: "normal",
    title: "2026 色彩趋势板",
    body: "偏灰调的莫兰迪色组，可以作为下个季度包装与 KV 的基底色板。",
    source: "pinterest.com",
    sourceType: "url",
    time: "3 天前",
    tag: "灵感采集",
    collection: "品牌视觉素材",
    meta: "链接图片 · 2400 × 1600",
    accent: 188,
    height: "tall",
    domain: "pinterest.com",
    related: ["image-packaging"],
  },
  // ── Video · 本地 ─────────────────────────────────────────
  {
    id: "video-local-brand",
    kind: "video",
    status: "organized",
    privacy: "normal",
    title: "品牌主视觉视频 · 初剪",
    body: "开头节奏太慢，需要把产品出镜时间提前到 20 秒以内。",
    source: "外部文件夹 / exports/brand-v1.mp4",
    sourceType: "external_file",
    time: "昨天",
    tag: "品牌资产",
    collection: "发布候选",
    meta: "本地视频 · MP4 · 1:24",
    accent: 315,
    height: "medium",
    duration: "1:24",
    related: ["link-frameio"],
  },
  // ── Video · 链接（YouTube）────────────────────────────────
  {
    id: "video-q2-launch",
    kind: "video",
    status: "organized",
    privacy: "normal",
    title: "竞品 Q2 发布会拆解",
    body: "前 8 分钟都在讲叙事，把产品定位成第二大脑，功能演示压到最后。",
    source: "youtube.com",
    sourceType: "url",
    time: "昨天",
    tag: "竞品分析",
    collection: "竞品分析包",
    meta: "视频链接 · YouTube · 12:34",
    accent: 280,
    height: "medium",
    duration: "12:34",
    domain: "youtube.com",
    url: "https://youtube.com/watch?v=demo",
    related: ["md-interview-04", "web-competitor-pricing"],
  },
  // ── Web · 有 OG 图 ───────────────────────────────────────
  {
    id: "web-producthunt",
    kind: "web",
    status: "organized",
    privacy: "normal",
    title: "Notion AI 上线 Product Hunt",
    body: "头图是一张很大的渐变图，标题层级与 CTA 的位置很值得参考。",
    source: "producthunt.com",
    sourceType: "url",
    time: "上周",
    tag: "竞品分析",
    collection: "竞品分析包",
    meta: "网页存档 · OG 图已缓存",
    accent: 25,
    height: "medium",
    ogImage: true,
    domain: "producthunt.com",
    url: "https://producthunt.com/posts/notion-ai",
    related: ["web-competitor-pricing"],
  },
  // ── Web · 无 OG 图 ───────────────────────────────────────
  {
    id: "web-competitor-pricing",
    kind: "web",
    status: "draft",
    privacy: "normal",
    title: "竞品定价页收藏",
    body: "免费档普遍卡在 1 GB / 单设备，是切入点。第一版只保存链接和元信息。",
    source: "competitor.example",
    sourceType: "url",
    time: "2 周前",
    tag: "竞品分析",
    collection: "竞品分析包",
    meta: "网页收藏 · 仅元信息",
    accent: 42,
    height: "short",
    ogImage: false,
    domain: "competitor.example",
    url: "https://competitor.example/pricing",
    related: ["video-q2-launch", "md-interview-04"],
  },
  // ── Link · 私密外链 ──────────────────────────────────────
  {
    id: "link-frameio",
    kind: "link",
    status: "organized",
    privacy: "private",
    title: "产品 15s 短片 · 终稿",
    body: "Frame.io 审片链接。标记为私密，外部 AI 批量分析会自动跳过。",
    source: "frame.io",
    sourceType: "url",
    time: "上周",
    tag: "品牌资产",
    collection: "发布候选",
    meta: "外部链接 · 0:15",
    accent: 315,
    height: "short",
    duration: "0:15",
    domain: "frame.io",
    related: ["image-color-board"],
  },
  // ── File · PDF ───────────────────────────────────────────
  {
    id: "file-q1-report",
    kind: "file",
    status: "organized",
    privacy: "normal",
    title: "2026 Q1 行业分析报告",
    body: "第三章的市场规模数据值得关注，中小企业采用率同比增长 34%，高于上年预测。",
    source: "外部文件夹 / reports/q1-2026.pdf",
    sourceType: "external_file",
    time: "3 天前",
    tag: "行业报告",
    meta: "PDF · 28 页 · 4.2 MB",
    accent: 25,
    height: "medium",
    fileExt: "pdf",
    related: ["web-competitor-pricing"],
  },
  // ── File · CSV ───────────────────────────────────────────
  {
    id: "file-competitor-data",
    kind: "file",
    status: "inbox",
    privacy: "normal",
    title: "竞品功能矩阵 · 原始数据",
    body: "从各竞品官网手动整理，需要补充定价列和 API 支持情况。",
    source: "外部文件夹 / research/competitor-matrix.csv",
    sourceType: "external_file",
    time: "今天 08:30",
    tag: "竞品分析",
    meta: "CSV · 1,234 行 · 78 KB",
    accent: 148,
    height: "short",
    fileExt: "csv",
    related: ["web-competitor-pricing", "video-q2-launch"],
  },
  // ── File · DOCX ──────────────────────────────────────────
  {
    id: "file-brand-guide",
    kind: "file",
    status: "published",
    privacy: "normal",
    title: "品牌视觉规范 2026",
    body: "已更新色值为 oklch 色彩空间，新增深色模式配色方案和图标使用规范。",
    source: "外部文件夹 / brand/guide-v4.docx",
    sourceType: "external_file",
    time: "上周",
    tag: "品牌资产",
    collection: "品牌视觉素材",
    meta: "DOCX · 64 页 · 12.1 MB",
    accent: 230,
    height: "short",
    fileExt: "docx",
    related: ["image-packaging", "image-color-board"],
  },
];

const agentTasks = [
  { title: "读取待整理资产", state: "done" },
  { title: "识别 Markdown、图片、视频、链接", state: "done" },
  { title: "建议标签和集合", state: "running" },
  { title: "发现跨资产关系", state: "todo" },
  { title: "等待用户确认写入 SQLite", state: "todo" },
] as const;

function getTagHue(name: string): number {
  return tags.find((tag) => tag.name === name)?.hue ?? 210;
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

function AppWindowChrome({
  sidebarCollapsed,
  agentCollapsed,
  onToggleSidebar,
  onToggleAgent,
}: PanelControls) {
  return (
    <>
      <div className="window-drag fixed inset-x-0 top-0 z-40 h-12 bg-transparent" />
      <div className="window-no-drag fixed left-[96px] top-[5px] z-[80] flex items-center gap-3">
        <Button
          isIconOnly
          aria-label={sidebarCollapsed ? "展开左侧栏" : "收起左侧栏"}
          size="sm"
          variant="ghost"
          className="h-8 w-8 text-zinc-500 hover:bg-black/5"
          onPress={onToggleSidebar}
        >
          {sidebarCollapsed ? <PanelLeftOpen size={20} /> : <PanelLeftClose size={20} />}
        </Button>
      </div>
      <div className="window-no-drag fixed right-5 top-[6px] z-[80]">
        <Button
          isIconOnly
          aria-label={agentCollapsed ? "展开 Agent" : "收起 Agent"}
          size="sm"
          variant="ghost"
          className="h-8 w-8 text-zinc-500 hover:bg-black/5"
          onPress={onToggleAgent}
        >
          {agentCollapsed ? <PanelRightOpen size={20} /> : <PanelRightClose size={20} />}
        </Button>
      </div>
    </>
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
    return (
      <div className={`relative ${heightCls} overflow-hidden border-b border-zinc-100`} style={{ background: grad }}>
        <Hatch />
        <div className="absolute inset-0 flex items-end p-3">
          <div className="flex items-center gap-1.5 rounded-md bg-white/70 px-2.5 py-1 text-[11px] font-medium text-zinc-700 shadow-sm backdrop-blur">
            <ImageIcon size={12} />
            {asset.sourceType === "external_file"
              ? `本地图片${asset.imageCount ? ` · ${asset.imageCount} 张` : ""}`
              : `链接图片${asset.domain ? ` · ${asset.domain}` : ""}`}
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

function AssetCard({ asset }: { asset: Asset }) {
  const { label, icon: Icon } = getKindMeta(asset.kind);
  const hasVisual =
    asset.kind === "image" ||
    asset.kind === "video" ||
    (asset.kind === "web" && asset.ogImage) ||
    asset.kind === "file";
  const showUrlRow = asset.kind === "link" || (asset.kind === "web" && !asset.ogImage);

  const KindBadge = ({ overlay }: { overlay?: boolean }) => (
    <Chip
      size="sm"
      className={`shrink-0 px-1.5 font-mono text-[10px] text-zinc-500 ${
        overlay
          ? "border border-white/30 bg-white/80 shadow-sm backdrop-blur"
          : "border border-zinc-200 bg-white"
      }`}
    >
      <Icon size={12} />
      {label}
    </Chip>
  );

  return (
    <article className="overflow-hidden rounded-lg border border-zinc-200 bg-white shadow-[0_1px_2px_rgba(20,20,20,0.04)] transition hover:-translate-y-0.5 hover:border-blue-200 hover:shadow-md">
      <button
        type="button"
        className="block w-full text-left"
        onClick={() => {
          window.location.hash = `/assets/${asset.id}`;
        }}
      >
        {hasVisual ? (
          <div className="relative">
            <VisualBlock asset={asset} />
            <div className="absolute right-2 top-2">
              <KindBadge overlay />
            </div>
          </div>
        ) : null}

        <div className="space-y-3 p-4">
          <div className="flex items-start gap-2">
            <h2 className="min-w-0 flex-1 text-[15px] font-semibold leading-6 text-zinc-950">
              {asset.title}
            </h2>
            {!hasVisual ? <KindBadge /> : null}
          </div>

          {showUrlRow ? (
            <div className="flex items-center gap-1.5 rounded-md border border-zinc-100 bg-zinc-50 px-2.5 py-1.5">
              {asset.kind === "link" ? (
                <ExternalLink size={11} className="shrink-0 text-zinc-400" />
              ) : (
                <Globe size={11} className="shrink-0 text-zinc-400" />
              )}
              <span className="truncate text-[11px] text-zinc-500">{asset.domain ?? asset.url ?? asset.source}</span>
            </div>
          ) : null}

          {asset.body ? (
            <p className="line-clamp-5 whitespace-pre-line text-sm leading-6 text-zinc-600">
              {asset.body}
            </p>
          ) : null}

          <div className="flex flex-wrap items-center gap-2">
            <TagPill name={asset.tag} />
            <SourceBadge asset={asset} />
            {asset.privacy === "private" ? (
              <Chip size="sm" className="bg-amber-50 text-[11px] text-amber-700">
                <ShieldCheck size={12} />
                私密
              </Chip>
            ) : null}
          </div>

          <div className="flex items-center justify-between gap-3 text-xs text-zinc-400">
            <span className="truncate">{asset.meta}</span>
            <span className="shrink-0">{asset.time}</span>
          </div>
        </div>
      </button>
    </article>
  );
}

function Sidebar() {
  const [sidebarOrder, setSidebarOrder] = useState(readSidebarOrderFromStorage);

  useEffect(() => {
    try {
      window.localStorage.setItem(SIDEBAR_ORDER_STORAGE_KEY, JSON.stringify(sidebarOrder));
    } catch {
      // Ignore storage failures; drag state should still work for the current session.
    }
  }, [sidebarOrder]);

  const orderedViews = useMemo(
    () => orderByIds(smartViews, sidebarOrder.views, (view) => view.id).slice(0, 5),
    [sidebarOrder.views],
  );
  const orderedConversations = useMemo(
    () => orderByIds(conversations, sidebarOrder.conversations, (conversation) => conversation.id).slice(0, 10),
    [sidebarOrder.conversations],
  );
  const orderedTags = useMemo(
    () => orderByIds(tags, sidebarOrder.tags, (tag) => tag.name).slice(0, 10),
    [sidebarOrder.tags],
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
                  icon={view.icon}
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

    if (sectionId === "conversations") {
      return (
        <SidebarSection title="对话" dragHandleRef={dragHandleRef}>
          <div className="space-y-0.5">
            {orderedConversations.map((conversation, index) => (
              <SortableSidebarItem key={conversation.id} sectionId="conversations" itemId={conversation.id} index={index}>
                <SidebarItem
                  label={conversation.title}
                  active={conversation.active}
                  meta={conversation.active ? undefined : conversation.time}
                  actions={
                    <>
                      <SidebarItemActionButton label={`置顶 ${conversation.title}`} icon={Pin} />
                      <SidebarItemActionButton label={`归档 ${conversation.title}`} icon={Archive} />
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
            <SortableSidebarItem key={tag.name} sectionId="tags" itemId={tag.name} index={index}>
              <SidebarItem
                colorDot={`oklch(0.62 0.14 ${tag.hue})`}
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

  return (
    <aside className="flex h-full w-full flex-col border-r border-white/45 bg-white/45 shadow-[inset_-1px_0_0_rgba(255,255,255,0.45)] backdrop-blur-2xl backdrop-saturate-150">
      {/* 固定顶部：资产管理（traffic light 留出 pt-12） */}
      <div className="shrink-0 px-3 pb-1 pt-12">
        <SidebarSection
          title="资产管理"
          action={
            <button type="button" className="flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] text-zinc-400 hover:bg-black/5">
              <Plus size={11} />
              新建
            </button>
          }
        >
          <div className="space-y-0.5">
            {[
              { icon: Archive, label: "全部资产", count: 142, active: true },
              { icon: Inbox, label: "待整理", count: 18 },
              { icon: CalendarClock, label: "发布入口", count: 6 },
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

      {/* 可滚动部分：Views / 对话 / Tags */}
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

function MainToolbar() {
  return (
    <div className="border-b border-zinc-100 px-7 pb-4 pt-3">
      <div className="flex flex-wrap items-center gap-3">
        <div className="mr-auto flex items-baseline gap-2">
          <h1 className="text-xl font-semibold tracking-normal text-zinc-950">全部资产</h1>
          <span className="text-sm text-zinc-400">10 / 142</span>
        </div>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        {["全部", "图片", "视频", "Markdown", "链接", "网页", "文件"].map((filter, index) => (
          <Chip
            key={filter}
            size="sm"
            className={`cursor-default px-2.5 py-1 text-xs ${
              index === 0 ? "bg-zinc-950 text-white" : "border border-zinc-200 bg-white text-zinc-600"
            }`}
          >
            {filter}
          </Chip>
        ))}
        <Button size="sm" variant="ghost" className="h-7 border border-dashed border-zinc-200 px-2.5 text-xs text-zinc-400">
          <Filter size={14} />
          筛选
        </Button>
      </div>
    </div>
  );
}

function MasonryCard({ data }: { index: number; data: Asset; width: number }) {
  return <AssetCard asset={data} />;
}

function AssetBoard() {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [scrollTop, setScrollTop] = useState(0);
  const [isScrolling, setIsScrolling] = useState(false);
  const scrollTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;

    const ro = new ResizeObserver(() => {
      setSize({ width: el.clientWidth, height: el.clientHeight });
    });
    ro.observe(el);
    setSize({ width: el.clientWidth, height: el.clientHeight });

    const onScroll = () => {
      setScrollTop(el.scrollTop);
      setIsScrolling(true);
      clearTimeout(scrollTimer.current);
      scrollTimer.current = setTimeout(() => setIsScrolling(false), 150);
    };
    el.addEventListener("scroll", onScroll, { passive: true });

    return () => {
      ro.disconnect();
      el.removeEventListener("scroll", onScroll);
      clearTimeout(scrollTimer.current);
    };
  }, []);

  // subtract px-7 padding (28px × 2 = 56px)
  const innerWidth = Math.max(0, size.width - 56);
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
    containerRef: scrollRef,
    items: assets,
    render: MasonryCard,
    resizeObserver,
    overscanBy: 2,
  });

  return (
    <main className="flex h-full min-w-0 flex-col bg-white">
      <MainToolbar />
      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto px-7 py-5">
        {masonry}
      </div>
    </main>
  );
}

function AssetDetail({ asset }: { asset: Asset }) {
  const { label, icon: Icon } = getKindMeta(asset.kind);
  const hasVisual = asset.kind === "image" || asset.kind === "video";
  const isLinkAsset = asset.kind === "web" || asset.kind === "link";

  return (
    <main className="flex h-full min-w-0 flex-col bg-white">
      <div className="border-b border-zinc-100 px-7 pb-4 pt-16">
        <div className="flex items-center gap-2 text-sm text-zinc-500">
          <Button
            size="sm"
            variant="ghost"
            className="h-8 px-2"
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
          <Button isIconOnly aria-label="更多资产操作" variant="secondary">
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

function AssetInspector({ asset }: { asset: Asset }) {
  const relatedAssets = assets.filter((item) => asset.related.includes(item.id));
  const view = smartViews[2];

  return (
    <aside className="flex h-full w-full flex-col border-l border-zinc-200 bg-zinc-50/70">
      <div className="flex items-center gap-2 border-b border-zinc-200 px-5 py-4">
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
            <Chip size="sm" className="border border-dashed border-zinc-200 bg-white text-xs text-zinc-400">
              <Plus size={12} />
              添加标签
            </Chip>
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

        <InspectorSection title="当前 View 查询" icon={ListFilter}>
          <p className="text-xs leading-5 text-zinc-500">
            View 是保存好的 SQLite 查询条件，结果实时刷新。
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            {view.conditions.map((condition) => (
              <Chip key={condition} size="sm" className="border border-zinc-200 bg-white text-xs text-zinc-600">
                {condition}
              </Chip>
            ))}
          </div>
        </InspectorSection>
      </ScrollArea>
    </aside>
  );
}

function AgentPanel({ asset }: { asset?: Asset }) {
  return (
    <aside className="flex h-full w-full flex-col border-l border-zinc-200 bg-zinc-50/70">
      <div className="flex items-center gap-2 border-b border-zinc-200 px-5 pb-4 pt-16">
        <Sparkles size={17} className="text-blue-600" />
        <span className="font-semibold text-blue-700">Agent</span>
        <span className="flex items-center gap-1.5 text-xs text-zinc-500">
          <span className="h-2 w-2 rounded-full bg-emerald-500" />
          工作中
        </span>
      </div>

      <ScrollArea className="min-h-0 flex-1" viewportClassName="space-y-4 p-5">
        {asset ? (
          <div className="rounded-lg border border-blue-100 bg-blue-50 p-3">
            <div className="flex items-start gap-2">
              <Bot size={16} className="mt-0.5 text-blue-600" />
              <div>
                <div className="text-sm font-semibold text-blue-950">针对当前资产</div>
                <p className="mt-1 text-sm leading-6 text-blue-900/75">
                  我可以解释、补标签、找相似素材，或把它加入一个 Collection。
                </p>
              </div>
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              {["解释这条资产", "找相似素材", "自动补标签", "建立关系"].map((action) => (
                <Chip key={action} className="bg-white text-xs text-blue-700">
                  {action}
                </Chip>
              ))}
            </div>
          </div>
        ) : (
          <div className="ml-auto max-w-[320px] rounded-xl rounded-tr-sm bg-blue-600 px-4 py-3 text-sm leading-6 text-white">
            把待整理里的素材按主题分组，给出标签建议。私密资产不要发给外部模型。
          </div>
        )}

        <div className="flex gap-3">
          <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-blue-50 text-blue-600">
            <Sparkles size={16} />
          </span>
          <div className="text-sm leading-6 text-zinc-700">
            {asset
              ? `已读取「${asset.title}」。这条资产属于 ${asset.tag}，当前有 ${asset.related.length} 条关系。`
              : "我会先做基础索引，再异步分析摘要、标签和关系。AI 结果会作为建议，确认后才写入 SQLite。"}
          </div>
        </div>

        <div className="rounded-lg border border-zinc-200 bg-white p-4 shadow-sm">
          <div className="mb-3 flex items-center justify-between">
            <span className="text-sm font-semibold text-zinc-950">任务流</span>
            <span className="text-xs text-zinc-400">3 / 5</span>
          </div>
          <div className="space-y-2">
            {agentTasks.map((task) => (
              <div key={task.title} className="flex items-center gap-2 text-sm">
                {task.state === "done" ? (
                  <CheckCircle2 size={16} className="text-emerald-600" />
                ) : task.state === "running" ? (
                  <AlertCircle size={16} className="text-blue-600" />
                ) : (
                  <Circle size={16} className="text-zinc-300" />
                )}
                <span className={task.state === "todo" ? "text-zinc-400" : "text-zinc-700"}>{task.title}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="rounded-lg border border-blue-200 bg-white p-4 shadow-[0_0_0_3px_rgba(37,99,235,0.08)]">
          <div className="flex items-center gap-2 text-sm font-semibold text-zinc-950">
            <FileText size={15} className="text-blue-600" />
            整理建议 · v1
          </div>
          <p className="mt-2 text-sm leading-6 text-zinc-600">
            建议把 18 个待整理资产分成「竞品分析」「灵感采集」「品牌资产」三组，并为 4 条链接补充网页收藏类型。
          </p>
          <div className="mt-3 flex justify-end gap-2">
            <Button size="sm" variant="secondary">
              查看
            </Button>
            <Button size="sm" variant="primary">
              应用建议
            </Button>
          </div>
        </div>
      </ScrollArea>

      <div className="border-t border-zinc-200 p-4">
        <TextArea
          aria-label="Ask Agent"
          className="min-h-20 w-full resize-none"
          placeholder={asset ? "针对这条资产提问..." : "让 Agent 搜索、整理或分析资产..."}
          variant="secondary"
        />
        <div className="mt-3 flex items-center justify-between gap-3">
          <div className="flex gap-2">
            <Chip className="bg-zinc-100 text-xs text-zinc-600">引用卡片</Chip>
            <Chip className="bg-zinc-100 text-xs text-zinc-600">批量整理</Chip>
          </div>
          <Button isIconOnly aria-label="发送给 Agent" size="sm" variant="primary">
            <Send size={16} />
          </Button>
        </div>
      </div>
    </aside>
  );
}

function getMainDefaultSize(activeAsset: Asset | undefined, sidebarCollapsed: boolean, agentCollapsed: boolean) {
  if (!activeAsset) {
    if (sidebarCollapsed && agentCollapsed) {
      return 100;
    }

    if (sidebarCollapsed) {
      return 72;
    }

    if (agentCollapsed) {
      return 80;
    }

    return 52;
  }

  if (sidebarCollapsed && agentCollapsed) {
    return 80;
  }

  if (sidebarCollapsed) {
    return 58;
  }

  if (agentCollapsed) {
    return 60;
  }

  return 38;
}

export function AssetManagerPage({ assetId }: { assetId?: string }) {
  const activeAsset = assetId ? assets.find((asset) => asset.id === assetId) : undefined;
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [sidebarVisible, setSidebarVisible] = useState(true);
  const [agentCollapsed, setAgentCollapsed] = useState(false);
  const [agentVisible, setAgentVisible] = useState(true);
  const sidebarPanelRef = useRef<PanelImperativeHandle | null>(null);
  const agentPanelRef = useRef<PanelImperativeHandle | null>(null);

  const controls: PanelControls = {
    sidebarCollapsed,
    agentCollapsed,
    onToggleSidebar: () => {
      if (sidebarPanelRef.current?.isCollapsed()) {
        sidebarPanelRef.current.expand();
        setTimeout(() => setSidebarVisible(true), 50);
      } else {
        setSidebarVisible(false);
        sidebarPanelRef.current?.collapse();
      }
    },
    onToggleAgent: () => {
      if (agentPanelRef.current?.isCollapsed()) {
        agentPanelRef.current.expand();
        setTimeout(() => setAgentVisible(true), 50);
      } else {
        setAgentVisible(false);
        agentPanelRef.current?.collapse();
      }
    },
  };

  return (
    <div className="relative h-screen min-h-0 overflow-hidden text-zinc-950">
      <AppWindowChrome {...controls} />
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
          onResize={(size) => setSidebarCollapsed(size.asPercentage === 0)}
          className={`transition-opacity duration-150 ${sidebarVisible ? "opacity-100" : "opacity-0"}`}
        >
          <Sidebar />
        </ResizablePanel>
        <ResizableHandle
          withHandle
          className={sidebarCollapsed ? "opacity-0 pointer-events-none" : ""}
        />

        <ResizablePanel
          id="main"
          defaultSize={getMainDefaultSize(activeAsset, sidebarCollapsed, agentCollapsed)}
          minSize={activeAsset ? 34 : 42}
        >
          {activeAsset ? <AssetDetail asset={activeAsset} /> : <AssetBoard />}
        </ResizablePanel>

        {activeAsset ? (
          <>
            <ResizableHandle withHandle />
            <ResizablePanel id="inspector" defaultSize={20} minSize={18} maxSize={32}>
              <AssetInspector asset={activeAsset} />
            </ResizablePanel>
          </>
        ) : null}

        <ResizableHandle
          withHandle
          className={agentCollapsed ? "opacity-0 pointer-events-none" : ""}
        />
        <ResizablePanel
          panelRef={agentPanelRef}
          id="agent"
          defaultSize={activeAsset ? 22 : 28}
          minSize={18}
          maxSize={38}
          collapsible
          collapsedSize={0}
          onResize={(size) => setAgentCollapsed(size.asPercentage === 0)}
          className={`transition-opacity duration-150 ${agentVisible ? "opacity-100" : "opacity-0"}`}
        >
          <AgentPanel asset={activeAsset} />
        </ResizablePanel>
      </ResizablePanelGroup>
    </div>
  );
}
