/**
 * @purpose Build the Chrome Manifest V3 browser extension bundle.
 * @role    Vite entrypoint that hands the extension manifest to CRXJS.
 * @deps    @crxjs/vite-plugin, vite, ./manifest.json.
 * @gotcha  This app intentionally has no renderer, popup, content script, or Desktop bridge yet.
 */

import { crx, type ManifestV3Export } from "@crxjs/vite-plugin";
import { defineConfig } from "vite";

import manifest from "./manifest.json";

const isDev = process.env.__DEV__ === "true";

export default defineConfig({
  plugins: [
    crx({
      manifest: manifest as ManifestV3Export,
      browser: "chrome",
    }),
  ],
  build: {
    emptyOutDir: !isDev,
    outDir: "dist_chrome",
    sourcemap: isDev,
  },
});
