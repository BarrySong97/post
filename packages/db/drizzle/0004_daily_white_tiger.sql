CREATE INDEX `asset_files_vault_file_exists_mtime_asset_idx` ON `asset_files` (`vault_id`,`file_exists`,`mtime_ms`,`asset_id`);--> statement-breakpoint
CREATE INDEX `asset_files_vault_file_exists_ctime_asset_idx` ON `asset_files` (`vault_id`,`file_exists`,`ctime_ms`,`asset_id`);--> statement-breakpoint
CREATE INDEX `asset_tags_tag_asset_idx` ON `asset_tags` (`tag_id`,`asset_id`);
