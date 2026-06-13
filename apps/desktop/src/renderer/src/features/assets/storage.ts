export const SIDEBAR_ORDER_STORAGE_KEY = "post.assetManager.sidebarOrder.v1";
export const ASSET_FILTER_OPEN_STORAGE_KEY = "post.assetManager.filterOpen.v1";
export const OPEN_VAULT_TARGET_STORAGE_KEY = "post.assetManager.openVaultTarget.v1";
export const SIDEBAR_COLLAPSED_STORAGE_KEY = "post.assetManager.sidebarCollapsed";
export const SIDEBAR_WIDTH_STORAGE_KEY = "post.assetManager.sidebarPct";

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
