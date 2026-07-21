/**
 * @purpose Register Post browser collection menus, popup preparation, and save handoffs.
 * @role    Chrome MV3 background worker for image/video/post/web/YouTube collection workflows.
 * @deps    chrome.contextMenus, tabs, scripting, runtime, storage, and native messaging APIs.
 * @gotcha  Only user-triggered popup/save requests may ask for Chrome's post:// launch prompt.
 */

import { inspectBookmarkDocument } from "../page-inspector";
import type {
  BookmarkCapture,
  BookmarkDuplicate,
  BookmarkPopupPrepareResponse,
  BookmarkPopupSaveRequest,
  BookmarkSaveAction,
  BookmarkSaveResponse,
} from "../shared/bookmark";

// Build-time channel injected by vite `define` (see vite.config.chrome.ts). Stamped onto every
// native message as `appEnv`, which the native host maps to post-<appEnv>.sqlite — so the dev
// and prod extension builds target their own databases and never cross over.
declare const __APP_ENV__: "dev" | "prod";
const APP_ENV: "dev" | "prod" = typeof __APP_ENV__ === "undefined" ? "dev" : __APP_ENV__;

const IMAGE_PARENT_MENU_ID = "post.collect-image";
const IMAGE_TAG_MENU_PREFIX = `${IMAGE_PARENT_MENU_ID}.tag.`;
const VIDEO_PARENT_MENU_ID = "post.collect-video";
const VIDEO_TAG_MENU_PREFIX = `${VIDEO_PARENT_MENU_ID}.tag.`;
const POST_PARENT_MENU_ID = "post.collect-post";
const POST_TAG_MENU_PREFIX = `${POST_PARENT_MENU_ID}.tag.`;
const YOUTUBE_PARENT_MENU_ID = "post.collect-youtube";
const YOUTUBE_TAG_MENU_PREFIX = `${YOUTUBE_PARENT_MENU_ID}.tag.`;
const IMAGE_SAVE_UNTAGGED_ID = `${IMAGE_PARENT_MENU_ID}.untagged`;
const VIDEO_SAVE_UNTAGGED_ID = `${VIDEO_PARENT_MENU_ID}.untagged`;
const POST_SAVE_UNTAGGED_ID = `${POST_PARENT_MENU_ID}.untagged`;
const YOUTUBE_SAVE_UNTAGGED_ID = `${YOUTUBE_PARENT_MENU_ID}.untagged`;
const UNTAGGED_MENU_TITLE = "直接保存（进 Inbox）";
const RECENT_TAGS_STORAGE_KEY = "post.recentTagIds";
const MAX_RECENT_TAGS = 6;
const POST_NATIVE_HOST = "com.post.desktop";
const MAX_CONTEXT_MENU_TAGS = 20;
const SAVE_DEDUP_WINDOW_MS = 5000;
const BACKGROUND_VIDEO_CANDIDATE_LIMIT = 30;
const DESKTOP_LAUNCH_TIMEOUT_MS = 15_000;
const DESKTOP_LAUNCH_POLL_MS = 250;
const DESKTOP_PROTOCOL_URL = "post://extension/open";

type MenuTag = { id: string; name: string; color: string | null; sortOrder: number };

async function getRecentTagIds(): Promise<string[]> {
  try {
    const stored = await chrome.storage.local.get(RECENT_TAGS_STORAGE_KEY);
    const value = stored[RECENT_TAGS_STORAGE_KEY];
    return Array.isArray(value) ? value.filter((id): id is string => typeof id === "string") : [];
  } catch {
    return [];
  }
}

async function recordRecentTag(tagId: string): Promise<void> {
  try {
    const current = await getRecentTagIds();
    const next = [tagId, ...current.filter((id) => id !== tagId)].slice(0, MAX_RECENT_TAGS);
    await chrome.storage.local.set({ [RECENT_TAGS_STORAGE_KEY]: next });
  } catch {
    // Best-effort ordering; a storage failure just means no recency boost this time.
  }
}

