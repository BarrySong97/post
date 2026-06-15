# Image Galleries Design

## Summary

Post will add image galleries as folded image stacks in the asset board. A gallery is not a tag, saved view, filesystem asset, or Markdown graph link. It is a user-managed primary grouping of existing image assets: once a gallery has two or more members, the asset board shows one gallery card instead of showing each member image separately.

The first implementation must add a JavaScript unit-test baseline before building gallery behavior. Gallery rules affect database constraints, repository projection, and user-facing list semantics, so the feature should not rely only on type checks and manual UI verification.

## Goals

- Let users group existing image assets into a gallery that appears as one card in the asset board.
- Keep each image in at most one folded gallery; multi-classification remains a tag responsibility.
- Keep galleries separate from `assets`, `asset_files`, and `asset_links`.
- Provide a dedicated gallery page focused on browsing images, not asset metadata.
- Preserve gallery membership when a file is temporarily missing.
- Introduce a TypeScript unit-test command and cover the core gallery and board projection rules.

## Non-Goals

- Do not make galleries a new `assets.kind` value in the first version.
- Do not reuse `asset_links` for gallery membership.
- Do not support one image belonging to multiple folded galleries.
- Do not add independent gallery tags in the first version.
- Do not make the Rust indexer create, update, or delete galleries.
- Do not add React component tests as part of the initial test baseline.

## Product Model

The asset board distinguishes normal image cards from gallery cards:

- An image with no gallery membership appears as a normal image asset card.
- A gallery with one member does not fold in the asset board; the single image still appears as a normal image card.
- A gallery with two or more members appears as one gallery card.
- Non-cover members of a folded gallery do not appear as separate asset-board cards.
- The gallery card uses the gallery cover image and shows a stack indicator plus member count.
- Missing members remain part of the gallery and are surfaced in the gallery page. The gallery card may show a light missing count such as `8 张 · 2 丢失`.

Deleting a gallery removes only the grouping relationship. Member images return to normal asset-board display. Deleting a member image removes that image from the gallery through foreign-key cascade or application cleanup. Temporarily missing files do not remove membership.

## Data Model

Add two tables in `packages/db/src/schema.ts` and generate a Drizzle migration.

### `asset_galleries`

- `id`
- `vault_id`
- `title`
- `description`
- `cover_asset_id`
- `status`
- `privacy`
- `created_at`
- `updated_at`
- `deleted_at`

`status` and `privacy` mirror the asset workflow enough for gallery cards to participate in board status filters. Gallery tags are deferred. In the first version, tag filters match galleries through member image tags.

### `asset_gallery_items`

- `gallery_id`
- `asset_id`
- `vault_id`
- `sort_order`
- `caption`
- `created_at`

Required constraints and indexes:

- `asset_gallery_items.gallery_id` references `asset_galleries.id` with cascade delete.
- `asset_gallery_items.asset_id` references `assets.id` with cascade delete.
- `asset_gallery_items(vault_id, asset_id)` is unique, enforcing one folded gallery per image.
- Index `asset_galleries(vault_id, updated_at)`.
- Index `asset_gallery_items(gallery_id, sort_order)`.
- Index `asset_gallery_items(vault_id, asset_id)`.

Application rules:

- Gallery members must be image assets.
- `cover_asset_id` must point to a gallery member.
- Creating a gallery defaults the first selected image as the cover, even when the gallery has one member.
- If the cover asset is permanently deleted, choose the lowest `sort_order` remaining member as the new cover.
- If no members remain after deletion cleanup, soft-delete the gallery.
- Missing files keep their membership and sort position.

## API Boundaries

Keep the existing asset API focused on real assets.

### `assets` router

- Continues to return real asset records.
- Does not return gallery union items.
- `/assets/:assetId` remains the single-asset detail route.

### `galleries` router

Add a dedicated router for gallery behavior:

- `galleries.list`
- `galleries.byId`
- `galleries.create`
- `galleries.update`
- `galleries.delete`
- `galleries.addItems`
- `galleries.removeItems`
- `galleries.reorderItems`
- `galleries.setCover`

Shared gallery input schemas should live under `apps/desktop/src/shared/contracts/` and remain renderer-safe.

### `assetBoard` or `library` router

