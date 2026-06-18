/**
 * @purpose Support asset manager form schemas behavior and data shaping.
 * @role    Renderer asset manager support module shared by pages, controls, and forms.
 * @deps    Asset tRPC types, React/HeroUI where UI is present, local storage or URL helpers as needed.
 * @gotcha  Keep asset kind/status/tag/view contracts synchronized with packages/db schema and saved-view JSON.
 */

import { z } from "zod";

import {
  SAVED_VIEW_ICON_MAX_LENGTH,
  SAVED_VIEW_NAME_MAX_LENGTH,
} from "@shared/contracts/assets/saved-views/saved-view.contract";
import { TAG_NAME_MAX_LENGTH } from "@shared/contracts/assets/tags/tag.contract";
import {
  GALLERY_DESCRIPTION_MAX_LENGTH,
  GALLERY_TITLE_MAX_LENGTH,
} from "@shared/contracts/galleries/gallery.contract";
import type { AssetFilterState } from "@/store/asset-manager-atoms";

export const tagFormSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, "请输入标签名称")
    .max(TAG_NAME_MAX_LENGTH, `名称不能超过 ${TAG_NAME_MAX_LENGTH} 个字符`),
  color: z.string().nullable(),
});

export const viewFormSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, "请输入 View 名称")
    .max(SAVED_VIEW_NAME_MAX_LENGTH, `名称不能超过 ${SAVED_VIEW_NAME_MAX_LENGTH} 个字符`),
  icon: z.string().max(SAVED_VIEW_ICON_MAX_LENGTH),
  // Maintained by AssetFilterFields; pass through without runtime checks.
  filters: z.custom<AssetFilterState>(),
});

export const galleryFormSchema = z.object({
  title: z
    .string()
    .trim()
    .min(1, "请输入图集标题")
    .max(GALLERY_TITLE_MAX_LENGTH, `标题不能超过 ${GALLERY_TITLE_MAX_LENGTH} 个字符`),
  description: z
    .string()
    .trim()
    .max(GALLERY_DESCRIPTION_MAX_LENGTH, `描述不能超过 ${GALLERY_DESCRIPTION_MAX_LENGTH} 个字符`),
  status: z.enum(["inbox", "organized", "draft", "published", "archived"]),
  privacy: z.enum(["normal", "private"]),
});

export type TagFormValues = z.infer<typeof tagFormSchema>;
export type ViewFormValues = z.infer<typeof viewFormSchema>;
export type GalleryFormValues = z.infer<typeof galleryFormSchema>;
