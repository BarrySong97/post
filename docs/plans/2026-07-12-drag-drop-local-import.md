# Drag-drop local file import

## Goal

Let users drop external files onto the Post desktop window to copy them into the active vault and index them as assets, with an inhale-style hover mask while dragging.

## Approach

1. Preload exposes `resolveDroppedFilePaths` via Electron `webUtils.getPathForFile`.
2. Main `importLocalFiles` copies into `assets/imports/`, skips vault-internal and hidden sources, then runs indexer `refresh` on the new relative paths and queues thumbnails.
3. `FileDropZone` on the app shell shows a full-window mask on external `Files` drag when a vault is active, then calls the mutation on drop.

## Status

Implemented 2026-07-12.
