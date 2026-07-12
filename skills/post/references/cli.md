# post-cli reference

Safe organization CLI for Post. Same domain rules as Desktop. Never a raw SQLite shell.

## Invoke

| Mode | Command |
| --- | --- |
| npm | `npx @barrysongdev4real/post-cli …` |
| Global | `post-cli …` after `npm i -g @barrysongdev4real/post-cli` |
| Monorepo | `pnpm post-cli …` |

## Global flags

| Flag | Meaning |
| --- | --- |
| `--json` | Stable machine-readable output (prefer always) |
| `--db <path>` | Explicit SQLite path |
| `--env <env>` | Default `prod`; use `dev` for development DB |
| `--vault <vaultId>` | Target vault when multiple exist |

Also: `POST_USER_DATA_DIR` overrides app data directory resolution.

## Commands

### Snapshot

- `ledger-info` — DB path, vault summary, counts, available ops (agent discovery entry)

### Vault

- `vault list`
- `vault current`

### Asset read

- `asset list` — `--kind`, `--status`, `--tag`, `--search`, `--limit`
- `asset get <id>`
- `asset tags <id>`

### Asset tags (write: dry-run unless `--commit`)

- `asset tag add <assetId> --tag <tagId> [--commit]`
- `asset tag remove <assetId> --tag <tagId> [--commit]`
- `asset tag add-many` / `remove-many` (see `--help` for batch flags)

### Live navigation (Desktop must run; no `--commit`)

- `asset open <id>` — soft-opens detail in the running app; exit `3` if app unreachable; exit `1` if id missing

### Tags (write needs `--commit`)

- `tag list|get|create|update|delete|reorder`

### Saved views (write needs `--commit`)

- `view list|get|create|update|delete|reorder`
- `view update` keeps existing filters unless filter flags are passed; `--clear-filters` resets to unfiltered

### Live filter (Desktop must run; no `--commit`)

- `filter apply` — `--tag`, `--kind`, `--source`, `--match`, `--time`, `--status`, `--sort`
- `filter view <nameOrId>`
- `filter tag <nameOrId>`
- `filter all` / `filter inbox` / `filter clear`
- `filter get` — read current live filter back

### Batch

- `apply-patch <patch.json> --dry-run|--commit`

## Write / IPC behavior

- Default is **dry-run**: validates in a rolled-back transaction.
- After successful `--commit`, best-effort local IPC `ledger.changed` refreshes Desktop; failure is a warning only.
- Live `filter.*` / `asset open` use the same local IPC socket family as the extension host; messages are guarded by `dbPath` match.
- CLI never deletes, moves, renames, or rewrites original vault files.
- CLI does not expose arbitrary SQL.
