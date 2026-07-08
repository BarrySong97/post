/**
 * @purpose Generate the website robots.txt metadata route.
 * @role    Next.js App Router metadata route for crawler access and sitemap discovery.
 * @deps    next, ./lib/seo.
 * @gotcha  Keep the sitemap host aligned with SITE_URL because the website is statically exported.
 */
import type { MetadataRoute } from "next";

import { SITE_URL } from "./lib/seo";

export const dynamic = "force-static";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
    },
    sitemap: `${SITE_URL}/sitemap.xml`,
  };
}
