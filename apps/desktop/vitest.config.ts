/**
 * @purpose Configure Vitest for desktop workspace unit tests.
 * @role    Test runner setup for shared contracts, main use cases, and repository logic.
 * @deps    vitest/config, node path utilities.
 * @gotcha  Keep tests Node-only until renderer component testing is intentionally introduced.
 */

import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

import { defineConfig } from "vitest/config";

const rootDir = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    globals: false,
    clearMocks: true,
  },
  resolve: {
    alias: {
      electron: resolve(rootDir, "src/main/test-utils/electron.mock.ts"),
      "@electron-toolkit/utils": resolve(
        rootDir,
        "src/main/test-utils/electron-toolkit-utils.mock.ts",
      ),
      "@main": resolve(rootDir, "src/main"),
      "@preload": resolve(rootDir, "src/preload"),
      "@shared": resolve(rootDir, "src/shared"),
      "@": resolve(rootDir, "src/renderer/src"),
      "@renderer": resolve(rootDir, "src/renderer/src"),
    },
  },
});
