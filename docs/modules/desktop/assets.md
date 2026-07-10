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
- `apps/desktop/src/main/services/extension-image-import-service.ts` and `extension-video-import-service.ts` - browser extension imports for downloaded image and MP4/HLS video assets.
- `apps/desktop/src/main/services/extension-post-import-service.ts` and `twitter-post-resolver.ts` - idempotent X Post Markdown import, normalized metadata resolution, direct-media child imports, and Post relationships.

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
- The app and Settings sidebars share their persisted width and `280px` minimum
  width through `apps/desktop/src/renderer/src/lib/asset-manager/storage.ts`.
- Live filter control (CLI): the Post CLI drives the two filter atoms over local IPC. Main publishes `asset-filter.*` events; `apps/desktop/src/renderer/src/lib/asset-manager/apply-filter-command.ts` resolves canonical id-based payloads to names/labels via `sidebarMeta` and sets the atoms, mirroring the sidebar handlers. `asset-manager-page.tsx` reports the current filter back through `events.reportFilterState` so `filter get` can read it.
- Live navigation (CLI): `asset open <id>` publishes `asset-detail.open`; `app-shell.tsx` navigates to `/assets/$assetId`, opening the same detail view a card click uses.
- Browser extension imports: the native host sends `extension.image.save` and `extension.video.save` over local IPC. Desktop writes the downloaded file into `assets/web-clips/`, creates asset/file/tag rows, and queues thumbnail generation. For X posts, Desktop resolves normal media and `unified_card` public embed metadata into complete playback variants, then tries highest-bitrate MP4s before HLS or browser-observed fallbacks. Every direct MP4 must pass an ffmpeg video-stream check before it can be written, preventing DASH audio/init fragments from becoming assets. HLS import uses ffmpeg to mux an MP4. Video download and its hidden thumbnail subtask appear as one `import` task in the footer; watcher thumbnail queues re-check cache state before creating another visible task.
- X Post imports: `extension.post.save` resolves public metadata with a visible-page fallback and writes `assets/web-clips/posts/*.md` with `type: x-post` frontmatter. Direct images/videos are normal related assets under `assets/web-clips/media/`, inherit the selected tag, and run as hidden subtasks under one visible Post import. Repeated saves are keyed by Vault/platform/Post ID, refresh only the generated Markdown block, and preserve user frontmatter plus the Notes section. Partial media failures remain visible in Markdown warnings instead of discarding the Post text.
- Post Markdown detail renders local image references as contained image modules and local video links with the shared Plyr video player. Legacy relative-path Obsidian image embeds are resolved by basename so previously captured Posts remain previewable.
- Asset cards expose a right-click context menu with a destructive delete action. After confirmation, Desktop moves the source file to the OS trash, sets `assets.deleted_at`, and marks its `asset_files` row missing. Restoring the file to its original vault path lets the indexer clear the soft-delete marker and import it again.
- Thumbnail prewarm only retries failures explicitly marked `ffmpeg executable unavailable`. Mixed candidate errors (for example, one missing binary plus one real "no video stream" result) stay failed until the source changes, preventing startup loops.
- Keep shared asset contracts free of main-process dependencies so renderer forms and main routers can reuse the same constraints.
- Keep icon sizing aligned with [../../../design.md](../../../design.md).
- Masonry cards stay restrained: cover assets (image/video/web-with-OG) render the thumbnail only, while text assets (markdown/post/file/link) show a compact title, a preview body, and the first tag in the footer.
- Text-card preview body comes from `asset.description`, falling back to the indexer-derived `markdown.excerpt`; a missing excerpt simply renders no body. See [post-indexer](../post-indexer/README.md).
- Asset kinds in UI must stay compatible with `assetKinds` from the db schema.
- Avoid direct filesystem access from renderer components.
