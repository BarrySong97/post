/**
 * @purpose Define shared saved view contracts for filters, sorting, and forms.
 * @role    Renderer/main Zod schemas and constants for saved view tRPC inputs.
 * @deps    zod and asset list contracts.
 * @gotcha  Saved view filter JSON persistence expects these option values to stay stable.
 */

import { z } from "zod";

import {
  assetListSortInputSchema,
  assetListSourceTypeValues,
  assetListStatusFilterValues,
  assetListTagMatchValues,
  assetListTimeFilterValues,
  assetListTypeFilterValues,
} from "../asset-list.contract";

export const SAVED_VIEW_NAME_MAX_LENGTH = 80;
export const SAVED_VIEW_ICON_MAX_LENGTH = 80;
export const DEFAULT_SAVED_VIEW_ICON = "lucide:folder-kanban";

export const savedViewFiltersInputSchema = z.object({
  match: z.enum(assetListTagMatchValues).default("and"),
  tagIds: z.array(z.string().min(1)).default([]),
  types: z.array(z.enum(assetListTypeFilterValues)).default([]),
  sources: z.array(z.enum(assetListSourceTypeValues)).default([]),
  time: z.enum(assetListTimeFilterValues).default("any"),
  status: z.enum(["any", ...assetListStatusFilterValues]).default("any"),
});

export const savedViewInputSchema = z.object({
  vaultId: z.string().min(1).optional(),
  name: z.string().trim().min(1).max(SAVED_VIEW_NAME_MAX_LENGTH),
  icon: z.string().trim().max(SAVED_VIEW_ICON_MAX_LENGTH).optional(),
  filters: savedViewFiltersInputSchema,
  sort: assetListSortInputSchema.default("added_desc"),
});

export const updateSavedViewInputSchema = savedViewInputSchema.extend({
  id: z.string().min(1),
});

export const deleteSavedViewInputSchema = z.object({
  id: z.string().min(1),
});

export const reorderSavedViewsInputSchema = z.object({
  vaultId: z.string().min(1).optional(),
  orderedIds: z.array(z.string().min(1)),
});

export type SavedViewFiltersInput = z.infer<typeof savedViewFiltersInputSchema>;
