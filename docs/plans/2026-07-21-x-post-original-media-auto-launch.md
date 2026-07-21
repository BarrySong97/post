# X Post Original Media And Extension Auto Launch

## Goal

Keep X Post media captures lossless at the source resolution, apply the capture-time tag to the
Post and its downloaded media, and let users confirm a browser protocol prompt before packaged
Post opens for a user-triggered collection while Desktop is closed.

## Implementation

- Canonicalize `pbs.twimg.com/media` variants by media ID, request `name=orig`, and import each
  unique image once. Vault originals remain separate from generated board thumbnails.
- Resolve the selected tag once and idempotently attach it to the Post plus every successfully
  imported image/video child. Later Desktop tag edits and historical data are intentionally unchanged.
- Register `post://` with the packaged app and focus its main window when a protocol URL arrives.
- Mark Popup preparation as user-triggered while leaving Chrome startup context refresh passive.
  On a confirmed unavailable socket, the native host returns a structured `launchRequired`
  response without spawning Chrome or replaying the request. The extension creates a Chrome-owned
  `post://extension/open` navigation, waits up to 15 seconds for the user's confirmation and local
  IPC, then forwards the original request once. Concurrent actions share one launch attempt, and
  connected timeouts are never replayed.
- Keep direct-to-Inbox context-menu actions available when passive registration cannot reach
  Desktop. The first successful cold-start save refreshes context and restores the Tag submenu.

## Verification

- Covered X image URL canonicalization/deduplication and capture-tag inheritance with Desktop tests.
- Cover passive context, the Chrome launch handoff, no native-host replay, connected-timeout
  behavior, and dev-channel isolation with native-host Node tests.
- Desktop/Extension type checks, tests, production builds, native-host syntax checks, and the docs
  harness pass. Verify the packaged app advertises the `post` URL scheme before installation, then
  exercise a closed-app save against the installed bundle.
