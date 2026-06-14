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

## Lint And Format

```bash
pnpm lint
pnpm lint:fix
pnpm format
pnpm format:check
```

Oxlint checks JavaScript and TypeScript under `apps/`, `packages/`, and `scripts/`. Oxfmt formats supported source and config files in those roots. Generated `apps/desktop/src/renderer/src/routeTree.gen.ts` is ignored.

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

`check-docs.config.json` covers `apps/`, `packages/`, `crates/`, and `scripts/`, while ignoring generated `routeTree.gen.ts`.

Claude Code and Codex hooks call the shared scripts in `scripts/hooks/`. Codex users should run `/hooks` once, review the commands, and trust them for this project.
