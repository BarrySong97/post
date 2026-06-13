import { useId, useState } from "react";
import { Plus, X } from "lucide-react";
import { Button, Chip } from "@heroui/react";

import { ScrollArea } from "@/components/ui/scroll-area";
import { PageChrome } from "@/components/app-layout";

// ── Types & constants ─────────────────────────────────────────────────────────

type Platform = {
  id: string;
  name: string;
  fmt: string;
  hue: number;
  default: boolean;
  adapt: string;
};

const PLATFORMS: Platform[] = [
  { id: "mp",  name: "公众号", fmt: "长文",   hue: 150, default: true,  adapt: "保留全文 1240 字 · 自动配图与小标题" },
  { id: "xhs", name: "小红书", fmt: "图文",   hue: 0,   default: true,  adapt: "压缩到 ~350 字 · 9 图 · 加话题标签" },
  { id: "zh",  name: "知乎",   fmt: "长文",   hue: 210, default: false, adapt: "保留论证结构 · 顶部加 TL;DR" },
  { id: "x",   name: "X",      fmt: "Thread", hue: 230, default: true,  adapt: "拆成 5 条 thread · 译为英文" },
  { id: "jk",  name: "即刻",   fmt: "短帖",   hue: 280, default: false, adapt: "140 字金句 + 原文链接" },
];

const DEFAULT_SELECTED = new Set(PLATFORMS.filter((p) => p.default).map((p) => p.id));

const SOURCE = {
  cover: "封面 · 素材库示意图",
  title: "内容工具 2026：从「收藏」走向「再创作」",
  body: "做内容三年，最大的改变不是工具变多，而是把文字、图片、视频全塞进同一个库，只打标签，让 AI 替我整理和检索。\n\n「找」的成本，远高于「存」——所以别再建文件夹了，所有素材进一个库，剩下的交给搜索和 AI。",
  description: "一个内容创作者的素材管理方法论：放弃文件夹，改用单一素材库 + 标签 + 语义搜索。",
  kind: "长文 · Markdown",
  words: 1240,
  read: "约 6 分钟",
  tags: ["内容创作", "效率工具", "第二大脑", "知识管理"],
};

// ── SVG stripe cover placeholder ──────────────────────────────────────────────

function CoverPlaceholder({ label, ratio = "16 / 9", hue = 210 }: {
  label: string;
  ratio?: string;
  hue?: number;
}) {
  const patternId = useId();
  return (
    <div
      className="relative w-full overflow-hidden"
      style={{
        aspectRatio: ratio,
        background: `oklch(0.96 0.02 ${hue})`,
        color: `oklch(0.62 0.13 ${hue})`,
      }}
    >
      <svg className="absolute inset-0 h-full w-full" preserveAspectRatio="xMidYMid slice">
        <defs>
          <pattern id={patternId} width="9" height="9" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
            <line x1="0" y1="0" x2="0" y2="9" stroke="currentColor" strokeWidth="1" strokeOpacity="0.5" />
          </pattern>
        </defs>
        <rect width="100%" height="100%" fill={`url(#${patternId})`} />
      </svg>
      <div className="absolute inset-0 flex items-center justify-center">
        <span
          className="relative z-10 rounded px-2 py-0.5 font-mono text-xs tracking-wide"
          style={{ background: "rgba(255,255,255,0.78)", color: `oklch(0.45 0.12 ${hue})` }}
        >
          {label}
        </span>
      </div>
    </div>
  );
}

// ── Platform chip ─────────────────────────────────────────────────────────────

function PlatformChip({ platform, selected, onToggle }: {
  platform: Platform;
  selected: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      className={`inline-flex cursor-pointer items-center gap-2 rounded-xl border py-1.5 pl-2 pr-3 transition-all ${
        selected
          ? "border-blue-400/50 bg-white shadow-[0_0_0_3px_rgba(99,102,241,0.09)]"
          : "border-zinc-200 bg-white shadow-sm hover:border-zinc-300"
      }`}
    >
      {/* Square checkbox */}
      <span
        className={`flex h-4 w-4 shrink-0 items-center justify-center rounded text-xs ${
          selected ? "bg-blue-600 text-white" : "border border-zinc-200 text-transparent"
        }`}
      >
        ✓
      </span>
      {/* Color dot */}
      <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: `oklch(0.62 0.15 ${platform.hue})` }} />
      {/* Name */}
      <span className="text-xs font-semibold text-zinc-800">{platform.name}</span>
      {/* Format badge */}
      <span className="shrink-0 rounded border border-zinc-200 px-1.5 py-px font-mono text-xs text-zinc-400">
        {platform.fmt}
      </span>
    </button>
  );
}

