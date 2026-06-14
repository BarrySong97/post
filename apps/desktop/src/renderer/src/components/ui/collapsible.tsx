/**
 * @purpose Wrap the collapsible UI primitive for consistent renderer composition.
 * @role    Local shared UI primitive used by app panels and pages.
 * @deps    Radix/HeroUI/React primitives and Tailwind class composition.
 * @gotcha  Preserve accessibility and sizing behavior expected by existing desktop layouts.
 */

import * as CollapsiblePrimitive from "@radix-ui/react-collapsible";

const Collapsible = CollapsiblePrimitive.Root;
const CollapsibleTrigger = CollapsiblePrimitive.Trigger;
const CollapsibleContent = CollapsiblePrimitive.Content;

export { Collapsible, CollapsibleTrigger, CollapsibleContent };
