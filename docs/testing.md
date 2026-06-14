# Testing And Verification

## Principle

Verify by running the affected path. Reading code is not enough for this project because behavior crosses Electron IPC, SQLite, filesystem indexing, and renderer state.

## Current Commands

```bash
pnpm lint
pnpm check-types
pnpm build
pnpm indexer:check
pnpm indexer:test
node scripts/check-docs.mjs
```

There is no dedicated JavaScript unit-test command yet. For TypeScript changes, `pnpm lint` and `pnpm check-types` are the baseline verification. PostToolUse and pre-commit hooks run Oxfmt on edited/staged files; full `pnpm format:check` should become part of the baseline after a one-time formatting cleanup. For Rust indexer changes, run the focused Cargo-backed scripts.

## Focused Verification By Area

- Electron IPC or tRPC routers: run `pnpm lint` and `pnpm check-types`, then exercise the renderer flow in `pnpm dev`.
- Renderer UI: run `pnpm lint` and `pnpm check-types`, then start `pnpm dev` and verify the changed workflow in the app.
- Database schema: run `pnpm db:generate`, inspect the migration, then run `pnpm check-types`.
- Indexer: run `pnpm indexer:check` and `pnpm indexer:test`; for behavior changes, test against a small vault fixture manually until automated fixtures exist.
- Packaging or ffmpeg: run `pnpm ffmpeg:prepare`; for distributable changes, run `pnpm package`.

## Future Gates

- Add focused tests around asset filtering, saved views, and repository queries.
- Add deterministic fixtures for the Rust indexer.
- `check-docs.config.json` now covers `apps/`, `packages/`, `crates/`, and `scripts/`; keep `node scripts/check-docs.mjs --strict` clean before trusting hook changes.
- Claude Code and Codex Stop hooks run `node scripts/check-docs.mjs --hook`; Codex requires one-time `/hooks` review and trust before execution.
