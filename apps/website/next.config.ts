/**
 * @purpose Configure the Next.js build for the website app.
 * @role    Next.js config entrypoint for the website surface.
 * @deps    next, velite.
 * @gotcha  Workspace source packages used by the website should be listed in transpilePackages.
 *          Velite is kicked off here (once per process) so content/blog/*.mdx is compiled into .velite/
 *          before the build reads it — dev watches, build runs a single clean pass.
 */
import path from "node:path";

import type { NextConfig } from "next";

startVelite();

function startVelite() {
  if (process.env.VELITE_STARTED) return;
  process.env.VELITE_STARTED = "1";
  const isDev = process.argv.includes("dev");
  void import("velite").then((velite) => velite.build({ watch: isDev, clean: !isDev }));
}

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