// Recently-used tags first (in recency order), then the remaining tags in vault order.
// Split so the caller can draw a separator between the two groups.
function partitionTagsByRecency(
  tags: MenuTag[],
  recentIds: string[],
): {
  recent: MenuTag[];
  rest: MenuTag[];
} {
  const byId = new Map(tags.map((tag) => [tag.id, tag]));
  const recent = recentIds
    .map((id) => byId.get(id))
    .filter((tag): tag is MenuTag => tag !== undefined);
  const recentSet = new Set(recent.map((tag) => tag.id));
  const rest = tags.filter((tag) => !recentSet.has(tag.id));
  return { recent, rest };
}

type ContextMenuContexts = [
  `${chrome.contextMenus.ContextType}`,
  ...`${chrome.contextMenus.ContextType}`[],
];

const IMAGE_CONTEXTS = ["image"] satisfies ContextMenuContexts;
const VIDEO_CONTEXTS = ["page", "video"] satisfies ContextMenuContexts;
const POST_CONTEXTS = ["page"] satisfies ContextMenuContexts;
const YOUTUBE_CONTEXTS = ["page", "video"] satisfies ContextMenuContexts;

type ExtensionContextResponse =
  | {
      ok: true;
      context: {
        vault: {
          id: string;
          name: string;
          rootPath: string;
        };
        tags: Array<{
          id: string;
          name: string;
          color: string | null;
          sortOrder: number;
        }>;
      };
    }
  | {
      ok: false;
      message: string;
    };

type DesktopLaunchRequiredResponse = {
  ok: false;
  code: "desktop_unavailable";
  launchRequired: true;
  launchUrl: string;
  message: string;
};

type NativeOperationResponse = { ok: boolean; message?: string };

type ExtensionImageSaveResponse =
  | {
      ok: true;
      asset: {
        id: string;
        title: string;
        relativePath: string;
        tagId: string | null;
      };
    }
  | {
      ok: false;
      message: string;
    };

type ExtensionVideoSaveResponse = ExtensionImageSaveResponse;

type ExtensionPostSaveResponse =
  | {
      ok: true;
      asset: {
        id: string;
        title: string;
        relativePath: string;
        tagId: string | null;
        status: "created" | "updated";
        childAssetIds: string[];
        warnings: string[];
      };
    }
  | { ok: false; message: string };

type ExtensionBookmarkLookupResponse =
  | { ok: true; duplicates: BookmarkDuplicate[] }
  | { ok: false; message: string };

type TwitterVideoContextResponse =
  | {
      ok: true;
      context: {
        srcUrl?: string;
        candidateUrls: string[];
        pageUrl: string;
        tweetUrl?: string;
        tweetId?: string;
        title?: string;
        capturedAt: number;
      };
    }
  | {
      ok: false;
      context: null;
    };

type TwitterPostContextResponse =
  | {
      ok: true;
      context: {
        platform: "x";
        postId: string;
        canonicalUrl: string;
        pageUrl: string;
        capturedAt: number;
        visibleSnapshot: {
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
      };
    }
  | { ok: false; context: null };

function sendNativeMessage<TResponse>(message: Record<string, unknown>): Promise<TResponse> {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendNativeMessage(POST_NATIVE_HOST, message, (response: TResponse) => {
      const error = chrome.runtime.lastError;
      if (error) {
        reject(new Error(error.message));
        return;
      }

      resolve(response);
    });
  });
}

function isDesktopLaunchRequired(response: unknown): response is DesktopLaunchRequiredResponse {
  if (!response || typeof response !== "object") {
    return false;
  }
  const candidate = response as Partial<DesktopLaunchRequiredResponse>;
  return (
    candidate.ok === false &&
    candidate.code === "desktop_unavailable" &&
    candidate.launchRequired === true &&
    candidate.launchUrl === DESKTOP_PROTOCOL_URL
  );
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForDesktop(): Promise<boolean> {
  const deadline = Date.now() + DESKTOP_LAUNCH_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const response = await getDesktopContext();
    if (response.ok) {
      return true;
    }
    await delay(DESKTOP_LAUNCH_POLL_MS);
  }
  return false;
}

