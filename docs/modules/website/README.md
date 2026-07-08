# Website App

## Responsibility

`apps/website` is the standalone web surface for Post, built with Next.js (App Router), React 19, Tailwind CSS v4, and HeroUI (`@heroui/react` v3). It hosts the public/marketing landing page, separate from the Electron [desktop](../desktop/README.md) app. The current page reproduces a reference landing layout (nav, hero, interactive product preview, how-it-works, FAQ, footer). Text uses the self-hosted Geist font (`geist` package, applied in `layout.tsx`). The nav shows the app icon (`public/post-icon.png`, copied from the desktop icons) plus the name "Post"; product preview data comes from [mock-data](../mock-data/README.md), while the preview UI comes from [ui](../ui/README.md).

Canvas colors come from the shared [ui](../ui/README.md) package (`@post/ui/theme.css`), which defines the same `--background`/`--foreground`/`--surface` tokens the desktop app uses — HeroUI's component theme (accent, default, etc.) is left at its defaults, so HeroUI `Button`/`Link` render with their native styling.

## File Map

- `apps/website/app/layout.tsx` - App Router root layout and metadata.
- `apps/website/app/robots.ts` - static `robots.txt` metadata route.
- `apps/website/app/sitemap.ts` - static `sitemap.xml` metadata route.
- `apps/website/app/page.tsx` - index route (Server Component).
- `apps/website/app/components/ui.tsx` - `"use client"` re-export of HeroUI primitives, so `page.tsx` can stay a Server Component.
- `apps/website/app/components/site-header.tsx` - landing-page brand header and top navigation; the header download link uses the same HeroUI primary button styling as the hero CTA at the compact header size.
- `apps/website/app/components/hero-section.tsx` - compact hero copy and primary CTA.
- `apps/website/app/components/product-preview.tsx` - client-side interactive Post desktop preview composition; owns demo-only history, sidebar resize/collapse, filter values, editor target selection, footer popovers, and mock sidebar reorder state.
- `apps/website/app/components/how-it-works-section.tsx` - Post desktop workflow steps.
- `apps/website/app/components/faq-section.tsx` - Post FAQ copy.
- `apps/website/app/components/closing-cta.tsx` - final landing-page CTA.
- `apps/website/app/components/site-footer.tsx` - footer navigation groups and copyright.
- `apps/website/app/releases/page.tsx` - public changelog and latest Mac download route.
- `apps/website/app/components/releases/release-timeline.tsx` - release note data rendered by the changelog and validated before release.
- `apps/website/app/lib/seo.ts` - shared site, GitHub, release, and download URLs.
- `apps/website/app/globals.css` - imports `@post/ui/theme.css`; no locally-defined color tokens.
- `apps/website/public/post-icon.png`, `favicon.ico`, and `apple-touch-icon.png` - website icon assets copied from the desktop icon set.
- `apps/website/public/og-image.png` - Open Graph/Twitter share image generated from the landing hero background and real desktop preview mock.
- `apps/website/public/product-preview/` - generated bitmap thumbnails used by the product preview mock data.
- `apps/website/next.config.ts` - Next.js build configuration, including monorepo tracing root and workspace package transpilation.
- `apps/website/postcss.config.mjs` - Tailwind v4 PostCSS wiring.
- `apps/website/tsconfig.json` - extends `@post/config/tsconfig.base.json` with Next.js-specific options.

## Public Interfaces

- Development command from the repo root: `pnpm dev:website` (runs `pnpm -F website dev`).
- Workspace commands: `pnpm -F website dev | build | start | check-types`.
- Public download URL: `https://github.com/BarrySong97/post/releases/latest`.
- Changelog route: `/releases`.
- Cloudflare Pages production URL: `https://topostt.pages.dev`.
- Cloudflare Pages build command: `pnpm -F website build`.
- Cloudflare Pages build output directory: `apps/website/out`.

## Notes

- Shared library versions (`next`, `react`, `@heroui/react`, `@heroui/styles`, `tailwindcss`, `@tailwindcss/postcss`, `typescript`, `@types/*`) are pinned in the root `pnpm-workspace.yaml` catalog and referenced here as `catalog:`; app-specific package versions stay local to `apps/website/package.json`.
- Colors, the base Tailwind/HeroUI setup, and product preview presentation components come from `@post/ui`; deterministic demo data comes from `@post/mock-data`.
- The product preview owns only demo state: sidebar selection/order, sidebar resize/collapse, repeated asset-fill behavior for filtered boards, asset detail navigation, settings navigation, filter/open menus, footer popovers, and knowledge-graph node selection.
- The product preview must not call Electron, tRPC, localStorage, filesystem APIs, or browser route navigation. Back/forward inside the preview use an in-component history stack.
- TypeScript strictness is shared via `@post/config/tsconfig.base.json` (workspace devDependency `@post/config`); only Next.js-required options (`jsx`, `plugins`, `paths`, etc.) are overridden locally.
- Next transpiles `@post/ui` and `@post/mock-data` explicitly so the website can consume workspace source exports during local dev and builds.
- Next uses static export for Cloudflare Pages; `next/image` optimization is disabled so the exported `out` directory is self-contained.
- Tailwind v4 loads through the `@tailwindcss/postcss` plugin; there is no `tailwind.config` file.
- HeroUI's barrel imports `client-only`, so it cannot be imported from a Server Component. `app/components/ui.tsx` is a `"use client"` module that re-exports the HeroUI primitives; `app/page.tsx` stays a Server Component and imports them from there. No `HeroUIProvider` is required (matching the desktop renderer).
- Before running `pnpm release <version>`, add a new first entry to `ReleaseTimeline`, move `badge: "latest"` to that entry, and keep the version in sync with the desktop package version.
- `next-env.d.ts` is generated by Next.js, git-ignored, and excluded from the docs harness.
- Keep source file headers (`@purpose`/`@role`/`@deps`/`@gotcha`) current as content is added.
