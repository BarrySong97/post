# `.post/` — non-asset keep files

This folder sits at the **vault root** (the Agent project directory). Post’s indexer skips every path starting with `.`, so nothing here becomes an asset.

## Rule

- **Asset / library content** → normal (non-dot) paths in the vault.
- **Everything else that must be kept** → here under `.post/` only.

## Layout

| Path | Use |
| --- | --- |
| `scripts/` | Helpers that wrap `post-cli` |
| `patches/` | `apply-patch` JSON drafts |
| `scratch/` | Chat leftovers and other non-asset retainables |

Skill installs belong under `.agents/skills/post` (or `.claude` / `.cursor`), not as a substitute for this scratch tree.
