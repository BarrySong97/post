# Markdown note card: multi-paragraph excerpt + embedded images + video duration

## Goal

1. Note-card excerpts accumulate across paragraphs (blank lines are boundaries, not stoppers).
2. Vault-resolved markdown images / embeds appear on note cards (thumb strip by default; cover when image-primary).
3. Local video cards show a real duration badge (ffprobe → `image_cache.video_duration_ms`).

## Decisions

- **B + C adaptive**: default 44px thumb strip (max 3 + `+N`); cover when the note has images and body text is &lt; 80 chars.
- Review fixtures: real vault files tagged `卡片评审` (no SEED_TEST_ASSETS).
- Do not touch in-progress drag-drop import working-tree changes.

## Steps

See Claude plan `vivid-wobbling-pudding.md` for file-level detail. Summary:

1. Apply excerpt fix (`make_excerpt`, clamp-6, PARSER_VERSION 0.3.0).
2. Add `video_duration_ms`, probe via ffprobe during video thumbnail generation, map to `asset.duration`.
3. `attachRelations` batch-loads `noteImages` from `asset_links` + ready `image_cache`.
4. View-model + card UI for cover / strip; height estimate 170→190.
5. Docs + vault review fixtures after verification.

## Verification

- `pnpm indexer:test`, `pnpm check-types`, `pnpm db:migrate`, `node scripts/check-docs.mjs`
- Manual: filter tag `卡片评审`, check all card archetypes; edit a note and confirm watch refresh
- No commit until Barry accepts
