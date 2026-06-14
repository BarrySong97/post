# Vault Asset Data Model Design

Date: 2026-06-06

## Goal

Design the first real data model for the desktop asset manager. The app behaves like an Obsidian-style vault for mixed assets: the user chooses a folder, the app indexes everything inside it, and SQLite stores tags, relationships, parse caches, sync state, and graph data.

The app must not copy files into its own asset library, must not mutate user files by default, and must not block launch while scanning. Files remain in the selected folder. Users may open them with external Markdown editors, video players, audio players, image viewers, or the app's basic built-in viewers/editors.

The existing `notes` table is bootstrap scaffolding and is not part of the target model.

## Product Rules

- A vault is a user-selected folder.
- The app references files by path but does not treat path as identity.
- Tags live only in SQLite and are not read from or written to Markdown.
- Markdown links are parsed for navigation and knowledge graph display.
- The app does not automatically rewrite Markdown links.
- The app does not automatically move, rename, or reorganize real files.
- If the user moves or renames files inside the vault, the app should silently update paths when it can confidently match the file.
- Conflicts or uncertain matches should be surfaced for user review.
- Launch should render the previous SQLite state quickly; scanning and reconciliation run in the background.

## Recommended Approach

Use an asset-ID-centered model.

Each file becomes an `asset` with a stable `asset_id`. The current path, file stat data, fingerprints, and missing state live in `asset_files`. Tags, parsed links, graph edges, and caches all reference the stable asset ID rather than the path.

This lets the user reorganize the vault in Finder without breaking tags or graph relationships.

## Architecture

```text
Electron / React / tRPC
- Select vaults
- Display assets, tags, graph, details, sync state, and conflicts
- Provide basic Markdown editing and basic file operations
- Open files in external apps
- Read SQLite and trigger indexer tasks

Rust post-indexer
- Walk vault file trees
- Read file stat metadata
- Compute quick fingerprints and content hashes
- Parse Markdown links and embeds
- Reconcile moved, renamed, added, modified, missing, and restored files
- Watch file system changes during app runtime
- Write sync results, assets, file metadata, links, and caches to SQLite

SQLite
- Shared durable data layer
- WAL mode enabled
- Stores only index data, tags, relationships, parse caches, and sync records
```

The Rust indexer should start as a CLI or sidecar process rather than being embedded inside Electron.

```text
post-indexer scan --vault-id <id> --root-path <path> --db-path <path>
post-indexer reconcile --vault-id <id> --root-path <path> --db-path <path>
post-indexer watch --vault-id <id> --root-path <path> --db-path <path>
```

Electron starts the child process and consumes NDJSON progress events from stdout.

```json
{"type":"progress","runId":"...","filesSeen":1200,"phase":"stat"}
{"type":"moved","assetId":"...","from":"old/a.md","to":"new/a.md"}
{"type":"conflict","eventId":"...","candidates":2}
{"type":"completed","runId":"..."}
```

If the Rust indexer fails, the UI should keep rendering the previous SQLite state and mark the current sync run as failed.

## Data Model

### `vaults`

Represents a selected asset library folder.

```text
id text primary key
name text not null
root_path text not null
created_at integer timestamp_ms not null
updated_at integer timestamp_ms not null
last_opened_at integer timestamp_ms
last_sync_started_at integer timestamp_ms
last_sync_completed_at integer timestamp_ms
sync_status text not null
```

Paths inside the vault should be stored as relative paths wherever possible. If the user moves the whole vault folder, only `root_path` needs to change.

### `assets`

Stable logical identity for one indexed item.

```text
id text primary key
vault_id text not null references vaults(id)
kind text not null
status text not null
privacy text not null
title text not null
description text
created_at integer timestamp_ms not null
updated_at integer timestamp_ms not null
indexed_at integer timestamp_ms
deleted_at integer timestamp_ms
```

Initial `kind` values:

```text
markdown
image
video
audio
pdf
document
spreadsheet
archive
web
other
```

Initial `status` values:

```text
inbox
organized
draft
published
archived
```

Initial `privacy` values:

```text
normal
private
```

Tags and links attach to `assets.id`, not file paths.

### `asset_files`

Current file metadata for an asset.

```text
id text primary key
asset_id text not null references assets(id)
vault_id text not null references vaults(id)
relative_path text not null
file_name text not null
extension text
mime_type text
size_bytes integer not null
mtime_ms integer not null
ctime_ms integer
content_hash text
quick_fingerprint text
file_exists integer boolean not null
missing_since integer timestamp_ms
first_seen_at integer timestamp_ms not null
last_seen_at integer timestamp_ms not null
```

