/**
 * @purpose Validate inbound local-IPC messages sent by the Post CLI and extension native host.
 * @role    Zod boundary for CLI commands and extension asset/bookmark messages.
 * @deps    zod and shared saved-view/asset-list contracts.
 * @gotcha  Wire payloads are canonical/id-based; the renderer resolves ids to names and labels.
 */

import { z } from "zod";

import { assetListSortInputSchema } from "@shared/contracts/assets/asset-list.contract";
import { savedViewFiltersInputSchema } from "@shared/contracts/assets/saved-views/saved-view.contract";

const sidebarTargetSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("mgmt"), id: z.enum(["all", "inbox"]) }),
  z.object({ kind: z.literal("tag"), id: z.string().min(1) }),
]);

const baseFields = {
  source: z.literal("post-cli"),
  dbPath: z.string().min(1),
  emittedAt: z.number().optional(),
};

export const filterApplyMessageSchema = z.object({
  type: z.literal("filter.apply"),
  ...baseFields,
  filters: savedViewFiltersInputSchema,
  sort: assetListSortInputSchema.default("added_desc"),
});

export const filterActivateViewMessageSchema = z.object({
  type: z.literal("filter.activateView"),
  ...baseFields,
  viewId: z.string().min(1),
});

export const filterSelectSidebarMessageSchema = z.object({
  type: z.literal("filter.selectSidebar"),
  ...baseFields,
  item: sidebarTargetSchema,
});

export const filterClearMessageSchema = z.object({
  type: z.literal("filter.clear"),
  ...baseFields,
});

export const filterGetMessageSchema = z.object({
  type: z.literal("filter.get"),
  ...baseFields,
});

export const assetOpenMessageSchema = z.object({
  type: z.literal("asset.open"),
  ...baseFields,
  assetId: z.string().min(1),
});

const extensionBaseFields = {
  source: z.literal("post-extension"),
  dbPath: z.string().min(1),
  emittedAt: z.number().optional(),
};

export const extensionContextGetMessageSchema = z.object({
  type: z.literal("extension.context.get"),
  ...extensionBaseFields,
  vaultId: z.string().min(1).optional(),
});

export const extensionImageSaveMessageSchema = z.object({
  type: z.literal("extension.image.save"),
  ...extensionBaseFields,
  srcUrl: z.string().url(),
  pageUrl: z.string().url().optional(),
  pageTitle: z.string().optional(),
  tagId: z.string().min(1).optional(),
  vaultId: z.string().min(1).optional(),
});

export const extensionVideoSaveMessageSchema = z.object({
  type: z.literal("extension.video.save"),
  ...extensionBaseFields,
  srcUrl: z.string().optional(),
  candidateUrls: z.array(z.string()).optional(),
  pageUrl: z.string().url().optional(),
  pageTitle: z.string().optional(),
  tweetId: z.string().optional(),
  tweetUrl: z.string().url().optional(),
  tagId: z.string().min(1).optional(),
  vaultId: z.string().min(1).optional(),
});

const twitterPostVisibleSnapshotSchema = z.object({
  authorName: z.string().optional(),
  authorHandle: z.string().optional(),
  authorAvatarUrl: z.string().url().optional(),
  text: z.string().optional(),
  textTruncated: z.boolean().optional(),
  publishedAt: z.string().optional(),
  language: z.string().optional(),
  mediaUrls: z.array(z.string().url()).optional(),
  quotedPostUrl: z.string().url().optional(),
  replyToPostUrl: z.string().url().optional(),
});

export const extensionPostSaveMessageSchema = z.object({
  type: z.literal("extension.post.save"),
  ...extensionBaseFields,
  postId: z.string().regex(/^\d+$/),
  canonicalUrl: z.string().url(),
  pageUrl: z.string().url().optional(),
  pageTitle: z.string().optional(),
  capturedAt: z.number().optional(),
  visibleSnapshot: twitterPostVisibleSnapshotSchema.optional(),
  tagId: z.string().min(1).optional(),
  vaultId: z.string().min(1).optional(),
});

const bookmarkBaseCaptureSchema = z.object({
  canonicalUrl: z.string().url(),
  pageUrl: z.string().url(),
  sourceTitle: z.string().max(1000).optional(),
  description: z.string().max(50_000).optional(),
  thumbnailUrl: z.string().url().optional(),
  language: z.string().max(100).optional(),
  capturedAt: z.number(),
});

export const extensionBookmarkCaptureSchema = z.discriminatedUnion("kind", [
  bookmarkBaseCaptureSchema.extend({
    kind: z.literal("web"),
    siteName: z.string().max(500).optional(),
  }),
  bookmarkBaseCaptureSchema.extend({
    kind: z.literal("youtube"),
    videoId: z.string().min(1).max(100),
    channelId: z.string().max(200).optional(),
    channelName: z.string().max(500).optional(),
    channelUrl: z.string().url().optional(),
    publishedAt: z.string().max(100).optional(),
    durationMs: z.number().int().nonnegative().optional(),
    liveStatus: z.enum(["live", "ended", "none", "unknown"]).optional(),
  }),
]);

export const extensionBookmarkLookupMessageSchema = z.object({
  type: z.literal("extension.bookmark.lookup"),
  ...extensionBaseFields,
  capture: extensionBookmarkCaptureSchema,
  vaultId: z.string().min(1).optional(),
});

export const extensionBookmarkSaveMessageSchema = z.object({
  type: z.literal("extension.bookmark.save"),
  ...extensionBaseFields,
  capture: extensionBookmarkCaptureSchema,
  titleOverride: z.string().max(300).optional(),
  note: z.string().max(10_000).optional(),
  tagIds: z.array(z.string().min(1)).max(100).default([]),
  action: z.enum(["create", "update", "copy"]),
  vaultId: z.string().min(1).optional(),
});

export const commandMessageSchema = z.discriminatedUnion("type", [
  filterApplyMessageSchema,
  filterActivateViewMessageSchema,
  filterSelectSidebarMessageSchema,
  filterClearMessageSchema,
  filterGetMessageSchema,
  assetOpenMessageSchema,
]);

export type CommandMessage = z.infer<typeof commandMessageSchema>;
export type CommandOp = "apply" | "activateView" | "selectSidebar" | "clear" | "get" | "openAsset";
export type ExtensionContextGetMessage = z.infer<typeof extensionContextGetMessageSchema>;
export type ExtensionImageSaveMessage = z.infer<typeof extensionImageSaveMessageSchema>;
export type ExtensionVideoSaveMessage = z.infer<typeof extensionVideoSaveMessageSchema>;
export type ExtensionPostSaveMessage = z.infer<typeof extensionPostSaveMessageSchema>;
export type ExtensionBookmarkCapture = z.infer<typeof extensionBookmarkCaptureSchema>;
export type ExtensionBookmarkLookupMessage = z.infer<typeof extensionBookmarkLookupMessageSchema>;
export type ExtensionBookmarkSaveMessage = z.infer<typeof extensionBookmarkSaveMessageSchema>;
