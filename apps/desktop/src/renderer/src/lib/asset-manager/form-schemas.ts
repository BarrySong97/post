/**
 * @purpose Support asset manager form schemas behavior and data shaping.
 * @role    Renderer asset manager support module shared by pages, controls, and forms.
 * @deps    Asset tRPC types, React/HeroUI where UI is present, local storage or URL helpers as needed.
 * @gotcha  Keep asset kind/status/tag/view contracts synchronized with packages/db schema and saved-view JSON.
 *          Validation messages are locale-aware — call create*FormSchema(t) inside components so language
 *          switches refresh Zod error text.
 */

import { z } from "zod";

import {
  SAVED_VIEW_ICON_MAX_LENGTH,
  SAVED_VIEW_NAME_MAX_LENGTH,
} from "@shared/contracts/assets/saved-views/saved-view.contract";
import { TAG_NAME_MAX_LENGTH } from "@shared/contracts/assets/tags/tag.contract";
import type { AssetFilterState } from "@/store/asset-manager-atoms";

type Translate = (key: string, options?: Record<string, unknown>) => string;

export function createTagFormSchema(t: Translate) {
  return z.object({
    name: z
      .string()
      .trim()
      .min(1, t("tags.nameRequired"))
      .max(TAG_NAME_MAX_LENGTH, t("tags.nameTooLong", { max: TAG_NAME_MAX_LENGTH })),
    color: z.string().nullable(),
  });
}

export function createViewFormSchema(t: Translate) {
  return z.object({
    name: z
      .string()
      .trim()
      .min(1, t("views.nameRequired"))
      .max(SAVED_VIEW_NAME_MAX_LENGTH, t("views.nameTooLong", { max: SAVED_VIEW_NAME_MAX_LENGTH })),
    icon: z.string().max(SAVED_VIEW_ICON_MAX_LENGTH),
    // Maintained by AssetFilterFields; pass through without runtime checks.
    filters: z.custom<AssetFilterState>(),
  });
}

export type TagFormValues = z.infer<ReturnType<typeof createTagFormSchema>>;
export type ViewFormValues = z.infer<ReturnType<typeof createViewFormSchema>>;
