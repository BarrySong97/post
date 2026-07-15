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

X Post captures use normal `assets`, `asset_files`, `asset_tags`, `asset_links`, and `markdown_cache` rows plus `post_cache` for normalized query fields, including the remote author-avatar URL used by attribution cards. The Vault Markdown remains the durable source; `post_cache` is rebuildable application metadata keyed uniquely by Vault, platform, and external Post ID.

## Public Interfaces

- Schema exports from `packages/db/src/schema.ts`.
- Database helper exports from `packages/db/src/index.ts`.
- Root package scripts: `pnpm db:generate`, `pnpm db:migrate`, and `pnpm db:studio`.

## Notes

- Run `pnpm db:generate` after schema changes. For data-only cleanups with no schema change (e.g. `0010_prune_hidden_assets`, a one-time delete of assets ingested from hidden `.`-prefixed paths), use `pnpm exec drizzle-kit generate --custom` and rely on `assets` cascade to clear child rows.
- Commit generated SQL and Drizzle metadata together.
- Keep WAL and foreign keys enabled on every connection.
- Treat string union arrays such as `assetKinds` and `assetStatuses` as public contracts for renderer code and indexer behavior.
- `image_cache.thumbnail_luma` (nullable) holds the average luma of the thumbnail's bottom strip, written by the Rust indexer and read by the renderer for adaptive card overlay text; null means the thumbnail predates the column and will backfill on regeneration.
- `image_cache.video_duration_ms` (nullable) holds video duration in milliseconds from ffprobe during thumbnail generation; null for non-video assets or when ffprobe is unavailable.
- `web_cache` holds normalized fields for bookmarked web pages (`kind === "web"`): page url, display domain, site name, description. The OG cover image itself reuses the shared `image_cache` thumbnail rather than a dedicated column.
- TypeScript source files in this package have AI file headers. Update them when schema or connection responsibilities move.
