/**
 * @purpose Render the public /blog index — a list of personal-finance posts (OpenAI news style).
 * @role    Next.js App Router route; reads Velite-compiled posts and lays them out as cards.
 * @deps    ../lib/blog, blog components, SiteFooter, shared SEO constants.
 * @gotcha  SiteHeader is fixed from layout.tsx, so this page owns its top clearance (pt-28). Layout is
 *          adaptive: below FEATURED_THRESHOLD it's a plain 2-column grid; at/above it, the newest post
 *          becomes a large featured headline above the grid.
 */
import type { Metadata } from "next";

import { SiteFooter } from "../components/site-footer";
import { BlogGrid } from "../components/blog/blog-grid";
import { FeaturedPost } from "../components/blog/featured-post";
import { publishedPosts } from "../lib/blog";
import { OG_IMAGE_URL, SITE_NAME } from "../lib/seo";

const BLOG_TITLE = "Blog";
const BLOG_DESCRIPTION = `Notes on personal finance, investing, and money habits from ${SITE_NAME}.`;

/** At/above this many posts, promote the newest into a large featured headline. */
const FEATURED_THRESHOLD = 6;

export const metadata: Metadata = {
  title: BLOG_TITLE,
  description: BLOG_DESCRIPTION,
  alternates: {
    canonical: "/blog",
  },
  openGraph: {
    type: "website",
    url: "/blog",
    siteName: SITE_NAME,
    title: `${BLOG_TITLE} | ${SITE_NAME}`,
    description: BLOG_DESCRIPTION,
    images: [{ url: OG_IMAGE_URL, width: 1200, height: 630, alt: `${SITE_NAME} Blog` }],
  },
  twitter: {
    card: "summary_large_image",
    title: `${BLOG_TITLE} | ${SITE_NAME}`,
    description: BLOG_DESCRIPTION,
    images: [OG_IMAGE_URL],
  },
};

export default function BlogPage() {
  const posts = publishedPosts;
  const isFeaturedLayout = posts.length >= FEATURED_THRESHOLD;
  const featured = isFeaturedLayout ? posts[0] : null;
  const gridPosts = isFeaturedLayout ? posts.slice(1) : posts;

  return (
    <div className="bg-background text-sm">
      <main className="mx-auto max-w-5xl px-6 pb-16 pt-28">
        <div className="max-w-2xl">
          <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-foreground/45">
            Blog
          </p>
          <h1 className="mt-3 text-[40px] font-bold leading-tight tracking-tight text-foreground">
            Writing on money
          </h1>
          <p className="mt-4 text-[15px] leading-7 text-foreground/65">{BLOG_DESCRIPTION}</p>
        </div>

        <div className="mt-12">
          {posts.length === 0 ? (
            <p className="text-[15px] text-foreground/55">
              No posts published yet. Check back soon.
            </p>
          ) : (
            <>
              {featured ? <FeaturedPost post={featured} /> : null}
              <BlogGrid posts={gridPosts} />
            </>
          )}
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}
