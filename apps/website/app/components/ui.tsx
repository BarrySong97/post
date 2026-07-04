"use client";

/**
 * @purpose Expose HeroUI client components behind a "use client" boundary, themed for the website.
 * @role    Client module so Server Components can use HeroUI without opting the whole page into client.
 * @deps    @heroui/react.
 * @gotcha  HeroUI's barrel imports `client-only`; keep it isolated here so app/page.tsx stays an RSC.
 *          HeroUI bakes `rounded-3xl` onto its `.button` (components layer); this wrapper injects the
 *          `rounded-lg` utility (utilities layer wins) so every website Button matches the desktop
 *          product's button radius in one place, instead of repeating className on each instance.
 */
import { Button as HeroButton } from "@heroui/react";
import type { ComponentProps } from "react";

export { Link } from "@heroui/react";

export function Button({ className, ...props }: ComponentProps<typeof HeroButton>) {
  return <HeroButton className={`rounded-lg${className ? ` ${className}` : ""}`} {...props} />;
}
