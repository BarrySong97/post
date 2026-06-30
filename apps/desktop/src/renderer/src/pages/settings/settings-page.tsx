/**
 * @purpose Render the settings surface for the desktop renderer.
 * @role    App-level React component composed by routes, shell, or shared workflows.
 * @deps    React, HeroUI/local UI primitives, tRPC hooks, and shared renderer modules as needed.
 * @gotcha  Keep operational layouts dense and aligned with design.md icon and panel sizing rules.
 */

import { useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { ArrowLeft, Settings } from "lucide-react";
import { Button, Input, ListBox, Select } from "@heroui/react";

import { readSidebarWidthPct, SIDEBAR_MIN_WIDTH_PX } from "@/lib/asset-manager/storage";
import { isMacWindow } from "@/lib/platform";

type SettingsSection = "general";

const NAV = [
  {
    group: "偏好",
    items: [{ id: "general" as const, label: "通用", Icon: Settings }],
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
        style={{ width: sidebarWidth, minWidth: `${SIDEBAR_MIN_WIDTH_PX}px` }}
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
                      className={
                        active === id ? "shrink-0 text-zinc-700" : "shrink-0 text-zinc-400"
                      }
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

function SettingGroup({ children }: { children: React.ReactNode }) {
  return (
    <div className="mb-5 overflow-hidden rounded-xl border border-zinc-200 bg-white">
      {children}
    </div>
  );
}

function SettingRow({
  title,
  desc,
  children,
}: {
  title: string;
  desc?: string;
  children: React.ReactNode;
}) {
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
  return (
    <>
      <SectionTitle>通用</SectionTitle>

      <SettingGroup>
        <SettingRow title="语言" desc="界面显示语言">
          <SettingSelect defaultKey="auto">
            <ListBox.Item
              id="auto"
              className="cursor-pointer px-3 py-1.5 text-[12.5px] text-zinc-700 hover:bg-zinc-50"
            >
              跟随系统
            </ListBox.Item>
            <ListBox.Item
              id="zh"
              className="cursor-pointer px-3 py-1.5 text-[12.5px] text-zinc-700 hover:bg-zinc-50"
            >
              中文
            </ListBox.Item>
            <ListBox.Item
              id="en"
              className="cursor-pointer px-3 py-1.5 text-[12.5px] text-zinc-700 hover:bg-zinc-50"
            >
              English
            </ListBox.Item>
          </SettingSelect>
        </SettingRow>
      </SettingGroup>
    </>
  );
}
