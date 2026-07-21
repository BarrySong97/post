# Post Indexer

## Responsibility

`crates/post-indexer` is the Rust CLI that scans vault files, reconciles missing files, refreshes changed paths, runs watch mode, parses markdown links, derives markdown card excerpts, and generates thumbnails.

## File Map

- `crates/post-indexer/src/main.rs` - CLI parsing, sync run recording, filesystem scan/watch logic, markdown link extraction, markdown excerpt generation, thumbnail generation, and JSON event emission.
- `crates/post-indexer/Cargo.toml` - crate dependencies and metadata.

## Data Flow

The Electron main process starts the indexer with a vault ID, root path, database path, and command. The indexer writes asset, file, link, markdown cache, thumbnail cache, sync run, and sync event data to SQLite, while emitting structured progress events to stdout for the main process to consume.

When parsing markdown, the indexer derives a plain-text `excerpt` (frontmatter, code fences, headings, and inline markup stripped; prose accumulated across paragraphs — joined with `\n` so the renderer's `whitespace-pre-line` keeps the breaks — truncated to ~240 chars) and stores it in `markdown_cache.excerpt`. The renderer surfaces this as the text-card preview body. Because excerpts are only (re)written when a markdown file is parsed, a full reindex backfills them for existing notes; the `PARSER_VERSION` constant tracks excerpt/parse behavior changes.
Markdown files whose frontmatter declares `type: x-post` are indexed with asset kind `post` while still using the normal Markdown parser and link cache. This preserves their first-class Post identity across scan, refresh, reconcile, and watcher events.
Internet Shortcut (`.url`) files remain `web` assets by default. When their `URL=` value is a YouTube Watch/Shorts/Live/Embed link, the indexer classifies them as `youtube`, preserving the dedicated card/filter kind across scan, refresh, reconcile, restore, and watcher events without relying on SQLite cache rows.

Video thumbnail generation still uses ffmpeg for a representative frame. In the same pass the indexer best-effort probes duration — preferring `ffprobe` (`format=duration`), then falling back to parsing `Duration:` from `ffmpeg -i` stderr because the desktop app only ships ffmpeg — and stores milliseconds in `image_cache.video_duration_ms`. On a ready thumbnail cache hit, videos whose `video_duration_ms` is still null get a duration-only backfill (no frame regen); a failed probe stores `-1` so prewarm does not retry forever. The renderer formats positive values as the card's duration badge (`m:ss` / `h:mm:ss`) and ignores negatives.

Image thumbnail generation never enlarges small raster sources. When an image's long edge is at most 720px, the indexer records its dimensions, source fingerprint, bottom-strip luma, and `thumbnail_format = original` without writing or recompressing a cache file; the renderer uses the vault source directly. Larger PNG sources produce lossless 720px PNG thumbnails to preserve screenshot text and transparency, while other supported large rasters produce JPEG thumbnails. Existing small JPEG thumbnails and large PNG-to-JPEG thumbnails are invalidated once and replaced with the appropriate representation. Video frames always remain generated JPEG posters.

Animated GIF/WebP sources are detected during thumbnail analysis and always receive a static first-frame thumbnail, including sources below the normal 720px original-file threshold. AVIF sequence branding is recorded even though Chromium remains the playback decoder. On macOS, HEIC sources are decoded through `sips` into a 720px card thumbnail plus a longest-edge-4096 JPEG detail proxy; originals are never rewritten.

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

- The scan/watch/reconcile walk skips hidden entries via `should_skip`: any name starting with `.` (dotfile or dot-directory, so its whole subtree is skipped) plus `node_modules`. Hidden paths therefore never become assets. Existing rows imported by older builds are cleaned up once by the `packages/db` prune migration. Agent automation uses this: non-asset keep files belong under the vault’s `.post/` directory (see [skills/post](../../../skills/post/SKILL.md)).
- Keep CLI argument names and event shapes stable for Electron callers.
- Keep parser and indexer version constants meaningful when behavior changes.
- Thumbnail output must remain under the configured thumbnail root.
- `image_cache.media_metadata_version` gates animated-image metadata backfills independently of source identity; increment it when extraction semantics change.
- Thumbnail generation also records `image_cache.thumbnail_luma`, the average Rec. 601 luma of the thumbnail's bottom strip (`average_bottom_luma`), which the renderer uses to flip card overlay text between dark and light. Ready thumbnails cached before this column existed are treated as stale by `thumbnail_cache_matches` so the value backfills once.
- A ready `image_cache` row with `thumbnail_format = original` intentionally has no `thumbnail_path`; cache validation must treat a matching source fingerprint plus recorded luma as complete so small images do not requeue forever.
- Thumbnail target loading normalizes cached error text before parsing sqlite CLI output so previous ffmpeg failures cannot corrupt tab-delimited rows.
- Thumbnail retry logic uses the explicit `ffmpeg executable unavailable` error marker. A missing candidate path mixed with a real ffmpeg media error must not make a corrupt or non-video source retryable.
- Path handling must preserve vault-relative paths.
- The Rust entrypoint has an AI file header. Keep it aligned with command, dependency, and event-contract changes.
