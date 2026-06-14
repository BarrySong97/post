# Config Package

## Responsibility

`packages/config` owns shared TypeScript configuration for the monorepo.

## File Map

- `packages/config/tsconfig.base.json` - strict compiler defaults.
- `packages/config/package.json` - workspace package metadata.

## Public Interfaces

Workspace TypeScript projects extend `packages/config/tsconfig.base.json`.

## Notes

- Strictness is part of the project contract.
- Do not weaken compiler options to work around local errors; fix the code or narrow the type.
- Any config relaxation should be recorded as an ADR.
