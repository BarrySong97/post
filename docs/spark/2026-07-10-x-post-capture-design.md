# X Post Capture Design

Date: 2026-07-10

## Summary

Post will extend the browser extension from image and video collection to saving an X/Twitter post as a first-class Vault asset. The saved Post is a Markdown file that remains readable and portable outside the application. Directly attached images and videos are downloaded as separate local assets, linked to the Post, and assigned the same selected tag.

The browser extension starts the workflow from the context menu on an X post. It identifies the selected post, lets the user choose a tag, and sends the post identity plus a visible-page fallback snapshot through Native Messaging. Post Desktop resolves the full post metadata, downloads direct media, writes the Markdown file, and updates SQLite indexes and relationships.

## Goals

- Add an `Add post to Post` context-menu workflow on `x.com` and `twitter.com`.
- Let the user select an active-Vault tag before saving.
- Save each post as a durable, human-readable Markdown file inside the active Vault.
- Preserve the post text, author, publication time, source URL, capture time, and supported structured content.
- Download directly attached images and videos as local child assets.
- Represent reply, quote, repost, poll, and link-card context without importing an entire conversation.
- Make repeated saves idempotent by X post ID.
- Keep useful text even when metadata or media resolution partially fails.
- Keep SQLite as the application index and cache rather than the only copy of post content.

## Non-Goals

- Saving an entire thread or conversation in the first version.
- Archiving replies, likes, bookmarks, view counts, or other live engagement history.
- Automatically downloading media attached only to a quoted post.
- Scraping the complete content of an external article linked by a post.
- Guaranteeing capture of protected, deleted, region-restricted, or authentication-gated posts that are not available to the resolver or visible-page fallback.
- Reproducing X's visual layout as HTML or a screenshot.
- Adding a general-purpose social network import framework in the first implementation.

## Product Workflow

On an X post page or timeline item, the browser context menu contains:

```text
Add post to Post
  <tag name 1>
  <tag name 2>
  ...
```

The extension asks Desktop for the active Vault and its tags when building the submenu, matching the existing image and video workflows. Selecting a tag starts one logical import task. Desktop reports progress through the existing background-task UI, including metadata resolution, media download, and final indexing, without exposing internal media subtasks as duplicate top-level tasks.

The command applies to the post under the pointer when the content script can identify one. On a post detail page, it falls back to the page's primary post. If neither can be identified, the extension shows a specific failure instead of saving an unrelated post.

## Recommended Architecture

Use one Markdown main asset with local media child assets.

```text
X page
  -> Extension content script
  -> Extension background worker
  -> Chrome Native Messaging host
  -> Desktop local IPC
  -> X post resolver
  -> Post import service
       -> Markdown file
       -> direct image/video files
       -> SQLite asset, tag, cache, and relationship rows
  -> Vault change notification and UI invalidation
```

This design preserves the local-first Vault contract while allowing Desktop to query and render structured post fields efficiently. A JSON-plus-generated-Markdown design would create two competing sources of truth. A SQLite-only design would make captured content less portable and less recoverable outside Post.

### Extension Content Script

The content script records the post associated with the context-menu event and returns a capture request containing:

```ts
type XPostCaptureContext = {
  platform: "x";
  postId: string;
  canonicalUrl: string;
  pageUrl: string;
  visibleSnapshot?: {
    authorName?: string;
    authorHandle?: string;
    text?: string;
    publishedAt?: string;
    language?: string;
    mediaUrls?: string[];
    quotedPostUrl?: string;
    replyToPostUrl?: string;
  };
};
```

The visible snapshot is a fallback, not the preferred canonical source. It should contain only fields already present in the selected post DOM and must not depend on unstable CSS class names when semantic attributes or post links are available.

### Native Message And Local IPC

Add a Native Messaging request for saving a post and a matching Desktop local IPC command. The concrete message names should follow the existing naming convention, for example:

```text
Native request: post.post.save
Local IPC:      extension.post.save
```

The request includes the active tag ID and `XPostCaptureContext`. The response returns the main Post asset ID, imported child asset IDs, warnings, and whether the operation created or updated an existing Post.

### Metadata Resolution

Desktop resolves metadata in this order:

1. Resolve public X embed/post metadata using the canonical post ID.
2. Merge fields that are missing from the resolver with the extension's visible snapshot.
3. Preserve the canonical URL and post ID even when only partial text metadata is available.
4. Fail before writing files only when the post cannot be identified or no meaningful content can be captured.

The resolver normalizes provider-specific responses into an internal `ResolvedXPost` model. The import service must not persist raw provider response shapes as its domain contract.

