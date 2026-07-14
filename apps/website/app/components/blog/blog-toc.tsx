"use client";

/**
 * @purpose Render a post's table of contents (from Velite's s.toc) with scroll-spy active highlighting.
 * @role    Right-hand sidebar on the /blog/[slug] detail page.
 * @deps    react, ../../lib/blog (BlogToc).
 * @gotcha  Client component — it tracks the heading currently under the fixed header and highlights the
 *          matching link. The active heading is the last one whose top has passed ACTIVE_OFFSET_PX (kept
 *          in sync with the prose-headings:scroll-mt-28 offset). The parent pins this with `sticky top-28`.
 */
import { useEffect, useState } from "react";

import type { BlogToc as BlogTocData } from "../../lib/blog";

type TocEntry = BlogTocData[number];

/** Trigger line just below the fixed header — matches the headings' scroll-mt-28 (112px). */
const ACTIVE_OFFSET_PX = 120;

function flattenIds(items: TocEntry[]): string[] {
  return items.flatMap((item) => [item.url.replace(/^#/, ""), ...flattenIds(item.items)]);
}

function TocList({
  items,
  activeId,
  nested = false,
}: {
  items: TocEntry[];
  activeId: string | undefined;
  nested?: boolean;
}) {
  return (
    <ul className={nested ? "mt-2 space-y-2" : "space-y-2"}>
      {items.map((item) => {
        const id = item.url.replace(/^#/, "");
        const active = id === activeId;
        return (
          <li key={item.url} className={nested ? "pl-3" : ""}>
            <a
              href={item.url}
              aria-current={active ? "location" : undefined}
              className={`block text-[13px] leading-snug transition-colors ${
                active ? "font-medium text-foreground" : "text-foreground/55 hover:text-foreground"
              }`}
            >
              {item.title}
            </a>
            {item.items.length > 0 ? (
              <TocList items={item.items} activeId={activeId} nested />
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}

export function BlogTableOfContents({ toc }: { toc: BlogTocData }) {
  const [activeId, setActiveId] = useState<string>();

  useEffect(() => {
    const headings = flattenIds(toc)
      .map((id) => document.getElementById(id))
      .filter((el): el is HTMLElement => el !== null);
    if (headings.length === 0) {
      return;
    }

    const updateActive = () => {
      let current = headings[0]!.id;
      for (const heading of headings) {
        if (heading.getBoundingClientRect().top <= ACTIVE_OFFSET_PX) {
          current = heading.id;
        } else {
          break;
        }
      }
      setActiveId(current);
    };

    updateActive();
    window.addEventListener("scroll", updateActive, { passive: true });
    window.addEventListener("resize", updateActive, { passive: true });
    return () => {
      window.removeEventListener("scroll", updateActive);
      window.removeEventListener("resize", updateActive);
    };
  }, [toc]);

  if (toc.length === 0) {
    return null;
  }

  return (
    <nav aria-label="Table of contents" className="border-l border-border-subtle pl-4">
      <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-foreground/45">
        On this page
      </p>
      <div className="mt-3">
        <TocList items={toc} activeId={activeId} />
      </div>
    </nav>
  );
}
