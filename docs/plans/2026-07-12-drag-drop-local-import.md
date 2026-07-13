# Drag-drop local file import

## Goal

Let users drop external files onto the Post desktop window to copy them into the active vault and index them as assets, with four-state drop feedback and a footer-aware import progress pill.

## Approach

1. Preload exposes `resolveDroppedFilePaths` via Electron `webUtils.getPathForFile`.
2. Main `importLocalFiles` copies into `assets/imports/`, skips vault-internal and hidden sources, then runs indexer `refresh` on the new relative paths and queues thumbnails. Import tasks carry a `subject` built from basenames.
3. `FileDropZone` shows hover / blocked / in-flight / done-failed states; the progress pill shares the `import` background task.

## Status

Implemented 2026-07-12; four-state UI + highlight + footer subject/digest follow-up 2026-07-13.
