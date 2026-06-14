# Desktop App

## Responsibility

`apps/desktop` owns the Electron application: main-process services, preload bridge, React renderer, app shell, asset manager, terminal integration, and packaging config.

It does not own shared database schema definitions; those live in [../db](../db/README.md). It consumes the Rust indexer from [../post-indexer](../post-indexer/README.md).

## File Map

- `apps/desktop/src/main/` - Electron app lifecycle, protocol registration, tRPC IPC handler, repositories, services, watchers, terminal, and background tasks.
- `apps/desktop/src/preload/` - context bridge exposing the narrow `window.api` surface to the renderer.
- `apps/desktop/src/renderer/src/` - React app, routes, layout, feature code, state atoms, and tRPC client link.
- `apps/desktop/resources/ffmpeg/` - packaged ffmpeg binary destination.
- `apps/desktop/electron.vite.config.ts` - Electron/Vite build configuration.
- `apps/desktop/electron-builder.yml` - packaging configuration.

## Data Flow

Renderer components call tRPC hooks. The custom renderer link sends IPC requests through `window.api`, the main process resolves them through `appRouter.createCaller()`, and repositories/services read or write SQLite through Drizzle.

For the detailed IPC contract, see [../../topics/electron-trpc-ipc.md](../../topics/electron-trpc-ipc.md).

## Public Interfaces

- Renderer routes under `apps/desktop/src/renderer/src/routes/`.
- Preload `window.api` surface in `apps/desktop/src/preload/index.ts`.
- Main tRPC router in `apps/desktop/src/main/trpc/router.ts`.
- Domain routers under `apps/desktop/src/main/trpc/routers/`.
- Terminal IPC handlers in `apps/desktop/src/main/terminal.ts`.

## Notes

- Do not bypass preload or import main-process code into renderer code.
- Keep subscriptions tied to renderer WebContents lifetime; the main IPC handler tracks sender IDs for cleanup.
- Keep filesystem paths and native process work in main-process services or the Rust indexer.
- UI changes should follow [../../../design.md](../../../design.md).

## Subpages

- [Asset management](assets.md)
