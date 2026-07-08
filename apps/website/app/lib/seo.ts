/**
 * @purpose Centralize public website URLs and release/download constants.
 * @role    Shared website metadata source for navigation, releases, and download links.
 * @deps    None.
 * @gotcha  Keep GitHub URLs aligned with electron-builder publish owner/repo.
 */

export const SITE_NAME = "Post";
export const SITE_URL = "https://posttt.pages.dev";
export const SITE_TITLE = "Post — Local-first desktop workspace";
export const SITE_DESCRIPTION =
  "Post is a local-first desktop workspace for organizing vault files, assets, notes, tags, saved views, and publishing workflows.";
export const SITE_KEYWORDS = [
  "Post",
  "local-first workspace",
  "desktop workspace",
  "vault files",
  "asset management",
  "notes",
  "publishing workflow",
];
export const SITE_ICON_URL = "/post-icon.png";
export const OG_IMAGE_URL = "/og-image.png";
export const FAVICON_URL = "/favicon.ico";
export const APPLE_TOUCH_ICON_URL = "/apple-touch-icon.png";
export const GITHUB_URL = "https://github.com/BarrySong97/post";
export const GITHUB_RELEASES_URL = `${GITHUB_URL}/releases`;
export const GITHUB_LATEST_RELEASE_URL = `${GITHUB_RELEASES_URL}/latest`;
export const DOWNLOAD_URL = GITHUB_LATEST_RELEASE_URL;
