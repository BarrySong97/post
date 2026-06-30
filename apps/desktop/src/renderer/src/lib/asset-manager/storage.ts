/**
 * @purpose Support asset manager storage behavior and data shaping.
 * @role    Renderer asset manager support module for persisted UI preferences.
 * @deps    Asset tRPC types, React/HeroUI where UI is present, local storage or URL helpers as needed.
 * @gotcha  Keep asset kind/status/tag/view contracts synchronized with packages/db schema and saved-view JSON.
 */

export const SIDEBAR_ORDER_STORAGE_KEY = "post.assetManager.sidebarOrder.v1";
export const ASSET_FILTER_OPEN_STORAGE_KEY = "post.assetManager.filterOpen.v1";
export const OPEN_VAULT_TARGET_STORAGE_KEY = "post.assetManager.openVaultTarget.v1";
export const SIDEBAR_COLLAPSED_STORAGE_KEY = "post.assetManager.sidebarCollapsed";
export const SIDEBAR_WIDTH_STORAGE_KEY = "post.assetManager.sidebarPct";

// Shared minimum width (px) for the main app sidebar and the Settings sidebar — wide
// enough that the right-aligned count numbers never clip.
export const SIDEBAR_MIN_WIDTH_PX = 320;

// Maximum sidebar width (px). Kept in pixels (not a window-relative percentage) so the
// resize constraint never collides with the pixel minSize and never rescales with the
// window — required for the panel's `preserve-pixel-size` freeze to stay stable.
export const SIDEBAR_MAX_WIDTH_PX = 560;

export function readAssetFilterOpenFromStorage() {
  if (typeof window === "undefined") {
    return false;
  }

  try {
    return window.localStorage.getItem(ASSET_FILTER_OPEN_STORAGE_KEY) === "true";
  } catch {
    return false;
  }
}

export function writeAssetFilterOpenToStorage(filterOpen: boolean) {
  try {
    window.localStorage.setItem(ASSET_FILTER_OPEN_STORAGE_KEY, String(filterOpen));
  } catch {
    // Ignore storage failures; filter UI should still work for the current session.
  }
}

export function readSidebarWidthPct(defaultPct = 20) {
  const raw = localStorage.getItem(SIDEBAR_WIDTH_STORAGE_KEY);
  const pct = Number.parseFloat(raw ?? "");
  return Number.isFinite(pct) && pct > 0 ? pct : defaultPct;
}
