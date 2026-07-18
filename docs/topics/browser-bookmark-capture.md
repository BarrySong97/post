# Browser Bookmark Capture

## Contract

The Chrome toolbar Popup inspects the active HTTP(S) page, asks Desktop for the active Vault/tags and duplicate matches, then sends one typed bookmark request through Chrome Native Messaging and Desktop local IPC. There is no renderer HTTP server.

```text
Popup or YouTube context menu
  -> Extension background worker
  -> post.bookmark.lookup / post.bookmark.save
  -> Native Messaging host
  -> extension.bookmark.lookup / extension.bookmark.save
  -> Desktop bookmark import service
  -> Vault .url + SQLite cache + optional cached cover
```

The capture payload is a `web | youtube` discriminated union. YouTube URLs normalize Watch, Shorts, Live, Embed, and `youtu.be` forms to one video ID. Page metadata is untrusted and is validated again at the Desktop socket boundary.

## Persistence

- General pages are `web` assets backed by `assets/web-clips/pages/*.url` and `web_cache`.
- YouTube videos are `youtube` assets backed by `assets/web-clips/youtube/*.url` and `youtube_cache`.
- The `.url` file contains only `[InternetShortcut]` plus the canonical URL. Full metadata, custom title, note, warnings, and copy index live in SQLite.
- Covers are best-effort remote downloads stored in the normal thumbnail cache and referenced through `image_cache`.

## Duplicate Policy

Popup lookup lists active copies in ascending `copy_index`. Update refreshes the earliest active copy, preserves its custom title/note, and merges selected tags. Copy creates the next unique index. The YouTube context-menu shortcut always uses update semantics; if no active copy exists it creates one.

## UI Boundary

YouTube cards use the existing video-cover composition: cover, duration, primary tag, source, and a centered red YouTube mark. They never expose `mediaUrl`, mount a `<video>`, or play on hover. Embedded/detail playback is intentionally outside this workflow.
