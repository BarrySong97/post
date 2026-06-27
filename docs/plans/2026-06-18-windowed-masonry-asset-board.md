# Windowed Masonry Asset Board

## Context

The asset board must keep its masonry visual layout while remaining responsive with tens of thousands of assets. The current board uses cursor-based infinite loading. That works for incremental scrolling, but fast scrollbar jumps can land beyond the already-loaded pages, leaving the target area blank while the app sequentially catches up.

## Direction

Keep the masonry UI, but separate layout discovery from full card hydration.

1. Query a lightweight, globally ordered layout index for the active filter set.
2. Feed the full lightweight index into the masonry virtualizer so scroll height exists immediately.
3. Hydrate full asset card data only for currently rendered and nearby items.
4. Render same-size placeholders for unhydrated cards.
5. Keep thumbnail/image loading scoped to the active window instead of the entire result set.

## First Experiment

- Add an `assets.layoutIndex` query that returns lightweight asset metadata for all matching assets.
- Add an `assets.hydrate` query that returns full asset rows for a bounded list of ids.
- Change the asset board to render from the layout index and request hydration from `masonic`'s rendered range callback.
- Keep the existing asset detail and actions unchanged.

## Verification

- Type-check, lint, build, and docs harness.
- Use the 50k asset fixture to compare query timings and manually verify fast scrollbar jumps.
- Track whether current-screen placeholders appear immediately and hydrated cards follow without waiting for previous pages.

## Follow-Ups

- Add an indexed two-step SQL path if `layoutIndex` still reports temp sorting.
- Add explicit performance marks around scroll jump to first visible card and first hydrated card.
- Tune placeholder height estimates for image/video/document card categories.
