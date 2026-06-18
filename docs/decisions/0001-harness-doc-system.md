# 0001 - Adopt AI Harness Documentation System

## Context

Post already has a compact `AGENTS.md`, but the project spans Electron main, preload, renderer, shared packages, SQLite schema, and a Rust indexer. Agents need a stable way to navigate from the repository entry point into module-specific context without rediscovering the architecture on every task.

The local toolkit at `/Users/songtianjian/coding-md` defines a harness-oriented documentation system with three layers:

- Knowledge layer: `AGENTS.md`, `docs/`, `design.md`, source file headers.
- Enforcement layer: `check-docs` and optional hooks.
- Verification layer: focused test and run commands.

## Decision

Adopt the documentation system incrementally.

- Make `AGENTS.md` the single agent entry point.
- Add `docs/run.md`, `docs/conventions.md`, `docs/testing.md`, module docs, topics, plans, and ADRs.
- Add `scripts/check-docs.mjs` and shared hook scripts from the toolkit.
- Start `check-docs` in bootstrap mode against `scripts/` only.
- Defer `.claude` / `.codex` Stop hook activation until legacy source files have AI file headers.

## Rationale

Enabling the full Stop hook immediately would block normal work because existing source files do not yet have `@purpose` headers. Bootstrap mode gives the repository a working sensor today while keeping the migration explicit and reversible.

## Consequences

- New durable context should land in `docs/` and be linked from `AGENTS.md`.
- Source file headers should be added module by module.
- The harness check is not full-repo enforcement yet; expanding it is tracked in [../plans/README.md](../plans/README.md).

## Status Update

As of 2026-06-15, the bootstrap migration is complete: `check-docs.config.json` covers `apps/`, `packages/`, `crates/`, and `scripts/`, and the Stop hooks call `node scripts/check-docs.mjs --hook`.
