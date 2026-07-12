/**
 * @purpose Render the public Post release notes page.
 * @role    Next.js App Router route for changelog and latest GitHub Release download entry.
 * @deps    ReleaseTimeline, website UI primitives, and shared SEO/download constants.
 * @gotcha  SiteHeader is fixed from layout.tsx, so this page owns its top clearance.
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
      <main className="mx-auto max-w-5xl px-6 pb-16 pt-28">
        <div className="max-w-2xl">
          <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-foreground/45">
            Releases
          </p>
          <h1 className="mt-3 text-[40px] font-bold leading-tight tracking-tight text-foreground">
            Changelog
          </h1>
          <p className="mt-4 text-[15px] leading-7 text-foreground/65">
            User-facing changes for Post desktop. Mac downloads and the Chrome extension zip are
            published from GitHub Releases.
          </p>
          <Link
            href={DOWNLOAD_URL}
            className="mt-6 inline-flex h-10 items-center rounded-lg bg-foreground px-4 text-sm font-semibold text-background transition-colors hover:bg-foreground/85"
          >
            Download latest Mac release
          </Link>
          <p className="mt-3 text-[13px] leading-6 text-foreground/55">
            The same release page includes{" "}
            <span className="font-mono text-[12px]">Post-&lt;version&gt;-chrome-extension.zip</span>{" "}
            for the browser extension.
          </p>
        </div>
        <div className="mt-10">
          <ReleaseTimeline />
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}
