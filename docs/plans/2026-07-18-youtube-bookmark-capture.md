# YouTube Bookmark Capture

## Summary

Add a 360px browser-extension popup for saving general web pages and YouTube videos, plus a YouTube-only context-menu shortcut. General pages remain `web` assets; YouTube becomes a dedicated `youtube` asset kind rendered with the existing video-cover card, a red YouTube play mark, and no hover playback.

## Implementation

- Add popup/page inspection and bookmark lookup/save messages to the extension, native host, and Desktop local IPC. The popup supports an editable title, existing-tag multi-select, and a note; YouTube context-menu saves remain direct-to-Inbox or single-tag.
- Persist every bookmark as a Vault `.url` pointer plus database metadata. Add `youtube_cache`, extend `web_cache`, classify YouTube `.url` files in the Rust indexer, cache remote covers locally, and support update-versus-copy through `copyIndex`.
- Add `youtube` to database, shared filter, repository, renderer, and i18n contracts. Reuse the current video cover layout, source duration from `youtube_cache`, disable media hover preview, and leave detail playback out of scope.
- Keep partial captures useful: a canonical URL/video ID is sufficient, while absent metadata or cover download produces warnings rather than discarding the bookmark.

## Verification

- Cover URL normalization, extraction, duplicate update/copy, tag merge, partial metadata, and bookmark formatting with focused tests.
- Run database generation, extension and Desktop type checks/builds, JavaScript tests/lint, Rust check/tests, manual Chrome + Desktop smoke tests, and `node scripts/check-docs.mjs`.

## Assumptions

- No YouTube API key, transcript, dynamic engagement metrics, downloaded video, embedded player, or detail redesign.
- `.url` preserves the source URL only; full metadata and notes live in SQLite.
