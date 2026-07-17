/**
 * @purpose Render the public Post release notes page.
 * @role    Next.js App Router route for changelog and latest GitHub Release download entry.
 * @deps    ReleaseTimeline, website UI primitives, and shared SEO/download constants.
 * @gotcha  SiteHeader is fixed from layout.tsx, so this page owns its top clearance. The outer gutter
 *          stays max-w-5xl to keep the left edge aligned with SiteHeader's own max-w-5xl logo/nav row;
 *          the readable column is an inner max-w-[44rem] cap, because this page is pure running text
 *          and a full 5xl measure runs well past a comfortable line length. Centering the narrow
 *          column instead would misalign it against the header. The download link is deliberately a
 *          text link, not a filled button — the primary CTA already lives in the hero and the fixed
 *          header, and repeating it here would shout over the release notes.
 */

import type { Metadata } from "next";

import { SiteFooter } from "../components/site-footer";
import { Link } from "../components/ui";
import { ReleaseTimeline } from "../components/releases/release-timeline";
import { DOWNLOAD_URL, OG_IMAGE_URL, SITE_DESCRIPTION, SITE_NAME } from "../lib/seo";

const RELEASES_TITLE = `${SITE_NAME} Changelog`;
const RELEASES_DESCRIPTION = `Release notes, Mac desktop downloads, and Chrome extension zip for ${SITE_NAME}. ${SITE_DESCRIPTION}`;

export const metadata: Metadata = {
  title: RELEASES_TITLE,
  description: RELEASES_DESCRIPTION,
  alternates: {
    canonical: "/releases",
  },
  openGraph: {
    type: "website",
    url: "/releases",
    siteName: SITE_NAME,
    title: RELEASES_TITLE,
    description: RELEASES_DESCRIPTION,
    images: [
      {
        url: OG_IMAGE_URL,
        width: 1200,
        height: 630,
        alt: `${SITE_NAME} desktop workspace preview`,
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: RELEASES_TITLE,
    description: RELEASES_DESCRIPTION,
    images: [OG_IMAGE_URL],
  },
};

export default function ReleasesPage() {
  return (
    <div className="bg-background text-sm">
      <main className="mx-auto max-w-5xl px-6 pb-24 pt-28">
        <div className="max-w-[44rem]">
          <header>
            <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-foreground/45">
              Releases
            </p>
            <h1 className="mt-3 text-[40px] font-bold leading-tight tracking-tight text-foreground">
              Changelog
            </h1>
            <p className="mt-4 max-w-[34rem] text-[15px] leading-7 text-foreground/65">
              User-facing changes for Post desktop, the website, and the Chrome extension. Every
              release ships from GitHub Releases with the Mac app and{" "}
              <span className="whitespace-nowrap font-mono text-[12px]">
                Post-&lt;version&gt;-chrome-extension.zip
              </span>
              .
            </p>
            <Link
              href={DOWNLOAD_URL}
              className="mt-6 inline-flex items-baseline gap-1.5 border-b border-border-subtle pb-0.5 text-sm font-semibold text-foreground transition-colors hover:border-foreground"
            >
              Download the latest Mac release
              <span aria-hidden className="font-normal text-foreground/45">
                &rarr;
              </span>
            </Link>
          </header>
          <div className="mt-20">
            <ReleaseTimeline />
          </div>
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}
