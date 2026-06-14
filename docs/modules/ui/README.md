# UI Package

## Responsibility

`packages/ui` contains shared style exports for the desktop renderer. It should stay small and reusable, with concrete app composition remaining in `apps/desktop`.

## File Map

- `packages/ui/src/index.ts` - public package entry point.
- `packages/ui/src/styles/styles.css` - shared Tailwind/HeroUI style layer.
- `packages/ui/package.json` - package metadata and exports.

## Data Flow

The desktop renderer imports shared styles from this package, then composes app-specific components locally.

## Public Interfaces

- CSS and style exports from `@post/ui`.

## Notes

- Do not move feature-specific component behavior here unless it is genuinely shared.
- Keep design decisions synchronized with [../../../design.md](../../../design.md).
- Source files in this package have AI file headers. Keep them high-level and avoid duplicating implementation details.
