/**
 * @purpose Ambient declarations for renderer build-time constants.
 * @role    Type surface for values injected via Vite `define` in electron.vite.config.ts.
 * @deps    electron.vite.config.ts `renderer.define`.
 * @gotcha  Keep names in sync with the `define` keys; these are textual replacements, not runtime globals.
 */

/** App version injected from apps/desktop/package.json `version` at build time. */
declare const __APP_VERSION__: string;
