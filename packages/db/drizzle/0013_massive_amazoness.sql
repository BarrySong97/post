CREATE TABLE `youtube_cache` (
	`asset_id` text PRIMARY KEY NOT NULL,
	`vault_id` text NOT NULL,
	`video_id` text NOT NULL,
	`canonical_url` text NOT NULL,
	`source_title` text,
	`title_override` text,
	`description` text,
	`channel_id` text,
	`channel_name` text,
	`channel_url` text,
	`published_at` integer,
	`duration_ms` integer,
	`thumbnail_url` text,
	`language` text,
	`live_status` text DEFAULT 'unknown' NOT NULL,
	`note` text,
	`copy_index` integer DEFAULT 0 NOT NULL,
	`capture_status` text DEFAULT 'complete' NOT NULL,
	`warnings_json` text DEFAULT '[]' NOT NULL,
	`schema_version` integer DEFAULT 1 NOT NULL,
	`captured_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`asset_id`) REFERENCES `assets`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`vault_id`) REFERENCES `vaults`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `youtube_cache_vault_video_copy_unique` ON `youtube_cache` (`vault_id`,`video_id`,`copy_index`);--> statement-breakpoint
CREATE INDEX `youtube_cache_vault_id_idx` ON `youtube_cache` (`vault_id`);--> statement-breakpoint
CREATE INDEX `youtube_cache_channel_id_idx` ON `youtube_cache` (`channel_id`);--> statement-breakpoint
ALTER TABLE `web_cache` ADD `source_title` text;--> statement-breakpoint
ALTER TABLE `web_cache` ADD `title_override` text;--> statement-breakpoint
ALTER TABLE `web_cache` ADD `thumbnail_url` text;--> statement-breakpoint
ALTER TABLE `web_cache` ADD `language` text;--> statement-breakpoint
ALTER TABLE `web_cache` ADD `note` text;--> statement-breakpoint
ALTER TABLE `web_cache` ADD `copy_index` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `web_cache` ADD `capture_status` text DEFAULT 'complete' NOT NULL;--> statement-breakpoint
ALTER TABLE `web_cache` ADD `warnings_json` text DEFAULT '[]' NOT NULL;--> statement-breakpoint
ALTER TABLE `web_cache` ADD `schema_version` integer DEFAULT 1 NOT NULL;--> statement-breakpoint
UPDATE `web_cache` AS `target`
SET `copy_index` = (
	SELECT COUNT(*)
	FROM `web_cache` AS `preceding`
	WHERE `preceding`.`vault_id` = `target`.`vault_id`
		AND `preceding`.`url` = `target`.`url`
		AND `preceding`.`asset_id` < `target`.`asset_id`
);--> statement-breakpoint
CREATE UNIQUE INDEX `web_cache_vault_url_copy_unique` ON `web_cache` (`vault_id`,`url`,`copy_index`);
