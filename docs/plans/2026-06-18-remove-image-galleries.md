# Remove Image Galleries Plan

## Goal

Remove image galleries as a product feature from frontend through backend and return the asset
board to a plain asset list. This is a full removal, not a hidden or deprecated feature path. The
change should eliminate gallery UI, routes, tRPC procedures, domain/CLI commands, board-folding
projection code, and the gallery database tables. Existing assets and vault files must not be
deleted.

## Decision

- Do not keep a disabled gallery button, hidden route, compatibility tRPC router, CLI command, or
  domain service.
- Do not keep `assetBoard` as a gallery-aware alias around `assets.list`.
- Do not keep gallery tables in the active schema after migration.
- Treat old gallery docs/specs as historical only; they must not describe active behavior.

## Rationale

Galleries add a second grouping model on top of tags and saved views, but the current product does
not need that extra concept. Keeping the code hidden would still leave the expensive
`assetBoard.list` projection path in place, including gallery lookup, folding, in-memory sorting, and
extra renderer model branches. Full removal is cleaner and directly supports the asset-page
performance cleanup.

## Scope

- Remove user-facing gallery creation, selection, gallery cards, and the `/galleries/:galleryId`
  route.
- Replace `trpc.assetBoard.list` usage in the asset manager with the existing raw
  `trpc.assets.list` paginated path.
- Delete gallery-aware board projection code once no renderer route consumes it.
- Remove gallery tRPC router, shared gallery contracts, main use cases, repositories, and tests.
- Remove `packages/domain/src/galleries` and all CLI `gallery` commands/operation handling.
- Remove `asset_galleries` and `asset_gallery_items` from `packages/db/src/schema.ts`, then generate
  a Drizzle migration that drops those tables and related indexes.
- Update module/topic docs so galleries are no longer documented as active behavior.

## Non-Goals

- Do not replace galleries with a new collection feature in this change.
- Do not introduce Canvas/WebGL rendering as part of this removal.
- Do not delete asset rows, asset files, thumbnails, tags, saved views, markdown cache, or link data.
- Do not preserve gallery membership data unless a separate export requirement is added before the
  migration.

## Implementation Plan

### 1. Renderer and Routes

- In `asset-manager-page.tsx`, remove gallery-selection state, create-gallery modal, gallery toolbar
  button, `GalleryCard`, and `AssetBoardCard` item branching.
- Change the infinite query from `trpc.assetBoard.list` to `trpc.assets.list`.
- Map query results with `mapIndexedAsset` and render only `AssetCard`.
- Remove navigation to `/galleries/:galleryId`.
- Delete `apps/desktop/src/renderer/src/routes/_app.galleries.$galleryId.tsx` and
  `apps/desktop/src/renderer/src/pages/galleries/gallery-page.tsx`.
- Simplify renderer model/types by removing `IndexedGallery`, `GalleryCard`, `GalleryDetail`,
  `AssetBoardCard`, `mapIndexedGallery`, and `mapIndexedBoardItem`.
- Remove `galleryFormSchema` from asset-manager form schemas.

### 2. Desktop Main and tRPC

- Remove `assetBoardRouter` and `galleriesRouter` from `apps/desktop/src/main/trpc/router.ts`.
- Delete `apps/desktop/src/main/trpc/routers/asset-board.ts`.
- Delete `apps/desktop/src/main/trpc/routers/galleries.ts`.
- Delete `apps/desktop/src/main/repositories/asset-board-repository.ts` and its test.
- Delete `apps/desktop/src/main/repositories/galleries-repository.ts`.
- Delete `apps/desktop/src/main/use-cases/galleries.ts` and its test.
- Delete shared contracts under `apps/desktop/src/shared/contracts/asset-board/` and
  `apps/desktop/src/shared/contracts/galleries/`.

### 3. Domain and CLI

- Delete `packages/domain/src/galleries/index.ts`.
- Remove the gallery export from `packages/domain/src/index.ts` and `packages/domain/package.json`.
- Remove gallery operation types, lock scopes, count reporting, apply-patch handling, and Commander
  `gallery` subcommands from `packages/cli/src/main.ts`.
- Update CLI docs to describe tags, views, assets, and vaults only.

### 4. Database Migration

- Remove `assetGalleries` and `assetGalleryItems` from `packages/db/src/schema.ts`.
- Run `pnpm db:generate`.
- Inspect the generated SQL and ensure it drops only:
  - `asset_gallery_items`
  - `asset_galleries`
  - their indexes/foreign keys as represented by Drizzle
- Confirm the migration does not touch `assets`, `asset_files`, thumbnails, tags, saved views, or
  link/cache tables.

### 5. Documentation

- Update `docs/modules/desktop/assets.md` to describe `trpc.assets.list` as the board data path and
  remove gallery notes.
- Update `docs/modules/desktop/README.md`, `docs/modules/db/README.md`,
  `docs/modules/domain/README.md`, `docs/modules/cli/README.md`, and
  `docs/topics/vault-indexing-flow.md`.
- Mark the old gallery spark/spec documents as superseded or historical if they remain under
  `docs/spark/`.
- Keep source headers current for files whose responsibilities change, especially
  `asset-manager-page.tsx`, `asset-model.ts`, router files, and CLI/domain entrypoints.

### 6. Verification

- Run the affected test suites:
  - `pnpm test`
  - `pnpm check-types`
  - `pnpm lint`
- Run database verification:
  - `pnpm db:generate` before committing schema changes
  - inspect generated migration SQL manually
  - run `pnpm db:migrate` against a temporary copy if needed
