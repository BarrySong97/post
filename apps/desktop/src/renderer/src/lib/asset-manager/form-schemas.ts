/**
 * @purpose Support asset manager form schemas behavior and data shaping.
 * @role    Renderer asset manager support module shared by pages, controls, and forms.
 * @deps    Asset tRPC types, React/HeroUI where UI is present, local storage or URL helpers as needed.
 * @gotcha  Keep asset kind/status/tag/view contracts synchronized with packages/db schema and saved-view JSON.
 */

import { z } from "zod";

import type { AssetFilterState } from "@/store/asset-manager-atoms";

// Mirror of the backend constraints in apps/desktop/src/main/trpc/routers/assets.ts.
// The backend zod schemas live in the main process and can't be imported from the
// renderer build, so we keep a small parallel copy here for client-side validation.
export const TAG_NAME_MAX_LENGTH = 60;
export const SAVED_VIEW_NAME_MAX_LENGTH = 80;
export const VIEW_ICON_MAX_LENGTH = 80;

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
  icon: z.string().max(VIEW_ICON_MAX_LENGTH),
  // Maintained by AssetFilterFields; pass through without runtime checks.
  filters: z.custom<AssetFilterState>(),
});

export type TagFormValues = z.infer<typeof tagFormSchema>;
export type ViewFormValues = z.infer<typeof viewFormSchema>;
