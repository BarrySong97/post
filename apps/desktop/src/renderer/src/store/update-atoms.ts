/**
 * @purpose Store the latest desktop auto-update lifecycle event for renderer consumers.
 * @role    Shared Jotai state used by the update toast controller and Settings page.
 * @deps    jotai and shared update contracts.
 * @gotcha  This is transient session state; persistent release metadata belongs to GitHub Releases.
 */

import { atom } from "jotai";

import type { UpdateStatusEvent } from "@shared/contracts/update/update.contract";

export const updateStatusAtom = atom<UpdateStatusEvent | null>(null);
