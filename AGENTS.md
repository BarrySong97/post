# Post - Agent Guide

**What it is**: a local-first Electron desktop workspace for organizing vault files, assets, notes, tags, saved views, indexing, previews, and publishing-oriented workflows.
**Architecture**: pnpm/Turbo monorepo with Electron, React 19, TanStack Router, tRPC over Electron IPC, Drizzle, SQLite, and a Rust indexer. Runtime details live in [docs/run.md](docs/run.md).

## Hard Rules

- The renderer never talks to a local HTTP server. All renderer-to-main calls go through `window.api` and the custom tRPC IPC link. See [docs/topics/electron-trpc-ipc.md](docs/topics/electron-trpc-ipc.md).
- Database shape changes start in `packages/db/src/schema.ts`, then run `pnpm db:generate` and commit the generated Drizzle SQL.
- SQLite lives in Electron `userData`; every connection must keep WAL mode and foreign keys enabled through `packages/db/src/index.ts`.
- UI work follows the desktop tool design rules in [design.md](design.md): dense panels, HeroUI/Tailwind v4, 14px toolbar icons, 13px small action icons.
- TypeScript strictness is part of the contract: `noUnusedLocals`, `noUnusedParameters`, and `noUncheckedIndexedAccess` are enforced through `packages/config/tsconfig.base.json`.
- The harness now checks `apps/`, `packages/`, `crates/`, and `scripts/`; keep source headers, module docs, and topic docs current with code changes. See [docs/plans/README.md](docs/plans/README.md).

## Commands

```bash
# Development
pnpm dev              # Start desktop app in dev mode
pnpm dev:debug        # Start with DevTools open

# Build and type-check
pnpm build            # Build all workspaces via Turbo
pnpm check-types      # TypeScript type check across all workspaces

# Database
pnpm db:generate      # Generate Drizzle migrations from schema changes
pnpm db:migrate       # Run pending migrations
pnpm db:studio        # Open Drizzle Studio GUI

# Rust indexer
pnpm indexer:check
pnpm indexer:test
pnpm indexer:build

# Packaging
pnpm package          # Build and bundle app directory
pnpm dist             # Build distributable installers

# Harness
node scripts/check-docs.mjs
```

## Definition of Done

1. Read the relevant module doc in [docs/modules/](docs/modules/) and any linked topic in [docs/topics/](docs/topics/).
2. For broad or risky changes, write or update a plan in [docs/plans/](docs/plans/) before editing code.
3. Make the smallest coherent code change and follow [docs/conventions.md](docs/conventions.md).
4. Keep nearby context current: source file header, module doc, topic doc, and ADR when the decision is durable.
5. Run the focused verification from [docs/testing.md](docs/testing.md), then run `node scripts/check-docs.mjs`.
6. Before any git operation, use the conventional commit batching workflow required by the active skills.

## Navigation

- Modules: [desktop](docs/modules/desktop/README.md), [db](docs/modules/db/README.md), [ui](docs/modules/ui/README.md), [config](docs/modules/config/README.md), [post-indexer](docs/modules/post-indexer/README.md), [cli](docs/modules/cli/README.md)
- Desktop subtopics: [asset management](docs/modules/desktop/assets.md)
- Agent skill (skills.sh): [skills/post](skills/post/SKILL.md) — `npx skills add BarrySong97/post -s post`
- Cross-module topics: [Electron tRPC IPC](docs/topics/electron-trpc-ipc.md), [vault indexing flow](docs/topics/vault-indexing-flow.md), [renderer i18n](docs/topics/i18n.md)
- Project guides: [run](docs/run.md), [conventions](docs/conventions.md), [testing](docs/testing.md), [design](design.md), [layered architecture](docs/reference/frontend-backend-layered-architecture.md)
- Harness records: [specs](docs/specs/README.md), [plans](docs/plans/README.md), [decisions](docs/decisions/README.md)
