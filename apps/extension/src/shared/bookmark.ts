/**
 * @purpose Define browser bookmark snapshots and popup/background message contracts.
 * @role    Browser-safe shared types for generic web and YouTube collection workflows.
 * @deps    DOM URL primitives only.
 * @gotcha  Source metadata is untrusted page content; Desktop validates every wire payload again.
 */

export type BookmarkTag = {
  id: string;
  name: string;
  color: string | null;
  sortOrder: number;
};

type BaseBookmarkCapture = {
  canonicalUrl: string;
  pageUrl: string;
  sourceTitle?: string;
  description?: string;
  thumbnailUrl?: string;
  language?: string;
  capturedAt: number;
};

export type WebBookmarkCapture = BaseBookmarkCapture & {
  kind: "web";
  siteName?: string;
};

export type YouTubeBookmarkCapture = BaseBookmarkCapture & {
  kind: "youtube";
  videoId: string;
  channelId?: string;
  channelName?: string;
  channelUrl?: string;
  publishedAt?: string;
  durationMs?: number;
  liveStatus?: "live" | "ended" | "none" | "unknown";
};

export type BookmarkCapture = WebBookmarkCapture | YouTubeBookmarkCapture;

export type BookmarkDuplicate = {
  assetId: string;
  title: string;
  copyIndex: number;
};

export type BookmarkPopupPrepareResponse =
  | {
      ok: true;
      vault: { id: string; name: string };
      tags: BookmarkTag[];
      capture: BookmarkCapture;
      duplicates: BookmarkDuplicate[];
    }
  | { ok: false; message: string };

export type BookmarkSaveAction = "create" | "update" | "copy";

export type BookmarkPopupSaveRequest = {
  type: "post.bookmarkPopup.save";
  capture: BookmarkCapture;
  titleOverride?: string;
  note?: string;
  tagIds: string[];
  action: BookmarkSaveAction;
};

export type BookmarkSaveResponse =
  | {
      ok: true;
      asset: {
        id: string;
        title: string;
        relativePath: string;
        status: "created" | "updated";
        warnings: string[];
      };
    }
  | { ok: false; message: string };
