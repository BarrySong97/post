# CLI Package

## Responsibility

`packages/cli` owns the Post command line interface for users and AI agents. It exposes safe organization commands for tags, asset-tag bindings, saved views, and supporting asset/vault queries.

The CLI is a full organization interface, not a raw SQLite shell. It calls `@post/domain` so writes use the same business rules as the desktop app.

## File Map

- `packages/cli/src/main.ts` - Commander.js command tree and CLI entrypoint.
- `packages/cli/bin/post-cli.mjs` - global executable wrapper that launches the TypeScript CLI through Electron Node mode.
- `packages/cli/scripts/build.mjs` - npm packaging build that bundles workspace code and copies DB migrations.
- `packages/cli/npm/` - generated npm publish directory for `@barrysongdev4real/post-cli`; do not edit by hand.
- `packages/cli/src/runtime/` - database path resolution, migration, and domain context construction.
- `packages/cli/src/output/` - stable JSON and concise text output helpers.
- `packages/cli/package.json` - workspace scripts and dependencies.

## Data Flow

Root `pnpm post-cli ...` delegates to `@post/cli`, which runs under Electron Node mode for `better-sqlite3` ABI compatibility. The CLI resolves the SQLite database path, runs Drizzle migrations, builds a `DomainContext`, calls `@post/domain`, and renders either text or JSON output.

After successful `--commit` writes, the CLI sends a best-effort local IPC `ledger.changed` notification to a running desktop app for UI cache refresh. Notification failures are warnings only; the database commit remains authoritative. In JSON output, `warnings: []` means the running app acknowledged the refresh notification.

The `filter` command group and `asset open` drive the running desktop app's live UI over the same local IPC socket (`filter.*` / `asset.open` messages, `command.ack` responses). These are live-only controls: they do not write SQLite, act immediately (no `--commit`/dry-run), and fail with exit code `3` when the app is not running. `filter get` reads the app's current live filter back (two-way). The socket address is derived from the userData directory and every message is guarded by a `dbPath` match against the running app. `asset open <id>` resolves the asset from SQLite first (exit `1` if not found), then tells the app to navigate to that asset's detail view.

## npm Distribution

`@barrysongdev4real/post-cli` is published from the generated
`packages/cli/npm` directory, not from the workspace package root. The build
bundles local `@post/domain` and `@post/db` TypeScript into `dist/index.mjs`,
copies `packages/db/drizzle` into `dist/drizzle`, and keeps `better-sqlite3`,
`commander`, and `drizzle-orm` as npm runtime dependencies.

The workspace command still runs through Electron Node mode for the desktop
app's native dependency ABI. The npm package runs through the user's normal Node
runtime and installs its own `better-sqlite3` build.

## Public Interfaces

- Development command: `pnpm post-cli ...`.
- Workspace command: `pnpm -F @post/cli post-cli ...`.
- npm command: `npx @barrysongdev4real/post-cli ...`.
- Global command after npm install: `post-cli ...`.
- Packaging command: `pnpm -F @post/cli pack:dry`.
- Publish command: `pnpm -F @post/cli publish:npm`.
- Global options: `--db`, `--env`, `--vault`, and `--json`.
- Batch entry point: `apply-patch <patch.json> --dry-run|--commit`.
- Asset queries: `asset list`, `asset get <assetId>`, and `asset tags <assetId>`.
- Tag CRUD: `tag list|get|create|update|delete|reorder`.
- Saved-view CRUD: `view list|get|create|update|delete|reorder`.
- Live filter control: `filter apply|view <nameOrId>|tag <nameOrId>|all|inbox|clear|get` controls the running desktop app's asset filter in real time.
- Live navigation: `asset open <assetId>` opens an asset's detail view in the running app.

## Notes

- Write commands are dry-run by default unless `--commit` is present.
- Dry-runs execute domain validation inside a rolled-back SQLite transaction so
  callers can see validation failures without committing data.
- `view update` preserves existing filters unless filter flags are passed; use
  `--clear-filters` to reset filters to the default unfiltered view.
- Saved-view and live-filter `--kind` options include `youtube`, matching the
  Desktop board's first-class YouTube bookmark filter.
- Saved views and live `filter apply` commands default to `added_desc`, matching
  the Desktop asset board's newest-import-first order. Callers can still choose
  added, modified, or source-created time in either direction with `--sort`.
- Live commands (`filter *`, `asset open`) act on the running app immediately with no `--commit` and exit `3` when the app is unreachable; `asset open` reads SQLite only to validate the id.
- The default database environment is `prod` so the global command targets the installed app; pass `--env dev` for development data.
- The CLI never deletes, moves, renames, or rewrites original vault files.
- The CLI does not expose arbitrary writable SQL.
- `ledger-info --json` should remain a stable machine-readable capability and database snapshot for AI callers.
- Agent-facing skill: [skills/post/SKILL.md](../../../skills/post/SKILL.md). Install with `npx skills add BarrySong97/post -s post`, or for Codex skill-installer use `--repo BarrySong97/post --path skills/post` (not `--path post`). The skill documents CLI usage, data model, extension capture, and the vault `.post/` convention for non-asset keep files. This module doc remains the developer source of truth.
- npm publish uses the caller's existing npm auth, such as user-level
  `~/.npmrc` or `NODE_AUTH_TOKEN`; never commit npm tokens to the repo.