## Vault Layout

The default paths are:

```text
assets/web-clips/posts/YYYY-MM-DD-<handle>-<post-id>.md
assets/web-clips/media/<post-id>-<ordinal>.<extension>
```

The importer sanitizes the handle and file name, uses the publication date when available, and falls back to the capture date. The post ID is always part of the main file name, making collisions unlikely and manual inspection practical.

The database identity key is `(vault_id, platform, external_post_id)`, not the file path. A later rename or move detected by the indexer must not create another logical Post.

## Markdown Format

The Markdown file is the durable representation of the captured Post. Application-owned metadata lives in frontmatter, generated content lives inside explicit markers, and a user-owned notes section is preserved across repeated saves.

```markdown
---
type: x-post
platform: x
post_id: "2075123908790165888"
source_url: "https://x.com/example/status/2075123908790165888"
author_name: "Example"
author_handle: "example"
published_at: "2026-07-10T10:20:30Z"
captured_at: "2026-07-10T10:25:00Z"
language: en
reply_to_post_id: null
reply_to_url: null
quoted_post_id: null
quoted_post_url: null
reposted_by_handle: null
capture_status: complete
---

<!-- post:generated:start -->
Post text appears here.

![[../media/2075123908790165888-1.jpg]]
<!-- post:generated:end -->

## Notes

```

On repeated capture, Desktop may update application-owned frontmatter fields and the generated block. It must preserve content outside the generated block, especially `## Notes`. Unknown user-added frontmatter keys must also be retained unless they conflict with application-owned keys.

`capture_status` is `complete` or `partial`. A partial capture includes a warnings section in the generated block with unresolved remote media URLs or unavailable metadata, so the Vault file remains useful without opening SQLite.

## Supported Post Shapes

### Ordinary Post

Save the complete resolved text, author identity, publication time, language when available, source URL, and capture time.

### Image Or Video Post

Download every directly attached image or video that the resolver can identify. Each file becomes its own image or video asset. The Markdown embeds or links the local media in source order.

All successfully imported direct media assets inherit the tag selected for the Post. A media failure does not discard the Post text or other successful media.

### Quote Post

Save a static snapshot of the quoted post inside the generated Markdown block, including quoted author, text, and source URL when available. Record the quoted post ID and URL in structured metadata. Do not create a second Post asset or automatically download quoted media in the first version.

### Reply

Save only the selected reply. Record its parent post ID and URL when available. Do not recursively fetch the parent or the surrounding conversation.

### Repost

Treat the original post as the canonical saved content and identity. Record the reposting account when that context is available. Repeated saves of the original post and its repost must converge on one Post asset.

### Long Post Or Note

Save the full resolved text when the metadata source provides it. If only the visible portion is available, save that portion with a partial-capture warning rather than inventing or truncating content silently.

### Poll

Save a static snapshot of poll options, available counts or percentages, end time, and whether the poll was open at capture time. The snapshot is historical content and is not refreshed automatically.

### Link Card

Save the target URL and available card title and description. Do not fetch and archive the destination article in the first version.

## Data Model

The implementation should add `post` to the shared asset-kind contract and database schema. The Post Markdown file is represented by the normal `assets` and `asset_files` rows.

Add a structured post cache keyed by the main asset ID. The exact table name may follow repository conventions; `post_cache` is used here for clarity.

```text
asset_id text primary key references assets(id)
vault_id text not null references vaults(id)
platform text not null
external_post_id text not null
canonical_url text not null
author_name text
author_handle text
published_at integer timestamp_ms
captured_at integer timestamp_ms not null
language text
reply_to_external_id text
reply_to_url text
quoted_external_id text
quoted_url text
reposted_by_handle text
capture_status text not null
schema_version integer not null
```

Recommended uniqueness:

```text
unique(platform, external_post_id, vault_id)
```

Use `asset_tags` for both the main Post and imported direct media. Use `asset_links` for Post relationships, adding compatible relation values through the normal schema migration process:

```text
post_media
reply_to
quoted_post
external_url
```

`post_media` points from the Post asset to a local child asset. `reply_to` and `quoted_post` may remain unresolved external references unless the related Post already exists in the Vault. Existing relation rows are reconciled on repeated capture instead of appended blindly.

All schema changes start in `packages/db/src/schema.ts`, use a generated Drizzle migration, and preserve WAL and foreign-key behavior through the existing database connection layer.

## Import Transaction And File Safety

The import service owns one logical operation per selected Post:

