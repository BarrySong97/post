/**
 * @purpose Provide renderer hero toast utilities shared across pages and components.
 * @role    Small renderer helper module outside page-specific ownership.
 * @deps    Renderer runtime, tRPC/client/provider code, platform or toast libraries as appropriate.
 * @gotcha  Keep helpers browser-safe unless they intentionally call preload-exposed APIs.
 */

import type { ReactNode } from "react";
import { ToastQueue } from "@heroui/react";

// HeroUI's default toast queue wraps every queue update in
// `document.startViewTransition(() => flushSync(fn))`. In our Electron window that
// makes freshly-added toasts flicker and vanish almost immediately. Overriding
// `wrapUpdate` with a plain synchronous call (no view transition) keeps them stable.
// The Toast.Provider in app-shell is wired to this same singleton queue.
export const heroToastQueue = new ToastQueue({ wrapUpdate: (fn) => fn() });

type HeroToastVariant = "default" | "accent" | "success" | "warning" | "danger";

type HeroToastOptions = {
  description?: ReactNode;
  /** Auto-dismiss delay in ms. Pass 0 for a persistent toast. Defaults to HeroUI's 4s. */
  timeout?: number;
};

function show(title: ReactNode, variant: HeroToastVariant, options?: HeroToastOptions) {
  return heroToastQueue.add(
    { title, description: options?.description, variant },
    { timeout: options?.timeout },
  );
}

export const heroToast = {
  show: (title: ReactNode, options?: HeroToastOptions) => show(title, "default", options),
  success: (title: ReactNode, options?: HeroToastOptions) => show(title, "success", options),
  danger: (title: ReactNode, options?: HeroToastOptions) => show(title, "danger", options),
  warning: (title: ReactNode, options?: HeroToastOptions) => show(title, "warning", options),
  info: (title: ReactNode, options?: HeroToastOptions) => show(title, "accent", options),
  close: (key: string) => heroToastQueue.close(key),
};