let desktopLaunchPromise: Promise<boolean> | null = null;

function launchDesktopFromChrome(): Promise<boolean> {
  if (desktopLaunchPromise) {
    return desktopLaunchPromise;
  }

  desktopLaunchPromise = (async () => {
    await chrome.tabs.create({ url: DESKTOP_PROTOCOL_URL, active: true });
    return waitForDesktop();
  })().finally(() => {
    desktopLaunchPromise = null;
  });
  return desktopLaunchPromise;
}

async function sendUserTriggeredNativeMessage<TResponse extends NativeOperationResponse>(
  message: Record<string, unknown>,
): Promise<TResponse> {
  const first = await sendNativeMessage<TResponse | DesktopLaunchRequiredResponse>({
    ...message,
    launchIfNeeded: true,
  });
  if (!isDesktopLaunchRequired(first)) {
    return first;
  }

  try {
    if (!(await launchDesktopFromChrome())) {
      return {
        ok: false,
        message: "Post 未在 15 秒内打开。请在 Chrome 弹窗中确认后重试。",
      } as TResponse;
    }
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : "Chrome 无法打开 Post。",
    } as TResponse;
  }

  return sendNativeMessage<TResponse>({
    ...message,
    launchIfNeeded: false,
  });
}

async function getDesktopContext(
  options: { launchIfNeeded?: boolean } = {},
): Promise<ExtensionContextResponse> {
  try {
    const request = {
      type: "post.context.get",
      appEnv: APP_ENV,
    };
    const response = options.launchIfNeeded
      ? await sendUserTriggeredNativeMessage<ExtensionContextResponse>(request)
      : await sendNativeMessage<ExtensionContextResponse>({ ...request, launchIfNeeded: false });
    console.log("[Post extension] native context response", response);
    return response;
  } catch (error) {
    console.warn("[Post extension] native context request failed", error);
    return {
      ok: false,
      message: error instanceof Error ? error.message : "Native messaging failed.",
    };
  }
}

function createDisabledChild(parentId: string, title: string, contexts: ContextMenuContexts) {
  chrome.contextMenus.create({
    id: `${parentId}.disabled`,
    parentId,
    title,
    contexts,
    enabled: false,
  });
}

function removeAllContextMenus(): Promise<void> {
  return new Promise((resolve) => {
    chrome.contextMenus.removeAll(() => {
      resolve();
    });
  });
}

let contextMenuRegistration = Promise.resolve();
const pendingSaves = new Map<string, number>();
const tabVideoCandidates = new Map<number, string[]>();
const tabVideoAvailability = new Map<number, boolean>();

async function setVideoMenuVisibility(visible: boolean) {
  try {
    await chrome.contextMenus.update(VIDEO_PARENT_MENU_ID, { visible });
  } catch {
    // Menu registration may still be waiting for Desktop context.
  }
}

async function syncVideoMenuVisibilityForActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  if (!tab?.id) {
    await setVideoMenuVisibility(false);
    return;
  }

  const response = await getTwitterVideoContext(tab.id);
  const hasVideo = response.ok;
  tabVideoAvailability.set(tab.id, hasVideo);
  await setVideoMenuVisibility(hasVideo);
}

function queueContextMenuRegistration() {
  contextMenuRegistration = contextMenuRegistration.then(
    registerContextMenus,
    registerContextMenus,
  );
  return contextMenuRegistration;
}

const X_URL_PATTERNS = ["https://x.com/*", "https://twitter.com/*"];
const YOUTUBE_URL_PATTERNS = [
  "https://www.youtube.com/watch*",
  "https://www.youtube.com/shorts/*",
  "https://www.youtube.com/live/*",
  "https://m.youtube.com/watch*",
  "https://m.youtube.com/shorts/*",
  "https://youtu.be/*",
  "https://www.youtube-nocookie.com/embed/*",
];

