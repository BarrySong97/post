# Global Status Line and Background Tasks Design

## Context

Post is moving toward an Obsidian-like vault application for local assets. The app now scans a selected folder, stores asset relationships in SQLite, and renders images in a virtualized masonry view. High-resolution images require generated thumbnails so the asset grid can stay responsive.

The current UI has page-local loading states for importing, reconciling, and thumbnail generation. That is not enough once work continues after the visible page loads. Users need a persistent, IDE-like status line that explains what the app is doing in the background without blocking the main interface.

## Goals

- Add a global bottom status line that appears across the app, not only on the asset page.
- Show app context on the left: app version and current folder/vault.
- Show the current or recently completed background task on the right.
- Provide a popover that summarizes running, queued, and recently completed tasks.
- Track first-version background tasks in Electron main process memory.
- Automatically generate missing or stale image thumbnails after indexing/reconcile and on app startup/vault load.
- Keep the UI usable while indexing or thumbnail generation is running.

## Non-Goals

- Do not build a persistent task history table in SQLite for the first version.
- Do not add pause, cancel, retry, or open-log controls in the first popover.
- Do not show sync idle or future sync state in the status line yet.
- Do not expose AI, export, batch edit, or cache cleanup task types yet.
- Do not make thumbnail generation depend on scrolling into a specific image.

## Product Shape

The app gets a global shell:

```text
AppShell
  Main page content
  GlobalStatusLine
```

The footer layout is:

```text
Left:  Post v0.1.0 | Folder: post-test-folder
Right: Generating thumbnails 3 / 42
```

When no background task is active, the right side is empty. When a task completes, the right side briefly shows a completion summary, then disappears:

```text
Thumbnails complete · 42 images
```

If a task fails, the right side shows a compact failure message until the user opens the popover or a newer task supersedes it:

```text
Thumbnail generation failed
```

Clicking the right task pill opens a Queue Summary popover with three sections:

```text
Running
Queued
Recently completed
```

The popover shows task title, status, progress, and any error summary. It does not include pause/cancel/log actions in the first version.

## Task Model

Background tasks live in Electron main process memory.

```ts
type BackgroundTaskType = "indexing" | "reconcile" | "thumbnails";

type BackgroundTaskStatus = "queued" | "running" | "completed" | "failed";

type BackgroundTask = {
  id: string;
  type: BackgroundTaskType;
  title: string;
  status: BackgroundTaskStatus;
  vaultId?: string;
  vaultName?: string;
  progress?: {
    current?: number;
    total?: number;
    label?: string;
  };
  summary?: string;
  startedAt: number;
  updatedAt: number;
  completedAt?: number;
  errorMessage?: string;
};
```

The task manager exposes:

```ts
createTask(input): BackgroundTask
startTask(taskId): void
updateTask(taskId, patch): void
completeTask(taskId, summary?): void
failTask(taskId, error): void
getSnapshot(): BackgroundTaskSnapshot
```

The snapshot includes:

```ts
type BackgroundTaskSnapshot = {
  activeTask: BackgroundTask | null;
  running: BackgroundTask[];
  queued: BackgroundTask[];
  recentlyCompleted: BackgroundTask[];
  failed: BackgroundTask[];
};
```

Recently completed tasks are retained in memory, for example the latest 10 tasks or tasks from the last 30 minutes. This history resets when the app restarts.

## Display Priority

The status line chooses one right-side task using this priority:

```text
running
queued
failed
recently completed
none
```

Example labels:

```text
Indexing folder · 155 files
Reindexing folder...
Generating thumbnails 3 / 42
Thumbnails complete · 42 images
Generated 39 thumbnails · 3 failed
Thumbnail generation failed
```

The right-side task summary should be stable and compact; detailed counts and errors live in the popover.

## Task Sources

First-version task types:

```text
indexing   Selecting/importing a folder and scanning assets
reconcile  Manual rescan/reconcile of the current folder
thumbnails Background thumbnail prewarming for image assets
```

