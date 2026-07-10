/**
 * @purpose Capture Twitter/X post and video context near the user's right-click target.
 * @role    Content script that extracts visible post metadata and video candidates for the background worker.
 * @deps    DOM and Chrome runtime messaging APIs.
 * @gotcha  Twitter/X often renders videos as blob: URLs; only observed MP4/HLS candidates are saved.
 */

type TwitterVideoContext = {
  srcUrl?: string;
  candidateUrls: string[];
  pageUrl: string;
  tweetUrl?: string;
  tweetId?: string;
  title?: string;
  capturedAt: number;
};

type TwitterPostContext = {
  platform: "x";
  postId: string;
  canonicalUrl: string;
  pageUrl: string;
  capturedAt: number;
  visibleSnapshot: {
    authorName?: string;
    authorHandle?: string;
    text?: string;
    publishedAt?: string;
    language?: string;
    mediaUrls?: string[];
    quotedPostUrl?: string;
    replyToPostUrl?: string;
  };
};

const VIDEO_CANDIDATE_LIMIT = 12;
const TWITTER_VIDEO_HOST_RE = /(^|\.)video\.twimg\.com$/i;
const TWEET_PATH_RE = /\/[^/]+\/status\/(\d+)/;

let lastContext: TwitterVideoContext | null = null;
let lastPostContext: TwitterPostContext | null = null;
let lastReportedVideoAvailability: boolean | null = null;

function isDirectVideoUrl(rawUrl: string | undefined): rawUrl is string {
  if (!rawUrl) {
    return false;
  }

  try {
    const url = new URL(rawUrl, window.location.href);
    return (
      (url.protocol === "http:" || url.protocol === "https:") &&
      (url.pathname.toLowerCase().includes(".mp4") || TWITTER_VIDEO_HOST_RE.test(url.hostname))
    );
  } catch {
    return false;
  }
}

function unique(values: readonly string[]) {
  return Array.from(new Set(values));
}

function getPerformanceVideoCandidates() {
  return performance
    .getEntriesByType("resource")
    .map((entry) => entry.name)
    .filter(isDirectVideoUrl)
    .slice(-VIDEO_CANDIDATE_LIMIT)
    .reverse();
}

function closestTweetLink(target: Element) {
  const article = target.closest("article") ?? target.closest("[data-testid='tweet']");
  const links = Array.from((article ?? document).querySelectorAll<HTMLAnchorElement>("a[href]"));
  const tweetLink = links.find((link) => TWEET_PATH_RE.test(link.pathname));
  if (!tweetLink) {
    return null;
  }

  return new URL(tweetLink.getAttribute("href") ?? tweetLink.href, window.location.origin);
}

function closestTweetArticle(target: Element) {
  return target.closest("article") ?? target.closest("[data-testid='tweet']");
}

function tweetLinkFromArticle(article: Element) {
  const links = Array.from(article.querySelectorAll<HTMLAnchorElement>("a[href]"));
  const tweetLink = links.find((link) => TWEET_PATH_RE.test(link.pathname));
  return tweetLink
    ? new URL(tweetLink.getAttribute("href") ?? tweetLink.href, window.location.origin)
    : null;
}

function tweetUrlFromLocation() {
  const match = window.location.pathname.match(TWEET_PATH_RE);
  if (!match) {
    return null;
  }

  return new URL(window.location.pathname, window.location.origin);
}

function findCurrentTweetArticle(tweetId: string) {
  const articles = Array.from(document.querySelectorAll("article, [data-testid='tweet']"));
  return (
    articles.find((article) =>
      Array.from(article.querySelectorAll<HTMLAnchorElement>("a[href]")).some((link) =>
        link.pathname.includes(`/status/${tweetId}`),
      ),
    ) ?? null
  );
}

function buildPostContext(article: Element, tweetUrl: URL): TwitterPostContext | null {
  const match = tweetUrl.pathname.match(TWEET_PATH_RE);
  const postId = match?.[1];
  if (!postId) {
    return null;
  }

  const text = article.querySelector<HTMLElement>("[data-testid='tweetText']")?.innerText.trim();
  const userName = article.querySelector<HTMLElement>("[data-testid='User-Name']");
  const authorName = userName?.querySelector<HTMLElement>("span")?.textContent?.trim();
  const authorHandle = match?.[0]?.split("/")[1];
  const publishedAt = article.querySelector<HTMLTimeElement>("time[datetime]")?.dateTime;
  const language =
    article.querySelector<HTMLElement>("[data-testid='tweetText']")?.lang || undefined;
  const mediaUrls = unique(
    Array.from(article.querySelectorAll<HTMLImageElement>("img[src]"))
      .map((image) => image.currentSrc || image.src)
      .filter((url) => {
        try {
          const parsed = new URL(url);
          return (
            (parsed.hostname === "pbs.twimg.com" || parsed.hostname.endsWith(".pbs.twimg.com")) &&
            parsed.pathname.includes("/media/")
          );
        } catch {
          return false;
        }
      }),
  );
  const quotedPostUrl = Array.from(article.querySelectorAll<HTMLAnchorElement>("a[href]"))
    .map((link) => new URL(link.getAttribute("href") ?? link.href, window.location.origin))
    .find((url) => {
      const linkedId = url.pathname.match(TWEET_PATH_RE)?.[1];
      return linkedId && linkedId !== postId;
    })?.href;

  return {
    platform: "x",
    postId,
    canonicalUrl: tweetUrl.href,
    pageUrl: window.location.href,
    capturedAt: Date.now(),
    visibleSnapshot: {
      authorName,
      authorHandle,
      text,
      publishedAt,
      language,
      mediaUrls,
      quotedPostUrl,
    },
  };
}

