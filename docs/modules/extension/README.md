# Extension App

## Responsibility

`apps/extension` is the standalone browser extension surface for Post. It is separate from the Electron desktop app and provides Chrome Manifest V3 collection workflows that hand browser assets to Post Desktop.

The first implemented browser event is a right-click context menu for images. The top-level "Add image to Post" item asks the Post Desktop native messaging host for the active vault's tags and renders those tags as submenu choices. Clicking a tag sends the selected image URL and tag ID to Desktop, which downloads the image into the active vault and creates asset/tag records.
Twitter/X pages also get a video content script. The "Add video to Post" context menu is shown only when the current hovered or right-clicked Post contains a video, asks the content script for the current post/video context, and sends the post ID plus observed `video.twimg.com` requests to Desktop. Desktop uses the post ID to resolve complete playback variants from X public embed metadata; observed MP4/HLS requests remain a fallback because they may be DASH audio or initialization fragments rather than complete videos.
The same content script identifies the X post under the context-menu pointer. The "Add post to Post" submenu sends the post ID, canonical URL, selected tag, and a visible DOM snapshot through Native Messaging. Desktop resolves normalized post metadata, writes a `type: x-post` Markdown asset, imports direct media as related child assets, and updates the same Post on repeated saves.
The background service worker suppresses duplicate save requests for the same asset/tag while a save is already in flight.

## File Map

- `apps/extension/manifest.json` - Chrome MV3 manifest with the background service worker, `contextMenus` permission, native messaging, and Twitter/X content script registration.
- `apps/extension/src/background/index.ts` - background service worker that registers image, Twitter/X video, and X Post context menus and forwards save requests to the native host.
- `apps/extension/src/content/twitter-video-context.ts` - Twitter/X content script that captures the right-clicked Post plus current-post video and visible media context.
- `apps/extension/native-host/post-native-host.mjs` - Chrome Native Messaging stdio host that forwards extension requests to Desktop local IPC.
- `apps/extension/native-host/install-native-host.mjs` - dev helper that writes the browser-specific native messaging host manifest for an extension ID.
- `apps/extension/vite.config.chrome.ts` - CRXJS/Vite build config for the unpacked Chrome extension output.
- `apps/extension/nodemon.chrome.json` - development watch command used by `pnpm -F extension dev`.
- `apps/extension/tsconfig.json` - TypeScript config extending the shared strict compiler settings.

## Public Interfaces

- Development command from the repo root: `pnpm dev:extension`.
- Workspace commands: `pnpm -F extension dev | build | check-types`.
- Native host dev registration: `pnpm -F extension native-host:install -- --extension-id <browser-extension-id>`.
- Custom Chromium host directory: add `--manifest-dir "<NativeMessagingHosts directory>"` when the target browser is not one of `chrome`, `chromium`, `chrome-for-testing`, `edge`, or `brave`.
- Build output: `apps/extension/dist_chrome`, intended to be loaded as an unpacked Chrome extension during local testing.

## Notes

- The extension does not use the desktop tRPC IPC bridge. Browser-to-Desktop calls go through Chrome Native Messaging, then Desktop's existing local IPC socket.
- Native host context calls fail quickly, while image/video/Post save calls use import-sized timeouts so long downloads do not report a false failure.
- Native Messaging host manifests must list exact extension origins; install the host again if the unpacked extension ID changes.
- Keep permissions narrow. Add `storage`, `downloads`, host permissions, content scripts, or native messaging only when a specified collection workflow requires them.
- Generated extension output is ignored by `apps/extension/.gitignore`.
