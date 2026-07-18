/**
 * @purpose Define the SQLite data model, enum contracts, indexes, and table relationships for Post.
 * @role    Shared schema contract consumed by Electron repositories and the Rust indexer.
 * @deps    drizzle-orm/sqlite-core; migrations in packages/db/drizzle.
 * @gotcha  After schema edits run pnpm db:generate and keep string unions compatible with UI/indexer code.
 */

import {
  index,
  integer,
  primaryKey,
  real,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

export const assetKinds = [
  "markdown",
  "post",
  "image",
  "video",
  "youtube",
  "audio",
  "pdf",
  "document",
  "spreadsheet",
  "archive",
  "web",
  "other",
] as const;
export type AssetKind = (typeof assetKinds)[number];

export const assetStatuses = ["inbox", "organized", "draft", "published", "archived"] as const;
export type AssetStatus = (typeof assetStatuses)[number];

export const assetPrivacies = ["normal", "private"] as const;
export type AssetPrivacy = (typeof assetPrivacies)[number];

export const vaultSyncStatuses = ["idle", "syncing", "failed"] as const;
export type VaultSyncStatus = (typeof vaultSyncStatuses)[number];

export const assetLinkRelationTypes = [
  "wiki_link",
  "embed",
  "markdown_link",
  "markdown_image",
  "external_url",
  "post_media",
  "reply_to",
  "quoted_post",
] as const;
export type AssetLinkRelationType = (typeof assetLinkRelationTypes)[number];

export const assetLinkResolvedStatuses = ["resolved", "unresolved", "ambiguous"] as const;
export type AssetLinkResolvedStatus = (typeof assetLinkResolvedStatuses)[number];

export const assetLinkCreatedFromValues = ["markdown_parse", "manual"] as const;
export type AssetLinkCreatedFrom = (typeof assetLinkCreatedFromValues)[number];

export const markdownParseStatuses = ["pending", "parsed", "failed"] as const;
export type MarkdownParseStatus = (typeof markdownParseStatuses)[number];

export const postCaptureStatuses = ["complete", "partial"] as const;
export type PostCaptureStatus = (typeof postCaptureStatuses)[number];

export const bookmarkCaptureStatuses = ["complete", "partial"] as const;
export type BookmarkCaptureStatus = (typeof bookmarkCaptureStatuses)[number];

export const youtubeLiveStatuses = ["live", "ended", "none", "unknown"] as const;
export type YouTubeLiveStatus = (typeof youtubeLiveStatuses)[number];

export const imageCacheStatuses = ["pending", "ready", "failed"] as const;
export type ImageCacheStatus = (typeof imageCacheStatuses)[number];

export const syncRunReasons = ["initial_import", "app_start", "watcher_event", "manual"] as const;
export type SyncRunReason = (typeof syncRunReasons)[number];

export const syncRunStatuses = ["running", "completed", "failed", "cancelled"] as const;
export type SyncRunStatus = (typeof syncRunStatuses)[number];

export const syncRunOwners = ["electron_main", "rust_indexer"] as const;
export type SyncRunOwner = (typeof syncRunOwners)[number];

export const syncEventTypes = [
  "added",
  "updated",
  "moved",
  "missing",
  "restored",
  "conflict",
  "deleted",
] as const;
export type SyncEventType = (typeof syncEventTypes)[number];

export const savedViewKinds = ["manual", "smart"] as const;
export type SavedViewKind = (typeof savedViewKinds)[number];

export const notes = sqliteTable("notes", {
  id: text("id").primaryKey(),
  title: text("title").notNull(),
  content: text("content").notNull(),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
});

export const vaults = sqliteTable(
  "vaults",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    rootPath: text("root_path").notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
    lastOpenedAt: integer("last_opened_at", { mode: "timestamp_ms" }),
    lastSyncStartedAt: integer("last_sync_started_at", { mode: "timestamp_ms" }),
    lastSyncCompletedAt: integer("last_sync_completed_at", { mode: "timestamp_ms" }),
    syncStatus: text("sync_status").$type<VaultSyncStatus>().notNull().default("idle"),
  },
  (table) => [uniqueIndex("vaults_root_path_unique").on(table.rootPath)],
);

