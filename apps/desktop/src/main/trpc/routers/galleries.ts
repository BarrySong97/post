/**
 * @purpose Define main-process tRPC procedures for image gallery operations.
 * @role    IPC-facing gallery API layer called by renderer tRPC hooks.
 * @deps    Gallery contracts, gallery use cases, gallery repositories, tRPC base procedures.
 * @gotcha  Galleries are not assets; keep folded board projection in asset-board router.
 */

import {
  addGalleryItems,
  createGallery,
  deleteGallery,
  getGalleryById,
  getRequestedOrActiveVault,
  listGalleries,
  removeGalleryItems,
  reorderGalleryItems,
  setGalleryCover,
  updateGallery,
  updateGalleryItemCaption,
} from "@post/domain";
import {
  galleryAddItemsInputSchema,
  galleryCreateInputSchema,
  galleryIdInputSchema,
  galleryListInputSchema,
  galleryRemoveItemsInputSchema,
  galleryReorderItemsInputSchema,
  gallerySetCoverInputSchema,
  galleryUpdateCaptionInputSchema,
  galleryUpdateInputSchema,
} from "@shared/contracts/galleries/gallery.contract";
import { runDomain } from "../../domain-context";
import { publicProcedure, router } from "../trpc";

export const galleriesRouter = router({
  list: publicProcedure.input(galleryListInputSchema).query(({ input }) => {
    return runDomain((ctx) => {
      const vault = getRequestedOrActiveVault(ctx, input?.vaultId);
      return vault ? listGalleries(ctx, vault.id) : [];
    });
  }),

  byId: publicProcedure.input(galleryIdInputSchema).query(({ input }) => {
    return runDomain((ctx) => getGalleryById(ctx, input.galleryId));
  }),

  create: publicProcedure.input(galleryCreateInputSchema).mutation(({ input }) => {
    return runDomain((ctx) => createGallery(ctx, input));
  }),

  update: publicProcedure.input(galleryUpdateInputSchema).mutation(({ input }) => {
    return runDomain((ctx) => updateGallery(ctx, input));
  }),

  delete: publicProcedure.input(galleryIdInputSchema).mutation(({ input }) => {
    return runDomain((ctx) => deleteGallery(ctx, input.galleryId));
  }),

  addItems: publicProcedure.input(galleryAddItemsInputSchema).mutation(({ input }) => {
    return runDomain((ctx) => addGalleryItems(ctx, input));
  }),

  removeItems: publicProcedure.input(galleryRemoveItemsInputSchema).mutation(({ input }) => {
    return runDomain((ctx) => removeGalleryItems(ctx, input));
  }),

  reorderItems: publicProcedure.input(galleryReorderItemsInputSchema).mutation(({ input }) => {
    return runDomain((ctx) => reorderGalleryItems(ctx, input));
  }),

  setCover: publicProcedure.input(gallerySetCoverInputSchema).mutation(({ input }) => {
    return runDomain((ctx) => setGalleryCover(ctx, input));
  }),

  updateCaption: publicProcedure.input(galleryUpdateCaptionInputSchema).mutation(({ input }) => {
    return runDomain((ctx) => updateGalleryItemCaption(ctx, input));
  }),
});
