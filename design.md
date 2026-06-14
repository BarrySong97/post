# Post Design System

Post is a desktop productivity tool, so the interface should feel quiet, dense, and efficient. The default surface is the usable app, not a landing page.

## Stack

- React 19 with TanStack Router.
- HeroUI components plus local primitives under `apps/desktop/src/renderer/src/components/ui/`.
- Tailwind CSS v4 with colors flowing through shared styles in `packages/ui`.
- Lucide icons for common actions.

## Layout

- Prefer structured panels, split panes, sidebars, inspectors, tables, grids, and toolbars.
- Keep repeated content in compact cards or rows; do not nest cards inside cards.
- Use stable dimensions for boards, toolbars, icon buttons, counters, tiles, and media previews so hover or loading states do not shift layout.
- Page sections should be unframed layouts or full-width bands, not floating decorative sections.

## Typography

- Use compact headings inside app panels. Reserve large display type for true first-run or marketing surfaces.
- Do not scale font size with viewport width.
- Letter spacing should remain `0` unless an existing component already sets otherwise.

## Icons

- Main navigation and toolbar icons use `14px`.
- Small action icons, including close/delete/edit controls, use `13px`.
- In the asset manager header, keep the filter icon, filter chevron, third-party opener icon, third-party opener chevron, and terminal opener icon aligned to the same `14px` icon box.
- Prefer Lucide icons in icon buttons, with tooltips for ambiguous actions.

## States

- Every async surface needs loading, empty, error, and success states when relevant.
- Destructive actions should use the shared confirmation pattern.
- Toasts should be short and action-oriented.

## Accessibility

- Preserve keyboard reachability for navigation, filters, dialogs, and inspectors.
- Keep focus states visible.
- Use semantic labels for icon-only buttons and form controls.
