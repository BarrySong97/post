/**
 * @purpose Define shared asset-board projection input contracts.
 * @role    Renderer/main boundary schema for folded gallery-aware board browsing.
 * @deps    Asset list contract schemas only.
 * @gotcha  Board items are display projections; keep raw asset operations on the assets router.
 */

import {
  ASSET_LIST_DEFAULT_LIMIT,
  ASSET_LIST_MAX_LIMIT,
  assetListInputSchema,
} from "../assets/asset-list.contract";

export const ASSET_BOARD_DEFAULT_LIMIT = ASSET_LIST_DEFAULT_LIMIT;
export const ASSET_BOARD_MAX_LIMIT = ASSET_LIST_MAX_LIMIT;

export const assetBoardListInputSchema = assetListInputSchema;
