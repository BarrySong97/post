/**
 * @purpose Define shared tag management contracts for asset workflows.
 * @role    Renderer/main Zod schemas and constants for tag forms and tRPC inputs.
 * @deps    zod only.
 * @gotcha  Keep form constraints and main-process validation sourced from this file.
 */

import { z } from "zod";

export const TAG_NAME_MAX_LENGTH = 60;
export const TAG_COLOR_MAX_LENGTH = 80;

export const tagInputSchema = z.object({
  vaultId: z.string().min(1).optional(),
  name: z.string().trim().min(1).max(TAG_NAME_MAX_LENGTH),
  color: z.string().trim().max(TAG_COLOR_MAX_LENGTH).optional().nullable(),
});

export const updateTagInputSchema = tagInputSchema.extend({
  id: z.string().min(1),
});

export const deleteTagInputSchema = z.object({
  id: z.string().min(1),
});

export const reorderTagsInputSchema = z.object({
  vaultId: z.string().min(1).optional(),
  orderedIds: z.array(z.string().min(1)),
});

export const addTagToAssetInputSchema = z.object({
  assetId: z.string().min(1),
  name: z.string().trim().min(1).max(TAG_NAME_MAX_LENGTH),
});

export const removeTagFromAssetInputSchema = z.object({
  assetId: z.string().min(1),
  tagId: z.string().min(1),
});
