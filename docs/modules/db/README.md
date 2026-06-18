# Database Package

## Responsibility

`packages/db` owns the SQLite schema, generated Drizzle migrations, and database utilities shared by the Electron main process.

## File Map

- `packages/db/src/schema.ts` - table definitions, enum-like string unions, indexes, and relations.
- `packages/db/src/index.ts` - database connection helpers and SQLite pragmas.
- `packages/db/drizzle/` - generated migration SQL and metadata snapshots.
- `packages/db/drizzle.config.ts` - Drizzle migration configuration.

## Data Flow

Main-process code imports schema and database helpers, opens the SQLite database in Electron `userData`, and uses Drizzle repositories to query or mutate data. The Rust indexer writes to the same schema through its own SQLite access path, so schema changes must preserve both TypeScript and Rust expectations.

## Public Interfaces

- Schema exports from `packages/db/src/schema.ts`.
- Database helper exports from `packages/db/src/index.ts`.
- Root package scripts: `pnpm db:generate`, `pnpm db:migrate`, and `pnpm db:studio`.

## Notes

- Run `pnpm db:generate` after schema changes.
- Commit generated SQL and Drizzle metadata together.
- Keep WAL and foreign keys enabled on every connection.
- Treat string union arrays such as `assetKinds` and `assetStatuses` as public contracts for renderer code and indexer behavior.
- `asset_galleries` and `asset_gallery_items` are user-managed image grouping tables. They do not represent filesystem assets and are not written by the Rust indexer.
- Gallery membership is relationship state, not file identity. Removing a gallery removes membership rows only and must not delete `assets`, `asset_files`, or vault files.
- Gallery item uniqueness is per vault and asset. Use that invariant to prevent the same image from appearing in multiple galleries at once.
- Missing files should not immediately delete gallery membership. Permanent asset deletion can cascade or repair gallery state, including cover reassignment and empty-gallery soft deletion.
- TypeScript source files in this package have AI file headers. Update them when schema or connection responsibilities move.
