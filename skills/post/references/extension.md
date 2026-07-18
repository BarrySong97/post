# Browser extension

Chrome MV3 collector that hands browser content to **Post Desktop**. It does **not** speak tRPC/HTTP to the renderer.

## Transport

```text
Extension → Chrome Native Messaging (com.post.desktop)
         → Desktop local IPC socket
         → import services / SQLite / vault files
```

Same local IPC family the CLI uses for live UI / `ledger.changed`.

## What it can save

| Action | Result |
| --- | --- |
| Add image to Post | Download into vault; create image asset; optional tag, or Inbox (no tag) |
| Add video to Post (X) | Resolve playback variants; import video asset |
| Add post to Post (X) | Idempotent Markdown `type: x-post` asset + related media children |
| Toolbar Popup | Save a general web page or YouTube video with title, existing tags, and note |
| Add YouTube video to Post | Fast Inbox/single-tag `.url` bookmark; updates the earliest active copy |

Recent tags appear first in the image/post menus; direct-save skips tagging.
YouTube bookmarks are first-class `youtube` assets with database metadata and a locally cached cover. The Vault `.url` file preserves the source URL only; full metadata and notes stay in SQLite.

## Dev vs prod channels

- Build-time `appEnv` (`dev` / `prod`) stamped on every native message.
- Maps to separate SQLite DBs; Desktop rejects cross-channel writes.
- Shared native host id `com.post.desktop`; manifest must allow both extension IDs.
- Run one Desktop app at a time when channels share userData/socket.

## Agent note

- Extension = **user/browser capture**.
- Agent organization = **`post-cli`** on what already exists.
- Do not invent extension HTTP APIs or call native messaging from the CLI skill path.
