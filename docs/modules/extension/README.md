# Extension App

## Responsibility

`apps/extension` is the standalone browser extension surface for Post. It is separate from the Electron desktop app and provides Chrome Manifest V3 collection workflows that hand browser assets to Post Desktop. Its toolbar Popup saves general pages and YouTube videos; context menus remain the fast path for images, X media/posts, and YouTube videos.

The first implemented browser event is a right-click context menu for images. The top-level "Add image to Post" item asks the Post Desktop native messaging host for the active vault's tags. Each submenu leads with a "直接保存（进 Inbox）" item that saves with no tag (the asset lands untagged in Inbox), followed by the tags ordered recent-first — recently-used tag IDs are remembered in `chrome.storage.local` and a separator divides them from the rest. Clicking a tag sends the selected image URL and tag ID to Desktop; the direct-save item sends no tag ID. Either way Desktop downloads the image into the active vault and creates the asset (plus the tag record only when a tag was chosen). Direct saves from `pbs.twimg.com/media/*` upgrade X's displayed thumbnail URL to the modern `format=<source>&name=orig` variant before download; profile/card images and other hosts remain unchanged. An empty vault no longer disables the menu — direct-save is always available.
Twitter/X pages also get a video content script. The "Add video to Post" context menu is shown only when the current hovered or right-clicked Post contains a video, asks the content script for the current post/video context, and sends the post ID plus observed `video.twimg.com` requests to Desktop. Desktop uses the post ID to resolve complete playback variants from X public embed metadata; observed MP4/HLS requests remain a fallback because they may be DASH audio or initialization fragments rather than complete videos.
The same content script identifies the X post under the context-menu pointer. When the selected post has a semantic "Show more" text control inside or alongside its text node, the save request clicks it and waits briefly for the selected post's text to expand before taking the DOM snapshot. The "Add post to Post" submenu sends the post ID, canonical URL, selected tag, snapshot (including the visible author-avatar URL), and whether its text is still truncated through Native Messaging. Desktop resolves normalized post metadata, including a server-rendered page fallback for long-form Note posts, writes a `type: x-post` Markdown asset, imports each unique X image at `name=orig`, and links direct media as child assets. The selected capture tag is applied to the Post plus every successfully imported image/video; later tag edits on the Post do not propagate.
The background service worker suppresses duplicate save requests for the same asset/tag while a save is already in flight.
If Desktop is closed while context menus are registered, each collection menu still keeps its direct-to-Inbox action instead of becoming fully disabled. That user click starts the `post://` confirmation flow; after the first successful cold-start save, the worker refreshes Desktop context and repopulates the Tag submenu.
After the packaged app has been opened once to register its native host and `post://` URL handler, opening the bookmark Popup or clicking a save menu while Post is closed lets the native host return a structured `desktop_unavailable` response. The extension then creates a Chrome-owned `post://extension/open` navigation so Chrome can show its external-protocol confirmation with the originating browser context. After approval, the extension polls passive Desktop context for up to 15 seconds and forwards the original request once. Concurrent user actions share one launch attempt. Chrome startup and background context-menu refreshes never show the prompt or launch Post. Development builds still require the Desktop dev server to be started explicitly.
The toolbar Popup inspects the active page with `activeTab` + `scripting`, loads the active Vault and existing tags through Native Messaging, and offers an editable title, existing-tag multi-select, and note. Generic pages become `web` `.url` assets. Recognized YouTube Watch/Shorts/Live/Embed pages become first-class `youtube` `.url` assets with normalized database metadata and a cached cover. A duplicate can update the earliest active copy (preserving its custom title/note and merging tags) or create an independent copy. The YouTube context menu always uses the update behavior and never opens the Popup.

### Dev and prod channels

The extension builds as two separate installs so a test browser and a release browser write to their own databases. The channel is a build-time constant (`__APP_ENV__`, injected by vite `define`) that the worker stamps onto every native message as `appEnv`; the native host maps it to `post-<appEnv>.sqlite`, and Desktop's dbPath guard rejects any save whose target does not match the running app — so the dev extension never writes the prod DB and vice versa. `pnpm -F extension build` produces the dev channel (name "Post Dev", `appEnv: "dev"`, `dist_chrome`); `pnpm -F extension build:prod` produces the release channel (name "Post", `appEnv: "prod"`, `dist_chrome_prod`). For pre-review packaged-app QA, `pnpm -F extension build:local-prod` keeps the stable unpacked development ID and `dist_chrome` path, labels the card "Post Dev (Prod QA)", and stamps `appEnv: "prod"`, allowing it to talk to the installed production Desktop; run the normal dev build afterward to restore the dev channel. One shared native host (`com.post.desktop`) serves both — routing is by `appEnv`, not identity — so its manifest must allow both extension IDs (see the install command below). Because dev and prod Desktop apps currently share one userData dir (one local IPC socket), run one Desktop app at a time; the guard safely rejects the mismatched channel otherwise.

