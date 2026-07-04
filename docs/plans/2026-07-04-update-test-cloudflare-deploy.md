# Update Test And Cloudflare Deploy

## Update Test Matrix

1. Dev fallback
   - Run `pnpm dev`.
   - Open Settings -> General -> Software Update.
   - Click check updates.
   - Expected: the app reports already latest. Dev/local installs must not throw
     missing `app-update.yml` errors.

2. Build readiness
   - Run `pnpm ffmpeg:prepare`.
   - Run `pnpm indexer:build`.
   - Run `pnpm -F desktop build`.
   - Run `pnpm -F desktop check-types`.
   - Expected: all commands pass.

3. Release dry run
   - Add the next release note as the first entry in
     `apps/website/app/components/releases/release-timeline.tsx`.
   - Move `badge: "latest"` to that entry.
   - Run
     `node scripts/release.mjs <version> --dry-run --no-checks --no-wait --no-publish`.
   - Expected: release note validation and planned git/tag actions succeed.

4. GitHub release artifact check
   - Push a `v<version>` tag from `main`.
   - Wait for the Release workflow.
   - Expected: GitHub Release contains the Mac arm64 dmg, zip, update metadata,
     and blockmap files.

5. End-to-end update
   - Install an older Post.app.
   - Publish a newer GitHub Release as latest.
   - Launch the older app.
   - Expected: launch check or Settings check finds the new version, clicking
     update downloads it, and Post restarts into the newer version without
     losing user data.

## Cloudflare Pages Deploy

Project settings:

- Project name: `posttt`
- Production URL: `https://posttt.pages.dev`
- Git provider: GitHub
- Repository: `BarrySong97/post`
- Production branch: `main`
- Framework preset: Next.js static export
- Build command: `pnpm -F website build`
- Build output directory: `apps/website/out`
- Environment variable: `NODE_VERSION=22`

The website is configured for static export through
`apps/website/next.config.ts`. `next/image` optimization is disabled so the
exported `out` directory can be served directly by Cloudflare Pages.

Verification:

- Run `pnpm -F website build`.
- Confirm `apps/website/out/index.html` and `apps/website/out/releases.html`
  exist.
- After Cloudflare deploys, open `https://posttt.pages.dev` and
  `https://posttt.pages.dev/releases`.
- Confirm the Download links point at
  `https://github.com/BarrySong97/post/releases/latest`.
