/**
 * @purpose Render the tags management surface for the desktop renderer.
 * @role    App-level React component composed by routes, shell, or shared workflows.
 * @deps    React, HeroUI/local UI primitives, tRPC hooks, and shared renderer modules as needed.
 * @gotcha  Keep operational layouts dense and aligned with design.md icon and panel sizing rules.
 */

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { DragDropProvider, type DragEndEvent } from "@dnd-kit/react";
import { isSortable, useSortable } from "@dnd-kit/react/sortable";
import { PointerActivationConstraints, PointerSensor } from "@dnd-kit/dom";
import { arrayMove } from "@dnd-kit/helpers";
import { Button, Dropdown } from "@heroui/react";
import {
  ArrowDown,
  ArrowUp,
  ArrowUpToLine,
  GripVertical,
  Hash,
  MoreHorizontal,
  Pencil,
  Plus,
  Trash2,
} from "lucide-react";
import { useTranslation } from "react-i18next";

import { PageChrome } from "@/components/layout/app-layout";
import { useConfirmModal } from "@/components/common/confirm-modal";
import { ScrollArea } from "@/components/ui/scroll-area";
import { TagFormModal } from "@/components/asset-manager/asset-management-modals";
import { getTagHue } from "@/lib/asset-manager/asset-model";
import type { SidebarTag, SidebarView } from "@/lib/asset-manager/types";
import { useInvalidateVaultState } from "@/hooks/use-invalidate-vault-state";
import { showToastAfterRefresh, toast } from "@/lib/toast";
import { trpc } from "@/lib/trpc";

type TagModalState = { kind: "create" } | { kind: "edit"; tag: SidebarTag };

type TagDeleteImpact = {
  updatedViews: SidebarView[];
  deletedViews: SidebarView[];
};

const TAG_ROW_TYPE = "tags-management-row";
const ROW_ACTION_BUTTON_CLASS_NAME =
  "grid h-7 w-7 cursor-pointer place-items-center rounded-md transition-colors disabled:pointer-events-none disabled:cursor-default disabled:opacity-35";
const ROW_MORE_TRIGGER_CLASS_NAME =
  "grid h-7 w-7 cursor-pointer place-items-center rounded-md text-zinc-400 outline-none transition-colors hover:bg-zinc-100 hover:text-zinc-700 data-[focus-visible]:ring-2 data-[focus-visible]:ring-zinc-500/25";

function orderTagsByIds(tags: readonly SidebarTag[], orderedIds: readonly string[]) {
  const byId = new Map(tags.map((tag) => [tag.id, tag]));
  const ordered = orderedIds.flatMap((id) => {
    const tag = byId.get(id);
    return tag ? [tag] : [];
  });
  const remaining = tags.filter((tag) => !orderedIds.includes(tag.id));
  return [...ordered, ...remaining];
}

function getTagDeleteImpact(tag: SidebarTag, views: readonly SidebarView[]): TagDeleteImpact {
  const updatedViews: SidebarView[] = [];
  const deletedViews: SidebarView[] = [];

  for (const view of views) {
    if (!view.filters.tagIds.includes(tag.id)) {
      continue;
    }

    const shouldDelete =
      view.filters.tagIds.length === 1 &&
      view.filters.types.length === 0 &&
      view.filters.sources.length === 0 &&
      view.filters.time === "any" &&
      view.filters.status === "any";

    if (shouldDelete) {
      deletedViews.push(view);
    } else {
      updatedViews.push(view);
    }
  }

  return { updatedViews, deletedViews };
}