## File Map

- `apps/extension/manifest.json` - Chrome MV3 manifest with the background service worker, `contextMenus` permission, native messaging, and Twitter/X content script registration.
- `apps/extension/src/background/index.ts` - background service worker that registers collection menus, prepares the Popup, and forwards save requests to the native host.
- `apps/extension/src/popup/` and `src/page-inspector.ts` - dense bookmark form plus active-page generic/YouTube metadata extraction.
- `apps/extension/src/content/twitter-video-context.ts` - Twitter/X content script that captures the right-clicked Post plus current-post video and visible media context.
- `apps/extension/native-host/post-native-host.mjs` - Chrome Native Messaging stdio host that forwards extension requests to Desktop local IPC.
- `apps/extension/native-host/install-native-host.mjs` - dev helper that writes the browser-specific native messaging host manifest for an extension ID.
- `apps/extension/scripts/package-extension.mjs` - prod zip packager (copies `INSTALL.md` into the zip root).
- `apps/extension/INSTALL.md` - end-user install notes shipped inside the release zip.
- `apps/extension/vite.config.chrome.ts` - CRXJS/Vite build config for the unpacked Chrome extension output.
- `apps/extension/nodemon.chrome.json` - development watch command used by `pnpm -F extension dev`.
- `apps/extension/tsconfig.json` - TypeScript config extending the shared strict compiler settings.

## Public Interfaces

- Development command from the repo root: `pnpm dev:extension`.
- Workspace commands: `pnpm -F extension dev | build | check-types`.
- Channel builds: `pnpm -F extension build` (dev → `dist_chrome`), `pnpm -F extension build:local-prod` (development ID/path → production Desktop), and `pnpm -F extension build:prod` (release → `dist_chrome_prod`).
- Prod zip: `pnpm -F extension package:prod` → `apps/extension/post-extension.zip` (includes `INSTALL.md`). GitHub Releases attach the same package as `Post-<version>-chrome-extension.zip` on each `v*` tag.
- Native host registration: `pnpm -F extension native-host:install -- --extension-id <id>[,<id2>,...]`. The current fixed IDs are Post Dev `odafghdnmoniilcgnopfphmbodgojaoo` and Post release `mdpiamelfbcdfglbodgnfdkilamgllae`; pass both comma-separated so the shared host allows both channels. Packaged Desktop startup writes both origins as well, preventing a release-app launch from disconnecting Post Dev.
- Custom Chromium host directory: add `--manifest-dir "<NativeMessagingHosts directory>"` when the target browser is not one of `chrome`, `chromium`, `chrome-for-testing`, `edge`, or `brave`.
- Build output: `apps/extension/dist_chrome` (dev) and `dist_chrome_prod` (release), each loaded as an unpacked/packed Chrome extension.

## Notes

- The extension does not use the desktop tRPC IPC bridge. Browser-to-Desktop calls go through Chrome Native Messaging, then Desktop's existing local IPC socket.
- Bookmark lookup/save uses `post.bookmark.lookup` and `post.bookmark.save`; see [browser bookmark capture](../../topics/browser-bookmark-capture.md).
- Native host context calls fail quickly, while image/video/Post save calls use import-sized timeouts so long downloads do not report a false failure.
- The protocol prompt occurs only after the socket is confirmed unavailable for a user-triggered production-channel request. The native host never launches Chrome or replays the request itself; it returns `launchRequired`, and the extension owns the Chrome tab navigation, readiness polling, and one retry. A request that connected and then timed out is never replayed because Desktop may already have committed it.
- X Post context responses are asynchronous because long text expansion may wait up to a short bounded timeout. Failed expansion does not block capture; Desktop records a partial-capture warning when no complete metadata text is available either.
- Native Messaging host manifests must list exact extension origins; install the host again if the unpacked extension ID changes.
- Keep permissions narrow. Add `storage`, `downloads`, host permissions, content scripts, or native messaging only when a specified collection workflow requires them.
- Generated extension output is ignored by `apps/extension/.gitignore`.
