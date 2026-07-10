# Post CLI

Safe local command line interface for organizing a Post workspace.

```bash
npx @barrysongdev4real/post-cli ledger-info --json
npx @barrysongdev4real/post-cli --db /path/to/post.sqlite ledger-info --json
npx @barrysongdev4real/post-cli tag list --json
npx @barrysongdev4real/post-cli asset list --kind image --json
npx @barrysongdev4real/post-cli asset get <asset-id> --json
npx @barrysongdev4real/post-cli view update <view-id> --name "Inbox review" --commit
npx @barrysongdev4real/post-cli apply-patch patch.json --dry-run
```

Install globally when you want a stable `post-cli` binary:

```bash
npm install -g @barrysongdev4real/post-cli
post-cli ledger-info --json
```

Writes are dry-run by default and require `--commit`. Dry-runs validate inside a
rolled-back SQLite transaction. The CLI never exposes raw SQL and never moves,
renames, deletes, or rewrites original vault files.

`view update` preserves existing filters unless filter flags are provided. Use
`--clear-filters` to reset a saved view to the default unfiltered state.

By default, the CLI targets the packaged Post app database. Use `--env dev` for
the development database, `--db <path>` for a specific SQLite file, or
`POST_USER_DATA_DIR` to override the app data directory.

Live UI commands such as `filter get`, `filter tag`, and `asset open` require
the desktop app to be running because they talk to the app over its local IPC
socket.
