-- Custom SQL migration file, put your code below! --
-- Prune assets that were ingested from hidden (dotfile / dot-directory) paths by
-- older indexer builds. From this version the indexer's should_skip excludes any
-- path component starting with ".", so these rows can never be re-created. This one
-- time cleanup drops the existing records only; the underlying vault files are left
-- untouched on disk.
--
-- Deleting from `assets` cascades to asset_files, image_cache, markdown_cache,
-- post_cache, web_cache, asset_tags and asset_links(source) via ON DELETE cascade,
-- and nulls asset_links(target); the connection runs with foreign_keys = ON.
DELETE FROM assets
WHERE id IN (
  SELECT asset_id
  FROM asset_files
  WHERE relative_path LIKE '.%'
     OR relative_path LIKE '%/.%'
);
