/**
 * @purpose Define main-process tRPC procedures for notes domain operations.
 * @role    IPC-facing application API layer called by renderer tRPC hooks.
 * @deps    trpc.ts base procedures, repositories/services, Drizzle schema types.
 * @gotcha  Validate inputs and keep side effects in repositories/services rather than renderer components.
 */

import { randomUUID } from "node:crypto";

import { TRPCError } from "@trpc/server";
import { desc, eq } from "drizzle-orm";
import { z } from "zod";

import { schema } from "@post/db";
import { getDatabase } from "../../db";
import { publicProcedure, router } from "../trpc";

const noteInput = z.object({
  title: z.string().trim().min(1, "Title is required").max(120, "Title is too long"),
  content: z.string().max(5000, "Content is too long"),
});

export const notesRouter = router({
  list: publicProcedure.query(() => {
    return getDatabase().select().from(schema.notes).orderBy(desc(schema.notes.updatedAt));
  }),

  create: publicProcedure.input(noteInput).mutation(({ input }) => {
    const now = new Date();
    const note = getDatabase()
      .insert(schema.notes)
      .values({
        id: randomUUID(),
        title: input.title,
        content: input.content,
        createdAt: now,
        updatedAt: now,
      })
      .returning()
      .get();

    return note;
  }),

  update: publicProcedure
    .input(
      noteInput.extend({
        id: z.string().min(1),
      }),
    )
    .mutation(({ input }) => {
      const note = getDatabase()
        .update(schema.notes)
        .set({
          title: input.title,
          content: input.content,
          updatedAt: new Date(),
        })
        .where(eq(schema.notes.id, input.id))
        .returning()
        .get();

      if (!note) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Note not found" });
      }

      return note;
    }),

  delete: publicProcedure.input(z.object({ id: z.string().min(1) })).mutation(({ input }) => {
    const note = getDatabase()
      .delete(schema.notes)
      .where(eq(schema.notes.id, input.id))
      .returning({ id: schema.notes.id })
      .get();

    if (!note) {
      throw new TRPCError({ code: "NOT_FOUND", message: "Note not found" });
    }

    return note;
  }),
});
