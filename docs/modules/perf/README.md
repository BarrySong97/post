# Performance Fixtures

## Responsibility

`scripts/perf` owns local-only performance fixture and measurement utilities. These scripts create
disposable SQLite/userData directories for asset-list profiling and record repeatable query timing
baselines.

## File Map

- `scripts/perf/seed-asset-fixture.mjs` - creates small, large, or stress asset databases under a
  caller-provided temporary `POST_USER_DATA_DIR`.
- `scripts/perf/measure-asset-list.mjs` - measures first-page and next-page asset-list SQL timings
  against a seeded fixture database.

## Notes

- Fixtures must write only under the requested output directory, usually `/private/tmp/post-perf-*`.
- These scripts are for local profiling and should not depend on Electron native module ABI builds.
- Keep generated fixture databases out of the repository.
- Use the same fixture size, sort/filter state, and machine when comparing before/after timings.
