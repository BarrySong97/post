# Mock Data Package

## Responsibility

`packages/mock-data` owns deterministic, browser-safe sample data for Post product previews and demos. It is intentionally separate from the desktop database, Electron runtime, and filesystem-backed `post-file://` assets.

The current package feeds the website product preview with sidebar counts, saved views, tags, asset cards, filter options, editor open targets, knowledge-graph nodes and edges, asset detail metadata, settings rows, status-line labels, and footer task rows. Preview image URLs point at static website assets under `apps/website/public/product-preview/`.

## File Map

- `packages/mock-data/src/index.ts` - public mock data exports and lookup helpers.
- `packages/mock-data/package.json` - package metadata and workspace dependencies.
- `packages/mock-data/tsconfig.json` - package TypeScript configuration.

## Public Interfaces

- `postPreviewSidebar` - sidebar summary, saved views, and tags.
- `postPreviewAssets` - mock asset board/detail records shaped for `@post/ui`.
- `postPreviewDefaultFilters` - initial filter state for the preview asset board.
- `postPreviewFilterOptions` - filter panel options for asset kind, tag, source, time, status, and sort.
- `postPreviewOpenTargets` - editor/finder split-button menu options.
- `postPreviewGraph` - deterministic knowledge-graph nodes, edges, and stat labels.
- `postPreviewSettings` - settings-page rows for the interactive website demo.
- `postPreviewStatus` - bottom status-line labels and mock background task rows.
- `getPostPreviewAssetById(id)` - convenience lookup for asset detail navigation.

## Notes

- Keep data deterministic; do not read the user's filesystem, SQLite, Electron userData, or network resources.
- Keep sample data shaped for shared presentation types from `@post/ui`.
- Asset images may be intentionally reused by multiple mock records so filtered preview boards can remain visually filled.
- Keep generated preview images in the consuming app's public assets so URL paths stay deployment-safe.