function SortableTagRow({
  tag,
  index,
  isFirst,
  isLast,
  onMoveFirst,
  onMoveUp,
  onMoveDown,
  onEdit,
  onDelete,
}: {
  tag: SidebarTag;
  index: number;
  isFirst: boolean;
  isLast: boolean;
  onMoveFirst: () => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const { t } = useTranslation();
  const { ref, handleRef, isDragging, isDropTarget } = useSortable({
    id: tag.id,
    index,
    group: "tags-management",
    type: TAG_ROW_TYPE,
    accept: TAG_ROW_TYPE,
    transition: { duration: 140, easing: "cubic-bezier(0.25, 1, 0.5, 1)", idle: true },
  });
  const color = tag.color ?? `oklch(0.62 0.14 ${getTagHue(tag.name)})`;

  return (
    <div
      ref={ref}
      className={`relative grid select-none grid-cols-[28px_34px_minmax(0,1fr)_76px_104px] items-center gap-3 border-b border-zinc-100 px-4 py-3 transition-[background-color,box-shadow,opacity] duration-150 last:border-b-0 ${
        isDragging
          ? "z-20 cursor-grabbing bg-white opacity-95 shadow-[0_14px_30px_rgba(24,24,27,0.14)] ring-1 ring-blue-200"
          : "hover:bg-zinc-50/70"
      } ${isDropTarget ? "bg-blue-50/70 shadow-[inset_3px_0_0_rgb(59,130,246)]" : ""}`}
    >
      <button
        ref={handleRef}
        type="button"
        data-drag-handle
        aria-label={t("common.drag", { name: tag.name })}
        className="grid h-7 w-7 cursor-grab place-items-center rounded-md text-zinc-400 transition-colors hover:bg-zinc-100 hover:text-zinc-700 active:cursor-grabbing active:bg-blue-50 active:text-blue-600"
      >
        <GripVertical size={15} />
      </button>
      <div className="grid h-8 w-8 place-items-center rounded-lg bg-zinc-100">
        <span className="h-3 w-3 rounded-full" style={{ background: color }} />
      </div>
      <div className="min-w-0">
        <div className="truncate text-[13.5px] font-semibold text-zinc-900">{tag.name}</div>
        <div className="mt-0.5 truncate text-[11.5px] text-zinc-400">
          {tag.color ? t("tags.customColorLabel") : t("tags.autoColor")}
        </div>
      </div>
      <div className="justify-self-end text-[12px] font-medium text-zinc-500">
        {t("tags.countItems", { count: tag.count })}
      </div>
      <div className="flex justify-end gap-1">
        <IconButton
          label={t("sidebar.moveItemUp", { name: tag.name })}
          disabled={isFirst}
          onPress={onMoveUp}
        >
          <ArrowUp size={13} />
        </IconButton>
        <IconButton
          label={t("sidebar.moveItemDown", { name: tag.name })}
          disabled={isLast}
          onPress={onMoveDown}
        >
          <ArrowDown size={13} />
        </IconButton>
        <TagRowMoreMenu
          tagName={tag.name}
          isFirst={isFirst}
          onMoveFirst={onMoveFirst}
          onEdit={onEdit}
          onDelete={onDelete}
        />
      </div>
    </div>
  );
}

function IconButton({
  label,
  danger = false,
  disabled = false,
  onPress,
  children,
}: {
  label: string;
  danger?: boolean;
  disabled?: boolean;
  onPress: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      data-no-drag
      aria-label={label}
      disabled={disabled}
      className={`${ROW_ACTION_BUTTON_CLASS_NAME} ${
        danger
          ? "text-zinc-400 hover:bg-red-50 hover:text-red-600"
          : "text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700"
      }`}
      onClick={(event) => {
        event.stopPropagation();
        onPress();
      }}
      onPointerDown={(event) => event.stopPropagation()}
    >
      {children}
    </button>
  );
}

function TagRowMoreMenu({
  tagName,
  isFirst,
  onMoveFirst,
  onEdit,
  onDelete,
}: {
  tagName: string;
  isFirst: boolean;
  onMoveFirst: () => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const { t } = useTranslation();

  return (
    <Dropdown>
      <Dropdown.Trigger
        data-no-drag
        className={ROW_MORE_TRIGGER_CLASS_NAME}
        aria-label={t("sidebar.itemMore", { name: tagName })}
        onClick={(event) => event.stopPropagation()}
        onPointerDown={(event) => event.stopPropagation()}
      >
        <MoreHorizontal size={13} />
      </Dropdown.Trigger>
      <Dropdown.Popover
        className="z-[120] overflow-hidden rounded-xl border border-zinc-200 bg-white p-1 shadow-[0_14px_34px_rgba(20,18,16,0.14),0_2px_7px_rgba(20,18,16,0.07)]"
        offset={6}
        placement="bottom end"
      >
        <Dropdown.Menu
          aria-label={t("sidebar.itemActions", { name: tagName })}
          className="min-w-32 p-0 outline-none"
          disabledKeys={isFirst ? ["move-first"] : []}
          onAction={(key) => {
            const action = String(key);
            if (action === "move-first") onMoveFirst();
            if (action === "edit") onEdit();
            if (action === "delete") onDelete();
          }}
        >
          <Dropdown.Item
            key="move-first"
            id="move-first"
            textValue={t("common.moveToFront")}
            className="flex h-7 cursor-default items-center gap-2 rounded-lg px-2 text-[12.5px] font-medium text-zinc-700 outline-none transition-colors data-[disabled]:opacity-45 data-[focused]:bg-zinc-100 data-[hovered]:bg-zinc-100"
          >
            <ArrowUpToLine size={13} className="text-zinc-500" />
            <span>{t("common.moveToFront")}</span>
          </Dropdown.Item>
          <Dropdown.Item
            key="edit"
            id="edit"
            textValue={t("common.edit")}
            className="flex h-7 cursor-default items-center gap-2 rounded-lg px-2 text-[12.5px] font-medium text-zinc-700 outline-none transition-colors data-[focused]:bg-zinc-100 data-[hovered]:bg-zinc-100"
          >
            <Pencil size={13} className="text-zinc-500" />
            <span>{t("common.edit")}</span>
          </Dropdown.Item>
          <Dropdown.Item
            key="delete"
            id="delete"
            textValue={t("common.delete")}
            className="flex h-7 cursor-default items-center gap-2 rounded-lg px-2 text-[12.5px] font-medium text-red-600 outline-none transition-colors data-[focused]:bg-red-50 data-[hovered]:bg-red-50"
          >
            <Trash2 size={13} />
            <span>{t("common.delete")}</span>
          </Dropdown.Item>
        </Dropdown.Menu>
      </Dropdown.Popover>
    </Dropdown>
  );
}

function TagDeleteDescription({ tag, impact }: { tag: SidebarTag; impact: TagDeleteImpact }) {
  const { t } = useTranslation();

  return (
    <div className="space-y-2">
      <p>{t("sidebar.deleteTagBody", { name: tag.name, count: tag.count })}</p>
      {impact.updatedViews.length > 0 ? (
        <p>
          {t("sidebar.viewsKeepAfterTag")}
          {impact.updatedViews.map((view) => `「${view.name}」`).join("、")}
        </p>
      ) : null}
      {impact.deletedViews.length > 0 ? (
        <p>
          {t("sidebar.viewsDeleteWithTag")}
          {impact.deletedViews.map((view) => `「${view.name}」`).join("、")}
        </p>
      ) : null}
    </div>
  );
}

export function TagsManagementPage() {
  const { t } = useTranslation();
  const sidebarQuery = useQuery({
    ...trpc.assets.sidebarMeta.queryOptions(),
    refetchOnWindowFocus: false,
    staleTime: 30_000,
  });
  const invalidateVaultState = useInvalidateVaultState();
  const confirm = useConfirmModal();
  const deleteTag = useMutation(trpc.assets.deleteTag.mutationOptions());
  const reorderTags = useMutation(
    trpc.assets.reorderTags.mutationOptions({
      onSuccess: invalidateVaultState,
    }),
  );
  const tags = sidebarQuery.data?.tags ?? [];
  const views = sidebarQuery.data?.views ?? [];
  const [orderedIds, setOrderedIds] = useState<string[]>([]);
  const [modalState, setModalState] = useState<TagModalState | null>(null);

  useEffect(() => {
    setOrderedIds(tags.map((tag) => tag.id));
  }, [tags]);

  const orderedTags = useMemo(() => orderTagsByIds(tags, orderedIds), [orderedIds, tags]);

  const reorderTagIds = (nextIds: string[]) => {
    setOrderedIds(nextIds);
    reorderTags.mutate({ vaultId: sidebarQuery.data?.vault?.id, orderedIds: nextIds });
  };

  const moveTag = (fromIndex: number, toIndex: number) => {
    const currentIds = orderedTags.map((tag) => tag.id);
    const nextIndex = Math.max(0, Math.min(currentIds.length - 1, toIndex));
    if (fromIndex === nextIndex) return;

    reorderTagIds(arrayMove(currentIds, fromIndex, nextIndex));
  };

  const handleDragEnd = (event: DragEndEvent) => {
    if (event.canceled) return;

    const currentIds = orderedTags.map((tag) => tag.id);
    const { source } = event.operation;
    if (
      !isSortable(source) ||
      source.initialGroup !== source.group ||
      source.initialIndex === source.index
    )
      return;

    const nextIds = arrayMove(currentIds, source.initialIndex, source.index);

    reorderTagIds(nextIds);
  };

  const handleDelete = (tag: SidebarTag) => {
    const impact = getTagDeleteImpact(tag, views);

    void (async () => {
      const confirmed = await confirm({
        title: t("tags.deleteTitle", { name: tag.name }),
        description: <TagDeleteDescription tag={tag} impact={impact} />,
        confirmLabel: t("common.delete"),
        cancelLabel: t("common.cancel"),
        variant: "danger",
        onConfirm: async () => {
          await deleteTag.mutateAsync({ id: tag.id });
        },
      });
      if (!confirmed) {
        return;
      }
      await invalidateVaultState();
      showToastAfterRefresh(() => {
        toast.success(t("tags.deleted"));
      });
    })();
  };

  return (
    <main className="flex h-full min-w-0 flex-col bg-white">
      <PageChrome>
        <div className="window-no-drag flex items-center gap-2">
          <Hash size={15} className="text-zinc-500" />
          <h1 className="text-[13px] font-semibold text-zinc-900">{t("tags.title")}</h1>
          <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-[11px] font-medium text-zinc-500">
            {tags.length}
          </span>
        </div>
        <div className="window-no-drag ml-auto">
          <Button
            size="sm"
            variant="primary"
            className="h-7 min-h-0 rounded-lg px-2.5 text-[12px] font-semibold"
            onPress={() => setModalState({ kind: "create" })}
          >
            <Plus size={13} />
            {t("tags.new")}
          </Button>
        </div>
      </PageChrome>

      <ScrollArea className="min-h-0 flex-1" viewportClassName="px-8 py-6">
        <div className="mx-auto max-w-[860px] overflow-visible bg-white">
          <div className="grid grid-cols-[28px_34px_minmax(0,1fr)_76px_104px] items-center gap-3 border-b border-zinc-100 bg-zinc-50 px-4 py-2 text-[11px] font-semibold uppercase tracking-wide text-zinc-400">
            <span />
            <span>{t("tags.colColor")}</span>
            <span>{t("tags.colName")}</span>
            <span className="justify-self-end">{t("tags.colAssets")}</span>
            <span className="justify-self-end">{t("tags.colActions")}</span>
          </div>
          {orderedTags.length > 0 ? (
            <DragDropProvider
              sensors={(defaults) => [
                ...defaults.filter((sensor) => sensor !== PointerSensor),
                PointerSensor.configure({
                  activationConstraints() {
                    return [new PointerActivationConstraints.Distance({ value: 3 })];
                  },
                  preventActivation(event) {
                    if (!(event.target instanceof Element)) {
                      return false;
                    }

                    if (event.target.closest("[data-drag-handle]")) {
                      return false;
                    }

                    return (
                      event.target.closest(
                        "button, a, input, textarea, select, [contenteditable='true']",
                      ) !== null
                    );
                  },
                }),
              ]}
              onDragEnd={handleDragEnd}
            >
              {orderedTags.map((tag, index) => (
                <SortableTagRow
                  key={tag.id}
                  tag={tag}
                  index={index}
                  isFirst={index === 0}
                  isLast={index === orderedTags.length - 1}
                  onMoveFirst={() => moveTag(index, 0)}
                  onMoveUp={() => moveTag(index, index - 1)}
                  onMoveDown={() => moveTag(index, index + 1)}
                  onEdit={() => setModalState({ kind: "edit", tag })}
                  onDelete={() => handleDelete(tag)}
                />
              ))}
            </DragDropProvider>
          ) : (
            <div className="grid h-48 place-items-center text-[13px] text-zinc-400">
              {sidebarQuery.isLoading ? t("tags.loading") : t("tags.empty")}
            </div>
          )}
        </div>
      </ScrollArea>

      <TagFormModal
        isOpen={modalState !== null}
        mode={modalState ?? { kind: "create" }}
        vaultId={sidebarQuery.data?.vault?.id}
        onOpenChange={(open) => {
          if (!open) setModalState(null);
        }}
      />
    </main>
  );
}
