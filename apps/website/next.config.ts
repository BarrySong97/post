/**
 * @purpose Configure the Next.js build for the website app.
 * @role    Next.js config entrypoint for the website surface.
 * @deps    next.
 * @gotcha  Workspace source packages used by the website should be listed in transpilePackages.
 */
import path from "node:path";

import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "export",
  images: {
    unoptimized: true,
  },
  // Pin the monorepo root so Next.js does not infer an unrelated parent lockfile.
  outputFileTracingRoot: path.join(process.cwd(), "../.."),
  transpilePackages: ["@post/ui", "@post/mock-data"],
};

export default nextConfig;
