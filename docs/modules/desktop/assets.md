# Desktop Asset Management

## Responsibility

The asset manager is the primary browsing and organization surface for vault content. It combines asset queries, filters, saved views, tags, previews, external editor openers, and terminal access.

## File Map

- `apps/desktop/src/renderer/src/pages/asset-manager/asset-manager-page.tsx` - main asset manager screen and panel orchestration.
- `apps/desktop/src/renderer/src/pages/galleries/gallery-page.tsx` - dedicated image gallery browsing and management surface.
- `apps/desktop/src/renderer/src/components/asset-manager/` - reusable asset manager controls such as filters, tag/view modals, and saved-view icon picker.
- `apps/desktop/src/renderer/src/components/layout/sidebar/` - shared sidebar navigation for vaults, saved views, tags, and status sections.
- `apps/desktop/src/renderer/src/lib/asset-manager/` - asset manager models, form schemas, URL helpers, storage helpers, and shared renderer types.
- `apps/desktop/src/renderer/src/store/asset-manager-atoms.ts` - cross-component asset manager UI state.
- `apps/desktop/src/main/trpc/routers/assets.ts` - asset tRPC procedures.
- `apps/desktop/src/main/trpc/routers/asset-board.ts` - gallery-aware asset board projection procedures.
- `apps/desktop/src/main/trpc/routers/galleries.ts` - gallery CRUD and membership procedures.
- `apps/desktop/src/main/use-cases/assets/` - asset tag and saved-view application workflows called by tRPC procedures.
- `apps/desktop/src/main/use-cases/galleries.ts` - gallery creation, membership, cover, and ordering workflows.
- `apps/desktop/src/shared/contracts/assets/` - shared asset, tag, and saved-view input schemas and validation constants.
- `apps/desktop/src/main/repositories/assets-repository.ts` - asset database query and write helpers.
- `apps/desktop/src/main/repositories/asset-board-repository.ts` - folded gallery board display projection.
- `apps/desktop/src/main/repositories/galleries-repository.ts` - gallery database query helpers.
- `apps/desktop/src/main/services/` - filesystem, editor launch, preview, thumbnail, and vault file behavior.

## Data Flow

1. Renderer state collects the active sidebar item, filters, saved view, and pagination cursor.
2. `trpc.assetBoard.list` powers the main board and folds multi-image galleries into one display card.
3. `trpc.assets.*` keeps single-asset actions and detail reads focused on real assets.
4. `trpc.galleries.*` manages gallery membership, cover, ordering, and the dedicated gallery page.
5. Main routers validate shared contracts and delegate to use cases, repositories, and services.
6. Repository results are normalized for renderer models such as `mapIndexedAsset` and `mapIndexedBoardItem`.
7. Preview URLs and file-opening actions return through preload-safe APIs.

## Interfaces

- `trpc.assetBoard.list` is the central board browsing data path.
- `trpc.assets.list` remains the raw real-asset listing path.
- `trpc.galleries.byId` drives `/galleries/:galleryId`.
- Saved views serialize filter and sort state through `filterJson` and `sortJson`.
- Asset previews use the `post-file://` protocol and markdown image URL resolution.

## Notes

- Keep filter state serializable; saved views depend on stable JSON.
- Keep shared asset contracts free of main-process dependencies so renderer forms and main routers can reuse the same constraints.
- Keep icon sizing aligned with [../../../design.md](../../../design.md).
- Asset kinds in UI must stay compatible with `assetKinds` from the db schema.
- Galleries are not an asset kind; they use `asset_galleries` and `asset_gallery_items` and are projected into the board as display cards.
- The asset board folds only multi-image galleries. A one-image gallery keeps showing as a normal asset card and uses that image as the gallery cover.
- The dedicated gallery route is image-first: the active preview stays in the main upper area, member thumbnails sit in a horizontal strip below it, and gallery metadata editing stays in the right inspector. Single-asset detail stays in `/assets/:assetId`.
- Gallery forms follow [../../conventions.md](../../conventions.md): HeroUI form controls, React Hook Form state, and shared Zod validation schemas.
- One image can belong to at most one gallery in a vault. Add, move, and create flows must surface conflicts instead of silently duplicating membership.
- Deleting a gallery removes relationship rows only; it must not delete the underlying assets or files.
- Missing gallery members remain in the gallery page as placeholders until the underlying asset is permanently deleted. Permanent asset deletion can remove membership, repair the cover, or soft-delete an empty gallery.
- Avoid direct filesystem access from renderer components.
