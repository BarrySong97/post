/**
 * @purpose Support asset manager types behavior and data shaping.
 * @role    Renderer asset manager type module shared by pages, layout, and controls.
 * @deps    Asset tRPC types, React/HeroUI where UI is present, local storage or URL helpers as needed.
 * @gotcha  Keep asset kind/status/tag/view contracts synchronized with packages/db schema and saved-view JSON.
 */

import type { RouterOutputs } from "@/lib/trpc";

export type AssetKind = "markdown" | "post" | "image" | "video" | "link" | "web" | "file";
export type AssetStatus = "inbox" | "organized" | "draft" | "published";
export type AssetPrivacy = "normal" | "private";

/** Bound vault tags on an asset (vault sortOrder). Cards use `tag` = first name. */
export type AssetTagRef = {
  id: string;
  name: string;
};

export type Asset = {
  id: string;
  kind: AssetKind;
  status: AssetStatus;
  privacy: AssetPrivacy;
  title: string;
  body?: string;
  source: string;
  sourceType: "vault" | "external_file" | "url";
  fileExists: boolean;
  time: string;
  timestampMs: number;
  createdTimestampMs: number;
  /** Primary tag name for cards/breadcrumb; untagged sentinel when empty. */
  tag: string;
  tags: AssetTagRef[];
  tagIds: string[];
  collection?: string;
  meta: string;
  accent: number;
  height?: "short" | "medium" | "tall";
  /** Formatted total duration for video cards (`m:ss` / `h:mm:ss`). */
  duration?: string;
  /** Raw video duration in ms; used for hover-preview remaining-time countdown. */
  durationMs?: number;
  mediaUrl?: string;
  thumbnailUrl?: string;
  thumbnailStatus?: "pending" | "ready" | "failed" | null;
  imageWidth?: number | null;
  imageHeight?: number | null;
  thumbnailWidth?: number | null;
  thumbnailHeight?: number | null;
  url?: string;
  related: string[];
  ogImage?: boolean;
  fileExt?: string;
  domain?: string;
  imageCount?: number;
  // Markdown note cards: vault images referenced via ![ ]() / ![[ ]], ordered by
  // source span. coverMode upgrades the first thumb to a top cover when the note
  // is image-primary (has images and body text under 80 chars).
  noteImages?: Array<{ assetId: string; fileName: string }>;
  noteImageCount?: number;
  coverMode?: boolean;
  // Whether the cover's bottom strip is light, so overlay text flips to dark-on-light.
  // Undefined when the thumbnail predates luma capture (renderer falls back to light text).
  coverIsLight?: boolean;
  // Source attribution for "quote"-style assets (X posts, and later book/AI excerpts).
  // Populated from postCache; absent for local and file assets.
  platform?: string;
  authorName?: string;
  authorHandle?: string;
  authorAvatarUrl?: string;
  publishedTime?: string;
};

export type IndexedAsset = RouterOutputs["assets"]["hydrate"]["items"][number];
export type AssetLayoutIndexItem = RouterOutputs["assets"]["layoutIndex"]["items"][number];
export type SidebarTag = RouterOutputs["assets"]["sidebarMeta"]["tags"][number];
export type SidebarView = RouterOutputs["assets"]["sidebarMeta"]["views"][number];
export type AssetSummary = RouterOutputs["assets"]["sidebarMeta"]["summary"];
