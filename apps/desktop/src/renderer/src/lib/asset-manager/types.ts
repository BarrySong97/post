/**
 * @purpose Support asset manager types behavior and data shaping.
 * @role    Renderer asset manager type module shared by pages, layout, and controls.
 * @deps    Asset tRPC types, React/HeroUI where UI is present, local storage or URL helpers as needed.
 * @gotcha  Keep asset kind/status/tag/view contracts synchronized with packages/db schema and saved-view JSON.
 */

import type { RouterOutputs } from "@/lib/trpc";

export type AssetKind = "markdown" | "image" | "video" | "link" | "web" | "file";
export type AssetStatus = "inbox" | "organized" | "draft" | "published";
export type AssetPrivacy = "normal" | "private";

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
  tag: string;
  tagIds: string[];
  collection?: string;
  meta: string;
  accent: number;
  height?: "short" | "medium" | "tall";
  duration?: string;
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
};

export type IndexedAsset = RouterOutputs["assets"]["list"]["items"][number];
export type IndexedBoardItem = RouterOutputs["assetBoard"]["list"]["items"][number];
export type IndexedGallery = Extract<IndexedBoardItem, { itemType: "gallery" }>["gallery"];
export type GalleryDetail = RouterOutputs["galleries"]["byId"];
export type GalleryMember = GalleryDetail["members"][number];
export type GalleryCard = {
  id: string;
  vaultId: string;
  title: string;
  description: string | null;
  status: AssetStatus;
  privacy: AssetPrivacy;
  coverAssetId: string | null;
  memberCount: number;
  missingCount: number;
  timestampMs: number;
  createdTimestampMs: number;
  cover: Asset | null;
};
export type AssetBoardCard =
  | { itemType: "asset"; id: string; asset: Asset }
  | { itemType: "gallery"; id: string; gallery: GalleryCard };
export type SidebarTag = RouterOutputs["assets"]["sidebarMeta"]["tags"][number];
export type SidebarView = RouterOutputs["assets"]["sidebarMeta"]["views"][number];
export type AssetSummary = RouterOutputs["assets"]["sidebarMeta"]["summary"];
