# Testing And Verification

## Principle

Verify by running the affected path. Reading code is not enough for this project because behavior crosses Electron IPC, SQLite, filesystem indexing, and renderer state.

## Current Commands

```bash
pnpm check-types
pnpm build
pnpm indexer:check
pnpm indexer:test
node scripts/check-docs.mjs
```

There is no dedicated JavaScript unit-test command yet. For TypeScript changes, `pnpm check-types` is the minimum verification. For Rust indexer changes, run the focused Cargo-backed scripts.

## Focused Verification By Area

- Electron IPC or tRPC routers: run `pnpm check-types`, then exercise the renderer flow in `pnpm dev`.
- Renderer UI: run `pnpm check-types`, start `pnpm dev`, and verify the changed workflow in the app.
- Database schema: run `pnpm db:generate`, inspect the migration, then run `pnpm check-types`.
- Indexer: run `pnpm indexer:check` and `pnpm indexer:test`; for behavior changes, test against a small vault fixture manually until automated fixtures exist.
- Packaging or ffmpeg: run `pnpm ffmpeg:prepare`; for distributable changes, run `pnpm package`.

## Future Gates

- Add focused tests around asset filtering, saved views, and repository queries.
- Add deterministic fixtures for the Rust indexer.
- After source headers are migrated, expand `check-docs.config.json` to cover `apps/`, `packages/`, and `crates/`.
- Only enable Stop hooks after `node scripts/check-docs.mjs` is clean on the intended source roots.
