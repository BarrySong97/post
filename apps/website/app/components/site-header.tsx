"use client";

/**
 * @purpose Render the site-wide fixed navigation header shared by every route.
 * @role    Client component rendered once from the root layout, not per-page — needs "use client"
 *          for the scroll listener that toggles its glass background.
 * @deps    ./ui (HeroUI Link behind a client boundary), HeroUI button class tokens.
 * @gotcha  Stays `fixed` and fully transparent at the top on purpose: it floats over each page's top
 *          content (e.g. the hero's full-bleed background image), so at scrollY 0 it must never gain
 *          an opaque/blurred background or it will hide the image. Past SCROLL_THRESHOLD_PX it swaps
 *          to a translucent, blurred "glass" background so it reads as a distinct layer over whatever
 *          scrolls underneath. z-index is z-[200], well above the ProductPreview mock's own internal
 *          z-[120] ceiling (traffic lights, dropdown popovers, etc.) — those elements sit inside a
 *          plain `position: relative` mock frame with no isolated stacking context, so without this
 *          margin their z-index competes directly against the header's in the page's root stacking
 *          context and paints over it while scrolling past the mock. Keep the app icon as a real image
 *          asset from public/post-icon.png.
 */
import { useEffect, useState } from "react";

import { Link } from "./ui";
import { DOWNLOAD_URL } from "../lib/seo";

const NAV_LINKS = [
  { label: "Roadmap", href: "#roadmap" },
  { label: "Blog", href: "/blog" },
  { label: "Changelog", href: "/releases" },
];

const NAV_LINK = "text-xs text-foreground/60 transition-colors hover:text-foreground";

const SCROLL_THRESHOLD_PX = 8;

export function SiteHeader() {
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const updateScrolled = () => setScrolled(window.scrollY > SCROLL_THRESHOLD_PX);
    updateScrolled();
    window.addEventListener("scroll", updateScrolled, { passive: true });
    return () => window.removeEventListener("scroll", updateScrolled);
  }, []);

  return (
    <header
      className={`fixed inset-x-0 top-0 z-[200] border-b transition-colors duration-300 ${
        scrolled
          ? "border-border-subtle bg-background/70 backdrop-blur-2xl"
          : "border-transparent bg-transparent"
      }`}
    >
      <div className="mx-auto flex h-14 max-w-5xl items-center justify-between px-6">
        <Link href="#" className="flex items-center gap-2 text-sm font-semibold text-foreground">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/post-icon.png" alt="Post" width={24} height={24} className="rounded-md" />
          <span>Post</span>
        </Link>
        <nav className="flex items-center gap-6">
          <ul className="hidden items-center gap-6 sm:flex">
            {NAV_LINKS.map((link) => (
              <li key={link.href}>
                <Link href={link.href} className={NAV_LINK}>
                  {link.label}
                </Link>
              </li>
            ))}
          </ul>
          <Link
            href={DOWNLOAD_URL}
            className="button button--md button--primary h-8 min-h-0 rounded-lg px-3 text-xs font-semibold"
          >
            Download Post
          </Link>
        </nav>
      </div>
    </header>
  );
}
