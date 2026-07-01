# Desktop Asset Management

## Responsibility

The asset manager is the primary browsing and organization surface for vault content. It combines asset queries, filters, saved views, tags, previews, external editor openers, and terminal access.

## File Map

- `apps/desktop/src/renderer/src/pages/asset-manager/asset-manager-page.tsx` - main asset manager screen and panel orchestration.
- `apps/desktop/src/renderer/src/components/asset-manager/` - reusable asset manager controls such as filters, tag/view modals, and saved-view icon picker.
- `apps/desktop/src/renderer/src/components/layout/sidebar/` - shared sidebar navigation for vaults, saved views, tags, and status sections.
- `apps/desktop/src/renderer/src/lib/asset-manager/` - asset manager models, form schemas, URL helpers, storage helpers, and shared renderer types.
- `apps/desktop/src/renderer/src/store/asset-manager-atoms.ts` - cross-component asset manager UI state.
- `apps/desktop/src/main/trpc/routers/assets.ts` - asset tRPC procedures.
- `apps/desktop/src/main/use-cases/assets/` - asset tag and saved-view application workflows called by tRPC procedures.
- `apps/desktop/src/shared/contracts/assets/` - shared asset, tag, and saved-view input schemas and validation constants.
- `apps/desktop/src/main/repositories/assets-repository.ts` - asset database query and write helpers.
- `apps/desktop/src/main/services/` - filesystem, editor launch, preview, thumbnail, and vault file behavior.

## Data Flow

1. Renderer state collects the active sidebar item, filters, and saved view.
2. `trpc.assets.layoutIndex` powers the masonry board with lightweight, globally ordered asset metadata.
3. `trpc.assets.hydrate` fills the currently rendered masonry window with full card data by asset id.
4. `trpc.assets.*` keeps single-asset actions and detail reads focused on real assets.
5. Main routers validate shared contracts and delegate to use cases, repositories, and services.
6. Repository results are normalized for renderer models such as `mapIndexedAsset`.
7. Preview URLs and file-opening actions return through preload-safe APIs.

## Interfaces

- `trpc.assets.layoutIndex` and `trpc.assets.hydrate` are the central board browsing data paths.
- Saved views serialize filter and sort state through `filterJson` and `sortJson`.
- Asset previews use the `post-file://` protocol and markdown image URL resolution.

## Notes

- Keep filter state serializable; saved views depend on stable JSON.
- Live filter control (CLI): the Post CLI drives the two filter atoms over local IPC. Main publishes `asset-filter.*` events; `apps/desktop/src/renderer/src/lib/asset-manager/apply-filter-command.ts` resolves canonical id-based payloads to names/labels via `sidebarMeta` and sets the atoms, mirroring the sidebar handlers. `asset-manager-page.tsx` reports the current filter back through `events.reportFilterState` so `filter get` can read it.
- Live navigation (CLI): `asset open <id>` publishes `asset-detail.open`; `app-shell.tsx` navigates to `/assets/$assetId`, opening the same detail view a card click uses.
- Keep shared asset contracts free of main-process dependencies so renderer forms and main routers can reuse the same constraints.
- Keep icon sizing aligned with [../../../design.md](../../../design.md).
- Masonry cards stay restrained: cover assets (image/video/web-with-OG) render the thumbnail only, while text assets (markdown/file/link) show a compact title, a preview body, and tags.
- Text-card preview body comes from `asset.description`, falling back to the indexer-derived `markdown.excerpt`; a missing excerpt simply renders no body. See [post-indexer](../post-indexer/README.md).
- Asset kinds in UI must stay compatible with `assetKinds` from the db schema.
- Avoid direct filesystem access from renderer components.
