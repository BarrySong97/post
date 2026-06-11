# Vault Watch System Design

## Context

Post treats a local folder as an asset vault. The current flow is scan-oriented:
the Rust `post-indexer` runs one-shot commands such as `scan`, `reconcile`, and
`thumbnails`; Electron main receives NDJSON progress; the renderer reads data
through request-response tRPC queries over Electron IPC.

This leaves an important stale-data gap. If a user opens a Markdown asset in an
external editor, changes the file, and returns to Post, the detail view and list
can still show cached content until a manual refresh or reconcile occurs.

The desired system is a full local synchronization layer:

- Detail views react quickly when the currently open file changes.
- List views react when files are created, updated, deleted, renamed, or moved.
- The vault keeps syncing while the app is open, without relying only on window
  focus.
- The existing footer/background-task UI shows sync status instead of adding a
  separate watcher status surface.
- Events reach the renderer through a unified subscription stream rather than
  ad hoc polling.

## Goals

- Turn `post-indexer watch` into a real long-running Rust watcher daemon.
- Use OS-backed file watching through a Rust watcher library such as `notify`.
- Keep Rust responsible for filesystem facts, fingerprinting, classification,
  and DB mutations.
- Keep Electron main responsible for app lifecycle, daemon process management,
  active vault selection, and event fan-out.
- Add a unified app event subscription over the existing Electron IPC tRPC
  transport.
- Reuse the existing footer task/status line for watcher sync progress,
  completion, and failure states.
- Support created, updated, deleted, renamed, and moved files.
- Support active scope priority for detail, list, and background states.
- Avoid heavy work for ordinary file saves by batching, debouncing, and using
  cheap fingerprints.
- Provide focus and route-switch audits as a correctness fallback for missed
  watcher events.

## Non-Goals

- Do not add cloud sync, collaboration, or conflict resolution between devices.
- Do not immediately hard-delete asset DB rows when files disappear.
- Do not make the renderer own filesystem watching logic.
- Do not send full asset or Markdown contents through the event stream.
- Do not replace React Query as the source of truth for complete data fetches.
- Do not require a full-vault reconcile for every small file edit.

## Recommended Architecture

The system uses a long-running Rust daemon and a unified event bus:

```text
Filesystem events
  -> Rust watcher daemon
  -> debounce / ignore / classify / fingerprint
  -> DB mutation
  -> NDJSON watcher events
  -> Electron main AppEventBus
  -> tRPC IPC subscription events.subscribe()
  -> renderer event handlers
  -> React Query invalidation / footer task updates
```

Responsibilities are deliberately split:

```text
Rust watcher daemon:
  - watch vault root
  - normalize paths
  - ignore noisy paths
  - coalesce file events
  - stat and fingerprint changed paths
  - detect created / updated / deleted / moved files
  - update SQLite
  - emit normalized NDJSON events

Electron main:
  - start / stop / restart watcher daemon
  - send active scope and audit commands to daemon stdin
  - parse daemon NDJSON
  - update BackgroundTaskManager
  - publish AppEventBus events
  - expose event subscription through tRPC IPC

Renderer:
  - query initial snapshots
  - subscribe to unified event stream
  - report current watch scope
  - debounce query invalidations
  - keep footer UI in sync with task events
```

## Rust Watcher Daemon

`post-indexer watch` becomes a persistent command:

```bash
post-indexer watch \
  --vault-id <id> \
  --root-path <path> \
  --db-path <path> \
  --thumbnail-root <path>
```

The daemon reads JSON commands from stdin and writes NDJSON events to stdout.

### Stdin Commands

```json
{"type":"set_scope","scope":{"type":"detail","assetId":"...","relativePath":"notes/a.md"}}
{"type":"set_scope","scope":{"type":"list","vaultId":"...","visibleAssetIds":["..."]}}
{"type":"set_scope","scope":{"type":"background","vaultId":"..."}}
{"type":"audit_scope"}
{"type":"shutdown"}
```

`set_scope` changes priority, not correctness. The watcher still tracks the
whole vault, but current-scope files are processed first.

`audit_scope` asks the daemon to run a cheap fingerprint check for the active
scope. It is used after window focus, route changes, and daemon restart to catch
events missed while the app was suspended or the watcher was restarting.

### Stdout Events

