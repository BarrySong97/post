/**
 * @purpose Register Post browser collection context menu entries.
 * @role    Chrome MV3 background service worker for image/video/post save events and native host handoff.
 * @deps    chrome.contextMenus, chrome.tabs, and chrome.runtime extension APIs.
 * @gotcha  Twitter/X videos often expose blob: URLs; only direct MP4 candidates can be imported.
 */

const IMAGE_PARENT_MENU_ID = "post.collect-image";
const IMAGE_TAG_MENU_PREFIX = `${IMAGE_PARENT_MENU_ID}.tag.`;
const VIDEO_PARENT_MENU_ID = "post.collect-video";
const VIDEO_TAG_MENU_PREFIX = `${VIDEO_PARENT_MENU_ID}.tag.`;
const POST_PARENT_MENU_ID = "post.collect-post";
const POST_TAG_MENU_PREFIX = `${POST_PARENT_MENU_ID}.tag.`;
const POST_NATIVE_HOST = "com.post.desktop";
const MAX_CONTEXT_MENU_TAGS = 20;
const SAVE_DEDUP_WINDOW_MS = 5000;
const BACKGROUND_VIDEO_CANDIDATE_LIMIT = 30;

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
        tagId: string;
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
        tagId: string;
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
      appEnv: "dev",
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

async function registerContextMenus() {
  const context = await getDesktopContext();
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
    documentUrlPatterns: ["https://x.com/*", "https://twitter.com/*"],
    visible: false,
  });

  await syncVideoMenuVisibilityForActiveTab();

  chrome.contextMenus.create({
    id: POST_PARENT_MENU_ID,
    title: "Add post to Post",
    contexts: POST_CONTEXTS,
    documentUrlPatterns: ["https://x.com/*", "https://twitter.com/*"],
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

  if (context.context.tags.length === 0) {
    createDisabledChild(IMAGE_PARENT_MENU_ID, "No tags in active vault", IMAGE_CONTEXTS);
    createDisabledChild(VIDEO_PARENT_MENU_ID, "No tags in active vault", VIDEO_CONTEXTS);
    createDisabledChild(POST_PARENT_MENU_ID, "No tags in active vault", POST_CONTEXTS);
    return;
  }

  for (const tag of context.context.tags.slice(0, MAX_CONTEXT_MENU_TAGS)) {
    chrome.contextMenus.create({
      id: `${IMAGE_TAG_MENU_PREFIX}${tag.id}`,
      parentId: IMAGE_PARENT_MENU_ID,
      title: tag.name,
      contexts: IMAGE_CONTEXTS,
    });

    chrome.contextMenus.create({
      id: `${VIDEO_TAG_MENU_PREFIX}${tag.id}`,
      parentId: VIDEO_PARENT_MENU_ID,
      title: tag.name,
      contexts: VIDEO_CONTEXTS,
      documentUrlPatterns: ["https://x.com/*", "https://twitter.com/*"],
    });

    chrome.contextMenus.create({
      id: `${POST_TAG_MENU_PREFIX}${tag.id}`,
      parentId: POST_PARENT_MENU_ID,
      title: tag.name,
      contexts: POST_CONTEXTS,
      documentUrlPatterns: ["https://x.com/*", "https://twitter.com/*"],
    });
  }

  if (context.context.tags.length > MAX_CONTEXT_MENU_TAGS) {
    createDisabledChild(
      IMAGE_PARENT_MENU_ID,
      `Showing first ${MAX_CONTEXT_MENU_TAGS} of ${context.context.tags.length} tags`,
      IMAGE_CONTEXTS,
    );
    createDisabledChild(
      VIDEO_PARENT_MENU_ID,
      `Showing first ${MAX_CONTEXT_MENU_TAGS} of ${context.context.tags.length} tags`,
      VIDEO_CONTEXTS,
    );
    createDisabledChild(
      POST_PARENT_MENU_ID,
      `Showing first ${MAX_CONTEXT_MENU_TAGS} of ${context.context.tags.length} tags`,
      POST_CONTEXTS,
    );
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

chrome.contextMenus.onClicked.addListener((info, tab) => {
  const menuItemId = String(info.menuItemId);
  if (menuItemId.startsWith(IMAGE_TAG_MENU_PREFIX)) {
    saveImageFromContextMenu(menuItemId, info, tab);
    return;
  }

  if (menuItemId.startsWith(VIDEO_TAG_MENU_PREFIX)) {
    void saveVideoFromContextMenu(menuItemId, info, tab);
    return;
  }

  if (menuItemId.startsWith(POST_TAG_MENU_PREFIX)) {
    void savePostFromContextMenu(menuItemId, tab);
  }
});

function saveImageFromContextMenu(
  menuItemId: string,
  info: chrome.contextMenus.OnClickData,
  tab?: chrome.tabs.Tab,
) {
  const tagId = menuItemId.slice(IMAGE_TAG_MENU_PREFIX.length);
  const srcUrl = info.srcUrl;
  if (!srcUrl) {
    console.warn("[Post extension] image context menu click had no srcUrl", info);
    return;
  }

  const dedupKey = `${tagId}:${srcUrl}`;
  const now = Date.now();
  const pendingSince = pendingSaves.get(dedupKey);
  if (pendingSince && now - pendingSince < SAVE_DEDUP_WINDOW_MS) {
    console.log("[Post extension] skipped duplicate image save request", { tagId, srcUrl });
    return;
  }

  pendingSaves.set(dedupKey, now);
  sendNativeMessage<ExtensionImageSaveResponse>({
    type: "post.image.save",
    appEnv: "dev",
    srcUrl,
    pageUrl: info.pageUrl ?? tab?.url,
    pageTitle: tab?.title,
    tagId,
  })
    .then((response) => {
      if (response.ok) {
        console.log("[Post extension] image saved", response.asset);
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
  menuItemId: string,
  info: chrome.contextMenus.OnClickData,
  tab?: chrome.tabs.Tab,
) {
  const tagId = menuItemId.slice(VIDEO_TAG_MENU_PREFIX.length);
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
  const dedupKey = `${tagId}:${pageUrl ?? ""}:${candidateUrls.join("|")}`;
  const now = Date.now();
  const pendingSince = pendingSaves.get(dedupKey);
  if (pendingSince && now - pendingSince < SAVE_DEDUP_WINDOW_MS) {
    console.log("[Post extension] skipped duplicate video save request", { tagId, pageUrl });
    return;
  }

  pendingSaves.set(dedupKey, now);
  sendNativeMessage<ExtensionVideoSaveResponse>({
    type: "post.video.save",
    appEnv: "dev",
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

async function savePostFromContextMenu(menuItemId: string, tab?: chrome.tabs.Tab) {
  const tagId = menuItemId.slice(POST_TAG_MENU_PREFIX.length);
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
  const dedupKey = `post:${tagId}:${context.postId}`;
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
      appEnv: "dev",
      ...context,
      pageTitle: tab.title,
      tagId,
    });
    if (result.ok) {
      console.log("[Post extension] post saved", result.asset);
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