`quick_fingerprint` should support fast move detection without always reading the full file. A first version can combine size, mtime, extension, and optional partial hash. `content_hash` is stronger and can be computed lazily, especially for large videos or archives.

Recommended uniqueness:

```text
unique(vault_id, relative_path)
index(asset_id)
index(vault_id, quick_fingerprint)
index(vault_id, content_hash)
```

### `tags`

Application-owned tag definitions.

```text
id text primary key
vault_id text not null references vaults(id)
name text not null
color text
sort_order integer not null
created_at integer timestamp_ms not null
updated_at integer timestamp_ms not null
```

Recommended uniqueness:

```text
unique(vault_id, name)
```

### `asset_tags`

Many-to-many relationship between assets and application tags.

```text
asset_id text not null references assets(id)
tag_id text not null references tags(id)
created_at integer timestamp_ms not null
primary key(asset_id, tag_id)
```

Tags are never written to Markdown frontmatter or inline `#tag` syntax in the first version.

### `asset_links`

Parsed references from Markdown files and future manual relationships if needed.

```text
id text primary key
vault_id text not null references vaults(id)
source_asset_id text not null references assets(id)
target_asset_id text references assets(id)
target_ref text not null
target_subpath text
relation_type text not null
target_kind_hint text
resolved_status text not null
source_span_start integer
source_span_end integer
created_from text not null
discovered_at integer timestamp_ms not null
updated_at integer timestamp_ms not null
```

Initial `relation_type` values:

```text
wiki_link
embed
markdown_link
markdown_image
external_url
```

Initial `resolved_status` values:

```text
resolved
unresolved
ambiguous
```

Initial `created_from` values:

```text
markdown_parse
manual
```

In the first version, links are created from Markdown parsing. The `manual` value is reserved so the schema can later support user-created relationships between arbitrary assets without changing the table shape.

Recommended indexes:

```text
index(vault_id, source_asset_id)
index(vault_id, target_asset_id)
index(vault_id, resolved_status)
```

### `markdown_cache`

Parsed Markdown metadata for fast rendering and graph navigation.

```text
asset_id text primary key references assets(id)
vault_id text not null references vaults(id)
title text
excerpt text
word_count integer
headings_json text not null
outbound_link_count integer not null
inbound_link_count integer not null
parse_status text not null
parsed_at integer timestamp_ms
parser_version text not null
```

`headings_json` stores heading text, level, slug or source span, and line information when available.

Initial `parse_status` values:

```text
pending
parsed
failed
```

### `sync_runs`

One background indexing or reconciliation run.

```text
id text primary key
vault_id text not null references vaults(id)
reason text not null
status text not null
owner text not null
indexer_version text
parser_version text
started_at integer timestamp_ms not null
completed_at integer timestamp_ms
duration_ms integer
files_seen integer not null
files_added integer not null
files_updated integer not null
files_moved integer not null
files_missing integer not null
error_message text
```

Initial `reason` values:

```text
initial_import
app_start
watcher_event
manual
```

Initial `status` values:

```text
running
completed
failed
cancelled
```

Initial `owner` values:

```text
electron_main
rust_indexer
```

### `sync_events`

Detailed events emitted during a sync run.

```text
id text primary key
sync_run_id text not null references sync_runs(id)
vault_id text not null references vaults(id)
asset_id text references assets(id)
event_type text not null
old_relative_path text
new_relative_path text
confidence real
detail_json text not null
created_at integer timestamp_ms not null
```

Initial `event_type` values:

```text
added
updated
moved
missing
restored
conflict
deleted
```

`confidence` is used for path reconciliation. Unique high-confidence matches are applied silently. Conflicts or low-confidence matches are shown in the UI.

## Sync Flow

### First Vault Import

1. User selects a folder.
2. Electron creates a `vaults` row.
3. Electron starts `post-indexer scan`.
4. Rust walks the tree and creates `assets` plus `asset_files`.
5. Rust parses Markdown files and writes `markdown_cache` plus `asset_links`.
6. UI shows import progress from `sync_runs`, `sync_events`, and indexer NDJSON.

The first import may take time and should be presented as an explicit onboarding/import task.

### Normal Launch

1. App opens SQLite.
2. UI immediately renders the last indexed state.
3. Electron starts `post-indexer reconcile` in the background.
4. The user can browse existing assets while reconciliation runs.

Launch must not wait for a full vault scan.

### Lightweight Reconciliation