Add a board projection API for the asset manager main view. This API returns display items, not raw asset records:

```ts
type AssetBoardItem =
  | { itemType: "asset"; asset: AssetListItem }
  | { itemType: "gallery"; gallery: GalleryListItem };
```

This keeps `assets.list` stable while giving the asset board the folded-gallery behavior it needs.

## Board Filtering And Sorting

The board projection applies existing filters with gallery-aware behavior:

- `type=image` returns normal images and gallery cards.
- Non-image type filters do not return gallery cards.
- Status filters use gallery `status` for gallery cards.
- Tag filters match a gallery when any member image has the requested tag.
- `untagged` matches a gallery only when all member images are untagged.
- Time sorting uses asset file time for normal assets and `asset_galleries.updated_at` for gallery cards.
- Updating gallery title, description, cover, ordering, or membership updates `asset_galleries.updated_at`.
- If a gallery matches a filter through a non-cover member, the gallery still appears using its cover image.

## Gallery Page

Add a dedicated gallery route:

```text
/galleries/:galleryId
```

This page is an image-focused viewer rather than an asset detail page:

- Central large preview for the current member.
- Thumbnail strip or side rail for all members in `sort_order`.
- Missing members keep their slot and render a controlled missing placeholder.
- Lightweight metadata for the current image: file name, dimensions, path, and tags.
- Actions: previous/next, set cover, remove member, reorder members, edit title/description/status, open current image asset detail.

`/assets/:assetId` remains focused on a single asset's details, file actions, tags, and metadata.

## Missing And Delete Semantics

The indexer can mark `asset_files.file_exists = false` when a previously indexed path is not found. This can represent deletion, rename, sync delay, or temporary storage unavailability, so missing is not treated as permanent deletion.

Rules:

- Missing gallery members remain in `asset_gallery_items`.
- Missing members are shown in the gallery page with a placeholder.
- Missing members count toward total member count.
- Restored files automatically regain their thumbnail and preview because membership was preserved.
- Explicit permanent asset deletion removes membership.
- Gallery deletion never deletes member assets.

## Unit Testing Baseline

Add Vitest before implementing gallery behavior.

Root changes:

- Add `pnpm test` as `turbo test`.
- Add a `test` task to `turbo.json`.

Desktop workspace changes:

- Add `vitest`.
- Add `apps/desktop/vitest.config.ts`.
- Add `desktop` scripts:
  - `test`: `vitest run`
  - `test:watch`: `vitest`

Initial scope:

- Test repository, use-case, contract, and pure helper logic.
- Use Node environment tests.
- Avoid React component tests in the first baseline.
- Provide test helpers for isolated temporary SQLite databases.

Gallery implementation should include focused tests for:

- One image cannot belong to two folded galleries.
- Creating a gallery defaults the first image as cover.
- A one-member gallery does not fold in the board.
- A two-member gallery returns one gallery card and hides non-cover members.
- Deleting a gallery restores member images to normal board display.
- Missing members remain in gallery detail.
- Deleting an asset removes membership and repairs cover selection.
- Tag filters match galleries through member tags.

## Implementation Phases

1. Add Vitest unit-test baseline and update `docs/testing.md`.
2. Add gallery schema and generated Drizzle migration.
3. Add gallery repository and use cases with unit tests.
4. Add board projection repository/API with folding tests.
5. Add gallery tRPC router and shared contracts.
6. Update asset manager board to consume board projection items.
7. Add gallery card UI and `/galleries/:galleryId` route.
8. Add gallery page interactions for browsing, reorder, cover, remove, and edit.
9. Update docs in `docs/modules/desktop/assets.md`, `docs/modules/db/README.md`, and related topic docs.

## Verification

Run the focused verification for each implementation phase:

```bash
pnpm test
pnpm check-types
node scripts/check-docs.mjs
```

For schema changes:

```bash
pnpm db:generate
pnpm check-types
```

For renderer work:

```bash
pnpm dev
```

Then manually verify:

- Create a gallery from multiple images.
- Confirm the asset board folds the members into one gallery card.
- Open the gallery page and browse members.
- Mark or simulate a missing member and confirm it remains visible as missing.
- Delete the gallery and confirm member images return to the asset board.