function postContextFromCurrentPage() {
  const tweetUrl = tweetUrlFromLocation();
  const tweetId = tweetUrl?.pathname.match(TWEET_PATH_RE)?.[1];
  if (!tweetUrl || !tweetId) {
    return null;
  }
  const article = findCurrentTweetArticle(tweetId);
  return article ? buildPostContext(article, tweetUrl) : null;
}

function postContextFromEvent(event: MouseEvent) {
  const target = event.target instanceof Element ? event.target : null;
  if (!target) {
    return postContextFromCurrentPage();
  }
  const article = closestTweetArticle(target);
  const tweetUrl = article ? tweetLinkFromArticle(article) : null;
  return article && tweetUrl ? buildPostContext(article, tweetUrl) : postContextFromCurrentPage();
}

function findVideoForEvent(event: MouseEvent, target: Element) {
  const directVideo = target.closest("video");
  if (directVideo) {
    return directVideo;
  }

  const pointVideo = document
    .elementsFromPoint(event.clientX, event.clientY)
    .find((element): element is HTMLVideoElement => element instanceof HTMLVideoElement);
  if (pointVideo) {
    return pointVideo;
  }

  const article = target.closest("article") ?? target.closest("[data-testid='tweet']");
  const articleVideo = article?.querySelector("video");
  if (articleVideo) {
    return articleVideo;
  }

  const pageTweetId = tweetUrlFromLocation()?.pathname.match(TWEET_PATH_RE)?.[1];
  if (!pageTweetId) {
    return null;
  }

  return findCurrentTweetArticle(pageTweetId)?.querySelector("video") ?? null;
}

function buildContext(video: HTMLVideoElement, tweetUrl: URL | null): TwitterVideoContext {
  const srcUrl = isDirectVideoUrl(video.currentSrc) ? video.currentSrc : undefined;
  const candidateUrls = unique([
    ...(srcUrl ? [srcUrl] : []),
    ...Array.from(video.querySelectorAll<HTMLSourceElement>("source[src]"))
      .map((source) => source.src)
      .filter(isDirectVideoUrl),
    ...getPerformanceVideoCandidates(),
  ]);

  return {
    srcUrl,
    candidateUrls,
    pageUrl: tweetUrl?.href ?? tweetUrlFromLocation()?.href ?? window.location.href,
    tweetUrl: tweetUrl?.href,
    tweetId: tweetUrl?.pathname.match(TWEET_PATH_RE)?.[1],
    title: document.title,
    capturedAt: Date.now(),
  };
}

function contextFromCurrentPostPage(): TwitterVideoContext | null {
  const tweetUrl = tweetUrlFromLocation();
  const tweetId = tweetUrl?.pathname.match(TWEET_PATH_RE)?.[1];
  if (!tweetUrl || !tweetId) {
    return null;
  }

  const video =
    findCurrentTweetArticle(tweetId)?.querySelector("video") ?? document.querySelector("video");
  return video ? buildContext(video, tweetUrl) : null;
}

function contextFromEvent(event: MouseEvent): TwitterVideoContext | null {
  const target = event.target instanceof Element ? event.target : null;
  const video = target ? findVideoForEvent(event, target) : null;
  if (!target || !video) {
    return contextFromCurrentPostPage();
  }

  return buildContext(video, closestTweetLink(target) ?? tweetUrlFromLocation());
}

function contextFromTarget(target: Element): TwitterVideoContext | null {
  const article = closestTweetArticle(target);
  const video = article?.querySelector("video");
  if (article && video) {
    return buildContext(video, tweetLinkFromArticle(article) ?? tweetUrlFromLocation());
  }

  return contextFromCurrentPostPage();
}

function reportVideoAvailability(context: TwitterVideoContext | null, force = false) {
  const hasVideo = Boolean(context);
  if (!force && hasVideo === lastReportedVideoAvailability) {
    return;
  }

  lastReportedVideoAvailability = hasVideo;
  chrome.runtime.sendMessage({ type: "post.twitterVideoAvailability.set", hasVideo }, () => {
    void chrome.runtime.lastError;
  });
}

document.addEventListener(
  "pointerover",
  (event) => {
    const target = event.target instanceof Element ? event.target : null;
    reportVideoAvailability(target ? contextFromTarget(target) : contextFromCurrentPostPage());
  },
  true,
);

document.addEventListener(
  "contextmenu",
  (event) => {
    lastContext = contextFromEvent(event);
    lastPostContext = postContextFromEvent(event);
    reportVideoAvailability(lastContext, true);
  },
  true,
);

reportVideoAvailability(contextFromCurrentPostPage());

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (!message || typeof message !== "object") {
    return false;
  }

  const type = (message as { type?: unknown }).type;
  if (type === "post.twitterVideoContext.get") {
    const context = contextFromCurrentPostPage() ?? lastContext;
    sendResponse({ ok: Boolean(context), context });
    return false;
  }

  if (type === "post.twitterPostContext.get") {
    const context = lastPostContext ?? postContextFromCurrentPage();
    sendResponse({ ok: Boolean(context), context });
    return false;
  }

  return false;
});