1. Validate the active Vault, selected tag, canonical post ID, and destination paths.
2. Resolve and normalize post metadata.
3. Download direct media into temporary files and validate each file using the existing image/video import rules.
4. Build the Markdown content while preserving user-owned sections from an existing file.
5. Atomically replace the Markdown and successful media files at their final Vault paths.
6. In one database transaction, upsert the Post asset, file row, post cache, tag binding, media assets, and relationships.
7. Queue thumbnails only for newly written or changed media.
8. Publish one Vault/UI invalidation and complete one visible import task.

Temporary files are removed after success or failure. A database failure after file writes must trigger reconciliation on the affected paths so the indexer can recover them. The service must never create duplicate database rows merely because the watcher observes its own file writes.

## Idempotency And Updates

Repeated capture of the same `(vault_id, platform, external_post_id)` updates the existing Post asset:

- Reuse the main asset ID and current tracked file path.
- Refresh resolver-owned metadata and generated Markdown content.
- Preserve user notes and unknown user frontmatter keys.
- Reuse unchanged media by stable source identity or content hash.
- Add newly discovered direct media and reconcile obsolete generated relationships.
- Ensure the selected tag is bound to the main Post and all direct media without creating duplicate bindings.
- Return `updated` rather than creating a second visible Post card.

The import service and extension background worker both suppress concurrent duplicate requests. The database uniqueness rule remains the final guard against races.

## Failure Behavior

- **Desktop unavailable:** keep the existing Native Messaging unavailable error and do not claim the Post was saved.
- **No active Vault:** return an actionable `No active vault` error before resolution or download.
- **Unknown tag:** reject the request; do not silently import an untagged Post when a tag was selected.
- **Post not identifiable:** reject the request and keep the context menu associated with the current page only.
- **Metadata unavailable but visible text exists:** save a partial Post from the visible snapshot.
- **Some media fail:** save the Post and successful media, set `capture_status: partial`, and record failed remote URLs in Markdown warnings and the response.
- **All media fail but text exists:** save the text-only partial Post.
- **File collision with an unrelated user file:** choose a deterministic alternate path and record it; never overwrite an unrelated file.
- **Database transaction fails:** report failure and schedule path reconciliation; do not emit a successful completion event.

The response shape should distinguish hard failure from partial success so the extension can show accurate feedback.

## Desktop Presentation

`post` assets use the existing text-asset card pattern: compact title, text excerpt, and first tag. The title should prefer a concise first line of post text and fall back to `@handle on X`. The card opens the normal asset detail route and resolves the Markdown through the existing file protocol.

Direct media remain independently browsable image/video assets because they are real Vault files. Their relationship to the parent Post is available for a future related-assets view, but that view is not required for the first capture release.

## Verification

### Unit Tests

- Normalize ordinary, media, quote, reply, repost, poll, link-card, and long-post resolver fixtures.
- Merge resolver data with visible snapshot fallbacks without replacing stronger canonical fields.
- Generate Markdown and preserve user notes and unknown frontmatter across updates.
- Produce deterministic safe paths and handle unrelated file collisions.
- Reconcile media and relationship rows idempotently.
- Return partial success when one or all media downloads fail but text is available.
- Reject invalid Vault, tag, and post identity inputs before file writes.

### Integration Tests

- Send `extension.post.save` through local IPC and create one Post asset plus direct media children.
- Save the same post twice and verify one main asset, stable asset IDs, no duplicate tag bindings, and no duplicate visible tasks.
- Verify watcher events caused by import do not duplicate assets or thumbnail work.
- Verify a database failure leaves recoverable files and no partial relationship transaction.
- Verify direct videos retain audio by using the existing complete-media resolver and ffmpeg validation path.

### Extension Tests

- Resolve the post under the context-menu pointer on a timeline.
- Fall back to the primary post on a status detail page.
- Do not offer or execute a save for an unidentified unrelated page region.
- Forward tag selection and visible snapshot fields through Native Messaging.
- Suppress concurrent duplicate saves for the same post and tag.

### Manual Acceptance Cases

- Save one ordinary post, one image post, one video post with audio, one quote post, one reply, one repost, one poll, and one link-card post.
- Confirm the Markdown and media are usable directly from Finder without Post running.
- Confirm one visible import task accurately reports progress.
- Confirm the Post card appears without restarting Desktop.
- Edit the Notes section, save the same Post again, and confirm the notes remain unchanged.
- Disconnect Desktop and confirm the extension reports unavailability without creating files.

## Rollout Boundary

The first release is complete when a user can right-click a single identifiable X post, choose a tag, and receive one idempotent Markdown Post asset plus all successfully resolved direct media in the active Vault. Thread capture, quoted-media download, live metric refresh, and richer related-asset UI remain separate follow-up features.
