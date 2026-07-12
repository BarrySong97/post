---
name: post
description: >-
  Control Post (local-first vault workspace) via post-cli: list/get assets, tags,
  saved views, apply-patch, live filter, and asset open. Use when organizing a
  Post vault, tagging inbox items, driving the Desktop UI, or when the user
  mentions Post, post-cli, vault assets, or the browser extension collector.
  Also covers the vault .post/ folder for non-asset keep files.
compatibility: >-
  Requires Node.js and @barrysongdev4real/post-cli (or repo pnpm post-cli).
  Live filter/asset open need Post Desktop running. Prefer --json.
metadata:
  author: Post
  version: "0.1.0"
---

# Post

Post is a **local-first desktop workspace**. The user links a folder as a **vault**. Files stay on disk; tags, saved views, and index metadata live in SQLite. Surfaces: **Desktop app**, **`post-cli`**, and a **Chrome extension** for capture.

## Mental model

- The Agent’s project directory **is the vault root** (whatever folder Post indexed), not a special monorepo path.
- **Non-dot paths** under that tree are (or become) **assets** after indexing.
- **Dot directories** (`.post`, `.agents`, `.claude`, `.cursor`, …) are **not indexed**.

## Hard rules

1. Prefer **`--json`** on every `post-cli` call.
2. Start with **`ledger-info --json`** (db path, vault, counts, ops).
3. Writes are **dry-run** unless **`--commit`**.
4. Never raw SQL. Never move/rename/delete/rewrite vault media via CLI.
5. Live commands (`filter *`, `asset open`) need Desktop running; exit **`3`** if unreachable.
6. Default DB env is **`prod`**. Use `--env dev` or `--db <path>` deliberately.
7. **Non-asset keep files** (scripts, patches, chat leftovers, agent notes) go only under **`<vault>/.post/`**. Asset/library content uses normal vault paths.

## Quick start

```bash
npx @barrysongdev4real/post-cli ledger-info --json
npx @barrysongdev4real/post-cli asset list --status inbox --json
npx @barrysongdev4real/post-cli tag list --json
```

In this monorepo: `pnpm post-cli …`.

Install this skill (skills.sh):

```bash
npx skills add BarrySong97/post -s post
```

## Capability map

| Need | Read |
| --- | --- |
| CLI commands & flags | [references/cli.md](references/cli.md) |
| Vault / asset / tag / view model | [references/data-model.md](references/data-model.md) |
| Browser extension capture | [references/extension.md](references/extension.md) |
| Desktop board, filters, soft detail | [references/assets-and-ui.md](references/assets-and-ui.md) |
| `.post/` workspace & indexer skip | [references/vault-workspace.md](references/vault-workspace.md) |
| Copy-paste recipes | [examples/workflows.md](examples/workflows.md) |

## Discovery loop

1. `ledger-info --json`
2. `vault current` / `asset list` / `tag list` / `view list` as needed
3. Mutate with dry-run, then `--commit`
4. Optionally drive UI: `filter …`, `asset open <id>` (Desktop must be open)
5. Put any non-asset keep files under `.post/` (bootstrap from [assets/dot-post-template](assets/dot-post-template/) if missing)
