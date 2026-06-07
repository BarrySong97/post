CREATE TABLE `saved_views` (
	`id` text PRIMARY KEY NOT NULL,
	`vault_id` text NOT NULL,
	`name` text NOT NULL,
	`kind` text DEFAULT 'manual' NOT NULL,
	`icon` text,
	`filter_json` text DEFAULT '{}' NOT NULL,
	`sort_json` text DEFAULT '{}' NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`vault_id`) REFERENCES `vaults`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `saved_views_vault_name_unique` ON `saved_views` (`vault_id`,`name`);--> statement-breakpoint
CREATE INDEX `saved_views_vault_sort_order_idx` ON `saved_views` (`vault_id`,`sort_order`);