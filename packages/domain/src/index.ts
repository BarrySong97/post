/**
 * @purpose Export shared Post domain workflows for desktop and CLI callers.
 * @role    Public package barrel for transport-neutral organization services.
 * @deps    Domain submodules.
 * @gotcha  Do not export Electron or tRPC adapters from this package.
 */

export * from "./assets/index";
export * from "./context";
export * from "./errors";
export * from "./saved-views/index";
export * from "./tags/index";
export * from "./vaults/index";
