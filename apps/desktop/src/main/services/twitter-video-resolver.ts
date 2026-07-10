/**
 * @purpose Resolve full Twitter/X playback variants from public post embed metadata.
 * @role    Pure media metadata adapter used by the extension video import service.
 * @deps    Global fetch and the public cdn.syndication.twimg.com tweet result endpoint.
 * @gotcha  The syndication endpoint is not a documented X API contract, so callers must retain fallbacks.
 */

export type TwitterVideoVariant = {
  url: string;
  contentType: "video/mp4" | "application/x-mpegURL";
  bitrate?: number;
};

type FetchLike = typeof fetch;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function readVariant(value: unknown): TwitterVideoVariant | null {
  if (!isRecord(value)) {
    return null;
  }

  const rawUrl = typeof value.url === "string" ? value.url : value.src;
  const rawContentType = typeof value.content_type === "string" ? value.content_type : value.type;
  if (
    typeof rawUrl !== "string" ||
    (rawContentType !== "video/mp4" && rawContentType !== "application/x-mpegURL")
  ) {
    return null;
  }

  try {
    const url = new URL(rawUrl);
    if (
      url.protocol !== "https:" ||
      (url.hostname !== "video.twimg.com" && !url.hostname.endsWith(".video.twimg.com"))
    ) {
      return null;
    }
  } catch {
    return null;
  }

  const rawBitrate = value.bitrate ?? value.bit_rate;
  const bitrate = typeof rawBitrate === "number" && rawBitrate > 0 ? rawBitrate : undefined;
  return { url: rawUrl, contentType: rawContentType, bitrate };
}

function readArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function collectVideoInfoVariants(value: unknown, depth = 0): unknown[] {
  if (depth > 12) {
    return [];
  }

  if (Array.isArray(value)) {
    return value.flatMap((item) => collectVideoInfoVariants(item, depth + 1));
  }

  if (!isRecord(value)) {
    return [];
  }

  const directVariants = isRecord(value.video_info) ? readArray(value.video_info.variants) : [];
  return [
    ...directVariants,
    ...Object.values(value).flatMap((item) => collectVideoInfoVariants(item, depth + 1)),
  ];
}

function readUnifiedCard(payload: Record<string, unknown>): unknown {
  if (!isRecord(payload.card) || !isRecord(payload.card.binding_values)) {
    return null;
  }

  const unifiedCard = payload.card.binding_values.unified_card;
  if (!isRecord(unifiedCard) || typeof unifiedCard.string_value !== "string") {
    return null;
  }

  try {
    return JSON.parse(unifiedCard.string_value) as unknown;
  } catch {
    return null;
  }
}

export function getTwitterSyndicationToken(tweetId: string) {
  if (!/^\d+$/.test(tweetId)) {
    throw new Error("Twitter post ID is invalid.");
  }

  return ((Number(tweetId) / 1e15) * Math.PI).toString(36).replace(/(0+|\.)/g, "");
}

export function parseTwitterVideoVariants(payload: unknown): TwitterVideoVariant[] {
  if (!isRecord(payload)) {
    return [];
  }

  const mediaVariants = collectVideoInfoVariants(payload.mediaDetails);
  const cardVariants = collectVideoInfoVariants(readUnifiedCard(payload));
  const topLevelVariants = isRecord(payload.video) ? readArray(payload.video.variants) : [];
  const variants = [...mediaVariants, ...cardVariants, ...topLevelVariants]
    .map(readVariant)
    .filter((variant): variant is TwitterVideoVariant => variant !== null);

  const uniqueByUrl = new Map<string, TwitterVideoVariant>();
  for (const variant of variants) {
    if (!uniqueByUrl.has(variant.url)) {
      uniqueByUrl.set(variant.url, variant);
    }
  }

  const unique = Array.from(uniqueByUrl.values());
  return unique.sort((left, right) => {
    if (left.contentType !== right.contentType) {
      return left.contentType === "video/mp4" ? -1 : 1;
    }

    return (right.bitrate ?? 0) - (left.bitrate ?? 0);
  });
}

export async function resolveTwitterVideoVariants(
  tweetId: string | undefined,
  fetchImpl: FetchLike = fetch,
): Promise<TwitterVideoVariant[]> {
  if (!tweetId || !/^\d+$/.test(tweetId)) {
    return [];
  }

  const endpoint = new URL("https://cdn.syndication.twimg.com/tweet-result");
  endpoint.searchParams.set("id", tweetId);
  endpoint.searchParams.set("lang", "en");
  endpoint.searchParams.set("token", getTwitterSyndicationToken(tweetId));

  try {
    const response = await fetchImpl(endpoint, {
      headers: {
        Accept: "application/json",
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
      },
      redirect: "follow",
    });
    if (!response.ok) {
      return [];
    }

    return parseTwitterVideoVariants(await response.json());
  } catch {
    return [];
  }
}
