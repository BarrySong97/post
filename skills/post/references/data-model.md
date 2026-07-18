# Data model (agent view)

Mental model: **files on disk in the vault; organization in SQLite**.

## Core entities

| Entity | Role |
| --- | --- |
| **Vault** | User-linked root folder (`rootPath`) + sync metadata |
| **Asset** | Indexed item in a vault (`kind`, `status`, `title`, soft-delete `deletedAt`) |
| **Asset file** | Concrete path under the vault (`relativePath`, hashes, `fileExists`) |
| **Tag** | Named label (`name`, `color`, `sortOrder`) per vault |
| **Asset↔Tag** | Many-to-many binding |
| **Saved view** | Named filter/sort (`filterJson`, `sortJson`, `sortOrder`) |
| **Asset link** | Relations (wiki/embed/post_media/…) between assets |
| **Caches** | Kind-specific metadata: `image_cache`, `markdown_cache`, `post_cache`, `web_cache`, `youtube_cache` |

## Asset kinds (typical)

`markdown`, `post`, `image`, `video`, `youtube`, `link`, `web`, `file`

- **Inbox / 待整理**: assets with no tags (CLI often uses status/inbox filters — prefer `ledger-info` / `asset list --help` for exact flags).
- **X posts**: kind `post` + Markdown on disk + `post_cache`; related media via `asset_links`.

## What agents change

Via `post-cli` / domain layer:

- Tags and asset–tag bindings
- Saved views
- Live UI filter / open (no SQLite write)

Agents do **not** use the CLI to rewrite media bytes or invent SQL rows. Capture of new web media is primarily the **extension → Desktop** path.
