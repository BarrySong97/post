# Electron tRPC IPC

## Why This Exists

Post has no HTTP server. The renderer communicates with the Electron main process through a custom tRPC link over Electron IPC. This topic is the cross-module contract between renderer, preload, main, and database code.

## Flow

```text
React component
  -> tRPC hook
  -> apps/desktop/src/renderer/src/lib/ipc-trpc-link.ts
  -> window.api.trpcRequest / trpcSubscribe
  -> apps/desktop/src/preload/index.ts
  -> Electron IPC channel
  -> apps/desktop/src/main/presentation/trpc/ipc-adapter.ts
  -> appRouter.createCaller()
  -> router procedure
  -> use case/repository/service
  -> SQLite via Drizzle
```

## Involved Modules

- [desktop](../modules/desktop/README.md)
- [db](../modules/db/README.md)

## Contract

- Queries and mutations use `ipcMain.handle("trpc:request", ...)`.
- Subscriptions use `ipcMain.on("trpc:subscribe", ...)` and return events over `trpc:subscription:event`.
- The renderer link converts IPC promises and subscription events into tRPC client observables.
- The preload bridge is the only renderer-visible native boundary.
- Reusable renderer/main input schemas live in `apps/desktop/src/shared/contracts/`; those modules must stay browser-safe.

## Notes

- Add new server-side behavior as tRPC procedures, not ad hoc IPC channels, unless the capability is not request/response shaped.
- Keep subscription cleanup tied to WebContents destruction.
- Return serialized error messages across IPC; do not leak native error objects.
- The tRPC link is renderer->main only. The one inbound channel for a separate OS process (the `post-cli` tool) is the local socket in `apps/desktop/src/main/local-ipc-server.ts`; it carries `ledger.changed` refresh hints and live UI commands (`filter.*`, `asset.open`) that reply with `command.ack`, all guarded by a `dbPath` match. For read-back, the renderer pushes its current filter through the `events.reportFilterState` mutation into a main-process cache that answers the socket's `filter.get`.