The indexer reads directory entries and file stat data:

```text
relative_path
size_bytes
mtime_ms
ctime_ms
extension
```

Comparison rules:

- Existing path with unchanged size and mtime: skip.
- Existing path with changed size or mtime: mark updated and queue deep parse.
- Database path missing on disk: mark missing.
- Disk path absent from database: treat as candidate new file or possible move.

### Move and Rename Detection

The indexer compares newly seen paths with missing database files.

Recommended matching priority:

1. Exact `content_hash` match: same asset.
2. Exact `quick_fingerprint` match: same asset if unique.
3. Same size, mtime, and extension: candidate match.
4. Multiple candidates: conflict.

When there is one high-confidence match, the indexer silently updates `asset_files.relative_path`, `file_name`, and `last_seen_at`, then writes `sync_events(event_type = moved)`.

When matching is uncertain, the indexer writes `sync_events(event_type = conflict)` and leaves the UI to ask the user.

### Deep Parse Queue

Deep parsing is only needed for:

- New files.
- Modified files.
- Moved files whose path affects relative Markdown link resolution.
- Previously unresolved links that may now resolve.
- Markdown files whose target set needs recalculation.

When a Markdown file is re-parsed, delete prior `asset_links` where `source_asset_id` is that asset and `created_from = markdown_parse`, then insert the fresh parse result.

## Markdown Link Parsing

The Rust parser maintains a link cache for navigation and graph display. The first version should support:

```text
[[A]]
[[A#Heading]]
[[A|Alias]]
![[image.png]]
![[video.mp4]]
markdown link to A.md
markdown link to docs/report.pdf
markdown image to images/a.png
https://example.com
```

Resolution rules:

1. Explicit relative path wins.
2. Same-directory target wins for ambiguous short names.
3. Vault-wide basename matching is allowed.
4. Multiple candidates become `ambiguous`.
5. Missing targets become `unresolved`.

Graph display reads `asset_links` only. It does not parse Markdown on demand.

Graph behavior:

- `resolved`: show a normal edge and allow jump to the target asset.
- `unresolved`: show a dangling node or unresolved reference.
- `ambiguous`: show a conflict state and let the user resolve later.

## Watcher Flow

While the app is running, Rust can run `post-indexer watch`.

Watcher events are hints, not final truth. They should be debounced and followed by reconciliation against disk stat data and SQLite state.

This protects the app from platform-specific watcher quirks and bulk folder moves.

## Error Handling

- If a file is missing, do not delete the asset immediately. Set `asset_files.file_exists = false` and `missing_since`.
- If a file reappears or is confidently matched at a new path, mark it restored or moved.
- If Markdown parsing fails, keep the asset and set `markdown_cache.parse_status = failed`.
- If Rust crashes, keep showing the previous SQLite state and mark the `sync_runs` row as failed.
- If SQLite write contention occurs, indexer writes should use short transactions and retry with backoff.
- If a target link cannot be resolved, keep `target_ref` so future scans can resolve it.

## Performance Principles

- UI launch reads SQLite only and should not wait for vault scanning.
- Full import is explicit and can show progress.
- Normal launch starts reconciliation in the background.
- Lightweight reconciliation reads paths and stat data before reading file contents.
- Full content hashing should be lazy for large files.
- Markdown parsing is incremental and only runs for new or changed Markdown files.
- Graph queries use cached `asset_links`.

## First Version Scope

In scope:

- Vault table and stable asset identity.
- File metadata and path reconciliation.
- SQLite-only tags.
- Markdown link parsing for navigation and graph display.
- Rust indexer CLI/sidecar.
- Sync runs and events.
- Silent path update for confident move/rename detection.
- Conflict events for uncertain matches.

Out of scope:

- Copying files into an app-owned asset store.
- Automatic real file moves or folder reorganization.
- Writing tags to Markdown.
- Automatically rewriting Markdown links.
- Full version history.
- Complex Obsidian block references.
- AI classification or automatic tagging.
- A custom full media editor.

## Acceptance Criteria

- The app can index a selected vault folder without copying files.
- Each indexed file has a stable asset ID that survives path changes.
- Tags remain attached to assets after a file is moved or renamed inside the vault.
- Markdown links and embeds are parsed into SQLite and can power navigation and a graph view.
- Startup can render the last indexed state before reconciliation completes.
- Background sync can detect added, updated, missing, restored, moved, and conflict states.
- Rust indexer failures do not crash the Electron UI.
- The schema leaves room for future manual relationships without requiring Markdown rewrites.
