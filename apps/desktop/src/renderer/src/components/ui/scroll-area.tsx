/**
 * @purpose Wrap the scroll-area UI primitive for consistent renderer composition.
 * @role    Local shared UI primitive used by app panels and pages.
 * @deps    Radix/HeroUI/React primitives and Tailwind class composition.
 * @gotcha  Preserve accessibility and sizing behavior expected by existing desktop layouts.
 */

import type { ComponentProps } from "react";
import type { Ref } from "react";
import * as ScrollAreaPrimitive from "@radix-ui/react-scroll-area";

function cn(...classes: Array<string | false | null | undefined>) {
  return classes.filter(Boolean).join(" ");
}

type ScrollAreaProps = ComponentProps<typeof ScrollAreaPrimitive.Root> & {
  viewportClassName?: string;
  viewportRef?: Ref<HTMLDivElement>;
  scrollbarClassName?: string;
  thumbClassName?: string;
};

export function ScrollArea({
  className,
  children,
  viewportClassName,
  viewportRef,
  scrollbarClassName,
  thumbClassName,
  ...props
}: ScrollAreaProps) {
  return (
    <ScrollAreaPrimitive.Root className={cn("relative overflow-hidden", className)} {...props}>
      <ScrollAreaPrimitive.Viewport
        ref={viewportRef}
        className={cn("h-full w-full rounded-[inherit]", viewportClassName)}
      >
        {children}
      </ScrollAreaPrimitive.Viewport>
      <ScrollBar className={scrollbarClassName} thumbClassName={thumbClassName} />
      <ScrollAreaPrimitive.Corner />
    </ScrollAreaPrimitive.Root>
  );
}

type ScrollBarProps = ComponentProps<typeof ScrollAreaPrimitive.ScrollAreaScrollbar> & {
  thumbClassName?: string;
};

export function ScrollBar({
  className,
  thumbClassName,
  orientation = "vertical",
  ...props
}: ScrollBarProps) {
  return (
    <ScrollAreaPrimitive.ScrollAreaScrollbar
      orientation={orientation}
      className={cn(
        "flex touch-none select-none transition-colors",
        orientation === "vertical"
          ? "h-full w-2.5 border-l border-l-transparent p-px"
          : "h-2.5 flex-col border-t border-t-transparent p-px",
        className,
      )}
      {...props}
    >
      <ScrollAreaPrimitive.ScrollAreaThumb
        className={cn("relative flex-1 rounded-full bg-zinc-300/75", thumbClassName)}
      />
    </ScrollAreaPrimitive.ScrollAreaScrollbar>
  );
}
