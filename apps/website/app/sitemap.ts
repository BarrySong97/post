/**
 * @purpose Generate the website sitemap.xml metadata route.
 * @role    Next.js App Router metadata route listing public static website routes.
 * @deps    next, ./lib/seo.
 * @gotcha  Update this list when adding new public website routes.
 */
import type { MetadataRoute } from "next";

import { SITE_URL } from "./lib/seo";

const PUBLIC_ROUTES = ["/", "/releases"] as const;

export const dynamic = "force-static";

export default function sitemap(): MetadataRoute.Sitemap {
  return PUBLIC_ROUTES.map((route) => ({
    url: new URL(route, SITE_URL).toString(),
    lastModified: new Date(),
    changeFrequency: route === "/" ? "monthly" : "weekly",
    priority: route === "/" ? 1 : 0.7,
  }));
}
