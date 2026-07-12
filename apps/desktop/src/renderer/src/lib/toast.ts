/**
 * @purpose Provide renderer toast utilities shared across pages and components.
 * @role    Small renderer helper module outside page-specific ownership.
 * @deps    Renderer runtime only (no HeroUI ToastQueue — Electron + view transitions were unstable).
 * @gotcha  Keep helpers browser-safe unless they intentionally call preload-exposed APIs.
 *          For mutations that refresh the board: await invalidate first, then
 *          `showToastAfterRefresh(() => toast.success(...))` so the toast tracks the list update.
 */

import type { ReactNode } from "react";

type ToastVariant = "default" | "accent" | "success" | "warning" | "danger";
type ToastOptions = {
  id?: string;
  description?: ReactNode;
  variant?: ToastVariant;
  timeout?: number;
  actionLabel?: string;
  onAction?: () => void;
  onClose?: () => void;
};
export type ToastItem = {
  id: string;
  title: ReactNode;
  description?: ReactNode;
  variant: ToastVariant;
  actionLabel?: string;
  onAction?: () => void;
};

const DEFAULT_TIMEOUT = 4000;
/** Keep in sync with GlobalToast / UpdateToast enter `transition.duration`. */
export const TOAST_ENTER_MS = 200;
const listeners = new Set<() => void>();
const timers = new Map<string, ReturnType<typeof setTimeout>>();
let items: ToastItem[] = [];

function emit() {
  for (const listener of listeners) {
    listener();
  }
}

function closeToast(id: string) {
  const timer = timers.get(id);
  if (timer) {
    clearTimeout(timer);
    timers.delete(id);
  }

  const nextItems = items.filter((item) => item.id !== id);
  if (nextItems.length === items.length) {
    return;
  }

  items = nextItems;
  emit();
}

function addToast(title: ReactNode, options?: ToastOptions) {
  const id =
    options?.id ?? `toast_${Date.now().toString(36)}_${Math.random().toString(36).slice(2)}`;
  const existingTimer = timers.get(id);
  if (existingTimer) {
    clearTimeout(existingTimer);
    timers.delete(id);
  }

  items = [
    {
      id,
      title,
      description: options?.description,
      variant: options?.variant ?? "default",
      actionLabel: options?.actionLabel,
      onAction: options?.onAction,
    },
    ...items.filter((item) => item.id !== id),
  ].slice(0, 3);
  emit();

  const timeout = options?.timeout ?? DEFAULT_TIMEOUT;
  if (timeout > 0) {
    timers.set(
      id,
      setTimeout(() => {
        closeToast(id);
        options?.onClose?.();
      }, timeout),
    );
  }

  return id;
}

/**
 * Show a toast after vault refresh has been awaited, once the browser has had a chance
 * to paint the updated list. Keeps success feedback in sync with the board instead of
 * leading the list by a large margin.
 */
export function showToastAfterRefresh(show: () => void) {
  if (typeof requestAnimationFrame !== "function") {
    show();
    return;
  }

  // Double-rAF: first after style/layout from invalidate, second after that paint commits.
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      show();
    });
  });
}

export function subscribeToasts(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getToastSnapshot() {
  return items;
}

function createToast() {
  const fn = (message: ReactNode, options?: ToastOptions) => addToast(message, options);

  fn.success = (message: ReactNode, options?: ToastOptions) =>
    fn(message, { ...options, variant: "success" });
  fn.danger = (message: ReactNode, options?: ToastOptions) =>
    fn(message, { ...options, variant: "danger" });
  fn.info = (message: ReactNode, options?: ToastOptions) =>
    fn(message, { ...options, variant: "accent" });
  fn.warning = (message: ReactNode, options?: ToastOptions) =>
    fn(message, { ...options, variant: "warning" });
  fn.close = closeToast;
  fn.clear = () => {
    for (const timer of timers.values()) {
      clearTimeout(timer);
    }
    timers.clear();
    items = [];
    emit();
  };

  return fn;
}

export const toast = createToast();