Markdown parsing is treated as part of indexing for now. It does not appear as a separate task.

## Thumbnail Prewarming

Thumbnail generation changes from viewport-triggered to vault-triggered:

```text
First folder import
  indexing starts
  indexing completes
  thumbnails task starts automatically

Manual reconcile
  reconcile starts
  reconcile completes
  thumbnails task starts automatically

App startup / vault loaded
  asset list loads
  app checks for missing/stale thumbnails
  thumbnails task starts automatically if work exists
```

The asset grid is not blocked by this work. It displays thumbnails when ready and placeholders while thumbnails are pending.

The grid may still report visible image IDs to boost priority, but visibility is only a priority signal. It is not the trigger for thumbnail generation.

## Thumbnail Task Behavior

The thumbnail task scans the current vault for image assets whose thumbnails are missing or stale.

Missing/stale means:

- no `image_cache` row exists for the asset;
- the cache status is not `ready`;
- the thumbnail file is missing;
- or the cached source size, mtime, or quick fingerprint differs from the current file.

The task generates thumbnails in small batches with low concurrency. It writes results to SQLite after each batch so the renderer can refresh incrementally.

For individual image failures:

- mark that image cache row as `failed`;
- continue processing the remaining images;
- complete the task with a summary such as `Generated 39 thumbnails · 3 failed`.

For task-level failures:

- mark the background task as `failed`;
- keep a compact error message in the task snapshot.

## Main Process Data Flow

The main process owns task state because all first-version background work is initiated there.

```text
renderer mutation
  -> tRPC asset router
  -> backgroundTaskManager.createTask()
  -> runIndexer(command, input, onEvent)
  -> onEvent updates task progress
  -> task completes/fails
  -> optional follow-up thumbnails task starts
```

`runIndexer` should support event streaming back to the caller through an `onEvent` callback. It can still return the final event list for existing call sites, but the task manager needs live events to update the status line while Rust is running.

## Renderer Data Flow

The renderer fetches task state through a small tRPC router:

```text
tasks.snapshot query
```

Polling behavior:

```text
active/queued/failed tasks present: poll about every 1s
no task present: poll more slowly, about every 5-10s, or on window focus
```

The status line and popover should be renderer-only consumers of the snapshot. Business logic stays in main.

## App Shell Placement

The app should add an `AppShell` near the route root so the status line appears across pages:

```text
__root route
  TRPC provider
  AppShell
    Outlet
    GlobalStatusLine
```

Existing full-height pages should reserve footer height so the status line does not overlay scrollable content. Asset manager panels should use a shell-provided available height rather than independently consuming the full viewport.

## Error Handling

User-visible error behavior:

- task failure appears on the right side of the status line;
- the popover shows the task name and short error;
- retry controls are not part of v1;
- users retry by repeating the original action, such as re-syncing the folder.

Image-level failures do not fail the whole thumbnails task. They contribute to the final summary.

## Testing

Unit-level checks:

- task manager priority ordering;
- recently completed retention;
- failure state handling;
- snapshot shape.

Integration checks:

- selecting a folder creates an indexing task;
- completed indexing starts a thumbnails task if missing/stale thumbnails exist;
- manual reconcile creates a reconcile task and then a thumbnails task;
- `tasks.snapshot` returns running, queued, completed, and failed tasks in the expected groups.

UI checks:

- status line left side shows version and current folder;
- right side hides when idle;
- right side shows running task progress;
- completion summary appears briefly;
- popover shows Queue Summary sections.

Performance checks:

- status polling does not re-render the asset grid unnecessarily;
- thumbnail generation remains background work and does not block page interaction;
- asset grid does not load original images for thumbnail cards.

## Open Implementation Notes

- Package version can come from desktop package metadata or a small main-process constant exposed through tRPC.
- Current folder should come from the active vault in the asset router or a shared vault context.
- If multiple vaults become supported at once, task snapshots should remain vault-aware but the status line should show the active vault first.
- The visual design should follow the selected IDE-style footer: left context, right task pill, Queue Summary popover.
