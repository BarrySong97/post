/**
 * @purpose Provide renderer toast utilities shared across pages and components.
 * @role    Small renderer helper module outside page-specific ownership.
 * @deps    Renderer runtime, tRPC/client/provider code, platform or toast libraries as appropriate.
 * @gotcha  Keep helpers browser-safe unless they intentionally call preload-exposed APIs.
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
