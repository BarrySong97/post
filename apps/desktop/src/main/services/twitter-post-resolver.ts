/**
 * @purpose Resolve normalized X/Twitter post content for browser-extension imports.
 * @role    Metadata adapter that merges public syndication data with a visible-page fallback snapshot.
 * @deps    Node Buffer, global fetch, and twitter-video-resolver variant parsing.
 * @gotcha  Canonicalize pbs media IDs to one name=orig URL before merging provider and DOM fallbacks.
 */

import { Buffer } from "node:buffer";

import { getTwitterSyndicationToken, parseTwitterVideoVariants } from "./twitter-video-resolver";

export type TwitterPostVisibleSnapshot = {
  authorName?: string;
  authorHandle?: string;
  authorAvatarUrl?: string;
  text?: string;
  textTruncated?: boolean;
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
  authorAvatarUrl?: string;
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

type ProviderText = {
  text: string;
  complete: boolean;
};

function applyDisplayTextRange(text: string, payload: Record<string, unknown>) {
  const range = payload.display_text_range;
  if (Array.isArray(range) && typeof range[0] === "number" && typeof range[1] === "number") {
    return text.slice(range[0], range[1]).trim();
  }

  return text.trim();
}

function recordAtPath(payload: Record<string, unknown>, keys: readonly string[]) {
  let current = payload;
  for (const key of keys) {
    const next = current[key];
    if (!isRecord(next)) {
      return undefined;
    }
    current = next;
  }
  return current;
}

function readProviderText(payload: Record<string, unknown>): ProviderText {
  const completeContainers = [
    recordAtPath(payload, ["note_tweet", "note_tweet_results", "result"]),
    recordAtPath(payload, ["note_tweet", "result"]),
    recordAtPath(payload, ["note_tweet"]),
    recordAtPath(payload, ["note_tweet_results", "result"]),
    recordAtPath(payload, ["note_tweet_results"]),
    recordAtPath(payload, ["extended_tweet"]),
  ];
  for (const container of completeContainers) {
    if (!container) {
      continue;
    }
    const text = readString(container, "full_text", "text");
    if (text) {
      return { text: applyDisplayTextRange(text, container), complete: true };
    }
  }

  const fullText = readString(payload, "full_text");
  if (fullText) {
    return { text: applyDisplayTextRange(fullText, payload), complete: true };
  }

  const text = readString(payload, "text") ?? "";
  return {
    text: applyDisplayTextRange(text, payload),
    complete: Boolean(text) && payload.truncated === false,
  };
}

function choosePostText(providerText: ProviderText, snapshot?: TwitterPostVisibleSnapshot) {
  const visibleText = snapshot?.text?.trim() ?? "";
  if (!providerText.text) {
    return visibleText;
  }
  if (!visibleText) {
    return providerText.text;
  }

  const visibleTextIsComplete = snapshot?.textTruncated === false;
  const visibleTextCanCompleteProvider = !providerText.complete && snapshot?.textTruncated !== true;
  if (
    visibleText.length > providerText.text.length &&
    (visibleTextIsComplete || visibleTextCanCompleteProvider)
  ) {
    return visibleText;
  }

  return providerText.text;
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function readServerRenderedString(html: string, recordKey: string, field: string) {
  const record = escapeRegExp(JSON.stringify(recordKey));
  const fieldName = escapeRegExp(field);
  const match = html.match(
    new RegExp(`${record}:\\$R\\[\\d+\\]=\\{[\\s\\S]{0,8192}?${fieldName}:("(?:\\\\.|[^"\\\\])*")`),
  );
  if (!match?.[1]) {
    return undefined;
  }

  try {
    const value: unknown = JSON.parse(match[1]);
    return typeof value === "string" && value.trim() ? value.trim() : undefined;
  } catch {
    return undefined;
  }
}

function noteTweetIdFromResultId(resultId: string | undefined) {
  if (!resultId) {
    return undefined;
  }
  try {
    const decoded = Buffer.from(resultId, "base64").toString("utf8");
    const prefix = "NoteTweetResults:";
    return decoded.startsWith(prefix) ? decoded.slice(prefix.length) : undefined;
  } catch {
    return undefined;
  }
}

export function parseTwitterServerRenderedText(
  html: string,
  postId: string,
  noteTweetResultId?: string,
) {
  const noteTweetId = noteTweetIdFromResultId(noteTweetResultId);
  if (noteTweetId) {
    const noteRecordKey = Buffer.from(`NoteTweet:${noteTweetId}`).toString("base64");
    return readServerRenderedString(html, noteRecordKey, "text");
  }

  const tweetRecordKey = Buffer.from(`Tweet:${postId}`).toString("base64");
  return readServerRenderedString(html, `client:${tweetRecordKey}:details`, "full_text");
}

function selectedPayload(rawPayload: unknown) {
  const outer = isRecord(rawPayload) ? rawPayload : {};
  return isRecord(outer.retweeted_status) ? outer.retweeted_status : outer;
}

function addServerRenderedText(rawPayload: unknown, text: string) {
  if (!isRecord(rawPayload)) {
    return rawPayload;
  }

  const addText = (payload: Record<string, unknown>) => ({
    ...payload,
    note_tweet: {
      ...(isRecord(payload.note_tweet) ? payload.note_tweet : {}),
      text,
    },
  });
  return isRecord(rawPayload.retweeted_status)
    ? { ...rawPayload, retweeted_status: addText(rawPayload.retweeted_status) }
    : addText(rawPayload);
}

function normalizeImageUrl(rawUrl: string) {
  try {
    const url = new URL(rawUrl);
    if (
      (url.hostname === "pbs.twimg.com" || url.hostname.endsWith(".pbs.twimg.com")) &&
      url.pathname.startsWith("/media/")
    ) {
      const extensionMatch = url.pathname.match(/\.([a-z0-9]+)$/i);
      const format = url.searchParams.get("format") ?? extensionMatch?.[1]?.toLowerCase();
      if (extensionMatch) {
        url.pathname = url.pathname.slice(0, -extensionMatch[0].length);
      }
      if (format) {
        url.searchParams.set("format", format);
      }
      url.searchParams.set("name", "orig");
    }
    return url.href;
  } catch {
    return rawUrl;
  }
}

function imageIdentityKey(rawUrl: string) {
  try {
    const url = new URL(rawUrl);
    if (
      (url.hostname === "pbs.twimg.com" || url.hostname.endsWith(".pbs.twimg.com")) &&
      url.pathname.startsWith("/media/")
    ) {
      return `${url.hostname}${url.pathname.replace(/\.[a-z0-9]+$/i, "")}`;
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
    const key = item.kind === "image" ? imageIdentityKey(item.url) : item.url;
    if (!unique.has(key)) {
      unique.set(key, item);
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
    text: readProviderText(value).text,
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
  const authorAvatarUrl =
    readString(user, "profile_image_url_https", "profile_image_url") ?? snapshot?.authorAvatarUrl;
  const providerText = readProviderText(payload);
  const text = choosePostText(providerText, snapshot);
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
  const noteTweet = recordAtPath(payload, ["note_tweet"]);
  const hasUnresolvedNote = Boolean(noteTweet && readString(noteTweet, "id"));
  if (
    !providerText.complete &&
    (payload.truncated === true || snapshot?.textTruncated === true || hasUnresolvedNote)
  ) {
    warnings.push("X post text may be truncated because the complete text was unavailable.");
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
    authorAvatarUrl,
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

  const payloadRecord = selectedPayload(payload);
  const providerText = readProviderText(payloadRecord);
  const noteTweet = recordAtPath(payloadRecord, ["note_tweet"]);
  const noteTweetResultId = noteTweet ? readString(noteTweet, "id") : undefined;
  const needsPageText =
    !providerText.complete && (Boolean(noteTweetResultId) || payloadRecord.truncated === true);
  if (needsPageText) {
    try {
      const response = await fetchImpl(input.canonicalUrl, {
        headers: {
          Accept: "text/html,application/xhtml+xml",
          "User-Agent":
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
        },
        redirect: "follow",
      });
      if (response.ok) {
        const pageText = parseTwitterServerRenderedText(
          await response.text(),
          input.postId,
          noteTweetResultId,
        );
        if (pageText && pageText.length > providerText.text.length) {
          payload = addServerRenderedText(payload, pageText);
        }
      }
    } catch {
      // Keep the syndication and visible-page fallbacks below.
    }
  }

  return parseTwitterPostPayload(payload, input);
}
