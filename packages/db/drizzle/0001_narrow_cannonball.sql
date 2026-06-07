CREATE TABLE `asset_files` (
	`id` text PRIMARY KEY NOT NULL,
	`asset_id` text NOT NULL,
	`vault_id` text NOT NULL,
	`relative_path` text NOT NULL,
	`file_name` text NOT NULL,
	`extension` text,
	`mime_type` text,
	`size_bytes` integer NOT NULL,
	`mtime_ms` integer NOT NULL,
	`ctime_ms` integer,
	`content_hash` text,
	`quick_fingerprint` text,
	`file_exists` integer DEFAULT true NOT NULL,
	`missing_since` integer,
	`first_seen_at` integer NOT NULL,
	`last_seen_at` integer NOT NULL,
	FOREIGN KEY (`asset_id`) REFERENCES `assets`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`vault_id`) REFERENCES `vaults`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `asset_files_vault_relative_path_unique` ON `asset_files` (`vault_id`,`relative_path`);--> statement-breakpoint
CREATE INDEX `asset_files_asset_id_idx` ON `asset_files` (`asset_id`);--> statement-breakpoint
CREATE INDEX `asset_files_vault_quick_fingerprint_idx` ON `asset_files` (`vault_id`,`quick_fingerprint`);--> statement-breakpoint
CREATE INDEX `asset_files_vault_content_hash_idx` ON `asset_files` (`vault_id`,`content_hash`);--> statement-breakpoint
CREATE INDEX `asset_files_vault_file_exists_idx` ON `asset_files` (`vault_id`,`file_exists`);--> statement-breakpoint
CREATE TABLE `asset_links` (
	`id` text PRIMARY KEY NOT NULL,
	`vault_id` text NOT NULL,
	`source_asset_id` text NOT NULL,
	`target_asset_id` text,
	`target_ref` text NOT NULL,
	`target_subpath` text,
	`relation_type` text NOT NULL,
	`target_kind_hint` text,
	`resolved_status` text NOT NULL,
	`source_span_start` integer,
	`source_span_end` integer,
	`created_from` text DEFAULT 'markdown_parse' NOT NULL,
	`discovered_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`vault_id`) REFERENCES `vaults`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`source_asset_id`) REFERENCES `assets`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`target_asset_id`) REFERENCES `assets`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `asset_links_vault_source_asset_idx` ON `asset_links` (`vault_id`,`source_asset_id`);--> statement-breakpoint
CREATE INDEX `asset_links_vault_target_asset_idx` ON `asset_links` (`vault_id`,`target_asset_id`);--> statement-breakpoint
CREATE INDEX `asset_links_vault_resolved_status_idx` ON `asset_links` (`vault_id`,`resolved_status`);--> statement-breakpoint
CREATE INDEX `asset_links_vault_relation_type_idx` ON `asset_links` (`vault_id`,`relation_type`);--> statement-breakpoint
CREATE TABLE `asset_tags` (
	`asset_id` text NOT NULL,
	`tag_id` text NOT NULL,
	`created_at` integer NOT NULL,
	PRIMARY KEY(`asset_id`, `tag_id`),
	FOREIGN KEY (`asset_id`) REFERENCES `assets`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`tag_id`) REFERENCES `tags`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `asset_tags_tag_id_idx` ON `asset_tags` (`tag_id`);--> statement-breakpoint
CREATE TABLE `assets` (
	`id` text PRIMARY KEY NOT NULL,
	`vault_id` text NOT NULL,
	`kind` text NOT NULL,
	`status` text DEFAULT 'inbox' NOT NULL,
	`privacy` text DEFAULT 'normal' NOT NULL,
	`title` text NOT NULL,
	`description` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`indexed_at` integer,
	`deleted_at` integer,
	FOREIGN KEY (`vault_id`) REFERENCES `vaults`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `assets_vault_id_idx` ON `assets` (`vault_id`);--> statement-breakpoint
CREATE INDEX `assets_vault_kind_idx` ON `assets` (`vault_id`,`kind`);--> statement-breakpoint
CREATE INDEX `assets_vault_status_idx` ON `assets` (`vault_id`,`status`);--> statement-breakpoint
CREATE TABLE `markdown_cache` (
	`asset_id` text PRIMARY KEY NOT NULL,
	`vault_id` text NOT NULL,
	`title` text,
	`excerpt` text,
	`word_count` integer,
	`headings_json` text NOT NULL,
	`outbound_link_count` integer DEFAULT 0 NOT NULL,
	`inbound_link_count` integer DEFAULT 0 NOT NULL,
	`parse_status` text DEFAULT 'pending' NOT NULL,
	`parsed_at` integer,
	`parser_version` text NOT NULL,
	FOREIGN KEY (`asset_id`) REFERENCES `assets`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`vault_id`) REFERENCES `vaults`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `markdown_cache_vault_id_idx` ON `markdown_cache` (`vault_id`);--> statement-breakpoint
CREATE INDEX `markdown_cache_vault_parse_status_idx` ON `markdown_cache` (`vault_id`,`parse_status`);--> statement-breakpoint
CREATE TABLE `sync_events` (
	`id` text PRIMARY KEY NOT NULL,
	`sync_run_id` text NOT NULL,
	`vault_id` text NOT NULL,
	`asset_id` text,
	`event_type` text NOT NULL,
	`old_relative_path` text,
	`new_relative_path` text,
	`confidence` real,
	`detail_json` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`sync_run_id`) REFERENCES `sync_runs`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`vault_id`) REFERENCES `vaults`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`asset_id`) REFERENCES `assets`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `sync_events_sync_run_id_idx` ON `sync_events` (`sync_run_id`);--> statement-breakpoint
CREATE INDEX `sync_events_vault_event_type_idx` ON `sync_events` (`vault_id`,`event_type`);--> statement-breakpoint
CREATE INDEX `sync_events_asset_id_idx` ON `sync_events` (`asset_id`);--> statement-breakpoint
CREATE TABLE `sync_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`vault_id` text NOT NULL,
	`reason` text NOT NULL,
	`status` text NOT NULL,
	`owner` text NOT NULL,
	`indexer_version` text,
	`parser_version` text,
	`started_at` integer NOT NULL,
	`completed_at` integer,
	`duration_ms` integer,
	`files_seen` integer DEFAULT 0 NOT NULL,
	`files_added` integer DEFAULT 0 NOT NULL,
	`files_updated` integer DEFAULT 0 NOT NULL,
	`files_moved` integer DEFAULT 0 NOT NULL,
	`files_missing` integer DEFAULT 0 NOT NULL,
	`error_message` text,
	FOREIGN KEY (`vault_id`) REFERENCES `vaults`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `sync_runs_vault_started_at_idx` ON `sync_runs` (`vault_id`,`started_at`);--> statement-breakpoint
CREATE INDEX `sync_runs_vault_status_idx` ON `sync_runs` (`vault_id`,`status`);--> statement-breakpoint
CREATE TABLE `tags` (
	`id` text PRIMARY KEY NOT NULL,
	`vault_id` text NOT NULL,
	`name` text NOT NULL,
	`color` text,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`vault_id`) REFERENCES `vaults`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `tags_vault_name_unique` ON `tags` (`vault_id`,`name`);--> statement-breakpoint
CREATE INDEX `tags_vault_sort_order_idx` ON `tags` (`vault_id`,`sort_order`);--> statement-breakpoint
CREATE TABLE `vaults` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`root_path` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`last_opened_at` integer,
	`last_sync_started_at` integer,
	`last_sync_completed_at` integer,
	`sync_status` text DEFAULT 'idle' NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `vaults_root_path_unique` ON `vaults` (`root_path`);