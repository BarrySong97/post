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
pnpm post-cli --env dev ledger-info --json
npx @barrysongdev4real/post-cli ledger-info --json
```

There is no browser URL and no HTTP API server. The app runs through Electron, with renderer calls crossing the preload bridge into main-process tRPC procedures.

On macOS, `pnpm -F desktop dev` prepares a local `apps/desktop/.electron-dev/Post.app` wrapper so Dock, menu, and process names show `Post` instead of the stock Electron bundle name.

The renderer dev server uses a strict local port. If `pnpm dev` reports that port `42873` is already in use, an existing dev app may already be running; reuse or stop that process before starting another instance. `pnpm dev` rebuilds Electron native modules such as `better-sqlite3`, while `pnpm test` may rebuild the same dependency for the Node ABI.

`pnpm post-cli` runs the CLI through Electron Node mode so it can use the Electron ABI build of `better-sqlite3`. By default it targets the packaged app database; use `--env dev` for the development database and `--db <path>` for fixture databases or sandboxed AI workflows.

The npm CLI package is built separately from `packages/cli/npm` and runs through
the user's Node runtime instead of Electron Node mode. Build and inspect it with
`pnpm -F @post/cli pack:dry`. Publish it with
`pnpm -F @post/cli publish:npm` after npm auth is available through
`NODE_AUTH_TOKEN` or user-level npm login.

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

Oxlint checks JavaScript and TypeScript under `apps/`, `packages/`, and `scripts/`. Oxfmt formats supported source and config files in those roots. Generated files and known legacy formatting outliers are listed in `.oxfmtrc.json`.

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
pnpm release <version>
```

`pnpm package` and `pnpm dist` prepare ffmpeg, build the Rust indexer, then run the desktop package scripts.

`pnpm release <version>` is the Mac release path. Add the new first entry in
`apps/website/app/components/releases/release-timeline.tsx`, move
`badge: "latest"` to it, then run the helper from `main`. The helper bumps the
desktop and website package versions, commits the release, pushes a `v<version>`
tag, waits for the GitHub Actions Release workflow, and publishes the generated
GitHub Release as latest. Use `--dry-run --no-checks --no-wait --no-publish` to
validate the release note/version wiring without mutating git state.

## Harness Checks

```bash
node scripts/check-docs.mjs
node scripts/check-docs.mjs --strict
```

`check-docs.config.json` covers `apps/`, `packages/`, `crates/`, and `scripts/`, while ignoring generated `routeTree.gen.ts`.

Claude Code and Codex hooks call the shared scripts in `scripts/hooks/`. Codex users should run `/hooks` once, review the commands, and trust them for this project.
