/**
 * @purpose Emit renderer-side asset-manager profiling events through the preload API.
 * @role    Shared renderer diagnostics helper for scroll, hydration, and tRPC timing.
 * @deps    Browser performance APIs and window.api preload bridge.
 * @gotcha  Keep values small and serializable because events are mirrored to disk.
 */

export type AssetProfileData = Record<string, unknown>;

const ASSET_PROFILE_PREFIX = "[asset-prof renderer]";

export function roundProfileNumber(value: number) {
  if (!Number.isFinite(value)) {
    return value;
  }

  return Math.round(value * 10) / 10;
}

// Profiling is dev-only: every event does a console.info plus an IPC round-trip to the
// main process that mirrors it to disk — too costly to keep on the scroll/hydration hot
// path in production. Kept on in dev so we can measure before/after optimizations.
const ASSET_PROFILE_ENABLED = import.meta.env.DEV;

export function emitAssetProfile(event: string, data: AssetProfileData = {}) {
  if (!ASSET_PROFILE_ENABLED || typeof window === "undefined") {
    return;
  }

  console.info(`${ASSET_PROFILE_PREFIX} ${event}`, data);
  window.api.assetProfileLog({ event, data });
}
