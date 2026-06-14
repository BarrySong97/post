# Post Indexer

## Responsibility

`crates/post-indexer` is the Rust CLI that scans vault files, reconciles missing files, refreshes changed paths, runs watch mode, parses markdown links, and generates thumbnails.

## File Map

- `crates/post-indexer/src/main.rs` - CLI parsing, sync run recording, filesystem scan/watch logic, markdown link extraction, thumbnail generation, and JSON event emission.
- `crates/post-indexer/Cargo.toml` - crate dependencies and metadata.

## Data Flow

The Electron main process starts the indexer with a vault ID, root path, database path, and command. The indexer writes asset, file, link, markdown cache, thumbnail cache, sync run, and sync event data to SQLite, while emitting structured progress events to stdout for the main process to consume.

## Commands

- `scan` - initial import style scan.
- `reconcile` - manual reconciliation.
- `refresh` - update selected paths.
- `watch` - watch vault or note scope, optionally as a daemon.
- `thumbnails` - generate image thumbnails.

Use repository scripts:

```bash
pnpm indexer:check
pnpm indexer:test
pnpm indexer:build
```

## Notes

- Keep CLI argument names and event shapes stable for Electron callers.
- Keep parser and indexer version constants meaningful when behavior changes.
- Thumbnail output must remain under the configured thumbnail root.
- Path handling must preserve vault-relative paths.
