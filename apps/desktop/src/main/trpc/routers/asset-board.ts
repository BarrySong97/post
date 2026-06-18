/**
 * @purpose Define main-process tRPC procedures for gallery-aware asset board projection.
 * @role    IPC-facing board API that returns display cards rather than raw asset rows.
 * @deps    Asset-board contracts, asset-board repository, vault and thumbnail services.
 * @gotcha  Keep raw asset listing on assets.list; this router owns folded gallery display behavior.
 */

import {
  ASSET_BOARD_DEFAULT_LIMIT,
  assetBoardListInputSchema,
} from "@shared/contracts/asset-board/asset-board.contract";
import { getAssetBoardPage } from "../../repositories/asset-board-repository";
import { getRequestedOrActiveVault } from "../../repositories/vaults-repository";
import { startThumbnailPrewarm } from "../../services/thumbnail-service";
import { publicProcedure, router } from "../trpc";

export const assetBoardRouter = router({
  list: publicProcedure.input(assetBoardListInputSchema).query(({ input }) => {
    const vault = getRequestedOrActiveVault(input?.vaultId);
    if (!vault) {
      return {
        items: [],
        total: 0,
        nextCursor: null,
      };
    }

    startThumbnailPrewarm(vault);
    return getAssetBoardPage({
      vaultId: vault.id,
      tagIds: input?.tagIds ?? (input?.tagId ? [input.tagId] : undefined),
      tagMatch: input?.tagMatch,
      statusFilter: input?.statusFilter,
      untagged: input?.untagged,
      typeFilters: input?.typeFilters,
      timeFilter: input?.timeFilter,
      sourceTypes: input?.sourceTypes,
      sort: input?.sort,
      cursor: input?.cursor,
      limit: input?.limit ?? ASSET_BOARD_DEFAULT_LIMIT,
    });
  }),
});
