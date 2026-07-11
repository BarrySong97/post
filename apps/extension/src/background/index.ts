/**
 * @purpose Register Post browser collection context menu entries.
 * @role    Chrome MV3 background service worker for image/video/post save events and native host handoff.
 * @deps    chrome.contextMenus, chrome.tabs, and chrome.runtime extension APIs.
 * @gotcha  Twitter/X videos often expose blob: URLs; only direct MP4 candidates can be imported.
 */

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
const IMAGE_SAVE_UNTAGGED_ID = `${IMAGE_PARENT_MENU_ID}.untagged`;
const VIDEO_SAVE_UNTAGGED_ID = `${VIDEO_PARENT_MENU_ID}.untagged`;
const POST_SAVE_UNTAGGED_ID = `${POST_PARENT_MENU_ID}.untagged`;
const UNTAGGED_MENU_TITLE = "直接保存（进 Inbox）";
const RECENT_TAGS_STORAGE_KEY = "post.recentTagIds";
const MAX_RECENT_TAGS = 6;
const POST_NATIVE_HOST = "com.post.desktop";
const MAX_CONTEXT_MENU_TAGS = 20;
const SAVE_DEDUP_WINDOW_MS = 5000;
const BACKGROUND_VIDEO_CANDIDATE_LIMIT = 30;

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
          text?: string;
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

async function getDesktopContext(): Promise<ExtensionContextResponse> {
  try {
    const response = await sendNativeMessage<ExtensionContextResponse>({
      type: "post.context.get",
      appEnv: APP_ENV,
    });
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

function formatMenuMessage(prefix: string, message: string) {
  const normalized = message.trim().replace(/\s+/g, " ");
  const clipped = normalized.length > 54 ? `${normalized.slice(0, 51)}...` : normalized;
  return `${prefix}: ${clipped}`;
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

  if (!context.ok) {
    createDisabledChild(
      IMAGE_PARENT_MENU_ID,
      formatMenuMessage("Post unavailable", context.message),
      IMAGE_CONTEXTS,
    );
    createDisabledChild(
      VIDEO_PARENT_MENU_ID,
      formatMenuMessage("Post unavailable", context.message),
      VIDEO_CONTEXTS,
    );
    createDisabledChild(
      POST_PARENT_MENU_ID,
      formatMenuMessage("Post unavailable", context.message),
      POST_CONTEXTS,
    );
    return;
  }

  const tags = context.context.tags;
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

chrome.runtime.onMessage.addListener((message, sender) => {
  if (
    !message ||
    typeof message !== "object" ||
    (message as { type?: unknown }).type !== "post.twitterVideoAvailability.set"
  ) {
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

// After a save that used a tag, promote it in the recency list and rebuild the menu so
// the tag surfaces first next time. Untagged (direct-to-Inbox) saves change no ordering.
function afterTaggedSave(tagId: string | undefined) {
  if (tagId) {
    void recordRecentTag(tagId).then(() => queueContextMenuRegistration());
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
  sendNativeMessage<ExtensionImageSaveResponse>({
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
        afterTaggedSave(tagId);
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
  sendNativeMessage<ExtensionVideoSaveResponse>({
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
        afterTaggedSave(tagId);
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
    const result = await sendNativeMessage<ExtensionPostSaveResponse>({
      type: "post.post.save",
      appEnv: APP_ENV,
      ...context,
      pageTitle: tab.title,
      tagId,
    });
    if (result.ok) {
      console.log("[Post extension] post saved", result.asset);
      afterTaggedSave(tagId);
    } else {
      console.warn("[Post extension] post save failed", result.message);
    }
  } catch (error) {
    console.warn("[Post extension] native post save failed", error);
  } finally {
    pendingSaves.delete(dedupKey);
  }
}

void queueContextMenuRegistration();
