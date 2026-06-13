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

export type IndexedAsset = RouterOutputs["assets"]["list"]["assets"][number];
export type SidebarTag = RouterOutputs["assets"]["list"]["tags"][number];
export type SidebarView = RouterOutputs["assets"]["list"]["views"][number];
export type AssetSummary = RouterOutputs["assets"]["list"]["summary"];