// Build one parent's submenu: "直接保存" first, then a separator, then tags ordered
// recent-first (with a separator between recent and the rest). Works with zero tags —
// direct-save is always available, so an empty vault no longer disables the menu.
function buildSaveSubmenu(opts: {
  parentId: string;
  tagPrefix: string;
  untaggedId: string;
  contexts: ContextMenuContexts;
  documentUrlPatterns?: string[];
  tags: MenuTag[];
  recentIds: string[];
}) {
  const patterns = opts.documentUrlPatterns
    ? { documentUrlPatterns: opts.documentUrlPatterns }
    : {};

  chrome.contextMenus.create({
    id: opts.untaggedId,
    parentId: opts.parentId,
    title: UNTAGGED_MENU_TITLE,
    contexts: opts.contexts,
    ...patterns,
  });

  const { recent, rest } = partitionTagsByRecency(opts.tags, opts.recentIds);
  const ordered = [...recent, ...rest].slice(0, MAX_CONTEXT_MENU_TAGS);
  if (ordered.length === 0) {
    return;
  }

  chrome.contextMenus.create({
    id: `${opts.parentId}.sep-top`,
    parentId: opts.parentId,
    type: "separator",
    contexts: opts.contexts,
    ...patterns,
  });

  const recentShown = ordered.filter((tag) => recent.some((item) => item.id === tag.id)).length;
  ordered.forEach((tag, index) => {
    if (index === recentShown && recentShown > 0 && recentShown < ordered.length) {
      chrome.contextMenus.create({
        id: `${opts.parentId}.sep-recent`,
        parentId: opts.parentId,
        type: "separator",
        contexts: opts.contexts,
        ...patterns,
      });
    }
    chrome.contextMenus.create({
      id: `${opts.tagPrefix}${tag.id}`,
      parentId: opts.parentId,
      title: tag.name,
      contexts: opts.contexts,
      ...patterns,
    });
  });

  if (opts.tags.length > MAX_CONTEXT_MENU_TAGS) {
    chrome.contextMenus.create({
      id: `${opts.parentId}.overflow`,
      parentId: opts.parentId,
      title: `已显示 ${MAX_CONTEXT_MENU_TAGS} / ${opts.tags.length} 个 tag`,
      contexts: opts.contexts,
      enabled: false,
      ...patterns,
    });
  }
}