```json
{"type":"watcher.ready","vaultId":"..."}
{"type":"watcher.status","vaultId":"...","status":"watching"}
{"type":"watcher.batch.started","vaultId":"...","pending":12}
{"type":"watcher.asset.changed","vaultId":"...","assetId":"...","kind":"markdown","change":"updated","relativePath":"notes/a.md","priority":"detail"}
{"type":"watcher.asset.moved","vaultId":"...","assetId":"...","from":"old.md","to":"new.md"}
{"type":"watcher.batch.completed","vaultId":"...","counts":{"created":2,"updated":5,"deleted":1,"moved":1,"warnings":0},"affectedAssetIds":["..."]}
{"type":"watcher.error","vaultId":"...","message":"...","recoverable":true}
```

### Raw Event Pipeline

```text
raw fs event
  -> normalize path
  -> ignore rules
  -> pending path set
  -> quiet-window debounce
  -> classify batch
  -> fingerprint/stat
  -> DB mutation
  -> NDJSON event
```

### Ignore Rules

The first version ignores:

```text
.git/**
node_modules/**
.DS_Store
.obsidian/workspace*
.obsidian/cache/**
.trash/**
thumbnail cache root
*.tmp
*.swp
*~
```

Ignore rules should be centralized in Rust and covered by tests. Later versions
can add user-configurable vault ignore patterns.

### Debounce And Coalescing

File saves are noisy. The daemon should batch events by normalized path and
wait for a quiet window before processing:

```text
event path -> pending_paths.add(path)
wait 300-800ms without new related events
process batch
```

If the batch crosses a threshold such as 200 changed paths in one second, the
daemon switches to large-batch mode:

- process DB mutations in chunks
- emit batch progress events
- avoid per-file renderer invalidation spam
- allow Electron main to show a footer sync task

## Change Classification

For every changed path, Rust compares current filesystem facts with DB facts.

Classification rules:

- File exists and DB has no row: `created`
- File exists and DB row has different size, mtime, or fingerprint: `updated`
- File no longer exists and DB row exists: `deleted` / missing
- Same strong fingerprint appears at a new relative path: `moved`
- Too many mixed create/delete/update events: `batch_reconcile_required`

Move detection must be conservative. A false move is worse than a missed move
because it can merge two unrelated assets. The first version should only treat
delete-plus-create as a move when `quick_fingerprint` strongly matches.

## Fingerprint Strategy

The watcher should avoid full-file hashing for large assets.

Cheap fingerprint:

```text
sizeBytes + mtimeMs + extension + partial hash
```

Markdown and small files can use a content hash or stronger quick hash. Large
images and videos should use partial hashing and metadata. If `mtimeMs` changes
but fingerprint is identical, avoid unnecessary thumbnail regeneration.

## Data Model

The existing schema already has most of the required pieces:

- `asset_files.relativePath`
- `asset_files.sizeBytes`
- `asset_files.mtimeMs`
- `asset_files.quickFingerprint`
- `asset_files.fileExists`
- `markdownCache`
- `imageCache`

The watcher design relies on explicit file-state semantics:

```ts
type AssetFileState = {
  relativePath: string;
  sizeBytes: number;
  mtimeMs: number;
  quickFingerprint: string;
  fileExists: boolean;
  lastSeenAt: Date;
  missingSince?: Date;
};
```

If `lastSeenAt` or `missingSince` is not currently present, they can be added
only when needed. The first implementation can reuse existing timestamps if
schema churn should be minimized.

Deletion should be soft:

- set `fileExists = false`
- record missing time if available
- emit a deleted/missing event
- do not immediately delete asset rows

This prevents transient editor saves and watcher races from destroying asset
identity.

## Indexer Mutation Rules

### Markdown Files

When a Markdown file changes:

- read file content
- update file metadata and fingerprint
- parse frontmatter
- update title and description fields
- update `markdownCache`
- re-parse Markdown links
- refresh `assetLinks`
- emit `watcher.asset.changed`

Malformed YAML must not crash the daemon. The daemon should preserve readable
content, mark parse status as failed where supported, emit a recoverable warning,
and continue.

### Image And Video Files

When an image or video changes:

- update file metadata and fingerprint
- compare source fingerprint with cached thumbnail source fingerprint
- mark image cache pending or stale when source changed
- emit an asset change event
- allow Electron main to queue a thumbnail task

Thumbnail generation stays a background task rather than blocking watcher batch
completion.

