/**
 * @purpose Define shared note input contracts.
 * @role    Renderer/main Zod schemas for note tRPC procedures.
 * @deps    zod only.
 * @gotcha  Note storage behavior stays in main repositories or use cases, not this contract.
 */

import { z } from "zod";

export const noteInputSchema = z.object({
  title: z.string().trim().min(1, "Title is required").max(120, "Title is too long"),
  content: z.string().max(5000, "Content is too long"),
});

export const updateNoteInputSchema = noteInputSchema.extend({
  id: z.string().min(1),
});

export const deleteNoteInputSchema = z.object({
  id: z.string().min(1),
});
