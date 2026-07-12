/**
 * @purpose Render the settings surface for the desktop renderer.
 * @role    App-level React component composed by routes, shell, or shared workflows.
 * @deps    React, HeroUI/local UI primitives, tRPC hooks, and shared renderer modules as needed.
 * @gotcha  Keep operational layouts dense and aligned with design.md icon and panel sizing rules.
 *          Language preference is stored under post.locale via changeAppLanguage.
 */

import { useMemo, useState } from "react";
import { useAtomValue } from "jotai";
import { useNavigate } from "@tanstack/react-router";
import { ArrowLeft, Settings } from "lucide-react";
import { Button, Input, ListBox, Select } from "@heroui/react";
import { useTranslation } from "react-i18next";

import { changeAppLanguage, getStoredLocalePreference, type AppLocale } from "@/i18n";
import { readSidebarWidthPct, SIDEBAR_MIN_WIDTH_PX } from "@/lib/asset-manager/storage";
import { isMacWindow } from "@/lib/platform";
import { updateStatusAtom } from "@/store/update-atoms";
import type { UpdateStatusEvent } from "@shared/contracts/update/update.contract";

type SettingsSection = "general";

function updateStatusNote(
  status: UpdateStatusEvent | null,
  t: (key: string, options?: Record<string, unknown>) => string,
): string {
  switch (status?.state) {
    case "checking":
      return t("settings.updateChecking");
    case "available":
      return t("settings.updateAvailable", { version: status.version ?? "" }).trim();
    case "downloading":
      return t("settings.updateDownloading", { percent: status.percent ?? 0 });
    case "downloaded":
      return t("settings.updateDownloaded");
    case "not-available":
      return t("settings.updateLatest");
    case "error":
      return t("settings.updateError");
    default:
      return t("settings.updateIdle");
  }
}

function updateActionLabel(status: UpdateStatusEvent | null, t: (key: string) => string): string {
  if (status?.state === "available") {
    return t("settings.downloadUpdate");
  }
  if (status?.state === "checking") {
    return t("settings.checking");
  }
  if (status?.state === "downloading") {
    return t("settings.downloading");
  }
  if (status?.state === "downloaded") {
    return t("settings.restarting");
  }
  return t("settings.checkUpdate");
}

function isUpdateActionDisabled(status: UpdateStatusEvent | null): boolean {
  return (
    status?.state === "checking" ||
    status?.state === "downloading" ||
    status?.state === "downloaded"
  );
}

export function SettingsPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [active, setActive] = useState<SettingsSection>("general");
  const [query, setQuery] = useState("");
  const chromePadding = isMacWindow() ? "pl-[100px]" : "pl-3";
  const sidebarWidth = `${readSidebarWidthPct()}vw`;

  const nav = useMemo(
    () => [
      {
        group: t("settings.preferences"),
        items: [{ id: "general" as const, label: t("settings.general"), Icon: Settings }],
      },
    ],
    [t],
  );

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
              aria-label={t("nav.backToApp")}
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
            placeholder={t("common.searchSettings")}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="h-7 rounded-lg bg-black/[0.045] px-2 text-[12px] text-zinc-700 placeholder:text-zinc-400 outline-none border-none ring-0 w-full"
          />
        </div>

        {/* Nav */}
        <nav className="min-h-0 flex-1 overflow-y-auto px-2 pb-4 pt-1">
          {nav.map((section) => (
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

function SettingSelect({
  selectedKey,
  onSelectionChange,
  children,
  className = "w-36",
  isDisabled,
}: {
  selectedKey: string;
  onSelectionChange: (key: string) => void;
  children: React.ReactNode;
  className?: string;
  isDisabled?: boolean;
}) {
  return (
    <Select.Root
      selectedKey={selectedKey}
      onSelectionChange={(key) => {
        if (key != null) {
          onSelectionChange(String(key));
        }
      }}
      isDisabled={isDisabled}
      className={className}
    >
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
  const { t } = useTranslation();
  const updateStatus = useAtomValue(updateStatusAtom);
  const [localePreference, setLocalePreference] = useState<AppLocale>(() =>
    getStoredLocalePreference(),
  );
  const updateButtonLabel = updateActionLabel(updateStatus, t);
  const updateButtonDisabled = isUpdateActionDisabled(updateStatus);
  const handleUpdateAction = () => {
    if (updateButtonDisabled) {
      return;
    }
    if (updateStatus?.state === "available") {
      void window.api.updater.download();
      return;
    }
    void window.api.updater.check();
  };

  return (
    <>
      <SectionTitle>{t("settings.general")}</SectionTitle>

      <SettingGroup>
        <SettingRow title={t("settings.language")} desc={t("settings.languageDesc")}>
          <SettingSelect
            selectedKey={localePreference}
            onSelectionChange={(key) => {
              const next = key as AppLocale;
              setLocalePreference(next);
              void changeAppLanguage(next);
            }}
          >
            <ListBox.Item
              id="auto"
              textValue={t("settings.followSystem")}
              className="cursor-pointer px-3 py-1.5 text-[12.5px] text-zinc-700 hover:bg-zinc-50"
            >
              {t("settings.followSystem")}
            </ListBox.Item>
            <ListBox.Item
              id="zh-CN"
              textValue={t("settings.chinese")}
              className="cursor-pointer px-3 py-1.5 text-[12.5px] text-zinc-700 hover:bg-zinc-50"
            >
              {t("settings.chinese")}
            </ListBox.Item>
            <ListBox.Item
              id="en"
              textValue={t("settings.english")}
              className="cursor-pointer px-3 py-1.5 text-[12.5px] text-zinc-700 hover:bg-zinc-50"
            >
              {t("settings.english")}
            </ListBox.Item>
          </SettingSelect>
        </SettingRow>
      </SettingGroup>

      <SettingGroup>
        <SettingRow title={t("settings.currentVersion")} desc={t("settings.currentVersionDesc")}>
          <span className="font-mono text-[12.5px] text-zinc-500">v{__APP_VERSION__}</span>
        </SettingRow>
        <SettingRow title={t("settings.softwareUpdate")} desc={updateStatusNote(updateStatus, t)}>
          <Button
            size="sm"
            className="h-8 rounded-lg px-3 text-[12.5px]"
            isDisabled={updateButtonDisabled}
            onPress={handleUpdateAction}
          >
            {updateButtonLabel}
          </Button>
        </SettingRow>
      </SettingGroup>
    </>
  );
}
