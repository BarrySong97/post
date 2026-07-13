/**
 * @purpose Capture OS file drops onto the desktop shell and show an inhale-style hover mask.
 * @role    App-shell overlay that copies dropped paths into the active vault via tRPC.
 * @deps    React, motion, lucide, react-i18next, tRPC mutation, vault invalidation, toast helpers.
 * @gotcha  Only activate for external Files transfers when a vault is active; use drag-depth to
 *          avoid flicker from nested dragenter/leave. Resolve paths through preload webUtils.
 */

import { useCallback, useRef, useState, type DragEvent, type ReactNode } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { Download } from "lucide-react";
import { useTranslation } from "react-i18next";

import { useInvalidateVaultState } from "@/hooks/use-invalidate-vault-state";
import { toast } from "@/lib/toast";
import { trpc } from "@/lib/trpc";

function hasFilePayload(dataTransfer: DataTransfer | null): boolean {
  if (!dataTransfer) {
    return false;
  }
  return Array.from(dataTransfer.types).includes("Files");
}

export function FileDropZone({ children }: { children: ReactNode }) {
  const { t } = useTranslation();
  const reduceMotion = useReducedMotion();
  const invalidateVaultState = useInvalidateVaultState();
  const dragDepth = useRef(0);
  const [active, setActive] = useState(false);

  const tasksQuery = useQuery({
    ...trpc.tasks.snapshot.queryOptions(),
    refetchInterval: 5_000,
  });
  const hasVault = Boolean(tasksQuery.data?.activeVault);

  const importMutation = useMutation(
    trpc.assets.importLocalFiles.mutationOptions({
      onSuccess: async (result) => {
        await invalidateVaultState();
        if (result.imported > 0) {
          toast.success(t("shell.dropImportSuccess", { count: result.imported }));
        } else if (result.failed > 0) {
          toast.danger(t("shell.dropImportFailed"));
        } else {
          toast.info(t("shell.dropImportSkipped"));
        }
      },
      onError: (error) => {
        toast.danger(error.message || t("shell.dropImportFailed"));
      },
    }),
  );

  const clearDrag = useCallback(() => {
    dragDepth.current = 0;
    setActive(false);
  }, []);

  const onDragEnter = useCallback(
    (event: DragEvent<HTMLDivElement>) => {
      if (!hasVault || !hasFilePayload(event.dataTransfer)) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      dragDepth.current += 1;
      setActive(true);
    },
    [hasVault],
  );

  const onDragOver = useCallback(
    (event: DragEvent<HTMLDivElement>) => {
      if (!hasVault || !hasFilePayload(event.dataTransfer)) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      event.dataTransfer.dropEffect = "copy";
    },
    [hasVault],
  );

  const onDragLeave = useCallback((event: DragEvent<HTMLDivElement>) => {
    if (!hasFilePayload(event.dataTransfer)) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    dragDepth.current = Math.max(0, dragDepth.current - 1);
    if (dragDepth.current === 0) {
      setActive(false);
    }
  }, []);

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

      importMutation.mutate({ paths });
    },
    [clearDrag, hasVault, importMutation, t],
  );

  return (
    <div
      className="relative h-screen min-h-0 overflow-hidden"
      onDragEnter={onDragEnter}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    >
      {children}
      <AnimatePresence>
        {active ? (
          <motion.div
            key="file-drop-mask"
            className="pointer-events-none absolute inset-0 z-[190] flex items-center justify-center bg-zinc-950/40"
            initial={reduceMotion ? { opacity: 1 } : { opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={reduceMotion ? { opacity: 0 } : { opacity: 0 }}
            transition={{ duration: reduceMotion ? 0 : 0.16 }}
            aria-hidden
          >
            <motion.div
              className="relative flex h-40 w-40 flex-col items-center justify-center gap-3 rounded-2xl border border-dashed border-white/70 bg-white/10 text-white shadow-[0_18px_48px_rgba(0,0,0,0.28)] backdrop-blur-[2px]"
              initial={reduceMotion ? false : { scale: 1.18, opacity: 0.55 }}
              animate={
                reduceMotion
                  ? { scale: 1, opacity: 1 }
                  : {
                      scale: [1.18, 0.94, 1],
                      opacity: [0.55, 1, 1],
                    }
              }
              transition={
                reduceMotion
                  ? { duration: 0 }
                  : { duration: 0.55, ease: [0.22, 1, 0.36, 1], times: [0, 0.65, 1] }
              }
            >
              {!reduceMotion ? (
                <motion.span
                  className="pointer-events-none absolute inset-[-18%] rounded-[28px] border border-white/25"
                  initial={{ scale: 1.35, opacity: 0.45 }}
                  animate={{ scale: 0.92, opacity: 0 }}
                  transition={{
                    duration: 0.7,
                    ease: "easeOut",
                    repeat: Infinity,
                    repeatDelay: 0.15,
                  }}
                />
              ) : null}
              <Download size={22} strokeWidth={1.75} className="relative z-[1]" />
              <span className="relative z-[1] px-3 text-center text-[13px] font-medium leading-tight tracking-tight">
                {t("shell.dropImportHint")}
              </span>
            </motion.div>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  );
}
