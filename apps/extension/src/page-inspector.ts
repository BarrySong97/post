/**
 * @purpose Extract normalized bookmark metadata from the active browser document.
 * @role    Self-contained function injected by the MV3 background worker with chrome.scripting.
 * @deps    Browser DOM and URL APIs.
 * @gotcha  This function is serialized by Chrome; every helper must remain inside its body.
 */

import type { BookmarkCapture } from "./shared/bookmark";

export function inspectBookmarkDocument(): BookmarkCapture | null {
  const text = (value: string | null | undefined) => value?.trim() || undefined;
  const meta = (...selectors: string[]) => {
    for (const selector of selectors) {
      const element = document.querySelector<HTMLMetaElement>(selector);
      const content = text(element?.content ?? element?.getAttribute("content"));
      if (content) {
        return content;
      }
    }
    return undefined;
  };
  const absoluteUrl = (value: string | undefined) => {
    if (!value) {
      return undefined;
    }
    try {
      const url = new URL(value, location.href);
      return url.protocol === "http:" || url.protocol === "https:" ? url.href : undefined;
    } catch {
      return undefined;
    }
  };
  const youtubeVideoId = (rawUrl: string) => {
    try {
      const url = new URL(rawUrl);
      const host = url.hostname.replace(/^www\./, "").replace(/^m\./, "");
      if (host === "youtu.be") {
        return text(url.pathname.split("/").filter(Boolean)[0]);
      }
      if (
        host !== "youtube.com" &&
        host !== "youtube-nocookie.com" &&
        !host.endsWith(".youtube.com")
      ) {
        return undefined;
      }
      const direct = text(url.searchParams.get("v"));
      if (direct) {
        return direct;
      }
      const parts = url.pathname.split("/").filter(Boolean);
      if (["shorts", "live", "embed"].includes(parts[0] ?? "")) {
        return text(parts[1]);
      }
      return undefined;
    } catch {
      return undefined;
    }
  };
  const isoDurationMs = (value: string | undefined) => {
    if (!value) {
      return undefined;
    }
    const match = /^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?)?$/i.exec(value);
    if (!match) {
      return undefined;
    }
    const days = Number(match[1] ?? 0);
    const hours = Number(match[2] ?? 0);
    const minutes = Number(match[3] ?? 0);
    const seconds = Number(match[4] ?? 0);
    const duration = (((days * 24 + hours) * 60 + minutes) * 60 + seconds) * 1000;
    return Number.isFinite(duration) && duration >= 0 ? Math.round(duration) : undefined;
  };
  const findVideoObject = (value: unknown): Record<string, unknown> | undefined => {
    if (!value || typeof value !== "object") {
      return undefined;
    }
    if (Array.isArray(value)) {
      for (const item of value) {
        const found = findVideoObject(item);
        if (found) {
          return found;
        }
      }
      return undefined;
    }
    const record = value as Record<string, unknown>;
    const type = record["@type"];
    if (type === "VideoObject" || (Array.isArray(type) && type.includes("VideoObject"))) {
      return record;
    }
    for (const child of Object.values(record)) {
      const found = findVideoObject(child);
      if (found) {
        return found;
      }
    }
    return undefined;
  };
  const videoObject = (() => {
    for (const script of Array.from(
      document.querySelectorAll<HTMLScriptElement>('script[type="application/ld+json"]'),
    )) {
      try {
        const found = findVideoObject(JSON.parse(script.textContent ?? ""));
        if (found) {
          return found;
        }
      } catch {
        // Ignore invalid third-party JSON-LD blocks.
      }
    }
    return undefined;
  })();
  const stringField = (value: unknown) => (typeof value === "string" ? text(value) : undefined);
  const firstString = (value: unknown) => {
    if (typeof value === "string") {
      return text(value);
    }
    if (Array.isArray(value)) {
      return value.find((item): item is string => typeof item === "string");
    }
    if (value && typeof value === "object") {
      return stringField((value as Record<string, unknown>).url);
    }
    return undefined;
  };

  const pageUrl = location.href;
  if (location.protocol !== "http:" && location.protocol !== "https:") {
    return null;
  }
  const canonicalLink = document.querySelector<HTMLLinkElement>('link[rel="canonical"]')?.href;
  const canonicalCandidate = absoluteUrl(canonicalLink) ?? pageUrl;
  const videoId = youtubeVideoId(canonicalCandidate) ?? youtubeVideoId(pageUrl);
  const sourceTitle =
    meta('meta[property="og:title"]', 'meta[name="twitter:title"]') ?? text(document.title);
  const description =
    stringField(videoObject?.description) ??
    meta(
      'meta[property="og:description"]',
      'meta[name="twitter:description"]',
      'meta[name="description"]',
    );
  const thumbnailUrl = absoluteUrl(
    firstString(videoObject?.thumbnailUrl) ??
      meta('meta[property="og:image"]', 'meta[name="twitter:image"]'),
  );
  const language = text(document.documentElement.lang);
  const capturedAt = Date.now();

  if (!videoId) {
    const canonical = new URL(canonicalCandidate);
    canonical.hash = "";
    return {
      kind: "web",
      canonicalUrl: canonical.href,
      pageUrl,
      sourceTitle,
      description,
      thumbnailUrl,
      language,
      siteName: meta('meta[property="og:site_name"]'),
      capturedAt,
    };
  }

  const author =
    videoObject?.author && typeof videoObject.author === "object"
      ? (videoObject.author as Record<string, unknown>)
      : undefined;
  const channelUrl = absoluteUrl(
    stringField(author?.url) ??
      document.querySelector<HTMLAnchorElement>("#owner a.yt-simple-endpoint")?.href,
  );
  const channelId =
    meta('meta[itemprop="channelId"]') ??
    channelUrl?.match(/\/channel\/([^/?#]+)/)?.[1] ??
    undefined;
  const liveFlag = meta('meta[itemprop="isLiveBroadcast"]');
  const endDate = meta('meta[itemprop="endDate"]');
  const liveStatus = liveFlag === "True" ? "live" : endDate ? "ended" : "none";

  return {
    kind: "youtube",
    videoId,
    canonicalUrl: `https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}`,
    pageUrl,
    sourceTitle,
    description,
    thumbnailUrl,
    language,
    channelId,
    channelName:
      stringField(author?.name) ??
      text(document.querySelector<HTMLElement>("#owner #channel-name")?.textContent),
    channelUrl,
    publishedAt:
      stringField(videoObject?.uploadDate) ??
      stringField(videoObject?.datePublished) ??
      meta('meta[itemprop="datePublished"]'),
    durationMs: isoDurationMs(
      stringField(videoObject?.duration) ?? meta('meta[itemprop="duration"]'),
    ),
    liveStatus,
    capturedAt,
  };
}
