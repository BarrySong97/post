# Main Layered Refactor Plan

## Goal

Move the Electron main process toward a backend-style layered layout without changing runtime behavior.

## First Batch Scope

- Add `apps/desktop/src/shared/contracts/` for renderer/main shared Zod input schemas, DTO-adjacent types, and validation constants.
- Replace duplicated asset manager form constraints with shared contracts.
- Split `apps/desktop/src/main/index.ts` into focused bootstrap, IPC adapter, protocol, and window-control modules.
- Keep tRPC procedure names, preload APIs, database schema, and renderer behavior unchanged.

## Follow-Up Scope

- Thin `assets.router.ts` by moving business workflows into `main/use-cases/`.
- Split large asset repositories by query responsibility.
- Split watcher sync and thumbnail queue coordination out of the watcher manager.
- Split terminal IPC registration from terminal session and node-pty infrastructure.

## Constraints

- Renderer must continue to communicate through `window.api` and the custom tRPC IPC link.
- Shared contracts must not import Electron, filesystem, database connection, or main-process runtime modules.
- Keep files under 500 lines where practical; when a file exceeds that, prefer a responsibility split over local helper accumulation.