### Generic Files

Generic files update metadata and any display title/description derived from the
file name or metadata. They do not require content parsing in the first version.

## Electron Main Watcher Manager

Electron main owns a `VaultWatcherManager`.

```ts
type WatcherState = {
  vaultId: string;
  rootPath: string;
  process: ChildProcess | null;
  status: "idle" | "starting" | "watching" | "restarting" | "failed";
  scope: WatchScope;
  lastEventAt?: number;
  restartCount: number;
  pendingChangedAssetIds: Set<string>;
};

type WatchScope =
  | { type: "detail"; vaultId: string; assetId: string; relativePath: string }
  | { type: "list"; vaultId: string; visibleAssetIds: string[] }
  | { type: "background"; vaultId: string };
```

Responsibilities:

- start one watcher daemon for the active vault
- stop the watcher when the active vault changes or the app quits
- send `set_scope`, `audit_scope`, and `shutdown` commands over stdin
- parse stdout NDJSON into typed events
- translate daemon events into app events
- update background tasks for sync batches
- restart crashed daemons with backoff

### Crash Recovery

Unexpected daemon exit:

```text
status = restarting
backoff: 1s -> 2s -> 5s -> 10s
restart daemon
send current scope
send audit_scope
```

If failures exceed a rolling-window threshold:

- set watcher status to failed
- show footer failure state
- keep manual reconcile available
- expose a "restart watcher" action later if needed

## Unified App Event Stream

The current IPC tRPC link is request-response. This design adds subscription
support instead of introducing one-off IPC push channels.

### IPC Shape

Query and mutation requests keep the existing promise flow.

Subscriptions add:

```ts
window.api.trpcSubscribe({ id, path, input });
window.api.trpcUnsubscribe({ id });
```

Main sends:

```text
trpc:subscription:next
trpc:subscription:error
trpc:subscription:complete
```

Renderer `ipc-trpc-link` maps subscription operations to observables and cleans
up the IPC listener when unsubscribed.

### Event Router

Add a unified subscription:

```ts
events.subscribe()
```

Event types:

```ts
type AppEvent =
  | { type: "watcher.status"; vaultId: string; status: "watching" | "restarting" | "failed" }
  | { type: "watcher.asset.changed"; vaultId: string; assetId: string; kind: AssetKind; change: "created" | "updated" | "deleted" | "moved"; relativePath: string }
  | { type: "watcher.batch.completed"; vaultId: string; affectedAssetIds: string[]; counts: ChangeCounts }
  | { type: "task.updated"; task: BackgroundTask }
  | { type: "task.completed"; task: BackgroundTask };
```

The event stream reports facts. It does not carry full asset content. Complete
data still comes from React Query queries such as `assets.list` and
`assets.markdownContent`.

## Footer Task Integration

The existing footer/background task system remains the user-facing status
surface.

Extend task types:

```ts
type BackgroundTaskType =
  | "indexing"
  | "reconcile"
  | "thumbnails"
  | "sync";
```

Normal watcher idle/watching status should not constantly occupy the active task
slot. It can appear as low-priority state in the popover or future diagnostics.

Watcher batches create or update `sync` tasks:

```text
Syncing 3 file changes
Sync complete · updated 2 · created 1
Watcher failed · restarting
Watcher stopped
```

Large batches should show progress. Small batches can appear briefly as recently
completed tasks.

Footer state should be initialized from `tasks.snapshot`, then updated through
`events.subscribe()`. The snapshot query remains a fallback and recovery path.

## Renderer Scope And Query Refresh

Renderer reports scope based on route and window state.

Detail route:

```ts
assets.setWatchScope({
  type: "detail",
  vaultId,
  assetId,
  relativePath,
});
```

List route:

```ts
assets.setWatchScope({
  type: "list",
  vaultId,
  visibleAssetIds,
});
```

Background or blurred window:

```ts
assets.setWatchScope({ type: "background", vaultId });
```

Window focus:

```ts
assets.auditWatchScope();
```

Renderer event handling:

```text
watcher.asset.changed for active detail asset
  -> invalidate markdownContent({ id })
  -> invalidate assets.list

watcher.asset.changed for list item
  -> add to changedAssetIds
  -> debounce 250ms
  -> invalidate assets.list once

watcher.batch.completed
  -> invalidate assets.list once
  -> invalidate active detail query if affectedAssetIds includes active asset

task.updated / task.completed
  -> patch or invalidate tasks.snapshot
```

