# Conventions

## Project Shape

- `apps/desktop` owns Electron main, preload, renderer, and packaging config.
- `packages/db` owns SQLite schema, migrations, and Drizzle database utilities.
- `packages/ui` owns shared Tailwind/HeroUI style exports.
- `packages/config` owns shared TypeScript compiler configuration.
- `crates/post-indexer` owns filesystem indexing, watch mode, link parsing, and thumbnail generation.

## Naming

- Files and folders use kebab-case where the surrounding code already does.
- React components and TypeScript types use PascalCase.
- Functions, values, atoms, hooks, and tRPC procedure helpers use camelCase.
- Database columns use snake_case in SQL and camelCase in TypeScript schema objects.

## Boundaries

- Renderer code imports tRPC hooks and UI helpers; it does not import Electron main modules or touch SQLite directly.
- Preload exposes the narrow `window.api` bridge. Add new renderer capabilities there instead of using direct Node access.
- Main-process tRPC routers validate inputs and call repositories/services. Keep filesystem, process, watcher, terminal, and database side effects out of React components.
- Schema changes belong in `packages/db/src/schema.ts`; migration SQL belongs in `packages/db/drizzle/`.
- Rust indexer changes must preserve the CLI/event contract consumed by the Electron main process.

## TypeScript

- All packages extend `packages/config/tsconfig.base.json`.
- Strict mode, unused checks, and `noUncheckedIndexedAccess` are expected to pass.
- Prefer shared types from the tRPC router, Drizzle schema, or local renderer model files over duplicate hand-written shapes.
- Run `pnpm lint` for Oxlint checks and `pnpm format` or `pnpm format:check` for Oxfmt formatting.

## Frontend

- Use HeroUI and the local UI primitives before adding new component patterns.
- Keep operational screens dense, scannable, and panel-based.
- Main navigation and toolbar icons use a 14px icon box; small action icons use 13px.
- Do not add marketing-style landing pages for app workflows.

## Documentation Harness

- Durable project context lives in `AGENTS.md` and `docs/`.
- Module-level behavior lives in `docs/modules/<module>/`.
- Cross-module flows live in `docs/topics/`.
- File-level purpose belongs in the source file header with `@purpose`, `@role`, `@deps`, and `@gotcha`.
- `check-docs` covers `apps/`, `packages/`, `crates/`, and `scripts/`.
- PostToolUse hooks format changed JS/TS/JSON/CSS files with Oxfmt and lint changed JS/TS files with Oxlint. The pre-commit hook runs the same checks on staged files.

## Commits

- Use Conventional Commit format: `type(scope): subject`.
- Keep commits cohesive; split unrelated changes into separate commits.
- For any git add, commit, or push operation, use the conventional commit batching workflow required by the active skills.

## Glossary

| Term | Identifier | Meaning |
|---|---|---|
| Vault | `vault` | A user-selected root folder managed by Post. |
| Asset | `asset` | A normalized item discovered in a vault. |
| Asset file | `assetFiles` | The concrete filesystem path associated with an asset. |
| Saved view | `savedViews` | A named filter/sort configuration for browsing assets. |
| Sync run | `syncRuns` | A recorded indexing or reconciliation execution. |
| Indexer | `post-indexer` | Rust CLI that scans, watches, refreshes, and thumbnails vault content. |

## Review Checklist

- [ ] The change is cohesive and does not carry unrelated refactors.
- [ ] Boundaries above are still respected.
- [ ] Schema changes include generated migrations.
- [ ] UI changes follow [design.md](../design.md).
- [ ] Relevant module/topic docs are updated.
- [ ] Focused verification from [testing.md](testing.md) was run.
- [ ] `node scripts/check-docs.mjs` was run.
