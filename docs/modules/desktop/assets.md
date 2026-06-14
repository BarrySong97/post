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
- `apps/desktop/src/main/repositories/assets-repository.ts` - asset database query and write helpers.
- `apps/desktop/src/main/services/` - filesystem, editor launch, preview, thumbnail, and vault file behavior.

## Data Flow

1. Renderer state collects the active sidebar item, filters, saved view, and pagination cursor.
2. `trpc.assets.*` hooks cross the IPC link into the main process.
3. Main routers delegate to repositories and services.
4. Repository results are normalized for renderer models such as `mapIndexedAsset`.
5. Preview URLs and file-opening actions return through preload-safe APIs.

## Interfaces

- `trpc.assets.list` is the central browsing data path.
- Saved views serialize filter and sort state through `filterJson` and `sortJson`.
- Asset previews use the `post-file://` protocol and markdown image URL resolution.

## Notes

- Keep filter state serializable; saved views depend on stable JSON.
- Keep icon sizing aligned with [../../../design.md](../../../design.md).
- Asset kinds in UI must stay compatible with `assetKinds` from the db schema.
- Avoid direct filesystem access from renderer components.
