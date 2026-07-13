/**
 * @purpose Capture OS file drops onto the desktop shell with four-state feedback.
 * @role    App-shell overlay: hover stack / blocked / in-flight pill / done-or-failed pill.
 * @deps    React, motion, lucide, react-i18next, tRPC mutation, vault invalidation.
 * @gotcha  Activate for external Files even without a vault (blocked UI). Resolve paths via preload.
 *          Prefer relatedTarget leave over drag-depth — nested board remounts after import can desync depth
 *          and leave previewRef set while React state is null (second hover shows no mask).
 *          Secondary drops replace flight; the first import task remains visible in the footer.
 *          window-no-drag is required on the pill (app-region trap — see app-shell header).
 */

import { useCallback, useEffect, useRef, useState, type DragEvent, type ReactNode } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { Ban, File, Film, Image as ImageIcon } from "lucide-react";
import { useTranslation } from "react-i18next";

import { ImportProgressPill, type ImportFlight } from "@/components/layout/import-progress-pill";
import { useInvalidateVaultState } from "@/hooks/use-invalidate-vault-state";
import { toast } from "@/lib/toast";
import { trpc, trpcClient } from "@/lib/trpc";

type DragKind = "image" | "video" | "file";
type DragPreview = { count: number; kind: DragKind };

function hasFilePayload(dataTransfer: DataTransfer | null): boolean {
  if (!dataTransfer) {
    return false;
  }
  return Array.from(dataTransfer.types).includes("Files");
}

function readDragItems(dataTransfer: DataTransfer): DragPreview {
  const items = Array.from(dataTransfer.items ?? []).filter((item) => item.kind === "file");
  if (items.length === 0) {
    // Fallback: some platforms expose files but empty items during dragover.
    const fileCount = dataTransfer.files?.length ?? 0;
    if (fileCount === 0) {
      return { count: 1, kind: "file" };
    }
    return { count: fileCount, kind: kindFromMime(dataTransfer.files[0]?.type ?? "") };
  }

  return {
    count: items.length,
    kind: kindFromMime(items[0]?.type ?? ""),
  };
}

function kindFromMime(mime: string): DragKind {
  if (mime.startsWith("image/")) {
    return "image";
  }
  if (mime.startsWith("video/")) {
    return "video";
  }
  return "file";
}

function isLeavingDropZone(event: DragEvent<HTMLDivElement>): boolean {
  const next = event.relatedTarget;
  if (!(next instanceof Node)) {
    return true;
  }
  return !event.currentTarget.contains(next);
}

function DropCardStack({ count, kind }: { count: number; kind: DragKind }) {
  const Icon = kind === "image" ? ImageIcon : kind === "video" ? Film : File;
  const cards = Math.min(3, Math.max(1, count));

  return (
    <div className="relative h-[5.5rem] w-[5.5rem]">
      {cards >= 3 ? (
        <div className="absolute inset-0 rotate-[-6deg] rounded-xl border border-zinc-200 bg-white opacity-50 shadow-sm" />
      ) : null}
      {cards >= 2 ? (
        <div className="absolute inset-0 rotate-[6deg] rounded-xl border border-zinc-200 bg-white opacity-70 shadow-sm" />
      ) : null}
      <div className="absolute inset-0 flex items-center justify-center rounded-xl border border-zinc-200 bg-white shadow-md">
        <Icon size={28} strokeWidth={1.6} className="text-zinc-800" />
        <span className="absolute -right-2 -top-2 flex h-6 min-w-6 items-center justify-center rounded-full bg-zinc-950 px-1.5 text-[11px] font-semibold text-white">
          {count}
        </span>
      </div>
    </div>
  );
}

