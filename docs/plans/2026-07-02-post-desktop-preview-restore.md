# Post Desktop Preview 1:1 Restore

## Goal

Restore the website product preview so it faithfully mirrors the current Desktop UI while keeping
the website demo-only. Desktop remains the source of truth for visual structure and interaction
patterns; `@post/ui` receives pure display components and `@post/mock-data` receives deterministic
demo data.

## Source Components To Mirror

- Shell: `apps/desktop/src/renderer/src/components/layout/app-layout.tsx`, including
  `ResizablePanelGroup`, pixel min/max sidebar sizing, collapse animation gate, edge hotspot,
  floating sidebar preview, and `WindowChromeNav` clearance.
- Sidebar: `components/layout/sidebar/sidebar.tsx`, including section chrome, scroll area,
  Views/Tags hover actions, HeroUI dropdown menus, count fade, move-first/edit/delete actions, and
  mock reorder behavior.
- Asset board: `pages/asset-manager/asset-manager-page.tsx`, including `AssetBoardHeader`, editor
  split menu, hidden Terminal toggle, active filter summary, true virtual masonry lanes, and card
  visuals.
- Filters: `components/asset-manager/asset-filter-controls.tsx`, including HeroUI
  `AccordionPanel`, `Tabs`, `TagGroup`, and action buttons.
- Detail: `pages/asset-manager/asset-manager-page.tsx` asset detail header and body presentation,
  adapted to preview history callbacks instead of router/file actions.
- Knowledge graph: `pages/graph/knowledge-graph-page.tsx`, using `react-force-graph-2d` with mock
  nodes and edges.
- Settings: `pages/settings/settings-page.tsx`, including sidebar width, chrome-safe back button,
  search, nav, and HeroUI setting controls.
- Footer: `components/layout/app-shell.tsx` status line CSS and HeroUI popovers.

## Implementation Rules

- `@post/ui` components must not import Electron APIs, tRPC, TanStack Router, Jotai, localStorage,
  database code, or filesystem code.
- Website owns demo state only: screen/history, active sidebar item, sidebar width/collapse/preview,
  reorder state, filter values, open-target menu, footer popovers, and mock navigation.
- Existing Desktop class names, spacing, font sizes, colors, icon sizes, and z-index layers should be
  copied first, then simplified only where a runtime dependency is being removed.
- Mock data must use Desktop-compatible filter/status/sort values so copied UI can be reused without
  translation hacks.

## Acceptance Checks

- Default board aligns with Desktop: traffic lights, toolbar, sidebar width, header, masonry cards,
  filter button, editor split menu, and footer.
- Sidebar resize works through `react-resizable-panels`, clamps to 320px minimum, and collapse never
  lets the page header overlap traffic lights or toolbar controls.
- Views/Tags hover state matches Desktop: counts fade out, up/down/more actions fade in, and more
  opens the HeroUI dropdown.
- Filter panel matches Desktop structure and HeroUI primitives; Terminal button stays hidden.
- Asset board uses fixed-width lane masonry rather than CSS columns.
- Knowledge graph uses the same canvas graph component style and node click behavior.
- Settings and footer use Desktop layout and popovers.
- Narrow preview widths keep text and controls readable without overlapping.

## Verification

- `pnpm -F @post/ui check-types`
- `pnpm -F @post/mock-data check-types`
- `apps/website/node_modules/.bin/tsc --noEmit -p apps/website/tsconfig.json`
- `node scripts/check-docs.mjs`
- Browser QA at `http://localhost:3001/` against the running Desktop dev app.
