/**
 * @purpose Resolve normalized X/Twitter post content for browser-extension imports.
 * @role    Metadata adapter that merges public syndication data with a visible-page fallback snapshot.
 * @deps    Global fetch and twitter-video-resolver variant parsing.
 * @gotcha  The syndication response is undocumented; keep parsing defensive and persist only normalized fields.
 */

import { getTwitterSyndicationToken, parseTwitterVideoVariants } from "./twitter-video-resolver";

export type TwitterPostVisibleSnapshot = {
  authorName?: string;
  authorHandle?: string;
  text?: string;
  publishedAt?: string;
  language?: string;
  mediaUrls?: string[];
  quotedPostUrl?: string;
  replyToPostUrl?: string;
};

export type TwitterPostMedia = {
  kind: "image" | "video";
  url: string;
  candidateUrls: string[];
};

export type TwitterQuotedPost = {
  postId?: string;
  url?: string;
  authorName?: string;
  authorHandle?: string;
  text?: string;
};

export type TwitterPoll = {
  choices: Array<{ label: string; count?: number }>;
  endsAt?: string;
  countsFinal?: boolean;
};

export type TwitterLinkCard = {
  url: string;
  title?: string;
  description?: string;
};

export type ResolvedTwitterPost = {
  platform: "x";
  postId: string;
  canonicalUrl: string;
  text: string;
  authorName?: string;
  authorHandle?: string;
  publishedAt?: Date;
  capturedAt: Date;
  language?: string;
  replyToPostId?: string;
  replyToUrl?: string;
  quotedPost?: TwitterQuotedPost;
  repostedByHandle?: string;
  media: TwitterPostMedia[];
  poll?: TwitterPoll;
  linkCard?: TwitterLinkCard;
  warnings: string[];
};

export type ResolveTwitterPostInput = {
  postId: string;
  canonicalUrl: string;
  capturedAt?: number;
  visibleSnapshot?: TwitterPostVisibleSnapshot;
};

type FetchLike = typeof fetch;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function readString(record: Record<string, unknown>, ...keys: string[]) {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }

  return undefined;
}