Use three levels of noise control:

1. Rust daemon batches raw filesystem events.
2. Electron main coalesces watcher events into app events and footer tasks.
3. Renderer debounces React Query invalidations.

## Implementation Phases

### Phase 1: Subscription Infrastructure

- Add main process `AppEventBus`.
- Extend preload API for tRPC subscriptions.
- Extend renderer IPC tRPC link to support subscription observables.
- Add `events.subscribe()`.
- Verify unsubscribe cleanup and window close behavior.
- Optionally emit test task events to validate the pipe.

### Phase 2: Watcher Daemon Skeleton

- Make `post-indexer watch` long-running.
- Emit `watcher.ready`.
- Read stdin commands.
- Support `set_scope`, `audit_scope`, and `shutdown`.
- Electron main starts and stops the daemon.
- Footer can show watcher status.

### Phase 3: File Event Collection

- Add `notify` crate.
- Watch vault root recursively.
- Normalize paths.
- Apply ignore rules.
- Debounce and coalesce events.
- Emit batch events without DB mutation first.

### Phase 4: Incremental DB Updates

- Implement refresh path/path batch logic.
- Handle created, updated, deleted, and moved files.
- Reparse Markdown and asset links.
- Mark thumbnail cache stale when source changes.
- Emit affected asset IDs.

### Phase 5: Renderer Scope And Refresh

- Report detail/list/background scope.
- Send focus `audit_scope`.
- Subscribe to app events.
- Invalidate `assets.list` and `markdownContent` using debounced rules.
- Update footer from task events.

### Phase 6: Resilience And Polish

- Add crash restart with backoff.
- Add failed state and manual recovery action.
- Add diagnostic logging for watcher events.
- Tune debounce thresholds.
- Add user-visible copy for missing/deleted current files.

## Failure Recovery

- Watcher crash: Electron main restarts daemon with backoff.
- Restarted watcher: main sends current scope and `audit_scope`.
- Repeated failures: watcher status becomes failed and footer reports it.
- Event parse error: record warning and continue.
- DB mutation failure: emit recoverable watcher error and mark sync task failed.
- Subscription disconnect: renderer falls back to snapshot polling and focus audit.
- App quit: main sends shutdown, then kills process if it does not exit.

## Testing Strategy

Rust unit tests:

- path normalization
- ignore rules
- debounce/coalescing behavior
- created/updated/deleted/moved classification
- fingerprint matching
- malformed Markdown/frontmatter recovery
- event JSON serialization

Rust integration tests:

- create Markdown file -> DB asset created
- edit Markdown file -> metadata and markdown cache updated
- delete file -> file marked missing
- rename file -> same asset ID path updated when fingerprint matches
- mass file changes -> batch event emitted

Electron/main tests where practical:

- watcher manager starts daemon
- watcher manager sends scope commands
- daemon crash triggers restart
- AppEventBus publishes task and watcher events
- subscription cleanup removes listeners

Renderer tests where practical:

- active detail asset update invalidates markdown content
- list batch update invalidates assets list once
- task events update or invalidate footer snapshot
- subscription disconnect fallback does not break page data

Manual acceptance:

- Edit current Markdown asset in an external editor; Post detail updates after
  save or focus.
- Create a new file while list is open; list updates without manual reconcile.
- Delete current detail file; UI shows a missing/deleted state.
- Rename a file; asset identity is preserved when fingerprint strongly matches.
- Bulk changes show one footer sync task, not many noisy toasts or refetches.
- Watcher crash/restart is visible but does not crash the app.

## Acceptance Criteria

The first complete version is done when:

- `post-indexer watch` is a real daemon and exits cleanly on shutdown.
- Electron main manages one active watcher per active vault.
- Unified tRPC IPC subscriptions work for app events.
- Watcher events flow into `events.subscribe()`.
- Footer/background task system shows sync progress and failures.
- Detail, list, background, and focus scopes are reported.
- Created, updated, deleted, and moved files are handled for Markdown and
  generic files.
- Markdown changes update preview content and frontmatter-derived fields.
- Thumbnail cache is marked stale when image/video source changes.
- Large batches are coalesced and do not spam renderer refetches.
- TypeScript checks and Rust checks/tests pass.