async function registerContextMenus() {
  const context = await getDesktopContext();
  const recentIds = await getRecentTagIds();
  await removeAllContextMenus();

  chrome.contextMenus.create({
    id: IMAGE_PARENT_MENU_ID,
    title: "Add image to Post",
    contexts: IMAGE_CONTEXTS,
  });

  chrome.contextMenus.create({
    id: VIDEO_PARENT_MENU_ID,
    title: "Add video to Post",
    contexts: VIDEO_CONTEXTS,
    documentUrlPatterns: X_URL_PATTERNS,
    visible: false,
  });

  await syncVideoMenuVisibilityForActiveTab();

  chrome.contextMenus.create({
    id: POST_PARENT_MENU_ID,
    title: "Add post to Post",
    contexts: POST_CONTEXTS,
    documentUrlPatterns: X_URL_PATTERNS,
  });

  chrome.contextMenus.create({
    id: YOUTUBE_PARENT_MENU_ID,
    title: "Add YouTube video to Post",
    contexts: YOUTUBE_CONTEXTS,
    documentUrlPatterns: YOUTUBE_URL_PATTERNS,
  });

  const tags = context.ok ? context.context.tags : [];
  buildSaveSubmenu({
    parentId: IMAGE_PARENT_MENU_ID,
    tagPrefix: IMAGE_TAG_MENU_PREFIX,
    untaggedId: IMAGE_SAVE_UNTAGGED_ID,
    contexts: IMAGE_CONTEXTS,
    tags,
    recentIds,
  });
  buildSaveSubmenu({
    parentId: VIDEO_PARENT_MENU_ID,
    tagPrefix: VIDEO_TAG_MENU_PREFIX,
    untaggedId: VIDEO_SAVE_UNTAGGED_ID,
    contexts: VIDEO_CONTEXTS,
    documentUrlPatterns: X_URL_PATTERNS,
    tags,
    recentIds,
  });
  buildSaveSubmenu({
    parentId: POST_PARENT_MENU_ID,
    tagPrefix: POST_TAG_MENU_PREFIX,
    untaggedId: POST_SAVE_UNTAGGED_ID,
    contexts: POST_CONTEXTS,
    documentUrlPatterns: X_URL_PATTERNS,
    tags,
    recentIds,
  });
  buildSaveSubmenu({
    parentId: YOUTUBE_PARENT_MENU_ID,
    tagPrefix: YOUTUBE_TAG_MENU_PREFIX,
    untaggedId: YOUTUBE_SAVE_UNTAGGED_ID,
    contexts: YOUTUBE_CONTEXTS,
    documentUrlPatterns: YOUTUBE_URL_PATTERNS,
    tags,
    recentIds,
  });

  if (!context.ok) {
    for (const [parentId, contexts] of [
      [IMAGE_PARENT_MENU_ID, IMAGE_CONTEXTS],
      [VIDEO_PARENT_MENU_ID, VIDEO_CONTEXTS],
      [POST_PARENT_MENU_ID, POST_CONTEXTS],
      [YOUTUBE_PARENT_MENU_ID, YOUTUBE_CONTEXTS],
    ] as const) {
      createDisabledChild(parentId, "Post closed · saving opens it", contexts);
    }
  }
}

chrome.runtime.onInstalled.addListener(() => {
  void queueContextMenuRegistration();
});

chrome.runtime.onStartup.addListener(() => {
  void queueContextMenuRegistration();
});

chrome.tabs.onRemoved.addListener((tabId) => {
  tabVideoCandidates.delete(tabId);
  tabVideoAvailability.delete(tabId);
});

chrome.tabs.onActivated.addListener(({ tabId }) => {
  void setVideoMenuVisibility(tabVideoAvailability.get(tabId) ?? false);
});

async function inspectBookmarkInTab(tabId: number): Promise<BookmarkCapture> {
  const results = await chrome.scripting.executeScript({
    target: { tabId },
    func: inspectBookmarkDocument,
  });
  const capture = results[0]?.result;
  if (!capture) {
    throw new Error("当前页面不支持收藏。请打开普通网页或 YouTube 视频页面。");
  }
  return capture;
}

async function lookupBookmark(
  capture: BookmarkCapture,
  options: { launchIfNeeded?: boolean } = {},
): Promise<ExtensionBookmarkLookupResponse> {
  try {
    const request = {
      type: "post.bookmark.lookup",
      appEnv: APP_ENV,
      capture,
    };
    return options.launchIfNeeded
      ? await sendUserTriggeredNativeMessage<ExtensionBookmarkLookupResponse>(request)
      : await sendNativeMessage<ExtensionBookmarkLookupResponse>({
          ...request,
          launchIfNeeded: false,
        });
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : "Bookmark lookup failed.",
    };
  }
}

async function saveBookmark(input: {
  capture: BookmarkCapture;
  titleOverride?: string;
  note?: string;
  tagIds: string[];
  action: BookmarkSaveAction;
}): Promise<BookmarkSaveResponse> {
  try {
    return await sendUserTriggeredNativeMessage<BookmarkSaveResponse>({
      type: "post.bookmark.save",
      appEnv: APP_ENV,
      ...input,
    });
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : "Bookmark save failed.",
    };
  }
}

