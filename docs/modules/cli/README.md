# CLI Package

## Responsibility

`packages/cli` owns the Post command line interface for users and AI agents. It exposes safe organization commands for tags, asset-tag bindings, saved views, and supporting asset/vault queries.

The CLI is a full organization interface, not a raw SQLite shell. It calls `@post/domain` so writes use the same business rules as the desktop app.

## File Map

- `packages/cli/src/main.ts` - Commander.js command tree and CLI entrypoint.
- `packages/cli/bin/post-cli.mjs` - global executable wrapper that launches the TypeScript CLI through Electron Node mode.
- `packages/cli/src/runtime/` - database path resolution, migration, and domain context construction.
- `packages/cli/src/output/` - stable JSON and concise text output helpers.
- `packages/cli/package.json` - workspace scripts and dependencies.

## Data Flow

Root `pnpm post-cli ...` delegates to `@post/cli`, which runs under Electron Node mode for `better-sqlite3` ABI compatibility. The CLI resolves the SQLite database path, runs Drizzle migrations, builds a `DomainContext`, calls `@post/domain`, and renders either text or JSON output.

After successful `--commit` writes, the CLI sends a best-effort local IPC `ledger.changed` notification to a running desktop app for UI cache refresh. Notification failures are warnings only; the database commit remains authoritative. In JSON output, `warnings: []` means the running app acknowledged the refresh notification.

## Public Interfaces

- Development command: `pnpm post-cli ...`.
- Workspace command: `pnpm -F @post/cli post-cli ...`.
- Global command after linking: `post-cli ...`.
- Global options: `--db`, `--env`, `--vault`, and `--json`.
- Batch entry point: `apply-patch <patch.json> --dry-run|--commit`.

## Notes

- Write commands are dry-run by default unless `--commit` is present.
- The default database environment is `prod` so the global command targets the installed app; pass `--env dev` for development data.
- The CLI never deletes, moves, renames, or rewrites original vault files.
- The CLI does not expose arbitrary writable SQL.
- `ledger-info --json` should remain a stable machine-readable capability and database snapshot for AI callers.
