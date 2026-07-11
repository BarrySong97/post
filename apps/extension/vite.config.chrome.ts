/**
 * @purpose Build the Chrome Manifest V3 browser extension bundle for a dev or prod channel.
 * @role    Vite entrypoint that hands a channel-specific manifest to CRXJS.
 * @deps    @crxjs/vite-plugin, vite, ./manifest.json.
 * @gotcha  POST_CHANNEL=prod builds the release extension (name "Post", appEnv "prod") into
 *          dist_chrome_prod; the default dev build stays "Post Dev"/dev in dist_chrome. The two
 *          channels are separate installs that route to post-prod.sqlite vs post-dev.sqlite.
 */

import { crx, type ManifestV3Export } from "@crxjs/vite-plugin";
import { defineConfig } from "vite";

import manifest from "./manifest.json";

const isDev = process.env.__DEV__ === "true";
const channel = process.env.POST_CHANNEL === "prod" ? "prod" : "dev";

const channelManifest = {
  ...(manifest as Record<string, unknown>),
  name: channel === "prod" ? "Post" : "Post Dev",
} as ManifestV3Export;

export default defineConfig({
  define: {
    // Compile-time channel. The background worker stamps this onto native messages as `appEnv`,
    // which the native host maps to post-<appEnv>.sqlite.
    __APP_ENV__: JSON.stringify(channel),
  },
  plugins: [
    crx({
      manifest: channelManifest,
      browser: "chrome",
    }),
  ],
  build: {
    emptyOutDir: !isDev,
    outDir: channel === "prod" ? "dist_chrome_prod" : "dist_chrome",
    sourcemap: isDev,
  },
});