async function prepareBookmarkPopup(): Promise<BookmarkPopupPrepareResponse> {
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  if (!tab?.id) {
    return { ok: false, message: "没有可读取的活动标签页。" };
  }
  try {
    const [context, capture] = await Promise.all([
      getDesktopContext({ launchIfNeeded: true }),
      inspectBookmarkInTab(tab.id),
    ]);
    if (!context.ok) {
      return { ok: false, message: context.message };
    }
    const lookup = await lookupBookmark(capture, { launchIfNeeded: true });
    if (!lookup.ok) {
      return { ok: false, message: lookup.message };
    }
    return {
      ok: true,
      vault: { id: context.context.vault.id, name: context.context.vault.name },
      tags: context.context.tags,
      capture,
      duplicates: lookup.duplicates,
    };
  } catch (error) {
    return {
      ok: false,
      message:
        error instanceof Error
          ? error.message
          : "无法读取当前页面。Chrome 内部页面不允许 Extension 收藏。",
    };
  }
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || typeof message !== "object") {
    return false;
  }

  const type = (message as { type?: unknown }).type;
  if (type === "post.bookmarkPopup.prepare") {
    void prepareBookmarkPopup().then(sendResponse);
    return true;
  }
  if (type === "post.bookmarkPopup.save") {
    const request = message as BookmarkPopupSaveRequest;
    void saveBookmark({
      capture: request.capture,
      titleOverride: request.titleOverride,
      note: request.note,
      tagIds: request.tagIds,
      action: request.action,
    }).then(sendResponse);
    return true;
  }
  if (type !== "post.twitterVideoAvailability.set") {
    return false;
  }

  const tabId = sender.tab?.id;
  const hasVideo = (message as { hasVideo?: unknown }).hasVideo === true;
  if (tabId === undefined) {
    return false;
  }

  tabVideoAvailability.set(tabId, hasVideo);
  if (sender.tab?.active) {
    void setVideoMenuVisibility(hasVideo);
  }
  return false;
});

chrome.webRequest.onBeforeRequest.addListener(
  (details) => {
    if (details.tabId < 0 || !isTwitterVideoCandidate(details.url)) {
      return undefined;
    }

    const candidates = tabVideoCandidates.get(details.tabId) ?? [];
    tabVideoCandidates.set(
      details.tabId,
      [details.url, ...candidates.filter((url) => url !== details.url)].slice(
        0,
        BACKGROUND_VIDEO_CANDIDATE_LIMIT,
      ),
    );
    return undefined;
  },
  { urls: ["https://video.twimg.com/*"] },
);

// Refresh after every successful save so a cold-start direct save replaces the offline-only menu
// with the now-running Desktop context. Tagged saves also promote their tag first.
function afterSuccessfulSave(tagId: string | undefined) {
  if (tagId) {
    void recordRecentTag(tagId).then(() => queueContextMenuRegistration());
  } else {
    void queueContextMenuRegistration();
  }
}

chrome.contextMenus.onClicked.addListener((info, tab) => {
  const id = String(info.menuItemId);
  if (id === IMAGE_SAVE_UNTAGGED_ID) {
    saveImageFromContextMenu(undefined, info, tab);
  } else if (id.startsWith(IMAGE_TAG_MENU_PREFIX)) {
    saveImageFromContextMenu(id.slice(IMAGE_TAG_MENU_PREFIX.length), info, tab);
  } else if (id === VIDEO_SAVE_UNTAGGED_ID) {
    void saveVideoFromContextMenu(undefined, info, tab);
  } else if (id.startsWith(VIDEO_TAG_MENU_PREFIX)) {
    void saveVideoFromContextMenu(id.slice(VIDEO_TAG_MENU_PREFIX.length), info, tab);
  } else if (id === POST_SAVE_UNTAGGED_ID) {
    void savePostFromContextMenu(undefined, tab);
  } else if (id.startsWith(POST_TAG_MENU_PREFIX)) {
    void savePostFromContextMenu(id.slice(POST_TAG_MENU_PREFIX.length), tab);
  } else if (id === YOUTUBE_SAVE_UNTAGGED_ID) {
    void saveYouTubeBookmarkFromContextMenu(undefined, tab);
  } else if (id.startsWith(YOUTUBE_TAG_MENU_PREFIX)) {
    void saveYouTubeBookmarkFromContextMenu(id.slice(YOUTUBE_TAG_MENU_PREFIX.length), tab);
  }
});

