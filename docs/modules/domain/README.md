# Domain Package

## Responsibility

`packages/domain` owns reusable, transport-neutral organization workflows for Post data. Desktop main and the CLI both call this package for tags, asset-tag bindings, saved views, vault lookup, and asset query helpers.

It does not resolve Electron `userData`, expose tRPC, parse CLI arguments, or own schema migrations.

## File Map

- `packages/domain/src/context.ts` - explicit `DomainContext` dependencies for database, active vault, clock, and id generation.
- `packages/domain/src/errors.ts` - structured domain errors used by desktop and CLI adapters.
- `packages/domain/src/assets/` - asset lookup helpers for CLI and organization workflows.
- `packages/domain/src/tags/` - tag CRUD, ordering, and asset-tag binding workflows.
- `packages/domain/src/saved-views/` - saved-view CRUD, ordering, and filter serialization.
- `packages/domain/src/vaults/` - vault lookup and active-vault helpers.

## Data Flow

Callers build a `DomainContext` with an initialized Drizzle database, optional active vault id, clock, and id generator. Domain functions validate inputs, enforce relationships, mutate SQLite through `@post/db` schema objects, and throw `DomainError` when a workflow cannot proceed.

Desktop main translates `DomainError` to `TRPCError`. The CLI translates the same errors to JSON/text output and process exit codes.

## Public Interfaces

- Package exports from `@post/domain`.
- Domain-specific subpath exports such as `@post/domain/tags` and `@post/domain/saved-views`.
- `DomainContext` and `DomainError`.

## Notes

- Keep this package free of Electron, tRPC, renderer, preload, filesystem UI, and process-management imports.
- Keep all write workflows explicit and relationship-aware; do not add raw SQL passthrough helpers here.
- Keep saved-view filter serialization compatible with desktop renderer contracts, including the first-class `post` asset type used by X captures and `added_desc` as the fallback sort for missing or invalid saved-view sort JSON.
