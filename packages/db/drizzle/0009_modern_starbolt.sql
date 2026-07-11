CREATE TABLE `web_cache` (
	`asset_id` text PRIMARY KEY NOT NULL,
	`vault_id` text NOT NULL,
	`url` text NOT NULL,
	`domain` text,
	`site_name` text,
	`description` text,
	`captured_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`asset_id`) REFERENCES `assets`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`vault_id`) REFERENCES `vaults`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `web_cache_vault_id_idx` ON `web_cache` (`vault_id`);