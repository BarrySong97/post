/**
 * @purpose Validate inbound local-IPC live UI command messages sent by the Post CLI.
 * @role    Zod schema boundary for the socket server's filter and asset command family.
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