export const assets = sqliteTable(
  "assets",
  {
    id: text("id").primaryKey(),
    vaultId: text("vault_id")
      .notNull()
      .references(() => vaults.id, { onDelete: "cascade" }),
    kind: text("kind").$type<AssetKind>().notNull(),
    status: text("status").$type<AssetStatus>().notNull().default("inbox"),
    privacy: text("privacy").$type<AssetPrivacy>().notNull().default("normal"),
    title: text("title").notNull(),
    description: text("description"),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
    indexedAt: integer("indexed_at", { mode: "timestamp_ms" }),
    deletedAt: integer("deleted_at", { mode: "timestamp_ms" }),
  },
  (table) => [
    index("assets_vault_id_idx").on(table.vaultId),
    index("assets_vault_kind_idx").on(table.vaultId, table.kind),
    index("assets_vault_status_idx").on(table.vaultId, table.status),
  ],
);

export const assetFiles = sqliteTable(
  "asset_files",
  {
    id: text("id").primaryKey(),
    assetId: text("asset_id")
      .notNull()
      .references(() => assets.id, { onDelete: "cascade" }),
    vaultId: text("vault_id")
      .notNull()
      .references(() => vaults.id, { onDelete: "cascade" }),
    relativePath: text("relative_path").notNull(),
    fileName: text("file_name").notNull(),
    extension: text("extension"),
    mimeType: text("mime_type"),
    sizeBytes: integer("size_bytes").notNull(),
    mtimeMs: integer("mtime_ms", { mode: "timestamp_ms" }).notNull(),
    ctimeMs: integer("ctime_ms", { mode: "timestamp_ms" }),
    contentHash: text("content_hash"),
    quickFingerprint: text("quick_fingerprint"),
    fileExists: integer("file_exists", { mode: "boolean" }).notNull().default(true),
    missingSince: integer("missing_since", { mode: "timestamp_ms" }),
    firstSeenAt: integer("first_seen_at", { mode: "timestamp_ms" }).notNull(),
    lastSeenAt: integer("last_seen_at", { mode: "timestamp_ms" }).notNull(),
  },
  (table) => [
    uniqueIndex("asset_files_vault_relative_path_unique").on(table.vaultId, table.relativePath),
    index("asset_files_asset_id_idx").on(table.assetId),
    index("asset_files_vault_quick_fingerprint_idx").on(table.vaultId, table.quickFingerprint),
    index("asset_files_vault_content_hash_idx").on(table.vaultId, table.contentHash),
    index("asset_files_vault_file_exists_idx").on(table.vaultId, table.fileExists),
    index("asset_files_vault_file_exists_mtime_asset_idx").on(
      table.vaultId,
      table.fileExists,
      table.mtimeMs,
      table.assetId,
    ),
    index("asset_files_vault_file_exists_ctime_asset_idx").on(
      table.vaultId,
      table.fileExists,
      table.ctimeMs,
      table.assetId,
    ),
  ],
);

export const imageCache = sqliteTable(
  "image_cache",
  {
    assetId: text("asset_id")
      .primaryKey()
      .references(() => assets.id, { onDelete: "cascade" }),
    vaultId: text("vault_id")
      .notNull()
      .references(() => vaults.id, { onDelete: "cascade" }),
    fileId: text("file_id").references(() => assetFiles.id, { onDelete: "cascade" }),
    width: integer("width"),
    height: integer("height"),
    thumbnailPath: text("thumbnail_path"),
    thumbnailWidth: integer("thumbnail_width"),
    thumbnailHeight: integer("thumbnail_height"),
    thumbnailSizeBytes: integer("thumbnail_size_bytes"),
    thumbnailFormat: text("thumbnail_format"),
    // Average luma (0-255) of the thumbnail's bottom strip, used to flip the card's
    // overlay text between dark-on-light and light-on-dark. Null for pre-existing
    // thumbnails until they regenerate.
    thumbnailLuma: integer("thumbnail_luma"),
    // Video duration in milliseconds from ffprobe during thumbnail generation.
    // Null for non-video assets, or when ffprobe is unavailable / fails.
    videoDurationMs: integer("video_duration_ms"),
    sourceSizeBytes: integer("source_size_bytes"),
    sourceMtimeMs: integer("source_mtime_ms", { mode: "timestamp_ms" }),
    sourceQuickFingerprint: text("source_quick_fingerprint"),
    status: text("status").$type<ImageCacheStatus>().notNull().default("pending"),
    errorMessage: text("error_message"),
    generatedAt: integer("generated_at", { mode: "timestamp_ms" }),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
  },
  (table) => [
    index("image_cache_vault_status_idx").on(table.vaultId, table.status),
    index("image_cache_file_id_idx").on(table.fileId),
  ],
);

