# X Post Capture Fidelity

## Summary

Capture complete X long-form text and the author's profile-image URL, persist normalized attribution metadata in Markdown and `post_cache`, and render the avatar in the asset-card attribution header with the existing initial avatar as the fallback.

## Key Changes

- Add `authorAvatarUrl` to the extension snapshot and normalized resolver output, preferring public X metadata and falling back to the selected Post DOM.
- Expand semantic "Show more" controls before taking the visible DOM snapshot, track whether text remains truncated, and prefer complete Note/extended fields over collapsed provider text.
- When syndication exposes only a Note result ID, resolve that exact Note from the canonical page's server-rendered records; keep a partial-capture warning when no complete source is available.
- Add nullable `post_cache.author_avatar_url`, generate the Drizzle migration, and write `author_avatar_url` into owned Markdown frontmatter.
- Return the URL through asset hydration, map it into the renderer asset model, and display a remote round image with the current deterministic initial when missing or failed.

## Test Plan

- Cover long-form provider/DOM/server-rendered fallbacks, resolver metadata, Markdown/frontmatter persistence, renderer mapping, and avatar fallback behavior where practical.
- Run `pnpm db:generate`, focused tests, `pnpm test`, `pnpm lint`, `pnpm check-types`, extension build, and `node scripts/check-docs.mjs`.

## Assumptions

- Store only the HTTPS profile-image URL; do not download or cache the avatar in the Vault.
- Existing Posts receive the URL when re-saved; no network backfill migration is performed.
