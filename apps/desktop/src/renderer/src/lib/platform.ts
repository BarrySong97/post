/**
 * @purpose Provide renderer platform utilities shared across pages and components.
 * @role    Small renderer helper module outside page-specific ownership.
 * @deps    Renderer runtime, tRPC/client/provider code, platform or toast libraries as appropriate.
 * @gotcha  Keep helpers browser-safe unless they intentionally call preload-exposed APIs.
 */

export function isMacWindow() {
  return typeof window !== "undefined" && window.api?.platform?.isMac === true;
}
