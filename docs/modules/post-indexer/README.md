# Post Indexer

## Responsibility

`crates/post-indexer` is the Rust CLI that scans vault files, reconciles missing files, refreshes changed paths, runs watch mode, parses markdown links, derives markdown card excerpts, and generates thumbnails.

## File Map

- `crates/post-indexer/src/main.rs` - CLI parsing, sync run recording, filesystem scan/watch logic, markdown link extraction, markdown excerpt generation, thumbnail generation, and JSON event emission.
- `crates/post-indexer/Cargo.toml` - crate dependencies and metadata.

## Data Flow

The Electron main process starts the indexer with a vault ID, root path, database path, and command. The indexer writes asset, file, link, markdown cache, thumbnail cache, sync run, and sync event data to SQLite, while emitting structured progress events to stdout for the main process to consume.

When parsing markdown, the indexer derives a plain-text `excerpt` (frontmatter, code fences, headings, and inline markup stripped; first prose paragraph truncated to ~160 chars) and stores it in `markdown_cache.excerpt`. The renderer surfaces this as the text-card preview body. Because excerpts are only (re)written when a markdown file is parsed, a full reindex backfills them for existing notes; the `PARSER_VERSION` constant tracks excerpt/parse behavior changes.
Markdown files whose frontmatter declares `type: x-post` are indexed with asset kind `post` while still using the normal Markdown parser and link cache. This preserves their first-class Post identity across scan, refresh, reconcile, and watcher events.

## Commands

- `scan` - initial import style scan.
- `reconcile` - manual reconciliation.
- `refresh` - update selected paths.
- `watch` - watch vault or note scope, optionally as a daemon.
- `thumbnails` - generate image and video thumbnails.

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
- Thumbnail target loading normalizes cached error text before parsing sqlite CLI output so previous ffmpeg failures cannot corrupt tab-delimited rows.
- Thumbnail retry logic uses the explicit `ffmpeg executable unavailable` error marker. A missing candidate path mixed with a real ffmpeg media error must not make a corrupt or non-video source retryable.
- Path handling must preserve vault-relative paths.
- The Rust entrypoint has an AI file header. Keep it aligned with command, dependency, and event-contract changes.
