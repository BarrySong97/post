import { useState } from "react";
import { Button, Input, Spinner, TextArea } from "@heroui/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Plus, Trash2, X } from "lucide-react";

import { trpc, type NoteView } from "@renderer/lib/trpc";

function formatDate(value: Date | string): string {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function NoteRow({ note }: { note: NoteView }) {
  const queryClient = useQueryClient();
  const [isEditing, setIsEditing] = useState(false);
  const [title, setTitle] = useState(note.title);
  const [content, setContent] = useState(note.content);

  const updateNote = useMutation(
    trpc.notes.update.mutationOptions({
      onSuccess: async () => {
        setIsEditing(false);
        await queryClient.invalidateQueries(trpc.notes.list.queryFilter());
      },
    }),
  );

  const deleteNote = useMutation(
    trpc.notes.delete.mutationOptions({
      onSuccess: async () => {
        await queryClient.invalidateQueries(trpc.notes.list.queryFilter());
      },
    }),
  );

  const resetDraft = () => {
    setTitle(note.title);
    setContent(note.content);
    setIsEditing(false);
  };

  const saveDraft = () => {
    updateNote.mutate({
      id: note.id,
      title,
      content,
    });
  };

  return (
    <article className="rounded-lg border border-border-subtle bg-surface p-4 shadow-sm">
      {isEditing ? (
        <div className="space-y-3">
          <Input
            aria-label="Note title"
            className="w-full"
            value={title}
            variant="secondary"
            onChange={(event) => setTitle(event.target.value)}
          />
          <TextArea
            aria-label="Note content"
            className="min-h-28 w-full resize-y"
            value={content}
            variant="secondary"
            onChange={(event) => setContent(event.target.value)}
          />
          {updateNote.error ? (
            <p className="rounded-md border border-danger/25 bg-danger/10 px-3 py-2 text-sm text-danger">
              {updateNote.error.message}
            </p>
          ) : null}
          <div className="flex flex-wrap justify-end gap-2">
            <Button
              isIconOnly
              aria-label="Cancel"
              variant="ghost"
              onPress={resetDraft}
            >
              <X size={18} />
            </Button>
            <Button
              isIconOnly
              aria-label="Save"
              isDisabled={!title.trim() || updateNote.isPending}
              variant="primary"
              onPress={saveDraft}
            >
              <Check size={18} />
            </Button>
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          <button
            className="block w-full rounded-md text-left outline-none transition hover:text-primary focus-visible:ring-2 focus-visible:ring-primary"
            type="button"
            onClick={() => setIsEditing(true)}
          >
            <h2 className="text-base font-semibold leading-6">{note.title}</h2>
            <p className="mt-1 line-clamp-3 whitespace-pre-wrap text-sm leading-6 text-foreground/70">
              {note.content || "No content"}
            </p>
          </button>
          <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-foreground/55">
            <span>Updated {formatDate(note.updatedAt)}</span>
            <Button
              isIconOnly
              aria-label="Delete"
              isDisabled={deleteNote.isPending}
              size="sm"
              variant="danger-soft"
              onPress={() => deleteNote.mutate({ id: note.id })}
            >
              <Trash2 size={16} />
            </Button>
          </div>
          {deleteNote.error ? (
            <p className="rounded-md border border-danger/25 bg-danger/10 px-3 py-2 text-sm text-danger">
              {deleteNote.error.message}
            </p>
          ) : null}
        </div>
      )}
    </article>
  );
}

export function NotesPage() {
  const queryClient = useQueryClient();
  const notesQuery = useQuery(trpc.notes.list.queryOptions());
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");

  const createNote = useMutation(
    trpc.notes.create.mutationOptions({
    onSuccess: async () => {
      setTitle("");
      setContent("");
      await queryClient.invalidateQueries(trpc.notes.list.queryFilter());
    },
    }),
  );

  const createDraft = () => {
    createNote.mutate({
      title,
      content,
    });
  };

  return (
    <main className="min-h-screen bg-background px-6 py-8 text-foreground">
      <div className="mx-auto grid max-w-6xl gap-6 lg:grid-cols-[360px_1fr]">
        <section className="rounded-lg border border-border-subtle bg-surface p-5 shadow-sm">
          <div className="mb-5">
            <p className="text-sm font-medium text-primary">Post Desktop</p>
            <h1 className="mt-1 text-2xl font-semibold tracking-normal">Notes</h1>
          </div>

          <div className="space-y-3">
            <label className="block space-y-1.5">
              <span className="text-sm font-medium text-foreground/75">Title</span>
              <Input
                aria-label="Title"
                className="w-full"
                value={title}
                variant="secondary"
                onChange={(event) => setTitle(event.target.value)}
              />
            </label>
            <label className="block space-y-1.5">
              <span className="text-sm font-medium text-foreground/75">Content</span>
              <TextArea
                aria-label="Content"
                className="min-h-48 w-full resize-y"
                value={content}
                variant="secondary"
                onChange={(event) => setContent(event.target.value)}
              />
            </label>
            <Button
              fullWidth
              isDisabled={!title.trim() || createNote.isPending}
              variant="primary"
              onPress={createDraft}
            >
              <Plus size={18} />
              <span>Add note</span>
            </Button>
            {createNote.error ? (
              <p className="rounded-md border border-danger/25 bg-danger/10 px-3 py-2 text-sm text-danger">
                {createNote.error.message}
              </p>
            ) : null}
          </div>
        </section>

        <section className="min-h-[520px] rounded-lg border border-border-subtle bg-surface-muted p-4">
          {notesQuery.isLoading ? (
            <div className="grid min-h-[420px] place-items-center">
              <div className="flex items-center gap-3 text-sm text-foreground/60">
                <Spinner />
                <span>Loading notes</span>
              </div>
            </div>
          ) : notesQuery.isError ? (
            <div className="grid min-h-[420px] place-items-center rounded-lg border border-danger/25 bg-danger/10">
              <div className="max-w-md px-6 text-center">
                <h2 className="text-lg font-semibold text-danger">Could not load notes</h2>
                <p className="mt-2 text-sm leading-6 text-danger/80">{notesQuery.error.message}</p>
              </div>
            </div>
          ) : notesQuery.data?.length ? (
            <div className="grid gap-3">
              {notesQuery.data.map((note) => (
                <NoteRow
                  key={note.id}
                  note={note}
                />
              ))}
            </div>
          ) : (
            <div className="grid min-h-[420px] place-items-center rounded-lg border border-dashed border-border-subtle bg-surface">
              <div className="max-w-sm px-6 text-center">
                <h2 className="text-lg font-semibold">No notes yet</h2>
                <p className="mt-2 text-sm leading-6 text-foreground/60">
                  Create the first note to verify Electron, tRPC, Drizzle, and SQLite are connected.
                </p>
              </div>
            </div>
          )}
        </section>
      </div>
    </main>
  );
}
