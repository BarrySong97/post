/**
 * @purpose Define shared gallery input contracts for renderer and main process calls.
 * @role    Browser-safe Zod schemas for gallery CRUD and membership operations.
 * @deps    zod and common identifier contracts.
 * @gotcha  Keep one-image-per-gallery ownership enforced in use cases and database constraints.
 */

import { z } from "zod";

import { optionalVaultInputSchema } from "../common/id.contract";

export const GALLERY_TITLE_MAX_LENGTH = 120;
export const GALLERY_DESCRIPTION_MAX_LENGTH = 1_200;
export const GALLERY_CAPTION_MAX_LENGTH = 500;
export const GALLERY_MAX_CREATE_ITEMS = 160;

export const galleryIdInputSchema = z.object({
  galleryId: z.string().min(1),
});

export const galleryCreateInputSchema = optionalVaultInputSchema.extend({
  title: z.string().trim().min(1).max(GALLERY_TITLE_MAX_LENGTH),
  description: z.string().trim().max(GALLERY_DESCRIPTION_MAX_LENGTH).optional(),
  assetIds: z.array(z.string().min(1)).min(1).max(GALLERY_MAX_CREATE_ITEMS),
});

export const galleryUpdateInputSchema = galleryIdInputSchema.extend({
  title: z.string().trim().min(1).max(GALLERY_TITLE_MAX_LENGTH),
  description: z.string().trim().max(GALLERY_DESCRIPTION_MAX_LENGTH).optional(),
  status: z.enum(["inbox", "organized", "draft", "published", "archived"]),
  privacy: z.enum(["normal", "private"]),
});

export const galleryAddItemsInputSchema = galleryIdInputSchema.extend({
  assetIds: z.array(z.string().min(1)).min(1).max(GALLERY_MAX_CREATE_ITEMS),
});

export const galleryRemoveItemsInputSchema = galleryIdInputSchema.extend({
  assetIds: z.array(z.string().min(1)).min(1),
});

export const galleryReorderItemsInputSchema = galleryIdInputSchema.extend({
  orderedAssetIds: z.array(z.string().min(1)).min(1),
});

export const gallerySetCoverInputSchema = galleryIdInputSchema.extend({
  assetId: z.string().min(1),
});

export const galleryUpdateCaptionInputSchema = galleryIdInputSchema.extend({
  assetId: z.string().min(1),
  caption: z.string().trim().max(GALLERY_CAPTION_MAX_LENGTH).optional(),
});

export const galleryListInputSchema = optionalVaultInputSchema.optional();
