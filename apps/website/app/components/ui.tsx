"use client";

/**
 * @purpose Expose HeroUI client components behind a "use client" boundary, themed for the website.
 * @role    Client module so Server Components can use HeroUI without opting the whole page into client.
 * @deps    @heroui/react.
 * @gotcha  HeroUI's barrel imports `client-only`; keep it isolated here so app/page.tsx stays an RSC.
 *          Every button-styled CTA on the site is a <Link> with raw `button button--*` classes, not
 *          HeroUI's <Button>: Button is a react-aria button primitive with no href support, so it can't
 *          navigate anywhere. Add `rounded-lg` on each instance (HeroUI bakes `rounded-3xl` onto
 *          `.button` at the components layer; the `rounded-lg` utility wins) to match the desktop
 *          product's button radius.
 */
export { Link } from "@heroui/react";