export const tags = sqliteTable(
  "tags",
  {
    id: text("id").primaryKey(),
    vaultId: text("vault_id")
      .notNull()
      .references(() => vaults.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    color: text("color"),
    sortOrder: integer("sort_order").notNull().default(0),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
  },
  (table) => [
    uniqueIndex("tags_vault_name_unique").on(table.vaultId, table.name),
    index("tags_vault_sort_order_idx").on(table.vaultId, table.sortOrder),
  ],
);

export const assetTags = sqliteTable(
  "asset_tags",
  {
    assetId: text("asset_id")
      .notNull()
      .references(() => assets.id, { onDelete: "cascade" }),
    tagId: text("tag_id")
      .notNull()
      .references(() => tags.id, { onDelete: "cascade" }),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.assetId, table.tagId] }),
    index("asset_tags_tag_id_idx").on(table.tagId),
    index("asset_tags_tag_asset_idx").on(table.tagId, table.assetId),
  ],
);

export const savedViews = sqliteTable(
  "saved_views",
  {
    id: text("id").primaryKey(),
    vaultId: text("vault_id")
      .notNull()
      .references(() => vaults.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    kind: text("kind").$type<SavedViewKind>().notNull().default("manual"),
    icon: text("icon"),
    filterJson: text("filter_json").notNull().default("{}"),
    sortJson: text("sort_json").notNull().default("{}"),
    sortOrder: integer("sort_order").notNull().default(0),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
  },
  (table) => [
    uniqueIndex("saved_views_vault_name_unique").on(table.vaultId, table.name),
    index("saved_views_vault_sort_order_idx").on(table.vaultId, table.sortOrder),
  ],
);

export const assetLinks = sqliteTable(
  "asset_links",
  {
    id: text("id").primaryKey(),
    vaultId: text("vault_id")
      .notNull()
      .references(() => vaults.id, { onDelete: "cascade" }),
    sourceAssetId: text("source_asset_id")
      .notNull()
      .references(() => assets.id, { onDelete: "cascade" }),
    targetAssetId: text("target_asset_id").references(() => assets.id, { onDelete: "set null" }),
    targetRef: text("target_ref").notNull(),
    targetSubpath: text("target_subpath"),
    relationType: text("relation_type").$type<AssetLinkRelationType>().notNull(),
    targetKindHint: text("target_kind_hint").$type<AssetKind>(),
    resolvedStatus: text("resolved_status").$type<AssetLinkResolvedStatus>().notNull(),
    sourceSpanStart: integer("source_span_start"),
    sourceSpanEnd: integer("source_span_end"),
    createdFrom: text("created_from")
      .$type<AssetLinkCreatedFrom>()
      .notNull()
      .default("markdown_parse"),
    discoveredAt: integer("discovered_at", { mode: "timestamp_ms" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
  },
  (table) => [
    index("asset_links_vault_source_asset_idx").on(table.vaultId, table.sourceAssetId),
    index("asset_links_vault_target_asset_idx").on(table.vaultId, table.targetAssetId),
    index("asset_links_vault_resolved_status_idx").on(table.vaultId, table.resolvedStatus),
    index("asset_links_vault_relation_type_idx").on(table.vaultId, table.relationType),
  ],
);

export const markdownCache = sqliteTable(
  "markdown_cache",
  {
    assetId: text("asset_id")
      .primaryKey()
      .references(() => assets.id, { onDelete: "cascade" }),
    vaultId: text("vault_id")
      .notNull()
      .references(() => vaults.id, { onDelete: "cascade" }),
    title: text("title"),
    excerpt: text("excerpt"),
    wordCount: integer("word_count"),
    headingsJson: text("headings_json").notNull(),
    outboundLinkCount: integer("outbound_link_count").notNull().default(0),
    inboundLinkCount: integer("inbound_link_count").notNull().default(0),
    parseStatus: text("parse_status").$type<MarkdownParseStatus>().notNull().default("pending"),
    parsedAt: integer("parsed_at", { mode: "timestamp_ms" }),
    parserVersion: text("parser_version").notNull(),
  },
  (table) => [
    index("markdown_cache_vault_id_idx").on(table.vaultId),
    index("markdown_cache_vault_parse_status_idx").on(table.vaultId, table.parseStatus),
  ],
);

export const postCache = sqliteTable(
  "post_cache",
  {
    assetId: text("asset_id")
      .primaryKey()
      .references(() => assets.id, { onDelete: "cascade" }),
    vaultId: text("vault_id")
      .notNull()
      .references(() => vaults.id, { onDelete: "cascade" }),
    platform: text("platform").notNull(),
    externalPostId: text("external_post_id").notNull(),
    canonicalUrl: text("canonical_url").notNull(),
    text: text("text").notNull(),
    authorName: text("author_name"),
    authorHandle: text("author_handle"),
    authorAvatarUrl: text("author_avatar_url"),
    publishedAt: integer("published_at", { mode: "timestamp_ms" }),
    capturedAt: integer("captured_at", { mode: "timestamp_ms" }).notNull(),
    language: text("language"),
    replyToExternalId: text("reply_to_external_id"),
    replyToUrl: text("reply_to_url"),
    quotedExternalId: text("quoted_external_id"),
    quotedUrl: text("quoted_url"),
    repostedByHandle: text("reposted_by_handle"),
    captureStatus: text("capture_status").$type<PostCaptureStatus>().notNull(),
    mediaJson: text("media_json").notNull().default("[]"),
    quotedPostJson: text("quoted_post_json"),
    pollJson: text("poll_json"),
    linkCardJson: text("link_card_json"),
    warningsJson: text("warnings_json").notNull().default("[]"),
    schemaVersion: integer("schema_version").notNull().default(1),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
  },
  (table) => [
    uniqueIndex("post_cache_vault_platform_external_unique").on(
      table.vaultId,
      table.platform,
      table.externalPostId,
    ),
    index("post_cache_vault_captured_at_idx").on(table.vaultId, table.capturedAt),
    index("post_cache_author_handle_idx").on(table.authorHandle),
  ],
);

// Normalized fields for bookmarked web pages (kind === "web"). The OG cover image rides
// on the shared imageCache thumbnail; this table holds the page URL and display domain.
export const webCache = sqliteTable(
  "web_cache",
  {
    assetId: text("asset_id")
      .primaryKey()
      .references(() => assets.id, { onDelete: "cascade" }),
    vaultId: text("vault_id")
      .notNull()
      .references(() => vaults.id, { onDelete: "cascade" }),
    url: text("url").notNull(),
    domain: text("domain"),
    siteName: text("site_name"),
    sourceTitle: text("source_title"),
    titleOverride: text("title_override"),
    description: text("description"),
    thumbnailUrl: text("thumbnail_url"),
    language: text("language"),
    note: text("note"),
    copyIndex: integer("copy_index").notNull().default(0),
    captureStatus: text("capture_status")
      .$type<BookmarkCaptureStatus>()
      .notNull()
      .default("complete"),
    warningsJson: text("warnings_json").notNull().default("[]"),
    schemaVersion: integer("schema_version").notNull().default(1),
    capturedAt: integer("captured_at", { mode: "timestamp_ms" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
  },
  (table) => [
    uniqueIndex("web_cache_vault_url_copy_unique").on(table.vaultId, table.url, table.copyIndex),
    index("web_cache_vault_id_idx").on(table.vaultId),
  ],
);

export const youtubeCache = sqliteTable(
  "youtube_cache",
  {
    assetId: text("asset_id")
      .primaryKey()
      .references(() => assets.id, { onDelete: "cascade" }),
    vaultId: text("vault_id")
      .notNull()
      .references(() => vaults.id, { onDelete: "cascade" }),
    videoId: text("video_id").notNull(),
    canonicalUrl: text("canonical_url").notNull(),
    sourceTitle: text("source_title"),
    titleOverride: text("title_override"),
    description: text("description"),
    channelId: text("channel_id"),
    channelName: text("channel_name"),
    channelUrl: text("channel_url"),
    publishedAt: integer("published_at", { mode: "timestamp_ms" }),
    durationMs: integer("duration_ms"),
    thumbnailUrl: text("thumbnail_url"),
    language: text("language"),
    liveStatus: text("live_status").$type<YouTubeLiveStatus>().notNull().default("unknown"),
    note: text("note"),
    copyIndex: integer("copy_index").notNull().default(0),
    captureStatus: text("capture_status")
      .$type<BookmarkCaptureStatus>()
      .notNull()
      .default("complete"),
    warningsJson: text("warnings_json").notNull().default("[]"),
    schemaVersion: integer("schema_version").notNull().default(1),
    capturedAt: integer("captured_at", { mode: "timestamp_ms" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
  },
  (table) => [
    uniqueIndex("youtube_cache_vault_video_copy_unique").on(
      table.vaultId,
      table.videoId,
      table.copyIndex,
    ),
    index("youtube_cache_vault_id_idx").on(table.vaultId),
    index("youtube_cache_channel_id_idx").on(table.channelId),
  ],
);

export const syncRuns = sqliteTable(
  "sync_runs",
  {
    id: text("id").primaryKey(),
    vaultId: text("vault_id")
      .notNull()
      .references(() => vaults.id, { onDelete: "cascade" }),
    reason: text("reason").$type<SyncRunReason>().notNull(),
    status: text("status").$type<SyncRunStatus>().notNull(),
    owner: text("owner").$type<SyncRunOwner>().notNull(),
    indexerVersion: text("indexer_version"),
    parserVersion: text("parser_version"),
    startedAt: integer("started_at", { mode: "timestamp_ms" }).notNull(),
    completedAt: integer("completed_at", { mode: "timestamp_ms" }),
    durationMs: integer("duration_ms"),
    filesSeen: integer("files_seen").notNull().default(0),
    filesAdded: integer("files_added").notNull().default(0),
    filesUpdated: integer("files_updated").notNull().default(0),
    filesMoved: integer("files_moved").notNull().default(0),
    filesMissing: integer("files_missing").notNull().default(0),
    errorMessage: text("error_message"),
  },
  (table) => [
    index("sync_runs_vault_started_at_idx").on(table.vaultId, table.startedAt),
    index("sync_runs_vault_status_idx").on(table.vaultId, table.status),
  ],
);

export const syncEvents = sqliteTable(
  "sync_events",
  {
    id: text("id").primaryKey(),
    syncRunId: text("sync_run_id")
      .notNull()
      .references(() => syncRuns.id, { onDelete: "cascade" }),
    vaultId: text("vault_id")
      .notNull()
      .references(() => vaults.id, { onDelete: "cascade" }),
    assetId: text("asset_id").references(() => assets.id, { onDelete: "set null" }),
    eventType: text("event_type").$type<SyncEventType>().notNull(),
    oldRelativePath: text("old_relative_path"),
    newRelativePath: text("new_relative_path"),
    confidence: real("confidence"),
    detailJson: text("detail_json").notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  },
  (table) => [
    index("sync_events_sync_run_id_idx").on(table.syncRunId),
    index("sync_events_vault_event_type_idx").on(table.vaultId, table.eventType),
    index("sync_events_asset_id_idx").on(table.assetId),
  ],
);

export type NoteRecord = typeof notes.$inferSelect;
export type NewNoteRecord = typeof notes.$inferInsert;

export type VaultRecord = typeof vaults.$inferSelect;
export type NewVaultRecord = typeof vaults.$inferInsert;
export type AssetRecord = typeof assets.$inferSelect;
export type NewAssetRecord = typeof assets.$inferInsert;
export type AssetFileRecord = typeof assetFiles.$inferSelect;
export type NewAssetFileRecord = typeof assetFiles.$inferInsert;
export type TagRecord = typeof tags.$inferSelect;
export type NewTagRecord = typeof tags.$inferInsert;
export type AssetTagRecord = typeof assetTags.$inferSelect;
export type NewAssetTagRecord = typeof assetTags.$inferInsert;
export type SavedViewRecord = typeof savedViews.$inferSelect;
export type NewSavedViewRecord = typeof savedViews.$inferInsert;
export type AssetLinkRecord = typeof assetLinks.$inferSelect;
export type NewAssetLinkRecord = typeof assetLinks.$inferInsert;
export type MarkdownCacheRecord = typeof markdownCache.$inferSelect;
export type NewMarkdownCacheRecord = typeof markdownCache.$inferInsert;
export type PostCacheRecord = typeof postCache.$inferSelect;
export type NewPostCacheRecord = typeof postCache.$inferInsert;
export type YouTubeCacheRecord = typeof youtubeCache.$inferSelect;
export type NewYouTubeCacheRecord = typeof youtubeCache.$inferInsert;
export type SyncRunRecord = typeof syncRuns.$inferSelect;
export type NewSyncRunRecord = typeof syncRuns.$inferInsert;
export type SyncEventRecord = typeof syncEvents.$inferSelect;
export type NewSyncEventRecord = typeof syncEvents.$inferInsert;
