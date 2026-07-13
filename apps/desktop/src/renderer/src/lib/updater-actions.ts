/**
 * @purpose Shared renderer helpers that kick off auto-update IPC with immediate UI feedback.
 * @role    Optimistic status writers used by UpdateToast and the Settings Software Update row.
 * @deps    Preload updater bridge and shared UpdateStatusEvent contract.
 * @gotcha  Always set the atom before awaiting IPC so the button/toast leave the idle "available"
 *          state on the same click; real progress/error events from main overwrite these values.
 */

import type { UpdateStatusEvent } from "@shared/contracts/update/update.contract";

type SetUpdateStatus = (event: UpdateStatusEvent) => void;

/** Flip to downloading at 0% immediately, then ask main to start the download. */
export function requestUpdateDownload(setStatus: SetUpdateStatus, version?: string) {
  setStatus({ state: "downloading", version, percent: 0 });
  return window.api.updater.download();
}

/** Flip to checking immediately, then ask main to poll for updates. */
export function requestUpdateCheck(setStatus: SetUpdateStatus) {
  setStatus({ state: "checking" });
  return window.api.updater.check();
}
