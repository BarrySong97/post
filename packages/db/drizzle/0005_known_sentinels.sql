CREATE TABLE `asset_galleries` (
	`id` text PRIMARY KEY NOT NULL,
	`vault_id` text NOT NULL,
	`title` text NOT NULL,
	`description` text,
	`cover_asset_id` text,
	`status` text DEFAULT 'inbox' NOT NULL,
	`privacy` text DEFAULT 'normal' NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`deleted_at` integer,
	FOREIGN KEY (`vault_id`) REFERENCES `vaults`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`cover_asset_id`) REFERENCES `assets`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `asset_galleries_vault_updated_at_idx` ON `asset_galleries` (`vault_id`,`updated_at`);--> statement-breakpoint
CREATE INDEX `asset_galleries_vault_status_idx` ON `asset_galleries` (`vault_id`,`status`);--> statement-breakpoint
CREATE INDEX `asset_galleries_cover_asset_idx` ON `asset_galleries` (`cover_asset_id`);--> statement-breakpoint
CREATE TABLE `asset_gallery_items` (
	`gallery_id` text NOT NULL,
	`asset_id` text NOT NULL,
	`vault_id` text NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`caption` text,
	`created_at` integer NOT NULL,
	PRIMARY KEY(`gallery_id`, `asset_id`),
	FOREIGN KEY (`gallery_id`) REFERENCES `asset_galleries`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`asset_id`) REFERENCES `assets`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`vault_id`) REFERENCES `vaults`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `asset_gallery_items_vault_asset_unique` ON `asset_gallery_items` (`vault_id`,`asset_id`);--> statement-breakpoint
CREATE INDEX `asset_gallery_items_gallery_sort_order_idx` ON `asset_gallery_items` (`gallery_id`,`sort_order`);--> statement-breakpoint
CREATE INDEX `asset_gallery_items_vault_asset_idx` ON `asset_gallery_items` (`vault_id`,`asset_id`);