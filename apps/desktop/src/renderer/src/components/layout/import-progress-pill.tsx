/**
 * @purpose Show a fixed bottom-right capsule for in-flight local file import.
 * @role    Presentational progress pill owned by FileDropZone flight state.
 * @deps    React, lucide, react-i18next.
 * @gotcha  Must use window-no-drag so clicks work under Electron app-region chrome.
 */

import { Loader2 } from "lucide-react";
import { useTranslation } from "react-i18next";

export type ImportFlightPhase = "importing" | "done" | "failed";

export type ImportFlight = {
  paths: string[];
  count: number;
  startedAt: number;
  phase: ImportFlightPhase;
  progressCurrent?: number;
  progressTotal?: number;
  result?: { imported: number; skipped: number; failed: number; relativePaths: string[] };
  errorMessage?: string;
};

export function ImportProgressPill({
  flight,
  onRetry,
}: {
  flight: ImportFlight;
  onRetry: () => void;
}) {
  const { t } = useTranslation();

  const tone =
    flight.phase === "done"
      ? "bg-emerald-800 text-white"
      : flight.phase === "failed"
        ? "bg-red-800 text-white"
        : "bg-zinc-950 text-white";

  const label =
    flight.phase === "done"
      ? t("shell.importPillDone", { count: flight.result?.imported ?? flight.count })
      : flight.phase === "failed"
        ? t("shell.importPillFailed")
        : flight.progressTotal && flight.progressTotal > 0 && flight.progressCurrent != null
          ? t("shell.importPillRunning", {
              current: flight.progressCurrent,
              total: flight.progressTotal,
            })
          : t("shell.importPillRunning", {
              current: "…",
              total: flight.count,
            });

  return (
    <div
      className={`fixed bottom-[42px] right-3.5 z-[150] window-no-drag flex items-center gap-2 rounded-full px-3.5 py-2 text-[12.5px] font-medium shadow-[0_10px_28px_rgba(0,0,0,0.22)] ${tone}`}
      role="status"
    >
      {flight.phase === "importing" ? (
        <Loader2 size={14} className="animate-spin opacity-90" />
      ) : null}
      <span className="leading-none tracking-tight">{label}</span>
      {flight.phase === "failed" ? (
        <button
          type="button"
          className="rounded-full bg-white/15 px-2 py-0.5 text-[11.5px] leading-none hover:bg-white/25"
          onClick={onRetry}
        >
          {t("shell.retry")}
        </button>
      ) : null}
    </div>
  );
}
