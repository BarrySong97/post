/**
 * @purpose Generate the website sitemap.xml metadata route.
 * @role    Next.js App Router metadata route listing public static website routes.
 * @deps    next, ./lib/seo, ./lib/blog.
 * @gotcha  Update the static list when adding new public routes; individual /blog/<slug> entries are
 *          derived automatically from the Velite-compiled posts at build time.
 */
import type { MetadataRoute } from "next";

import { publishedPosts } from "./lib/blog";
import { SITE_URL } from "./lib/seo";

const STATIC_ROUTES = ["/", "/releases", "/blog"] as const;

export const dynamic = "force-static";

export default function sitemap(): MetadataRoute.Sitemap {
  const now = new Date();

  const staticEntries: MetadataRoute.Sitemap = STATIC_ROUTES.map((route) => ({
    url: new URL(route, SITE_URL).toString(),
    lastModified: now,
    changeFrequency: route === "/" ? "monthly" : "weekly",
    priority: route === "/" ? 1 : 0.7,
  }));

  const postEntries: MetadataRoute.Sitemap = publishedPosts.map((post) => ({
    url: new URL(post.permalink, SITE_URL).toString(),
    lastModified: new Date(post.date),
    changeFrequency: "weekly",
    priority: 0.6,
  }));

  return [...staticEntries, ...postEntries];
}
