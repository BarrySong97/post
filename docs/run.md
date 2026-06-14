# Runbook

This repository is a pnpm/Turbo monorepo with an Electron desktop app, shared TypeScript packages, a SQLite/Drizzle database package, and a Rust indexer crate.

## Requirements

- Node.js compatible with the pinned pnpm workspace.
- `pnpm@10.14.0` from `packageManager` in `package.json`.
- Rust toolchain for `crates/post-indexer`.
- Electron native dependencies can require rebuilds; `pnpm dev` runs `pnpm rebuild:electron` before starting the app.

## Install

```bash
pnpm install
```

## Local Development

```bash
pnpm dev
pnpm dev:debug
```

There is no browser URL and no HTTP API server. The app runs through Electron, with renderer calls crossing the preload bridge into main-process tRPC procedures.

## Build And Type-Check

```bash
pnpm check-types
pnpm build
```

## Database

```bash
pnpm db:generate
pnpm db:migrate
pnpm db:studio
```

Use `pnpm db:generate` after schema edits in `packages/db/src/schema.ts`, then commit the generated SQL under `packages/db/drizzle/`.

## Rust Indexer

```bash
pnpm indexer:check
pnpm indexer:test
pnpm indexer:build
```

## Packaging

```bash
pnpm ffmpeg:prepare
pnpm package
pnpm dist
```

`pnpm package` and `pnpm dist` prepare ffmpeg, build the Rust indexer, then run the desktop package scripts.

## Harness Checks

```bash
node scripts/check-docs.mjs
node scripts/check-docs.mjs --strict
```

The check is currently scoped to `scripts/` while the legacy source tree is migrated to AI file headers. Expand `check-docs.config.json` after completing the plan in [plans](plans/README.md).
