# Plans

Use this directory for implementation plans that should remain visible to future agents.

## Harness Migration Status

Completed:

- `AGENTS.md`, `docs/`, `design.md`, and `scripts/check-docs.mjs` are the active knowledge layer.
- Source file headers have been added across `apps/`, `packages/`, `crates/`, and `scripts/`.
- `check-docs.config.json` now checks the full source roots and ignores only generated `routeTree.gen.ts`.
- Claude Code and Codex hook configs have been added at `.claude/settings.json` and `.codex/`.
- Oxlint and Oxfmt are installed as root devDependencies and wired into root scripts plus staged-file hooks.

Remaining:

- In Codex, open `/hooks` once, review the configured commands, and trust them for this project.
- Consider a one-time full `pnpm format` cleanup commit when the team is ready for broad formatting churn.
- Add focused automated tests for asset filtering, repository queries, and Rust indexer fixtures.
