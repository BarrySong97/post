# Desktop Asset Management

## Responsibility

The asset manager is the primary browsing and organization surface for vault content. It combines asset queries, filters, saved views, tags, previews, external editor openers, and terminal access.

## File Map

- `apps/desktop/src/renderer/src/pages/asset-manager/asset-manager-page.tsx` - main asset manager screen and panel orchestration.
- `apps/desktop/src/renderer/src/components/asset-manager/` - reusable asset manager controls such as filters, detail tag editing, tag/view modals, and saved-view icon picker.
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
- `apps/desktop/src/main/services/local-file-import-service.ts` - OS drag-and-drop copy into `assets/imports/` plus indexer refresh.
- `apps/desktop/src/main/services/thumbnail-queue.ts` - per-vault thumbnail drain queue shared by watcher and extension image import.
- `apps/desktop/src/renderer/src/components/layout/file-drop-zone.tsx` - global drop overlay (hover / blocked / in-flight pill) on the app shell.
- `apps/desktop/src/renderer/src/components/layout/import-progress-pill.tsx` - fixed bottom-right import progress capsule.

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
- Soft asset detail: opening an asset from the board (or CLI/graph) stays on `/` with search `asset=<id>` so the masonry board stays mounted under a full-panel overlay. Back closes the overlay and keeps scroll. Deep links to `/assets/$assetId` replace-redirect into `/?asset=`. Helpers live in `lib/asset-manager/open-asset-detail.ts`.
- Asset detail lists **all** bound tags and supports bind / unbind / create-and-bind via `assets.addTag` / `assets.removeTag` (`asset-detail-tags.tsx`). The add control is an inline HeroUI `ComboBox` (replaces the `+` while editing): filter vault tags while typing, select to bind, or press Enter to create-and-bind (`allowsCustomValue`); a trailing close control cancels. The suggestion popover uses dense `rounded-lg` (overriding HeroUI’s large default radius) and `max-h-48` scrolling so large vault tag lists stay usable. Bound tags use HeroUI `TagGroup` with remove. Masonry cards and the detail breadcrumb still show only the primary tag (`tags[0]` by vault `sortOrder`). Color editing stays in the tag management modal.
- Renderer chrome strings (filters, empty states, detail meta labels, toasts) go through `react-i18next`; see [../../topics/i18n.md](../../topics/i18n.md). Vault/user content is not translated.
- Live navigation (CLI): `asset open <id>` publishes `asset-detail.open`; `app-shell.tsx` calls `openAssetDetail`, the same soft path a card click uses.
- Browser extension imports: the native host sends `extension.image.save` and `extension.video.save` over local IPC. The `tagId` is optional — when omitted (the extension's direct-save item), the import service resolves no tag and skips the `asset_tags` write, so the asset lands untagged in Inbox; the save responses carry `tagId: string | null`. Desktop writes the downloaded file into `assets/web-clips/`, creates asset/file rows (and a tag row when a tag was chosen), and queues thumbnail generation. For X posts, Desktop resolves normal media and `unified_card` public embed metadata into complete playback variants, then tries highest-bitrate MP4s before HLS or browser-observed fallbacks. Every direct MP4 must pass an ffmpeg video-stream check before it can be written, preventing DASH audio/init fragments from becoming assets. HLS import uses ffmpeg to mux an MP4. Video download and its hidden thumbnail subtask appear as one `import` task in the footer; watcher thumbnail queues re-check cache state before creating another visible task.
- Local drag-and-drop import: dropping external files onto the app shell shows a four-state overlay — hover (24% full-window mask + card stack + count badge + vault name), blocked (no vault: Ban + hint), in-flight (bottom-right progress pill subscribed to the same `import` background task), and done/failed (green/red pill with Retry on failure). Hover leave uses `relatedTarget` (not drag-depth) so a board remount after the first import does not swallow the second hover mask. `assets.importLocalFiles` copies into `assets/imports/` (folders keep relative structure under `assets/imports/<folderName>/`). Hidden path segments and sources already inside the vault are skipped. After copy, main runs indexer `refresh` on the new relative paths and queues thumbnails. Paths are resolved in preload via `webUtils.getPathForFile` (`window.api.resolveDroppedFilePaths`).
- Background task footer: tasks carry optional `subject` (≤3 names + count) and `retry` (thumbnails assetIds, omitted above 500). The pill/popover merge queued into in-progress, show subject-aware titles (≤2 names joined, ≥3 count copy), keep import completions as detail rows, and fold other types into a rolling 30-minute `completedDigest` from main. Failed thumbnail rows can Retry through `assets.ensureThumbnails`. Extension image imports and watcher sync enqueue through `thumbnail-queue` so short bursts coalesce into one thumbnails task.
- X Post imports: `extension.post.save` resolves public metadata with a visible-page fallback and writes `assets/web-clips/posts/*.md` with `type: x-post` frontmatter. Direct images/videos are normal related assets under `assets/web-clips/media/`, inherit the selected tag, and run as hidden subtasks under one visible Post import. Repeated saves are keyed by Vault/platform/Post ID, refresh only the generated Markdown block, and preserve user frontmatter plus the Notes section. Partial media failures remain visible in Markdown warnings instead of discarding the Post text.
- Post Markdown detail renders local image references as contained image modules and local video links with the shared Plyr video player. Legacy relative-path Obsidian image embeds are resolved by basename so previously captured Posts remain previewable.
- Asset cards expose a right-click context menu with a destructive delete action. After confirmation, Desktop moves the source file to the OS trash, sets `assets.deleted_at`, and marks its `asset_files` row missing. Restoring the file to its original vault path lets the indexer clear the soft-delete marker and import it again.
- Thumbnail prewarm only retries failures explicitly marked `ffmpeg executable unavailable`. Mixed candidate errors (for example, one missing binary plus one real "no video stream" result) stay failed until the source changes, preventing startup loops.
- Keep shared asset contracts free of main-process dependencies so renderer forms and main routers can reuse the same constraints.
- Keep icon sizing aligned with [../../../design.md](../../../design.md).
- Masonry cards stay restrained. Cover assets (image/video/web-with-OG) render the thumbnail with an always-on info layer at the bottom (`AssetCardMediaOverlay`): primary tag on the left, source domain on the right. To avoid painting a container onto the image, the layer is subtitle-style text with no background — it flips dark-on-light for light covers and light-on-dark otherwise. Only the light-on-dark variant carries a glyph-hugging text-shadow; the dark-text variant renders shadowless because a white glow reads as a halo on near-white covers. The light/dark decision is `asset.coverIsLight`, derived from `imageCache.thumbnailLuma` (average luma of the thumbnail's bottom strip, computed by the Rust indexer in `average_bottom_luma`; null for thumbnails cached before the column existed, which regenerate once via `thumbnail_cache_matches`). The overlay adds no card height and renders nothing when there is nothing to show (untagged local media stays a clean image).
- Video cards preview on hover: `AssetCardMedia` mounts a muted, looping `<video preload="none">` over the thumbnail and plays it from `asset.mediaUrl` while the pointer is over the card. It reveals only on the `playing` event (so the loading gap shows the thumbnail, not a black flash) and honors `prefers-reduced-motion` by skipping the preview entirely. While previewing, the top-right duration badge counts down remaining time from `asset.durationMs` via `timeupdate`, and resets to the full duration when the pointer leaves.
- Web assets (`kind === "web"`) with a cached OG image render as cover cards: `webCache` supplies the display domain and `mapIndexedAsset` treats a ready `imageCache` thumbnail as the OG cover (`ogImage`), so the shared media cover + bottom info layer (tag + domain) apply. Without an OG image they fall back to the link preview row.
- Quote-style assets (`kind === "post"`) render an attribution header (`AssetCardAttribution`) — a small round author avatar and name on the left, published date pushed to the far right — in place of the auto-generated title, because the source is part of the content. Real profile photos are not captured yet, so `AssetCardAvatar` shows a plain author-initial on an author-derived color; wiring real avatars needs capture-side work (resolver + IPC + a stored/downloaded avatar). The platform mark (`PostBrandGlyph`) sits at the card's bottom-right corner rather than on the avatar, keeping the header uncluttered. Attribution and media-overlay source fields come from `postCache` (platform/authorHandle/authorName/canonicalUrl/publishedAt), joined in `getAssetRowsByIds`/`getAssetPage` and mapped to the renderer `Asset` by `mapIndexedAsset` (`domain` is derived from `canonicalUrl`). Web/link assets have no source data source yet — that needs capture-side work.
- Text-card preview body comes from `asset.description`, falling back to the indexer-derived `markdown.excerpt`; a missing excerpt simply renders no body. See [post-indexer](../post-indexer/README.md).
- Markdown note cards can surface vault-resolved embeds: `attachRelations` loads `noteImages` from `asset_links` (`markdown_image` / `embed`, `resolved`, ready `image_cache`) ordered by `sourceSpanStart`. `mapIndexedAsset` sets `coverMode` when the note has images and body text under 80 characters — those cards render a 3:2 top cover; otherwise a 44px thumb strip (max 3 + `+N`) sits above the tag row. Remote/unresolved/non-image targets stay filtered out.
- Video cards show a top-right duration badge when `imageCache.videoDurationMs` is present (filled by the indexer via ffprobe during thumbnail generation, or duration-only backfill on ready cache hits when the column is still null).
- Asset kinds in UI must stay compatible with `assetKinds` from the db schema.
- Avoid direct filesystem access from renderer components.