function saveImageFromContextMenu(
  tagId: string | undefined,
  info: chrome.contextMenus.OnClickData,
  tab?: chrome.tabs.Tab,
) {
  const srcUrl = info.srcUrl;
  if (!srcUrl) {
    console.warn("[Post extension] image context menu click had no srcUrl", info);
    return;
  }

  const dedupKey = `${tagId ?? "inbox"}:${srcUrl}`;
  const now = Date.now();
  const pendingSince = pendingSaves.get(dedupKey);
  if (pendingSince && now - pendingSince < SAVE_DEDUP_WINDOW_MS) {
    console.log("[Post extension] skipped duplicate image save request", { tagId, srcUrl });
    return;
  }

  pendingSaves.set(dedupKey, now);
  sendUserTriggeredNativeMessage<ExtensionImageSaveResponse>({
    type: "post.image.save",
    appEnv: APP_ENV,
    srcUrl,
    pageUrl: info.pageUrl ?? tab?.url,
    pageTitle: tab?.title,
    tagId,
  })
    .then((response) => {
      if (response.ok) {
        console.log("[Post extension] image saved", response.asset);
        afterSuccessfulSave(tagId);
      } else {
        console.warn("[Post extension] image save failed", response.message);
      }
    })
    .catch((error) => {
      console.warn("[Post extension] native image save failed", error);
    })
    .finally(() => {
      pendingSaves.delete(dedupKey);
    });
}

function getTwitterVideoContext(tabId: number): Promise<TwitterVideoContextResponse> {
  return new Promise((resolve) => {
    chrome.tabs.sendMessage(
      tabId,
      { type: "post.twitterVideoContext.get" },
      (response: TwitterVideoContextResponse | undefined) => {
        const error = chrome.runtime.lastError;
        if (error || !response) {
          resolve({ ok: false, context: null });
          return;
        }

        resolve(response);
      },
    );
  });
}

function getTwitterPostContext(tabId: number): Promise<TwitterPostContextResponse> {
  return new Promise((resolve) => {
    chrome.tabs.sendMessage(
      tabId,
      { type: "post.twitterPostContext.get" },
      (response: TwitterPostContextResponse | undefined) => {
        const error = chrome.runtime.lastError;
        if (error || !response) {
          resolve({ ok: false, context: null });
          return;
        }
        resolve(response);
      },
    );
  });
}

function isTwitterVideoCandidate(rawUrl: string) {
  try {
    const url = new URL(rawUrl);
    const pathname = url.pathname.toLowerCase();
    return (
      url.hostname.endsWith("video.twimg.com") &&
      (pathname.includes(".mp4") || pathname.includes(".m3u8"))
    );
  } catch {
    return false;
  }
}

async function saveVideoFromContextMenu(
  tagId: string | undefined,
  info: chrome.contextMenus.OnClickData,
  tab?: chrome.tabs.Tab,
) {
  const context = tab?.id
    ? await getTwitterVideoContext(tab.id)
    : { ok: false as const, context: null };
  const srcUrl = context.ok ? context.context.srcUrl : info.srcUrl;
  const candidateUrls = context.ok
    ? [...context.context.candidateUrls, ...(tab?.id ? (tabVideoCandidates.get(tab.id) ?? []) : [])]
    : info.srcUrl
      ? [info.srcUrl]
      : tab?.id
        ? (tabVideoCandidates.get(tab.id) ?? [])
        : [];
  const pageUrl = context.ok ? context.context.pageUrl : (info.pageUrl ?? tab?.url);
  const pageTitle = context.ok ? context.context.title : tab?.title;
  const dedupKey = `${tagId ?? "inbox"}:${pageUrl ?? ""}:${candidateUrls.join("|")}`;
  const now = Date.now();
  const pendingSince = pendingSaves.get(dedupKey);
  if (pendingSince && now - pendingSince < SAVE_DEDUP_WINDOW_MS) {
    console.log("[Post extension] skipped duplicate video save request", { tagId, pageUrl });
    return;
  }

  pendingSaves.set(dedupKey, now);
  sendUserTriggeredNativeMessage<ExtensionVideoSaveResponse>({
    type: "post.video.save",
    appEnv: APP_ENV,
    srcUrl,
    candidateUrls,
    pageUrl,
    pageTitle,
    tweetId: context.ok ? context.context.tweetId : undefined,
    tweetUrl: context.ok ? context.context.tweetUrl : undefined,
    tagId,
  })
    .then((response) => {
      if (response.ok) {
        console.log("[Post extension] video saved", response.asset);
        afterSuccessfulSave(tagId);
      } else {
        console.warn("[Post extension] video save failed", response.message);
      }
    })
    .catch((error) => {
      console.warn("[Post extension] native video save failed", error);
    })
    .finally(() => {
      pendingSaves.delete(dedupKey);
    });
}

