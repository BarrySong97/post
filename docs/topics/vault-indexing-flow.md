# Vault Indexing Flow

## Why This Exists

Vault indexing crosses Electron main services, the Rust indexer, SQLite schema, renderer queries, and background task events. Keeping this flow explicit prevents agents from changing one side of the contract without updating the others.

## Involved Modules

- [desktop](../modules/desktop/README.md)
- [db](../modules/db/README.md)
- [post-indexer](../modules/post-indexer/README.md)

## Flow

1. A vault is created or opened through desktop main-process procedures.
2. Main-process services resolve the vault root and database path.
3. The Rust indexer runs a command such as `scan`, `refresh`, `watch`, or `thumbnails`.
4. The indexer writes normalized records into SQLite tables from the db schema.
5. Main-process task/event routers expose progress and state to the renderer.
6. Renderer asset views query updated assets, tags, saved views, markdown cache, and image cache through tRPC.

## Important Records

- `vaults` tracks roots and sync status.
- `assets` and `asset_files` model normalized content and concrete paths.
- `asset_galleries` and `asset_gallery_items` model user-managed folded image groups. The indexer does not write them.
- `asset_links` and `markdown_cache` model markdown-derived graph data.
- `image_cache` stores generated thumbnail metadata.
- `sync_runs` and `sync_events` record indexing activity.

## Notes

- Path identity should be vault-relative at the database boundary.
- Missing, restored, moved, and conflict states need to remain visible to the sync event layer.
- Gallery membership is user-managed relationship state. The Rust indexer can mark an asset missing or restored, but it should not create or remove gallery rows.
- Missing files do not remove gallery membership; gallery views show missing placeholders until the asset is permanently deleted. Permanent asset deletion or cleanup workflows may remove membership, reassign covers, or soft-delete empty galleries.
- If the Rust indexer changes an emitted event or written field, update Electron consumers and this topic in the same change.
