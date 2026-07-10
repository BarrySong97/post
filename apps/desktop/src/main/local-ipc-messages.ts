/**
 * @purpose Validate inbound local-IPC messages sent by the Post CLI and extension native host.
 * @role    Zod schema boundary for the socket server's filter, asset, and extension command families.
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
  sort: assetListSortInputSchema.default("updated_desc"),
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
  tagId: z.string().min(1),
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
  tagId: z.string().min(1),
  vaultId: z.string().min(1).optional(),
});

const twitterPostVisibleSnapshotSchema = z.object({
  authorName: z.string().optional(),
  authorHandle: z.string().optional(),
  text: z.string().optional(),
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
  tagId: z.string().min(1),
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
