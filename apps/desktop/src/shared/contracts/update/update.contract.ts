/**
 * @purpose Define renderer-safe auto-update status contracts shared across Electron boundaries.
 * @role    Browser-safe type module consumed by main, preload, and renderer update flows.
 * @deps    TypeScript runtime only.
 * @gotcha  Keep this module free of Electron, Node, and database imports.
 */

export type UpdateState =
  | "checking"
  | "available"
  | "not-available"
  | "downloading"
  | "downloaded"
  | "error";

export type UpdateStatusEvent = {
  state: UpdateState;
  version?: string;
  percent?: number;
  message?: string;
};
