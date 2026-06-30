/**
 * @purpose Configure electron-vite builds for main, preload, and renderer bundles.
 * @role    Desktop build pipeline config shared by dev, build, package, and dist scripts.
 * @deps    electron-vite, Vite React plugin, TanStack Router plugin, Tailwind Vite plugin.
 * @gotcha  Main/preload/renderer aliases and plugin ordering affect both dev startup and packaged builds.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig, externalizeDepsPlugin } from "electron-vite";
import TanStackRouter from "@tanstack/router-plugin/vite";

// Single source of truth for the displayed app version: apps/desktop/package.json.
const appVersion = (
  JSON.parse(readFileSync(resolve("package.json"), "utf8")) as { version: string }
).version;

export default defineConfig({
  main: {
    plugins: [
      externalizeDepsPlugin({
        exclude: ["@post/db", "@post/domain"],
      }),
    ],
    resolve: {
      alias: {
        "@main": resolve("src/main"),
        "@preload": resolve("src/preload"),
        "@shared": resolve("src/shared"),
      },
    },
    build: {
      rollupOptions: {
        external: ["better-sqlite3"],
      },
    },
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    resolve: {
      alias: {
        "@preload": resolve("src/preload"),
        "@shared": resolve("src/shared"),
      },
    },
  },
  renderer: {
    define: {
      __APP_VERSION__: JSON.stringify(appVersion),
    },
    server: {
      port: 42873,
      strictPort: true,
    },
    resolve: {
      alias: {
        "@": resolve("src/renderer/src"),
        "@renderer": resolve("src/renderer/src"),
        "@main": resolve("src/main"),
        "@shared": resolve("src/shared"),
      },
    },
    plugins: [
      TanStackRouter({
        target: "react",
        routesDirectory: "./src/routes",
        generatedRouteTree: "./src/routeTree.gen.ts",
      }),
      react(),
      tailwindcss(),
    ],
  },
});
