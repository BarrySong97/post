/**
 * @purpose Convert X/Twitter Post photo CDN variants to their original-resolution URL.
 * @role    Pure URL normalization shared by direct image saves and full Post media imports.
 * @deps    WHATWG URL.
 * @gotcha  Only pbs.twimg.com/media photos are rewritten; profile/card images remain untouched.
 */

function isTwitterPostImage(url: URL): boolean {
  return (
    (url.hostname === "pbs.twimg.com" || url.hostname.endsWith(".pbs.twimg.com")) &&
    url.pathname.startsWith("/media/")
  );
}

export function toOriginalTwitterImageUrl(rawUrl: string): string {
  try {
    const url = new URL(rawUrl);
    if (!isTwitterPostImage(url)) {
      return rawUrl;
    }

    const legacyFormatSuffix = url.pathname.match(/\.([a-z0-9]+)(?::[^/]+)?$/i);
    const format = url.searchParams.get("format")?.trim() || legacyFormatSuffix?.[1]?.toLowerCase();
    if (!format) {
      return rawUrl;
    }

    if (legacyFormatSuffix) {
      url.pathname = url.pathname.slice(0, -legacyFormatSuffix[0].length);
    }
    url.search = "";
    url.hash = "";
    // X's modern media URL format orders `format` before the requested size name.
    url.searchParams.set("format", format);
    url.searchParams.set("name", "orig");
    return url.href;
  } catch {
    return rawUrl;
  }
}