export function FileDropZone({ children }: { children: ReactNode }) {
  const { t } = useTranslation();
  const reduceMotion = useReducedMotion();
  const invalidateVaultState = useInvalidateVaultState();
  const rootRef = useRef<HTMLDivElement>(null);
  const previewRef = useRef<DragPreview | null>(null);
  const clearFlightTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [preview, setPreview] = useState<DragPreview | null>(null);
  const [flight, setFlight] = useState<ImportFlight | null>(null);

  const tasksQuery = useQuery({
    ...trpc.tasks.snapshot.queryOptions(),
    refetchInterval: 5_000,
  });
  const hasVault = Boolean(tasksQuery.data?.activeVault);
  const vaultName = tasksQuery.data?.activeVault?.name ?? "";

  const clearFlightLater = useCallback(() => {
    if (clearFlightTimer.current) {
      clearTimeout(clearFlightTimer.current);
    }
    clearFlightTimer.current = setTimeout(() => {
      clearFlightTimer.current = null;
      setFlight(null);
    }, 4_000);
  }, []);

  const importMutation = useMutation(
    trpc.assets.importLocalFiles.mutationOptions({
      onSuccess: async (result) => {
        await invalidateVaultState();
        setFlight((current) =>
          current
            ? {
                ...current,
                phase: result.imported > 0 || result.relativePaths.length > 0 ? "done" : "failed",
                result,
                errorMessage:
                  result.imported === 0 && result.failed > 0
                    ? t("shell.dropImportFailed")
                    : undefined,
              }
            : current,
        );
        clearFlightLater();
      },
      onError: (error) => {
        setFlight((current) =>
          current
            ? {
                ...current,
                phase: "failed",
                errorMessage: error.message || t("shell.dropImportFailed"),
              }
            : current,
        );
      },
    }),
  );

  useEffect(() => {
    if (!flight || flight.phase !== "importing") {
      return;
    }

    const subscription = trpcClient.events.subscribe.subscribe(undefined, {
      onData: (event) => {
        if (event.type !== "task.updated" || event.task.type !== "import" || event.task.hidden) {
          return;
        }
        if (event.task.startedAt < flight.startedAt) {
          return;
        }
        const current = event.task.progress?.current;
        const total = event.task.progress?.total;
        if (current == null && total == null) {
          return;
        }
        setFlight((existing) =>
          existing && existing.phase === "importing"
            ? {
                ...existing,
                progressCurrent: current,
                progressTotal: total,
              }
            : existing,
        );
      },
    });

    return () => {
      subscription.unsubscribe();
    };
  }, [flight]);

  const clearDrag = useCallback(() => {
    previewRef.current = null;
    setPreview(null);
  }, []);

  const showDragPreview = useCallback((next: DragPreview) => {
    const prev = previewRef.current;
    previewRef.current = next;
    setPreview((current) => {
      if (
        current &&
        prev &&
        current.count === next.count &&
        current.kind === next.kind &&
        prev.count === next.count &&
        prev.kind === next.kind
      ) {
        return current;
      }
      return next;
    });
  }, []);

  useEffect(() => {
    const onWindowDragEnd = () => {
      clearDrag();
    };
    window.addEventListener("dragend", onWindowDragEnd);
    return () => {
      window.removeEventListener("dragend", onWindowDragEnd);
      if (clearFlightTimer.current) {
        clearTimeout(clearFlightTimer.current);
      }
    };
  }, [clearDrag]);

  const onDragEnter = useCallback(
    (event: DragEvent<HTMLDivElement>) => {
      if (!hasFilePayload(event.dataTransfer)) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      showDragPreview(readDragItems(event.dataTransfer));
    },
    [showDragPreview],
  );

  const onDragOver = useCallback(
    (event: DragEvent<HTMLDivElement>) => {
      if (!hasFilePayload(event.dataTransfer)) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      event.dataTransfer.dropEffect = hasVault ? "copy" : "none";
      // dragover is the recovery path when dragenter is skipped after a prior drop (Chromium/Electron).
      showDragPreview(readDragItems(event.dataTransfer));
    },
    [hasVault, showDragPreview],
  );

  const onDragLeave = useCallback(
    (event: DragEvent<HTMLDivElement>) => {
      if (!isLeavingDropZone(event)) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      clearDrag();
    },
    [clearDrag],
  );

  const startImport = useCallback(
    (paths: string[]) => {
      if (clearFlightTimer.current) {
        clearTimeout(clearFlightTimer.current);
        clearFlightTimer.current = null;
      }
      setFlight({
        paths,
        count: paths.length,
        startedAt: Date.now(),
        phase: "importing",
      });
      importMutation.mutate({ paths });
    },
    [importMutation],
  );

  const onDrop = useCallback(
    (event: DragEvent<HTMLDivElement>) => {
      event.preventDefault();
      event.stopPropagation();
      clearDrag();

      if (!hasVault) {
        toast.warning(t("shell.dropImportNoVault"));
        return;
      }

      const files = Array.from(event.dataTransfer.files);
      if (files.length === 0) {
        return;
      }

      const paths = window.api.resolveDroppedFilePaths(files);
      if (paths.length === 0) {
        toast.danger(t("shell.dropImportFailed"));
        return;
      }

      // A second drop replaces the capsule; the prior import task stays in the footer.
      startImport(paths);
    },
    [clearDrag, hasVault, startImport, t],
  );

  const showMask = preview != null;
  const blocked = showMask && !hasVault;

  return (
    <div
      ref={rootRef}
      className="relative h-screen min-h-0 overflow-hidden"
      onDragEnter={onDragEnter}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    >
      {children}
      <AnimatePresence>
        {showMask && preview ? (
          <motion.div
            key="file-drop-mask"
            className="pointer-events-none absolute inset-0 z-[190] flex items-center justify-center bg-zinc-950/25"
            initial={reduceMotion ? { opacity: 1 } : { opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: reduceMotion ? 0 : 0.16 }}
            aria-hidden
          >
            <motion.div
              className="relative z-[1] flex flex-col items-center gap-4"
              initial={reduceMotion ? false : { scale: 1.12, opacity: 0.6 }}
              animate={
                reduceMotion
                  ? { scale: 1, opacity: 1 }
                  : {
                      scale: [1.12, 0.96, 1],
                      opacity: [0.6, 1, 1],
                    }
              }
              exit={
                reduceMotion
                  ? { opacity: 0 }
                  : { scale: 0.9, opacity: 0, transition: { duration: 0.18 } }
              }
              transition={
                reduceMotion
                  ? { duration: 0 }
                  : { duration: 0.55, ease: [0.22, 1, 0.36, 1], times: [0, 0.65, 1] }
              }
            >
              {blocked ? (
                <>
                  <div className="flex h-[5.5rem] w-[5.5rem] items-center justify-center rounded-xl border border-dashed border-zinc-400 bg-white/80 text-zinc-500">
                    <Ban size={28} strokeWidth={1.6} />
                  </div>
                  <div className="max-w-[16rem] text-center text-white">
                    <div className="text-[14px] font-semibold tracking-tight">
                      {t("shell.dropBlockedTitle")}
                    </div>
                    <div className="mt-1 text-[12.5px] text-white/80">
                      {t("shell.dropBlockedHint")}
                    </div>
                  </div>
                </>
              ) : (
                <>
                  <DropCardStack count={preview.count} kind={preview.kind} />
                  <div className="max-w-[16rem] text-center text-white">
                    <div className="text-[14px] font-semibold tracking-tight">
                      {t("shell.dropHoverTitle")}
                    </div>
                    {vaultName ? (
                      <div className="mt-1 text-[12.5px] text-white/80">
                        {t("shell.dropHoverTarget", { name: vaultName })}
                      </div>
                    ) : null}
                  </div>
                </>
              )}
            </motion.div>
          </motion.div>
        ) : null}
      </AnimatePresence>
      <AnimatePresence>
        {flight ? (
          <motion.div
            key="import-progress-pill"
            className="pointer-events-none"
            initial={reduceMotion ? { opacity: 0 } : { opacity: 0, y: 10, scale: 0.96 }}
            animate={reduceMotion ? { opacity: 1 } : { opacity: 1, y: 0, scale: 1 }}
            exit={reduceMotion ? { opacity: 0 } : { opacity: 0, y: 8, scale: 0.96 }}
            transition={{ duration: reduceMotion ? 0.12 : 0.2 }}
          >
            <ImportProgressPill
              flight={flight}
              onRetry={() => {
                startImport(flight.paths);
              }}
            />
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  );
}
