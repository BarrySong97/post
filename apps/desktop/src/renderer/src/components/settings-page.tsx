import { useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import {
  ArrowLeft,
  Grid2x2,
  List,
  Sun,
  Moon,
  Monitor,
  Lock,
  Keyboard,
  Settings,
  Folder,
} from "lucide-react";
import { Button, Input, ListBox, Select, Switch } from "@heroui/react";

import { readSidebarWidthPct } from "@/features/assets/storage";
import { isMacWindow } from "@/lib/platform";

type SettingsSection = "general" | "appearance" | "vault" | "privacy" | "shortcuts";

const NAV = [
  {
    group: "偏好",
    items: [
      { id: "general" as const, label: "通用", Icon: Settings },
      { id: "appearance" as const, label: "外观", Icon: Monitor },
    ],
  },
  {
    group: "资产库",
    items: [
      { id: "vault" as const, label: "资产库", Icon: Folder },
      { id: "privacy" as const, label: "隐私", Icon: Lock },
    ],
  },
  {
    group: "高级",
    items: [
      { id: "shortcuts" as const, label: "快捷键", Icon: Keyboard },
    ],
  },
];

export function SettingsPage() {
  const navigate = useNavigate();
  const [active, setActive] = useState<SettingsSection>("general");
  const [query, setQuery] = useState("");
  const chromePadding = isMacWindow() ? "pl-[100px]" : "pl-3";
  const sidebarWidth = `${readSidebarWidthPct()}vw`;

  return (
    <div className="flex h-full overflow-hidden">
      {/* ── Sidebar — same width as the main app sidebar ── */}
      <aside
        style={{ width: sidebarWidth }}
        className="flex h-full flex-none flex-col border-r border-white/45 bg-white/45 shadow-[inset_-1px_0_0_rgba(255,255,255,0.45)] backdrop-blur-2xl backdrop-saturate-150"
      >

        {/* Chrome row — traffic-lights safe zone + back button */}
        <div className={`relative mt-[10.5px] h-12 ${chromePadding}`}>
          <div aria-hidden="true" className="window-drag absolute inset-0 z-0" />
          <div className="window-no-drag pointer-events-auto relative z-10 inline-flex -ml-1 -translate-y-1.5">
            <Button
              isIconOnly
              variant="ghost"
              size="sm"
              aria-label="返回应用"
              className="window-no-drag h-8 w-8 text-zinc-500 hover:bg-black/5"
              onPress={() => void navigate({ to: "/" })}
            >
              <ArrowLeft size={16} />
            </Button>
          </div>
        </div>

        {/* Search */}
        <div className="shrink-0 px-3 pb-2">
          <Input.Root
            placeholder="搜索设置…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="h-7 rounded-lg bg-black/[0.045] px-2 text-[12px] text-zinc-700 placeholder:text-zinc-400 outline-none border-none ring-0 w-full"
          />
        </div>

        {/* Nav */}
        <nav className="min-h-0 flex-1 overflow-y-auto px-2 pb-4 pt-1">
          {NAV.map((section) => (
            <div key={section.group} className="mb-1">
              <div className="px-2 py-1 text-[11px] font-semibold uppercase tracking-wide text-zinc-400">
                {section.group}
              </div>
              <div className="space-y-0.5">
                {section.items.map(({ id, label, Icon }) => (
                  <button
                    key={id}
                    type="button"
                    onClick={() => setActive(id)}
                    className={`flex w-full select-none items-center gap-2 rounded-lg px-3 py-1.5 text-left text-[13px] outline-none transition-colors focus-visible:ring-2 focus-visible:ring-zinc-500/25 ${
                      active === id
                        ? "bg-[var(--sidebar-item-selected)] font-medium text-zinc-950 shadow-[inset_0_0_0_1px_var(--sidebar-item-selected-border)] hover:bg-[var(--sidebar-item-selected-hover)]"
                        : "text-zinc-600 hover:bg-[var(--sidebar-item-hover)] hover:text-zinc-800"
                    }`}
                  >
                    <Icon
                      size={14}
                      className={active === id ? "shrink-0 text-zinc-700" : "shrink-0 text-zinc-400"}
                    />
                    {label}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </nav>
      </aside>

      {/* ── Content ── */}
      <main className="flex min-w-0 flex-1 flex-col overflow-hidden bg-white">
        {/* Drag strip — same height as sidebar chrome row */}
        <div className="relative mt-[10.5px] h-12 shrink-0">
          <div aria-hidden="true" className="window-drag absolute inset-0 z-0" />
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto">
          <div className="mx-auto max-w-[660px] px-12 pb-10 pt-4">
            {active === "general" && <GeneralSection />}
            {active === "appearance" && <AppearanceSection />}
            {active === "vault" && <VaultSection />}
            {active === "privacy" && <PrivacySection />}
            {active === "shortcuts" && <ShortcutsSection />}
          </div>
        </div>
      </main>
    </div>
  );
}

// ── Shared primitives ──────────────────────────────────────────────────────

function SectionTitle({ children }: { children: string }) {
  return <h1 className="mb-7 text-[22px] font-bold tracking-tight text-zinc-900">{children}</h1>;
}

function BlockLabel({ title, desc }: { title: string; desc?: string }) {
  return (
    <div className="mb-3">
      <div className="text-[13.5px] font-semibold text-zinc-800">{title}</div>
      {desc && <div className="mt-0.5 text-[12px] text-zinc-500">{desc}</div>}
    </div>
  );
}

function SettingGroup({ children }: { children: React.ReactNode }) {
  return (
    <div className="mb-5 overflow-hidden rounded-xl border border-zinc-200 bg-white">
      {children}
    </div>
  );
}

function SettingRow({ title, desc, children }: { title: string; desc?: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-4 border-t border-zinc-100 px-4 py-3.5 first:border-t-0">
      <div className="min-w-0 flex-1">
        <div className="text-[13.5px] font-medium text-zinc-800">{title}</div>
        {desc && <div className="mt-0.5 text-[12px] leading-relaxed text-zinc-500">{desc}</div>}
      </div>
      <div className="flex shrink-0 items-center">{children}</div>
    </div>
  );
}

// A controlled Switch using the correct HeroUI v3 compound API
function SettingSwitch({ value, onChange }: { value: boolean; onChange: (v: boolean) => void }) {
  return (
    <Switch.Root isSelected={value} onChange={onChange}>
      <Switch.Control>
        <Switch.Thumb />
      </Switch.Control>
    </Switch.Root>
  );
}

// A simple Select using the correct HeroUI v3 compound API
function SettingSelect({
  defaultKey,
  children,
  className = "w-36",
  isDisabled,
}: {
  defaultKey: string;
  children: React.ReactNode;
  className?: string;
  isDisabled?: boolean;
}) {
  return (
    <Select.Root defaultSelectedKey={defaultKey} isDisabled={isDisabled} className={className}>
      <Select.Trigger className="flex h-8 items-center gap-2 rounded-lg border border-zinc-200 bg-white px-3 text-[12.5px] text-zinc-700 hover:bg-zinc-50 data-[disabled]:opacity-50">
        <Select.Value />
        <Select.Indicator />
      </Select.Trigger>
      <Select.Popover>
        <ListBox.Root className="rounded-xl border border-zinc-200 bg-white py-1 shadow-lg">
          {children}
        </ListBox.Root>
      </Select.Popover>
    </Select.Root>
  );
}

// ── Sections ──────────────────────────────────────────────────────────────

function GeneralSection() {
  const [viewMode, setViewMode] = useState<"grid" | "list">("list");
  const [menuBar, setMenuBar] = useState(true);
  const [bottomBar, setBottomBar] = useState(true);

  return (
    <>
      <SectionTitle>通用</SectionTitle>

      <BlockLabel title="默认视图" desc="选择资产的默认展示方式" />
      <div className="mb-5 flex gap-3">
        {(["grid", "list"] as const).map((mode) => (
          <button
            key={mode}
            type="button"
            onClick={() => setViewMode(mode)}
            className={`relative flex flex-1 flex-col gap-2 rounded-xl border-[1.5px] bg-white p-3.5 text-left transition-shadow ${
              viewMode === mode
                ? "border-blue-500 shadow-[0_0_0_3px_rgba(59,130,246,0.15)]"
                : "border-zinc-200 hover:border-zinc-300"
            }`}
          >
            <div className="flex items-center justify-between">
              {mode === "grid"
                ? <Grid2x2 size={18} className={viewMode === mode ? "text-blue-500" : "text-zinc-400"} />
                : <List size={18} className={viewMode === mode ? "text-blue-500" : "text-zinc-400"} />}
              <span className={`h-3.5 w-3.5 rounded-full border-2 ${
                viewMode === mode
                  ? "border-blue-500 bg-blue-500 shadow-[inset_0_0_0_2px_white]"
                  : "border-zinc-300 bg-white"
              }`} />
            </div>
            <div className="text-[13px] font-semibold text-zinc-800">
              {mode === "grid" ? "网格视图" : "列表视图"}
            </div>
            <div className="text-[11.5px] leading-snug text-zinc-500">
              {mode === "grid" ? "以缩略图网格展示资产" : "以列表形式展示资产详情"}
            </div>
          </button>
        ))}
      </div>

      <SettingGroup>
        <SettingRow title="启动资产库" desc="启动时自动打开的资产库">
          <SettingSelect defaultKey="last">
            <ListBox.Item id="last" className="cursor-pointer px-3 py-1.5 text-[12.5px] text-zinc-700 hover:bg-zinc-50">上次使用的</ListBox.Item>
            <ListBox.Item id="none" className="cursor-pointer px-3 py-1.5 text-[12.5px] text-zinc-700 hover:bg-zinc-50">不自动打开</ListBox.Item>
          </SettingSelect>
        </SettingRow>

        <SettingRow title="语言" desc="界面显示语言">
          <SettingSelect defaultKey="auto">
            <ListBox.Item id="auto" className="cursor-pointer px-3 py-1.5 text-[12.5px] text-zinc-700 hover:bg-zinc-50">跟随系统</ListBox.Item>
            <ListBox.Item id="zh" className="cursor-pointer px-3 py-1.5 text-[12.5px] text-zinc-700 hover:bg-zinc-50">中文</ListBox.Item>
            <ListBox.Item id="en" className="cursor-pointer px-3 py-1.5 text-[12.5px] text-zinc-700 hover:bg-zinc-50">English</ListBox.Item>
          </SettingSelect>
        </SettingRow>

        <SettingRow title="在菜单栏中显示" desc="关闭主窗口后，仍在 macOS 菜单栏保留 Post">
          <SettingSwitch value={menuBar} onChange={setMenuBar} />
        </SettingRow>

        <SettingRow title="底部状态栏" desc="在应用标题栏中显示底部状态控件">
          <SettingSwitch value={bottomBar} onChange={setBottomBar} />
        </SettingRow>
      </SettingGroup>
    </>
  );
}

function AppearanceSection() {
  const [theme, setTheme] = useState<"light" | "dark" | "system">("system");
  const [sidebarIcons, setSidebarIcons] = useState(true);
  const [animations, setAnimations] = useState(true);

  const THEMES = [
    { id: "light" as const, label: "浅色", sub: "始终使用浅色模式", Icon: Sun },
    { id: "dark" as const, label: "深色", sub: "始终使用深色模式", Icon: Moon },
    { id: "system" as const, label: "跟随系统", sub: "同步系统外观设置", Icon: Monitor },
  ];

  return (
    <>
      <SectionTitle>外观</SectionTitle>

      <BlockLabel title="主题" desc="选择界面颜色主题" />
      <div className="mb-5 flex gap-3">
        {THEMES.map(({ id, label, sub, Icon }) => (
          <button
            key={id}
            type="button"
            onClick={() => setTheme(id)}
            className={`relative flex flex-1 flex-col gap-2 rounded-xl border-[1.5px] bg-white p-3.5 text-left transition-shadow ${
              theme === id
                ? "border-blue-500 shadow-[0_0_0_3px_rgba(59,130,246,0.15)]"
                : "border-zinc-200 hover:border-zinc-300"
            }`}
          >
            <div className="flex items-center justify-between">
              <Icon size={18} className={theme === id ? "text-blue-500" : "text-zinc-400"} />
              <span className={`h-3.5 w-3.5 rounded-full border-2 ${
                theme === id
                  ? "border-blue-500 bg-blue-500 shadow-[inset_0_0_0_2px_white]"
                  : "border-zinc-300 bg-white"
              }`} />
            </div>
            <div className="text-[13px] font-semibold text-zinc-800">{label}</div>
            <div className="text-[11.5px] leading-snug text-zinc-500">{sub}</div>
          </button>
        ))}
      </div>

      <SettingGroup>
        <SettingRow title="信息密度" desc="调整界面元素的间距与大小">
          <SettingSelect defaultKey="normal" className="w-28">
            <ListBox.Item id="normal" className="cursor-pointer px-3 py-1.5 text-[12.5px] text-zinc-700 hover:bg-zinc-50">标准</ListBox.Item>
            <ListBox.Item id="compact" className="cursor-pointer px-3 py-1.5 text-[12.5px] text-zinc-700 hover:bg-zinc-50">紧凑</ListBox.Item>
          </SettingSelect>
        </SettingRow>
        <SettingRow title="侧边栏图标" desc="在侧边栏条目旁显示图标">
          <SettingSwitch value={sidebarIcons} onChange={setSidebarIcons} />
        </SettingRow>
        <SettingRow title="界面动画" desc="启用过渡动画和视差效果">
          <SettingSwitch value={animations} onChange={setAnimations} />
        </SettingRow>
      </SettingGroup>
    </>
  );
}

function VaultSection() {
  const [autoIndex, setAutoIndex] = useState(true);
  const [autoSync, setAutoSync] = useState(true);
  const [thumbnails, setThumbnails] = useState(true);
  const [indexHidden, setIndexHidden] = useState(false);

  return (
    <>
      <SectionTitle>资产库</SectionTitle>

      <SettingGroup>
        <SettingRow title="自动索引" desc="文件变化时自动重新索引资产库内容">
          <SettingSwitch value={autoIndex} onChange={setAutoIndex} />
        </SettingRow>
        <SettingRow title="自动同步" desc="定期检查文件系统变化并同步到数据库">
          <SettingSwitch value={autoSync} onChange={setAutoSync} />
        </SettingRow>
        <SettingRow title="同步间隔" desc="后台检查文件变化的频率">
          <SettingSelect defaultKey="5" isDisabled={!autoSync}>
            <ListBox.Item id="1" className="cursor-pointer px-3 py-1.5 text-[12.5px] text-zinc-700 hover:bg-zinc-50">每 1 分钟</ListBox.Item>
            <ListBox.Item id="5" className="cursor-pointer px-3 py-1.5 text-[12.5px] text-zinc-700 hover:bg-zinc-50">每 5 分钟</ListBox.Item>
            <ListBox.Item id="15" className="cursor-pointer px-3 py-1.5 text-[12.5px] text-zinc-700 hover:bg-zinc-50">每 15 分钟</ListBox.Item>
            <ListBox.Item id="30" className="cursor-pointer px-3 py-1.5 text-[12.5px] text-zinc-700 hover:bg-zinc-50">每 30 分钟</ListBox.Item>
          </SettingSelect>
        </SettingRow>
        <SettingRow title="索引隐藏文件" desc="将点开头的隐藏文件和文件夹纳入索引">
          <SettingSwitch value={indexHidden} onChange={setIndexHidden} />
        </SettingRow>
      </SettingGroup>

      <SettingGroup>
        <SettingRow title="生成视频缩略图" desc="为视频资产自动生成预览缩略图">
          <SettingSwitch value={thumbnails} onChange={setThumbnails} />
        </SettingRow>
        <SettingRow title="缩略图质量" desc="生成的缩略图质量（影响磁盘占用）">
          <SettingSelect defaultKey="medium" className="w-28" isDisabled={!thumbnails}>
            <ListBox.Item id="high" className="cursor-pointer px-3 py-1.5 text-[12.5px] text-zinc-700 hover:bg-zinc-50">高质量</ListBox.Item>
            <ListBox.Item id="medium" className="cursor-pointer px-3 py-1.5 text-[12.5px] text-zinc-700 hover:bg-zinc-50">中等</ListBox.Item>
            <ListBox.Item id="low" className="cursor-pointer px-3 py-1.5 text-[12.5px] text-zinc-700 hover:bg-zinc-50">低质量</ListBox.Item>
          </SettingSelect>
        </SettingRow>
      </SettingGroup>
    </>
  );
}

function PrivacySection() {
  const [privateEnabled, setPrivateEnabled] = useState(true);
  const [analytics, setAnalytics] = useState(false);
  const [crashReports, setCrashReports] = useState(true);

  return (
    <>
      <SectionTitle>隐私</SectionTitle>

      <SettingGroup>
        <SettingRow title="隐私资产" desc="开启后可将资产标记为私密，私密资产在默认视图中隐藏">
          <SettingSwitch value={privateEnabled} onChange={setPrivateEnabled} />
        </SettingRow>
        <SettingRow title="匿名数据收集" desc="发送匿名使用统计，帮助改善 Post。不包含任何个人或资产信息">
          <SettingSwitch value={analytics} onChange={setAnalytics} />
        </SettingRow>
        <SettingRow title="崩溃报告" desc="应用崩溃时自动上报诊断信息，不含个人数据">
          <SettingSwitch value={crashReports} onChange={setCrashReports} />
        </SettingRow>
      </SettingGroup>

      <div className="flex items-start gap-3 rounded-xl border border-blue-100 bg-blue-50 px-4 py-3">
        <svg className="mt-0.5 shrink-0 text-blue-500" width={14} height={14} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round">
          <circle cx="8" cy="8" r="6" />
          <line x1="8" y1="7.5" x2="8" y2="11" />
          <circle cx="8" cy="5.2" r="0.6" fill="currentColor" stroke="none" />
        </svg>
        <p className="text-[12.5px] leading-relaxed text-zinc-600">
          Post 的所有资产数据均存储在本地，不会上传至任何云服务器。
        </p>
      </div>
    </>
  );
}

const SHORTCUTS = [
  { label: "搜索资产", keys: ["⌘", "K"] },
  { label: "新建笔记", keys: ["⌘", "N"] },
  { label: "切换侧边栏", keys: ["⌘", "["] },
  { label: "刷新资产库", keys: ["⌘", "R"] },
  { label: "切换预览面板", keys: ["⌘", "P"] },
  { label: "打开设置", keys: ["⌘", ","] },
  { label: "切换私密视图", keys: ["⌘", "⇧", "H"] },
  { label: "下一个资产", keys: ["↓"] },
  { label: "上一个资产", keys: ["↑"] },
  { label: "关闭详情面板", keys: ["Esc"] },
];

function ShortcutsSection() {
  return (
    <>
      <SectionTitle>快捷键</SectionTitle>
      <SettingGroup>
        {SHORTCUTS.map(({ label, keys }) => (
          <SettingRow key={label} title={label}>
            <div className="flex items-center gap-1">
              {keys.map((k) => (
                <kbd key={k} className="inline-flex h-[22px] min-w-[22px] items-center justify-center rounded-md border border-zinc-200 bg-zinc-50 px-1.5 font-mono text-[11px] text-zinc-600">
                  {k}
                </kbd>
              ))}
            </div>
          </SettingRow>
        ))}
      </SettingGroup>
    </>
  );
}
