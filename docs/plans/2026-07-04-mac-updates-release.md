# Mac Updates And Release

## Summary

Post ships Mac updates through GitHub Releases. The packaged desktop app checks
for updates on launch, lets the user start the download from Settings or a
toast, then restarts to install after the update is downloaded.

## Implementation

- Add `electron-updater` to the desktop app and configure
  `electron-builder.yml` to publish draft GitHub releases for `BarrySong97/post`.
- Build Mac `dmg` and `zip` artifacts for arm64. The zip is required by the
  macOS update feed; the dmg is the manual download artifact.
- Keep update logic in the main process, expose only `window.api.updater` from
  preload, and keep renderer code limited to status display and user intent.
- Add a website `/releases` page, release data, and download links pointing to
  the latest GitHub Release.
- Add a Mac-only GitHub Actions release workflow and a local release helper.

## Verification

- `pnpm -F desktop check-types`
- `pnpm -F website check-types`
- `pnpm -F website build`
- `pnpm ffmpeg:prepare`
- `pnpm indexer:build`
- `pnpm -F desktop build`
- `node scripts/check-docs.mjs`

## Assumptions

- Only Mac arm64 is in scope for this release path.
- Windows and Linux packaging remain configured but are not part of the release
  workflow or update validation.
