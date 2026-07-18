/**
 * @purpose Render and submit the browser-extension bookmark popup.
 * @role    Lightweight MV3 popup UI for web and YouTube captures.
 * @deps    chrome.runtime messaging and shared bookmark contracts.
 * @gotcha  Popup lifetime is short; background owns inspection, native messaging, and deduplication.
 */

import type {
  BookmarkPopupPrepareResponse,
  BookmarkPopupSaveRequest,
  BookmarkSaveAction,
  BookmarkSaveResponse,
} from "../shared/bookmark";

function element<T extends HTMLElement>(id: string): T {
  const value = document.getElementById(id);
  if (!value) {
    throw new Error(`Missing popup element: ${id}`);
  }
  return value as T;
}

function sendRuntimeMessage<T>(message: unknown): Promise<T> {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(message, (response: T) => {
      const error = chrome.runtime.lastError;
      if (error) {
        reject(new Error(error.message));
        return;
      }
      resolve(response);
    });
  });
}

function formatDuration(durationMs: number | undefined) {
  if (durationMs === undefined) {
    return undefined;
  }
  const seconds = Math.max(0, Math.round(durationMs / 1000));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const rest = seconds % 60;
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, "0")}:${String(rest).padStart(2, "0")}`
    : `${minutes}:${String(rest).padStart(2, "0")}`;
}

const loading = element<HTMLElement>("loading");
const errorState = element<HTMLElement>("error");
const errorMessage = element<HTMLElement>("error-message");
const content = element<HTMLElement>("content");
const form = element<HTMLFormElement>("form");
const titleInput = element<HTMLInputElement>("title");
const noteInput = element<HTMLTextAreaElement>("note");
const tagsContainer = element<HTMLElement>("tags");
const status = element<HTMLElement>("status");
const saveButton = element<HTMLButtonElement>("save");
const updateButton = element<HTMLButtonElement>("update");
const copyButton = element<HTMLButtonElement>("copy");
const selectedTagIds = new Set<string>();
let prepared: Extract<BookmarkPopupPrepareResponse, { ok: true }> | null = null;

function showError(message: string) {
  loading.hidden = true;
  content.hidden = true;
  errorMessage.textContent = message;
  errorState.hidden = false;
}

function setSaving(saving: boolean) {
  saveButton.disabled = saving;
  updateButton.disabled = saving;
  copyButton.disabled = saving;
  titleInput.disabled = saving;
  noteInput.disabled = saving;
  for (const button of Array.from(tagsContainer.querySelectorAll<HTMLButtonElement>("button"))) {
    button.disabled = saving;
  }
}

function showStatus(message: string, isError = false) {
  status.textContent = message;
  status.classList.toggle("error", isError);
  status.hidden = false;
}

async function save(action: BookmarkSaveAction) {
  if (!prepared) {
    return;
  }
  setSaving(true);
  status.hidden = true;
  const sourceTitle = prepared.capture.sourceTitle?.trim() ?? "";
  const editedTitle = titleInput.value.trim();
  const request: BookmarkPopupSaveRequest = {
    type: "post.bookmarkPopup.save",
    capture: prepared.capture,
    titleOverride: editedTitle && editedTitle !== sourceTitle ? editedTitle : undefined,
    note: noteInput.value.trim() || undefined,
    tagIds: [...selectedTagIds],
    action,
  };
  try {
    const response = await sendRuntimeMessage<BookmarkSaveResponse>(request);
    if (!response.ok) {
      throw new Error(response.message);
    }
    const warning = response.asset.warnings.length > 0 ? "，部分信息稍后可再次更新" : "";
    showStatus(`${response.asset.status === "updated" ? "已更新" : "已收藏"}${warning}`);
    setTimeout(() => window.close(), 900);
  } catch (error) {
    showStatus(error instanceof Error ? error.message : "收藏失败，请重试。", true);
    setSaving(false);
  }
}

function render(result: Extract<BookmarkPopupPrepareResponse, { ok: true }>) {
  prepared = result;
  const capture = result.capture;
  element<HTMLElement>("vault").textContent = result.vault.name;
  element<HTMLElement>("preview-title").textContent = capture.sourceTitle ?? capture.canonicalUrl;
  element<HTMLElement>("preview-byline").textContent =
    capture.kind === "youtube" ? (capture.channelName ?? "YouTube") : (capture.siteName ?? "");
  titleInput.value = capture.sourceTitle ?? capture.canonicalUrl;

  const source = element<HTMLElement>("source");
  source.textContent =
    capture.kind === "youtube" ? "▶ YouTube" : new URL(capture.canonicalUrl).host;
  source.classList.toggle("youtube", capture.kind === "youtube");
  const cover = element<HTMLImageElement>("cover");
  if (capture.thumbnailUrl) {
    cover.src = capture.thumbnailUrl;
    cover.hidden = false;
  }
  element<HTMLElement>("youtube-play").hidden = capture.kind !== "youtube";
  const duration = element<HTMLElement>("duration");
  const durationLabel = capture.kind === "youtube" ? formatDuration(capture.durationMs) : undefined;
  duration.textContent = durationLabel ?? "";
  duration.hidden = !durationLabel;

  tagsContainer.replaceChildren();
  if (result.tags.length === 0) {
    const empty = document.createElement("span");
    empty.className = "empty-tags";
    empty.textContent = "当前 Vault 还没有 Tag";
    tagsContainer.append(empty);
  } else {
    for (const tag of result.tags) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "tag";
      button.setAttribute("aria-pressed", "false");
      const dot = document.createElement("span");
      dot.className = "tag-dot";
      dot.style.setProperty("--tag-color", tag.color ?? "#a1a1aa");
      const label = document.createElement("span");
      label.textContent = tag.name;
      button.append(dot, label);
      button.addEventListener("click", () => {
        if (selectedTagIds.has(tag.id)) {
          selectedTagIds.delete(tag.id);
          button.setAttribute("aria-pressed", "false");
        } else {
          selectedTagIds.add(tag.id);
          button.setAttribute("aria-pressed", "true");
        }
      });
      tagsContainer.append(button);
    }
  }

  const hasDuplicates = result.duplicates.length > 0;
  element<HTMLElement>("duplicate").hidden = !hasDuplicates;
  element<HTMLElement>("normal-actions").hidden = hasDuplicates;
  if (hasDuplicates) {
    element<HTMLElement>("header-title").textContent = "已收藏过";
    element<HTMLElement>("duplicate-title").textContent =
      `这个页面已有 ${result.duplicates.length} 份收藏`;
  }

  loading.hidden = true;
  content.hidden = false;
  titleInput.focus();
  titleInput.select();
}

form.addEventListener("submit", (event) => {
  event.preventDefault();
  void save("create");
});
updateButton.addEventListener("click", () => void save("update"));
copyButton.addEventListener("click", () => void save("copy"));

void sendRuntimeMessage<BookmarkPopupPrepareResponse>({ type: "post.bookmarkPopup.prepare" })
  .then((result) => {
    if (result.ok) {
      render(result);
    } else {
      showError(result.message);
    }
  })
  .catch((error) => {
    showError(error instanceof Error ? error.message : "无法连接 Extension 后台。请重试。");
  });