- Run docs verification:
  - `node scripts/check-docs.mjs`
- Run the Electron app with `pnpm dev` and verify:
  - asset board loads with ordinary assets
  - infinite scroll still fetches pages
  - image assets open `/assets/:assetId`
  - no gallery toolbar control appears
  - stale `/galleries/:galleryId` URLs no longer route to a working page

### 7. Performance Verification

Capture a before/after performance baseline so the removal is measurable rather than subjective.
Use the same vault fixture, viewport size, sort/filter state, and scroll script before and after the
change.

#### Metrics

- `asset list first page`: time from `assets` route mount to first page data resolved.
- `next page fetch`: time from sentinel intersection to the next page appended.
- `main-process query time`: elapsed time inside the list tRPC procedure and repository call.
- `renderer scroll smoothness`: dropped-frame count or long-frame count while scrolling from top to
  bottom and back.
- `rendered item count`: number of card DOM nodes mounted during steady scrolling.
- `thumbnail protocol pressure`: count of `post-file://thumb` requests during the scripted scroll.
- `memory`: renderer RSS or heap after initial load and after a full scroll pass.

#### Test Data

- Use generated deterministic temporary vault/database fixtures rather than hand-built user data.
- Add a script such as `scripts/perf/seed-asset-fixture.mjs` that creates a disposable
  `POST_USER_DATA_DIR` under `/private/tmp/post-perf-*`, initializes SQLite through the project
  schema/migrations, and inserts realistic rows directly through the database layer.
- Build at least three fixture sizes:
  - `small`: 500 assets for quick smoke checks
  - `large`: 10,000 assets for normal regression runs
  - `stress`: 50,000 assets for worst-case local profiling
- Asset mix for `large` and `stress`:
  - 55% images
  - 25% markdown
  - 10% generic files
  - 5% videos
  - 5% web/link-style records
- Image rows should include ready `image_cache` entries and thumbnail paths. Reuse a small set of
  generated thumbnail files across many rows or generate tiny deterministic JPEGs so the test
  measures list/query/scroll behavior without requiring tens of thousands of unique real images.
- Before-removal baseline should include representative gallery rows because that is the path being
  removed:
  - 30% of image assets assigned to multi-image galleries
  - gallery sizes distributed across 2, 3, 5, 10, and 30 members
  - several missing-member rows to exercise the old missing-count path
- After-removal fixtures should use the same asset, file, tag, markdown, image-cache, and thumbnail
  data but omit gallery tables after the migration.
- Keep the existing small production-like vault as a secondary sanity check; it helps verify that
  the change does not regress low-count behavior.

#### Instrumentation

- Add temporary debug timing around the old `assetBoard.list` path before removal and the replacement
  `assets.list` path after removal. Use `performance.now()`/`console.time` in main-process router and
  repository boundaries, guarded by an env flag such as `POST_PERF_ASSETS=1`.
- Add a renderer-only perf marker around:
  - route mount
  - first non-empty list render
  - next-page fetch start/end
  - scroll script start/end
- Use Playwright or the in-app browser automation to run a fixed scroll script against `pnpm dev`
  where possible. If Electron automation is not practical, use Chromium DevTools Protocol against a
  debug Electron run.
- Record `PerformanceObserver` long tasks in the renderer during the scroll script.
- Count thumbnail protocol requests in the `post-file` protocol handler under the same env flag.
- Add a repeatable command for the large fixture, for example:
  - `POST_USER_DATA_DIR=/private/tmp/post-perf-large POST_PERF_ASSETS=1 pnpm -F desktop dev`
  - `node scripts/perf/run-asset-scroll.mjs --user-data-dir /private/tmp/post-perf-large --route /`
- The scroll runner should:
  - open the asset page
  - wait for the first page
  - record initial metrics
  - scroll to the bottom in fixed pixel steps
  - wait for pagination until no next page remains or a configured item cap is reached
  - scroll back to the top
  - write JSON to `/private/tmp/post-perf-large/result.json`

#### Acceptance Targets

- Remove all `assetBoard.list` calls from the asset page.
- First-page main-process list query should no longer scale with all gallery members; target at least
  a 50% reduction on the large fixture compared with the old gallery-aware path.
- Next-page fetch should use cursor pagination and avoid `BOARD_SCAN_LIMIT`-style full scans.
- On the 10,000-asset fixture, first-page repository time should stay near page-size work rather than
  total asset count work. A practical target is under 150 ms on a normal development Mac, with the
  exact baseline recorded in the perf result JSON.
- On the 50,000-asset stress fixture, loading the first page should remain usable and should not
  allocate or sort all rows in the renderer or main process.
- Scripted scroll should not increase mounted card count beyond the virtualization window.
- No background gallery query should run during asset-board load.
- No route or CLI command should be able to create, read, update, or delete galleries after removal.

## Risk Notes

- Dropping gallery tables deletes gallery membership data. This should be acceptable because the
  feature is being removed, and the tables do not own asset files.
- Removing `assetBoard` changes router output types; expect renderer type cleanup to cascade through
  `asset-manager/types.ts` and `asset-model.ts`.
- The generated TanStack route tree may change after deleting the route file. Treat
  `routeTree.gen.ts` as generated output and do not hand-edit it unless the existing toolchain does.
- Some historical docs and spark plans intentionally describe past decisions. Prefer marking them
  superseded over rewriting history unless the docs harness requires stronger cleanup.