function asDate(value: string | undefined) {
  if (!value) {
    return undefined;
  }

  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

function canonicalPostUrl(handle: string | undefined, postId: string, fallback: string) {
  if (handle) {
    return `https://x.com/${handle.replace(/^@/, "")}/status/${postId}`;
  }

  try {
    const url = new URL(fallback);
    url.hostname = "x.com";
    return url.href;
  } catch {
    return `https://x.com/i/status/${postId}`;
  }
}

function readDisplayText(payload: Record<string, unknown>) {
  const text = readString(payload, "text", "full_text") ?? "";
  const range = payload.display_text_range;
  if (Array.isArray(range) && typeof range[0] === "number" && typeof range[1] === "number") {
    return text.slice(range[0], range[1]).trim();
  }

  return text.trim();
}

function normalizeImageUrl(rawUrl: string) {
  try {
    const url = new URL(rawUrl);
    if (url.hostname === "pbs.twimg.com" || url.hostname.endsWith(".pbs.twimg.com")) {
      url.searchParams.set("name", "orig");
    }
    return url.href;
  } catch {
    return rawUrl;
  }
}

function parseMedia(payload: Record<string, unknown>, snapshot?: TwitterPostVisibleSnapshot) {
  const media: TwitterPostMedia[] = [];
  const details = Array.isArray(payload.mediaDetails) ? payload.mediaDetails : [];

  for (const value of details) {
    if (!isRecord(value)) {
      continue;
    }

    const type = readString(value, "type");
    if (type === "photo") {
      const imageUrl = readString(value, "media_url_https", "media_url");
      if (imageUrl) {
        media.push({ kind: "image", url: normalizeImageUrl(imageUrl), candidateUrls: [] });
      }
      continue;
    }

    if (type === "video" || type === "animated_gif") {
      const variants = parseTwitterVideoVariants({ mediaDetails: [value] });
      const first = variants[0]?.url;
      if (first) {
        media.push({
          kind: "video",
          url: first,
          candidateUrls: variants.map((variant) => variant.url),
        });
      }
    }
  }

  const photos = Array.isArray(payload.photos) ? payload.photos : [];
  for (const value of photos) {
    if (!isRecord(value)) {
      continue;
    }
    const imageUrl = readString(value, "url", "media_url_https", "media_url");
    if (imageUrl) {
      media.push({ kind: "image", url: normalizeImageUrl(imageUrl), candidateUrls: [] });
    }
  }

  for (const rawUrl of snapshot?.mediaUrls ?? []) {
    if (/^https?:\/\//.test(rawUrl)) {
      media.push({ kind: "image", url: normalizeImageUrl(rawUrl), candidateUrls: [] });
    }
  }

  const unique = new Map<string, TwitterPostMedia>();
  for (const item of media) {
    if (!unique.has(item.url)) {
      unique.set(item.url, item);
    }
  }
  return Array.from(unique.values());
}

function postUrlParts(rawUrl: string | undefined) {
  if (!rawUrl) {
    return {};
  }
  const match = rawUrl.match(/\/([^/]+)\/status\/(\d+)/);
  return match ? { handle: match[1], postId: match[2] } : {};
}

function parseQuotedPost(payload: Record<string, unknown>, snapshot?: TwitterPostVisibleSnapshot) {
  const value = payload.quoted_tweet ?? payload.quoted_status;
  if (!isRecord(value)) {
    const parts = postUrlParts(snapshot?.quotedPostUrl);
    return snapshot?.quotedPostUrl
      ? { postId: parts.postId, url: snapshot.quotedPostUrl }
      : undefined;
  }

  const user = isRecord(value.user) ? value.user : {};
  const postId = readString(value, "id_str", "rest_id");
  const authorHandle = readString(user, "screen_name");
  return {
    postId,
    url: postId ? canonicalPostUrl(authorHandle, postId, snapshot?.quotedPostUrl ?? "") : undefined,
    authorName: readString(user, "name"),
    authorHandle,
    text: readDisplayText(value),
  } satisfies TwitterQuotedPost;
}

function readCardBindings(payload: Record<string, unknown>) {
  if (!isRecord(payload.card) || !isRecord(payload.card.binding_values)) {
    return {} as Record<string, unknown>;
  }
  return payload.card.binding_values;
}

function bindingValue(value: unknown): unknown {
  if (!isRecord(value)) {
    return value;
  }
  return value.string_value ?? value.boolean_value ?? value.image_value ?? value;
}

function parsePoll(payload: Record<string, unknown>): TwitterPoll | undefined {
  const bindings = readCardBindings(payload);
  const choices: Array<{ label: string; count?: number }> = [];
  for (let index = 1; index <= 12; index += 1) {
    const labelValue = bindingValue(bindings[`choice${index}_label`]);
    if (typeof labelValue !== "string" || !labelValue.trim()) {
      continue;
    }
    const countValue = bindingValue(bindings[`choice${index}_count`]);
    const count =
      typeof countValue === "number"
        ? countValue
        : typeof countValue === "string" && Number.isFinite(Number(countValue))
          ? Number(countValue)
          : undefined;
    choices.push({ label: labelValue.trim(), count });
  }
  if (choices.length === 0) {
    return undefined;
  }

  const endsAtValue = bindingValue(bindings.end_datetime_utc);
  const finalValue = bindingValue(bindings.counts_are_final);
  return {
    choices,
    endsAt: typeof endsAtValue === "string" ? endsAtValue : undefined,
    countsFinal:
      typeof finalValue === "boolean"
        ? finalValue
        : finalValue === "true" || finalValue === "1"
          ? true
          : finalValue === "false" || finalValue === "0"
            ? false
            : undefined,
  };
}

function parseLinkCard(payload: Record<string, unknown>): TwitterLinkCard | undefined {
  const bindings = readCardBindings(payload);
  const urlValue = bindingValue(bindings.card_url ?? bindings.url ?? bindings.vanity_url);
  if (typeof urlValue !== "string" || !/^https?:\/\//.test(urlValue)) {
    const entities = isRecord(payload.entities) ? payload.entities : {};
    const urls = Array.isArray(entities.urls) ? entities.urls : [];
    const first = urls.find(isRecord);
    const expandedUrl = first ? readString(first, "expanded_url", "url") : undefined;
    if (!expandedUrl || !/^https?:\/\//.test(expandedUrl)) {
      return undefined;
    }
    return { url: expandedUrl };
  }

  const titleValue = bindingValue(bindings.title);
  const descriptionValue = bindingValue(bindings.description);
  return {
    url: urlValue,
    title: typeof titleValue === "string" ? titleValue : undefined,
    description: typeof descriptionValue === "string" ? descriptionValue : undefined,
  };
}

export function parseTwitterPostPayload(
  rawPayload: unknown,
  input: ResolveTwitterPostInput,
): ResolvedTwitterPost {
  const warnings: string[] = [];
  const outer = isRecord(rawPayload) ? rawPayload : {};
  const repost = isRecord(outer.retweeted_status) ? outer.retweeted_status : undefined;
  const payload = repost ?? outer;
  const snapshot = input.visibleSnapshot;
  const user = isRecord(payload.user) ? payload.user : {};
  const postId = readString(payload, "id_str", "rest_id") ?? input.postId;
  const authorName = readString(user, "name") ?? snapshot?.authorName;
  const authorHandle = readString(user, "screen_name") ?? snapshot?.authorHandle?.replace(/^@/, "");
  const text = readDisplayText(payload) || snapshot?.text?.trim() || "";
  const media = parseMedia(payload, snapshot);
  const quotedPost = parseQuotedPost(payload, snapshot);
  const replyToPostId =
    readString(payload, "in_reply_to_status_id_str") ??
    postUrlParts(snapshot?.replyToPostUrl).postId;
  const replyToHandle = readString(payload, "in_reply_to_screen_name");
  const replyToUrl =
    snapshot?.replyToPostUrl ??
    (replyToPostId ? canonicalPostUrl(replyToHandle, replyToPostId, "") : undefined);

  if (!isRecord(rawPayload)) {
    warnings.push("Public X metadata was unavailable; saved from the visible page snapshot.");
  }
  if (!text && media.length === 0 && !quotedPost) {
    throw new Error("No meaningful post content could be captured.");
  }

  return {
    platform: "x",
    postId,
    canonicalUrl: canonicalPostUrl(authorHandle, postId, input.canonicalUrl),
    text,
    authorName,
    authorHandle,
    publishedAt: asDate(readString(payload, "created_at") ?? snapshot?.publishedAt),
    capturedAt: new Date(input.capturedAt ?? Date.now()),
    language: readString(payload, "lang") ?? snapshot?.language,
    replyToPostId,
    replyToUrl,
    quotedPost,
    repostedByHandle:
      repost && isRecord(outer.user) ? readString(outer.user, "screen_name") : undefined,
    media,
    poll: parsePoll(payload),
    linkCard: parseLinkCard(payload),
    warnings,
  };
}

export async function resolveTwitterPost(
  input: ResolveTwitterPostInput,
  fetchImpl: FetchLike = fetch,
): Promise<ResolvedTwitterPost> {
  if (!/^\d+$/.test(input.postId)) {
    throw new Error("X post ID is invalid.");
  }

  const endpoint = new URL("https://cdn.syndication.twimg.com/tweet-result");
  endpoint.searchParams.set("id", input.postId);
  endpoint.searchParams.set("lang", "en");
  endpoint.searchParams.set("token", getTwitterSyndicationToken(input.postId));

  let payload: unknown;
  try {
    const response = await fetchImpl(endpoint, {
      headers: {
        Accept: "application/json",
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
      },
      redirect: "follow",
    });
    if (response.ok) {
      payload = await response.json();
    }
  } catch {
    payload = undefined;
  }

  return parseTwitterPostPayload(payload, input);
}
