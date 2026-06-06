# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
# Development
pnpm dev              # Start desktop app in dev mode
pnpm dev:debug        # Start with DevTools open (OPEN_DEVTOOLS=1)

# Build & type-check
pnpm build            # Build all workspaces via Turbo
pnpm check-types      # TypeScript type check across all workspaces

# Database
pnpm db:generate      # Generate Drizzle migrations from schema changes
pnpm db:migrate       # Run pending migrations
pnpm db:studio        # Open Drizzle Studio GUI

# Packaging
pnpm package          # Build + bundle app directory (electron-builder --dir)
pnpm dist             # Build + create distributable installers
```

## Architecture

This is a pnpm monorepo (Turbo) with one app and three packages:

- `apps/desktop` — Electron app (electron-vite, React 19, TanStack Router, tRPC)
- `packages/db` — SQLite schema, migrations, Drizzle ORM utilities
- `packages/ui` — Shared Tailwind/HeroUI styles
- `packages/config` — Shared `tsconfig.base.json`

### Electron-tRPC IPC pattern

There is no HTTP server. The renderer communicates with the main process exclusively through a custom tRPC link over Electron IPC:

```
Renderer (React/tRPC hooks)
  → window.api.trpcRequest()       [preload context bridge]
  → IPC channel "trpc:request"     [main process handler]
  → appRouter.createCaller()       [tRPC procedure resolution]
  → SQLite via Drizzle             [database]
```

Key files:
- `apps/desktop/src/preload/index.ts` — exposes `window.api` via context bridge
- `apps/desktop/src/renderer/src/lib/ipc-trpc-link.ts` — converts IPC promises to tRPC observables
- `apps/desktop/src/main/trpc/router.ts` — root tRPC router
- `apps/desktop/src/main/trpc/routers/` — individual procedure routers

### Database

- SQLite file: `post-dev.sqlite` (dev) or `post-prod.sqlite` (prod), placed in the Electron `userData` path
- Schema defined in `packages/db/src/schema.ts`; migrations live in `packages/db/drizzle/`
- Run `pnpm db:generate` after schema changes, then commit the generated migration SQL
- WAL mode and foreign keys are enabled on every connection (`packages/db/src/index.ts`)

### Frontend

- File-based routing via TanStack Router under `apps/desktop/src/renderer/src/routes/`
- React Query manages server state; tRPC hooks (`trpc.notes.*`) are the data layer
- HeroUI components + Tailwind CSS v4 (oklch color system)
- Resizable panel layout: sidebar / asset grid / inspector / agent panel

### TypeScript

All packages extend `packages/config/tsconfig.base.json`. Strict mode is on with `noUnusedLocals`, `noUnusedParameters`, and `noUncheckedIndexedAccess` enforced — the build will fail on violations.
