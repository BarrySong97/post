CREATE TABLE `post_cache` (
	`asset_id` text PRIMARY KEY NOT NULL,
	`vault_id` text NOT NULL,
	`platform` text NOT NULL,
	`external_post_id` text NOT NULL,
	`canonical_url` text NOT NULL,
	`text` text NOT NULL,
	`author_name` text,
	`author_handle` text,
	`published_at` integer,
	`captured_at` integer NOT NULL,
	`language` text,
	`reply_to_external_id` text,
	`reply_to_url` text,
	`quoted_external_id` text,
	`quoted_url` text,
	`reposted_by_handle` text,
	`capture_status` text NOT NULL,
	`media_json` text DEFAULT '[]' NOT NULL,
	`quoted_post_json` text,
	`poll_json` text,
	`link_card_json` text,
	`warnings_json` text DEFAULT '[]' NOT NULL,
	`schema_version` integer DEFAULT 1 NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`asset_id`) REFERENCES `assets`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`vault_id`) REFERENCES `vaults`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `post_cache_vault_platform_external_unique` ON `post_cache` (`vault_id`,`platform`,`external_post_id`);--> statement-breakpoint
CREATE INDEX `post_cache_vault_captured_at_idx` ON `post_cache` (`vault_id`,`captured_at`);--> statement-breakpoint
CREATE INDEX `post_cache_author_handle_idx` ON `post_cache` (`author_handle`);