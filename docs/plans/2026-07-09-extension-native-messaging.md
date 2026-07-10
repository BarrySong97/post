# Extension Native Messaging Bridge

## Summary

Post's browser extension should read live Desktop context through Chrome Native Messaging instead of local HTTP. The first bridge increment exposes the active vault and tag list so the image right-click menu can render real tag choices.

## Key Changes

- Add the `nativeMessaging` extension permission and call `chrome.runtime.sendNativeMessage` from the background service worker.
- Add a Node-based native host under `apps/extension/native-host/` that speaks Chrome's 4-byte-length-prefixed JSON protocol on stdio and forwards requests to Desktop's existing local IPC socket.
- Extend Desktop local IPC with `extension.context.get`, returning the active vault plus sorted tags for that vault.
- Add a dev installer script that writes the native host manifest for a specific browser extension ID.

## Test Plan

- Run `pnpm -F extension check-types` and `pnpm -F extension build`.
- Run `pnpm -F desktop check-types` for the new local IPC schema/server changes.
- Run `node scripts/check-docs.mjs`.
- Manual smoke: start Desktop, load the extension, register the native host for the extension ID, reload the extension, and verify image right-click shows real tag names.

## Assumptions

- This increment only fetches vault/tag context. Image download, vault file writes, asset creation, and tag binding will be implemented as a follow-up `extension.image.save` command.
- Native host registration is dev-only for now and user-specific on macOS.

## Twitter Video Follow-up

- Pass the X post ID through the existing native messaging bridge and resolve complete video variants from X public embed metadata in Desktop.
- Prefer highest-bitrate MP4 variants, retain HLS and observed browser requests as fallbacks, and validate every direct MP4 has a video stream before writing it into the vault.
- Treat the public syndication endpoint as an undocumented integration: parsing is isolated in its own module and failure falls back without breaking observed candidates.
- Regression coverage verifies the syndication token, response parsing, variant ordering, and the thumbnail retry marker that prevents invalid media from looping at startup.