// ── Compose card ──────────────────────────────────────────────────────────────

function ComposeCard() {
  const [tags, setTags] = useState(SOURCE.tags);

  return (
    <div className="overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-sm">
      {/* Cover */}
      <div className="relative">
        <CoverPlaceholder label={SOURCE.cover} ratio="16 / 9" hue={210} />
        <div className="absolute bottom-2.5 right-2.5">
          <Button size="sm" variant="outline" className="h-7 border-zinc-200 bg-white/90 px-2.5 text-xs font-semibold text-zinc-700 backdrop-blur-sm">
            ↻ 更换封面
          </Button>
        </div>
      </div>

      {/* Fields */}
      <div className="flex flex-col gap-3 p-3.5 pb-4">
        {/* Title */}
        <label className="flex flex-col gap-1.5">
          <span className="text-xs font-semibold uppercase tracking-wide text-zinc-300">标题</span>
          <input
            className="w-full rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm font-semibold text-zinc-900 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-50"
            defaultValue={SOURCE.title}
          />
        </label>

        {/* Body */}
        <div className="flex flex-col gap-1.5">
          <span className="text-xs font-semibold uppercase tracking-wide text-zinc-300">正文</span>
          <div className="rounded-lg border border-zinc-200 bg-white px-3 py-2.5">
            <p className="line-clamp-3 whitespace-pre-line text-xs leading-relaxed text-zinc-400">
              {SOURCE.body}
            </p>
            <div className="mt-2 flex items-center gap-2 border-t border-zinc-100 pt-2 text-xs text-zinc-300">
              <span>{SOURCE.kind}</span>
              <span>·</span>
              <span>{SOURCE.words} 字</span>
              <span>·</span>
              <span>{SOURCE.read}</span>
              <Button size="sm" variant="ghost" className="ml-auto h-5 min-w-0 px-1 text-xs text-blue-600">
                ✎ 编辑正文
              </Button>
            </div>
          </div>
        </div>

        {/* Description */}
        <label className="flex flex-col gap-1.5">
          <span className="text-xs font-semibold uppercase tracking-wide text-zinc-300">描述</span>
          <input
            className="w-full rounded-lg border border-zinc-200 bg-white px-3 py-2 text-xs text-zinc-900 outline-none placeholder:text-zinc-300 focus:border-blue-500 focus:ring-2 focus:ring-blue-50"
            defaultValue={SOURCE.description}
            placeholder="一句话摘要，用于各平台分享卡片"
          />
        </label>

        {/* Tags */}
        <div className="flex flex-col gap-1.5">
          <span className="text-xs font-semibold uppercase tracking-wide text-zinc-300">标签</span>
          <div className="flex flex-wrap gap-2">
            {tags.map((tag) => (
              <Chip
                key={tag}
                size="sm"
                className="h-6 gap-1 rounded-lg bg-blue-50 px-2 text-xs text-blue-600"
              >
                <span>#{tag}</span>
                <button
                  type="button"
                  onClick={() => setTags((prev) => prev.filter((t) => t !== tag))}
                  className="ml-1 flex cursor-pointer items-center text-blue-400 hover:text-blue-600"
                >
                  <X size={9} strokeWidth={2.5} />
                </button>
              </Chip>
            ))}
            <Button
              size="sm"
              variant="outline"
              className="h-6 min-w-0 gap-1 rounded-lg border-dashed border-zinc-200 px-2 text-xs text-zinc-400"
              onPress={() => {}}
            >
              <Plus size={10} />
              标签
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Preview column ─────────────────────────────────────────────────────────────

function PreviewColumn({ selectedPlatforms }: { selectedPlatforms: Set<string> }) {
  const tabs = PLATFORMS.filter((p) => selectedPlatforms.has(p.id));
  const [activeTab, setActiveTab] = useState<string>(() => tabs[0]?.id ?? "");
  const validActive = tabs.find((t) => t.id === activeTab) ? activeTab : (tabs[0]?.id ?? "");
  const activePlat = PLATFORMS.find((p) => p.id === validActive);

  return (
    <div className="flex min-w-0 flex-1 flex-col bg-zinc-50 px-6 py-5">
      {/* Section label */}
      <div className="mb-4 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-zinc-300">
        预览
        {activePlat && (
          <span className="ml-auto text-xs font-medium normal-case tracking-normal text-zinc-400">
            {activePlat.name} · {activePlat.adapt}
          </span>
        )}
      </div>

      {/* Tab pills */}
      {tabs.length > 0 && (
        <div className="mb-4 inline-flex self-start gap-1 rounded-xl bg-zinc-100 p-1">
          {tabs.map((p) => (
            <button
              key={p.id}
              type="button"
              onClick={() => setActiveTab(p.id)}
              className={`inline-flex cursor-pointer items-center gap-1.5 whitespace-nowrap rounded-lg border-0 px-3 py-1.5 text-xs transition-all ${
                validActive === p.id
                  ? "bg-white font-semibold text-zinc-900 shadow-sm"
                  : "bg-transparent text-zinc-400 hover:text-zinc-600"
              }`}
            >
              <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: `oklch(0.62 0.15 ${p.hue})` }} />
              {p.name}
            </button>
          ))}
        </div>
      )}

      {/* Stage */}
      <div className="flex min-h-0 flex-1 items-start justify-center overflow-y-auto">
        {tabs.length === 0 ? (
          <div className="m-auto flex flex-col items-center gap-3 text-zinc-300">
            <span className="text-4xl opacity-50">◎</span>
            <span className="text-sm">选择平台后，在此预览适配后的效果</span>
          </div>
        ) : (
          <div className="w-full max-w-sm">
            <div className="overflow-hidden rounded-2xl border border-zinc-200 bg-white shadow-lg">
              <CoverPlaceholder label={SOURCE.cover} ratio="16 / 9" hue={210} />
              <div className="p-4">
                <p className="mb-1 text-xs text-zinc-300">Post 团队 · 6 分钟阅读</p>
                <p className="mb-2 text-sm font-semibold leading-snug text-zinc-900">{SOURCE.title}</p>
                <p className="text-xs leading-relaxed text-zinc-500">
                  做内容三年，我最大的改变不是工具变多，而是把所有素材塞进同一个库。
                </p>
              </div>
            </div>
            {activePlat && (
              <div className="mt-3 flex items-center justify-center gap-2 text-xs text-zinc-300">
                <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: `oklch(0.62 0.15 ${activePlat.hue})` }} />
                按「{activePlat.name}」语气改写 · 可手动微调
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export function PublishPage() {
  const [selected, setSelected] = useState<Set<string>>(DEFAULT_SELECTED);
  const [phase, setPhase] = useState<"idle" | "publishing" | "done">("idle");

  const togglePlatform = (id: string) => {
    if (phase !== "idle") return;
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const publish = () => {
    if (!selected.size || phase !== "idle") return;
    setPhase("publishing");
    setTimeout(() => setPhase("done"), 1700);
  };

  const n = selected.size;
  const btnLabel =
    phase === "done" ? `已发布到 ${n} 个平台` :
    phase === "publishing" ? "发布中…" :
    `发布到 ${n} 个平台`;

  return (
    <div className="flex h-full min-h-0 flex-col bg-white">
      <PageChrome>
        <h1 className="text-[15px] font-semibold tracking-normal text-zinc-950">发布中心</h1>
        <span className="text-xs text-zinc-400">选好内容与平台，一键发布</span>
        <div className="window-no-drag ml-auto">
          <Button
            size="sm"
            variant={phase === "done" ? "secondary" : "primary"}
            isDisabled={n === 0 || phase !== "idle"}
            onPress={publish}
            className="rounded-xl px-4 text-xs font-semibold"
          >
            {phase === "done" && <span>✓</span>}
            {btnLabel}
          </Button>
        </div>
      </PageChrome>

      {/* ── Platform selector bar ── */}
      <div className="flex shrink-0 items-center gap-3 border-b border-zinc-100 bg-zinc-50 px-6 py-2.5">
        <span className="shrink-0 text-xs font-semibold uppercase tracking-wide text-zinc-300">
          目标平台
        </span>
        <div className="flex min-w-0 flex-1 flex-wrap gap-2">
          {PLATFORMS.map((p) => (
            <PlatformChip
              key={p.id}
              platform={p}
              selected={selected.has(p.id)}
              onToggle={() => togglePlatform(p.id)}
            />
          ))}
        </div>
        <span className="shrink-0 text-xs text-zinc-400">{n} 已选</span>
      </div>

      {/* ── Two-column body ── */}
      <div className="flex min-h-0 flex-1 overflow-hidden">
        {/* Left: content setup */}
        <div className="flex w-96 shrink-0 flex-col overflow-hidden border-r border-zinc-100">
          <ScrollArea className="min-h-0 flex-1">
            <div className="px-5 py-5">
              {/* Section label */}
              <div className="mb-3 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-zinc-300">
                <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-blue-600 text-xs font-bold leading-none text-white">
                  1
                </span>
                内容
              </div>
              <ComposeCard />
            </div>
          </ScrollArea>
        </div>

        {/* Right: preview */}
        <PreviewColumn selectedPlatforms={selected} />
      </div>
    </div>
  );
}
