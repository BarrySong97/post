/**
 * @purpose Wrap the resizable UI primitive for consistent renderer composition.
 * @role    Local shared UI primitive used by app panels and pages.
 * @deps    Radix/HeroUI/React primitives and Tailwind class composition.
 * @gotcha  Preserve accessibility and sizing behavior expected by existing desktop layouts.
 */

import type { ComponentProps } from "react";
import { GripVertical } from "lucide-react";
import { Group, Panel, Separator } from "react-resizable-panels";

function cn(...classes: Array<string | false | null | undefined>) {
  return classes.filter(Boolean).join(" ");
}

type ResizablePanelGroupProps = ComponentProps<typeof Group> & {
  direction?: ComponentProps<typeof Group>["orientation"];
};

export function ResizablePanelGroup({
  className,
  direction,
  orientation,
  ...props
}: ResizablePanelGroupProps) {
  return (
    <Group
      className={cn("h-full w-full", className)}
      orientation={orientation ?? direction ?? "horizontal"}
      {...props}
    />
  );
}

function toPercentageSize(size: string | number | undefined) {
  return typeof size === "number" ? `${size}%` : size;
}

export function ResizablePanel({
  collapsedSize,
  defaultSize,
  maxSize,
  minSize,
  ...props
}: ComponentProps<typeof Panel>) {
  return (
    <Panel
      collapsedSize={toPercentageSize(collapsedSize)}
      defaultSize={toPercentageSize(defaultSize)}
      maxSize={toPercentageSize(maxSize)}
      minSize={toPercentageSize(minSize)}
      {...props}
    />
  );
}

type ResizableHandleProps = ComponentProps<typeof Separator> & {
  withHandle?: boolean;
};

export function ResizableHandle({ className, withHandle, ...props }: ResizableHandleProps) {
  return (
    <Separator
      className={cn(
        "relative flex w-px items-center justify-center bg-zinc-200/80 transition-colors hover:bg-blue-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500",
        className,
      )}
      {...props}
    >
      {withHandle ? (
        <span className="z-10 grid h-6 w-3 place-items-center rounded-sm border border-zinc-200 bg-white shadow-sm">
          <GripVertical size={12} className="text-zinc-400" />
        </span>
      ) : null}
    </Separator>
  );
}
