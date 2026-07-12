# UI Package

## Responsibility

`packages/ui` contains shared style exports and browser-safe presentation components used across Post apps (the Electron [desktop](../desktop/README.md) renderer and the [website](../website/README.md)). Concrete app composition, data loading, routing, and side effects remain in the consuming app.

## File Map

- `packages/ui/src/index.ts` - public package entry point.
- `packages/ui/src/post-preview.tsx` - pure React presentation components for the interactive Post desktop product preview, including the desktop shell frame, resizable/collapsible sidebar, asset board, filter panel, editor split menu, asset detail, settings, status line, and knowledge-graph display.
- `packages/ui/src/styles/theme.css` - shared Tailwind v4 + HeroUI + color-token + base-reset layer. Free of Electron-specific rules; safe for any React app to import.
- `packages/ui/src/styles/styles.css` - desktop-only Electron window chrome and status-line styles. Imports `./theme.css` and adds window-drag rules, default `user-select: none` (with editable/copy opt-ins), panel-animation, and the global status line CSS.
- `packages/ui/package.json` - package metadata and exports (`./styles.css`, `./theme.css`).

## Data Flow

The desktop renderer imports `@post/ui/styles.css` (theme + Electron-specific rules). The website imports `@post/ui/theme.css` (theme only, no Electron window assumptions). Shared preview components are prop-driven and receive data/callbacks from the consumer.

## Public Interfaces

- `@post/ui/styles.css` - full desktop style layer.
- `@post/ui/theme.css` - shared theme layer only (colors, fonts, base reset); use this from non-Electron apps.
- `@post/ui` - shared presentation components and types, including `PostDesktopPreviewFrame`, `PostPreviewSidebar`, `PostPreviewAssetBoard`, `PostPreviewAssetCard`, `PostPreviewAssetDetail`, `PostPreviewKnowledgeGraph`, `PostPreviewSettings`, `PostPreviewStatusLine`, and their asset/sidebar/filter/status types.

## Notes

- Do not move feature-specific runtime behavior here. Shared components must avoid Electron APIs, tRPC, router state, Jotai atoms, localStorage, filesystem access, and database dependencies.
- Desktop preview components accept only data props and callbacks. Website-owned state covers history, active screen, sidebar width/collapse, filter values, editor target selection, popovers, and mock reorder actions.
- Keep `theme.css` free of window-chrome assumptions (no `overflow: hidden`, transparent body background, minimum window width, or desktop `user-select` policy) since it's consumed outside Electron too.
- Desktop `styles.css` sets `user-select: none` on `body` so top-chrome drag does not start text selection. Re-enable with native form controls, `[contenteditable]`, or the `.user-select-text` class (e.g. Markdown preview body).
- Keep design decisions synchronized with [../../../design.md](../../../design.md).
- Source files in this package have AI file headers. Keep them high-level and avoid duplicating implementation details.
