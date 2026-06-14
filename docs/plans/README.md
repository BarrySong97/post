# Plans

Use this directory for implementation plans that should remain visible to future agents.

## Current Harness Migration Plan

1. Keep `AGENTS.md`, `docs/`, `design.md`, and `scripts/check-docs.mjs` as the active knowledge layer.
2. Keep `check-docs.config.json` in bootstrap mode while only harness scripts have AI file headers.
3. Add file headers to source files module by module, starting with frequently edited areas:
   - `apps/desktop/src/renderer/src/features/assets/`
   - `apps/desktop/src/main/trpc/routers/`
   - `packages/db/src/`
   - `crates/post-indexer/src/`
4. After each module is migrated, add or refine its module documentation.
5. Expand `check-docs.config.json` from `scripts/` to the migrated roots.
6. Enable `.claude` / `.codex` Stop hooks only after `node scripts/check-docs.mjs` is clean for the selected roots.