async function savePostFromContextMenu(tagId: string | undefined, tab?: chrome.tabs.Tab) {
  if (!tab?.id) {
    console.warn("[Post extension] post context menu click had no tab id");
    return;
  }

  const response = await getTwitterPostContext(tab.id);
  if (!response.ok) {
    console.warn("[Post extension] no X post was found at the context menu target");
    return;
  }

  const context = response.context;
  const dedupKey = `post:${tagId ?? "inbox"}:${context.postId}`;
  const now = Date.now();
  const pendingSince = pendingSaves.get(dedupKey);
  if (pendingSince && now - pendingSince < SAVE_DEDUP_WINDOW_MS) {
    console.log("[Post extension] skipped duplicate post save request", {
      tagId,
      postId: context.postId,
    });
    return;
  }

  pendingSaves.set(dedupKey, now);
  try {
    const result = await sendUserTriggeredNativeMessage<ExtensionPostSaveResponse>({
      type: "post.post.save",
      appEnv: APP_ENV,
      ...context,
      pageTitle: tab.title,
      tagId,
    });
    if (result.ok) {
      console.log("[Post extension] post saved", result.asset);
      afterSuccessfulSave(tagId);
    } else {
      console.warn("[Post extension] post save failed", result.message);
    }
  } catch (error) {
    console.warn("[Post extension] native post save failed", error);
  } finally {
    pendingSaves.delete(dedupKey);
  }
}

async function saveYouTubeBookmarkFromContextMenu(
  tagId: string | undefined,
  tab?: chrome.tabs.Tab,
) {
  if (!tab?.id) {
    console.warn("[Post extension] YouTube bookmark menu click had no tab id");
    return;
  }
  let capture: BookmarkCapture;
  try {
    capture = await inspectBookmarkInTab(tab.id);
  } catch (error) {
    console.warn("[Post extension] YouTube page inspection failed", error);
    return;
  }
  if (capture.kind !== "youtube") {
    console.warn("[Post extension] context-menu page was not a YouTube video", capture.pageUrl);
    return;
  }

  const dedupKey = `youtube:${tagId ?? "inbox"}:${capture.videoId}`;
  const now = Date.now();
  const pendingSince = pendingSaves.get(dedupKey);
  if (pendingSince && now - pendingSince < SAVE_DEDUP_WINDOW_MS) {
    console.log("[Post extension] skipped duplicate YouTube save request", {
      tagId,
      videoId: capture.videoId,
    });
    return;
  }

  pendingSaves.set(dedupKey, now);
  try {
    const result = await saveBookmark({
      capture,
      tagIds: tagId ? [tagId] : [],
      action: "update",
    });
    if (result.ok) {
      console.log("[Post extension] YouTube bookmark saved", result.asset);
      afterSuccessfulSave(tagId);
    } else {
      console.warn("[Post extension] YouTube bookmark save failed", result.message);
    }
  } finally {
    pendingSaves.delete(dedupKey);
  }
}

void queueContextMenuRegistration();
