/**
 * @purpose Define shared asset list filter and pagination contracts.
 * @role    Renderer/main boundary schema for browsing assets over tRPC.
 * @deps    zod only.
 * @gotcha  Keep list option values compatible with repository filter parsing and saved views.
 */

import { z } from "zod";

import { optionalVaultInputSchema } from "../common/id.contract";

export const ASSET_LIST_DEFAULT_LIMIT = 80;
export const ASSET_LIST_MAX_LIMIT = 160;

export const assetListTypeFilterValues = [
  "markdown",
  "post",
  "image",
  "video",
  "link",
  "file",
] as const;
export const assetListTimeFilterValues = ["any", "today", "week", "m30"] as const;
export const assetListSourceTypeValues = ["vault", "external_file", "url"] as const;
export const assetListTagMatchValues = ["and", "or"] as const;
export const assetListStatusFilterValues = [
  "inbox",
  "organized",
  "draft",
  "published",
  "archived",
] as const;
export const assetListSortValues = [
  "updated_desc",
  "updated_asc",
  "created_desc",
  "created_asc",
] as const;

export const assetListSortInputSchema = z.enum(assetListSortValues);

export const assetListInputSchema = optionalVaultInputSchema
  .extend({
    tagId: z.string().optional(),
    tagIds: z.array(z.string().min(1)).optional(),
    tagMatch: z.enum(assetListTagMatchValues).optional(),
    statusFilter: z.enum(assetListStatusFilterValues).optional(),
    untagged: z.boolean().optional(),
    typeFilters: z.array(z.enum(assetListTypeFilterValues)).optional(),
    timeFilter: z.enum(assetListTimeFilterValues).optional(),
    sourceTypes: z.array(z.enum(assetListSourceTypeValues)).optional(),
    sort: assetListSortInputSchema.optional(),
    limit: z.number().int().min(1).max(ASSET_LIST_MAX_LIMIT).optional(),
    cursor: z
      .object({
        valueMs: z.number(),
        id: z.string().min(1),
      })
      .optional(),
  })
  .optional();

export const assetHydrateInputSchema = z.object({
  ids: z.array(z.string().min(1)).min(1).max(360),
});

export type AssetListInput = z.infer<typeof assetListInputSchema>;
export type AssetHydrateInput = z.infer<typeof assetHydrateInputSchema>;
export type AssetListSortInput = z.infer<typeof assetListSortInputSchema>;
