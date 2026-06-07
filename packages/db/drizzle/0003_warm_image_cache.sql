CREATE TABLE `image_cache` (
	`asset_id` text PRIMARY KEY NOT NULL,
	`vault_id` text NOT NULL,
	`file_id` text,
	`width` integer,
	`height` integer,
	`thumbnail_path` text,
	`thumbnail_width` integer,
	`thumbnail_height` integer,
	`thumbnail_size_bytes` integer,
	`thumbnail_format` text,
	`source_size_bytes` integer,
	`source_mtime_ms` integer,
	`source_quick_fingerprint` text,
	`status` text DEFAULT 'pending' NOT NULL,
	`error_message` text,
	`generated_at` integer,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`asset_id`) REFERENCES `assets`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`vault_id`) REFERENCES `vaults`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`file_id`) REFERENCES `asset_files`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `image_cache_vault_status_idx` ON `image_cache` (`vault_id`,`status`);--> statement-breakpoint
CREATE INDEX `image_cache_file_id_idx` ON `image_cache` (`file_id`);
