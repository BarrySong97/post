# Testing And Verification

## Principle

Verify by running the affected path. Reading code is not enough for this project because behavior crosses Electron IPC, SQLite, filesystem indexing, and renderer state.

## Current Commands

```bash
pnpm test
pnpm lint
pnpm check-types
pnpm build
pnpm indexer:check
pnpm indexer:test
pnpm post-cli --db /private/tmp/post-cli-smoke.sqlite --json ledger-info
node scripts/check-docs.mjs
```

`pnpm test` runs workspace unit tests through Turbo. The initial JavaScript test baseline uses Vitest in `apps/desktop` for shared contracts, main-process use cases, repositories, and pure helpers. Desktop tests rebuild `better-sqlite3` for the Node ABI before Vitest runs; `pnpm dev` still rebuilds it for Electron. React component tests are intentionally out of scope until the renderer has a dedicated component test harness. PostToolUse and pre-commit hooks run Oxfmt on edited/staged files; full `pnpm format:check` should become part of the baseline after a one-time formatting cleanup. For Rust indexer changes, run the focused Cargo-backed scripts.

Type checks, unit tests, and production builds do not prove every Electron renderer runtime path. APIs that compile can still fail in the desktop shell, so changed click paths, dialogs, form submissions, route transitions, and IPC-triggered flows need a real app pass in `pnpm dev`.

## Focused Verification By Area

- Electron IPC or tRPC routers: run `pnpm test`, `pnpm lint`, and `pnpm check-types`, then exercise the renderer flow in `pnpm dev`.
- CLI or shared domain workflows: run `pnpm -F @post/domain check-types`, `pnpm -F @post/cli check-types`, and a smoke command such as `pnpm post-cli --db /private/tmp/post-cli-smoke.sqlite --json ledger-info`.
- Renderer UI: run `pnpm test`, `pnpm lint`, and `pnpm check-types`, then start `pnpm dev` and verify the changed workflow in the app.
- Asset UI: verify board filtering, pagination, asset route navigation, thumbnail rendering, and metadata actions in the Electron app.
- Database schema: run `pnpm db:generate`, inspect the migration, then run `pnpm test` and `pnpm check-types`.
- Indexer: run `pnpm indexer:check` and `pnpm indexer:test`; for behavior changes, test against a small vault fixture manually until automated fixtures exist.
- Packaging or ffmpeg: run `pnpm ffmpeg:prepare`; for distributable changes, run `pnpm package`.

## Future Gates

- Expand focused tests around asset filtering, saved views, and repository queries.
- Add deterministic fixtures for the Rust indexer.
- `check-docs.config.json` now covers `apps/`, `packages/`, `crates/`, and `scripts/`; keep `node scripts/check-docs.mjs --strict` clean before trusting hook changes.
- Claude Code and Codex Stop hooks run `node scripts/check-docs.mjs --hook`; Codex requires one-time `/hooks` review and trust before execution.
