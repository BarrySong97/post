/**
 * @purpose Render the views management surface for the desktop renderer.
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
  FolderKanban,
  GripVertical,
  MoreHorizontal,
  Pencil,
  Plus,
  Trash2,
} from "lucide-react";

import { PageChrome } from "@/components/layout/app-layout";
import { useConfirmModal } from "@/components/common/confirm-modal";
import { ScrollArea } from "@/components/ui/scroll-area";
import { ViewFormModal } from "@/components/asset-manager/asset-management-modals";
import { ViewIconRenderer } from "@/components/asset-manager/view-icon-picker";
import type { SidebarView } from "@/lib/asset-manager/types";
import { useInvalidateVaultState } from "@/hooks/use-invalidate-vault-state";
import { showToastAfterRefresh, toast } from "@/lib/toast";
import { trpc } from "@/lib/trpc";

type ViewModalState = { kind: "create" } | { kind: "edit"; view: SidebarView };

const VIEW_ROW_TYPE = "views-management-row";
const ROW_ACTION_BUTTON_CLASS_NAME =
  "grid h-7 w-7 cursor-pointer place-items-center rounded-md transition-colors disabled:pointer-events-none disabled:cursor-default disabled:opacity-35";
const ROW_MORE_TRIGGER_CLASS_NAME =
  "grid h-7 w-7 cursor-pointer place-items-center rounded-md text-zinc-400 outline-none transition-colors hover:bg-zinc-100 hover:text-zinc-700 data-[focus-visible]:ring-2 data-[focus-visible]:ring-zinc-500/25";

function orderViewsByIds(views: readonly SidebarView[], orderedIds: readonly string[]) {
  const byId = new Map(views.map((view) => [view.id, view]));
  const ordered = orderedIds.flatMap((id) => {
    const view = byId.get(id);
    return view ? [view] : [];
  });
  const remaining = views.filter((view) => !orderedIds.includes(view.id));
  return [...ordered, ...remaining];
}

function SortableViewRow({
  view,
  index,
  isFirst,
  isLast,
  onMoveFirst,
  onMoveUp,
  onMoveDown,
  onEdit,
  onDelete,
}: {
  view: SidebarView;
  index: number;
  isFirst: boolean;
  isLast: boolean;
  onMoveFirst: () => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const { ref, handleRef, isDragging, isDropTarget } = useSortable({
    id: view.id,
    index,
    group: "views-management",
    type: VIEW_ROW_TYPE,
    accept: VIEW_ROW_TYPE,
    transition: { duration: 140, easing: "cubic-bezier(0.25, 1, 0.5, 1)", idle: true },
  });

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
        aria-label={`拖动 ${view.name}`}
        className="grid h-7 w-7 cursor-grab place-items-center rounded-md text-zinc-400 transition-colors hover:bg-zinc-100 hover:text-zinc-700 active:cursor-grabbing active:bg-blue-50 active:text-blue-600"
      >
        <GripVertical size={15} />
      </button>
      <div className="grid h-8 w-8 place-items-center rounded-lg bg-zinc-100 text-[13px] font-semibold text-zinc-700">
        <ViewIconRenderer value={view.icon} size={16} className="text-zinc-700" />
      </div>
      <div className="min-w-0">
        <div className="truncate text-[13.5px] font-semibold text-zinc-900">{view.name}</div>
        <div className="mt-0.5 truncate text-[11.5px] text-zinc-400">
          {view.conditions.length} 个条件
        </div>
      </div>
      <div className="justify-self-end text-[12px] font-medium text-zinc-500">{view.count} 项</div>
      <div className="flex justify-end gap-1">
        <IconButton label={`${view.name} 往前移一格`} disabled={isFirst} onPress={onMoveUp}>
          <ArrowUp size={13} />
        </IconButton>
        <IconButton label={`${view.name} 往后移一格`} disabled={isLast} onPress={onMoveDown}>
          <ArrowDown size={13} />
        </IconButton>
        <ViewRowMoreMenu
          viewName={view.name}
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

function ViewRowMoreMenu({
  viewName,
  isFirst,
  onMoveFirst,
  onEdit,
  onDelete,
}: {
  viewName: string;
  isFirst: boolean;
  onMoveFirst: () => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  return (
    <Dropdown>
      <Dropdown.Trigger
        data-no-drag
        className={ROW_MORE_TRIGGER_CLASS_NAME}
        aria-label={`${viewName} 更多操作`}
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
          aria-label={`${viewName} 操作`}
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
            textValue="移到最前"
            className="flex h-7 cursor-default items-center gap-2 rounded-lg px-2 text-[12.5px] font-medium text-zinc-700 outline-none transition-colors data-[disabled]:opacity-45 data-[focused]:bg-zinc-100 data-[hovered]:bg-zinc-100"
          >
            <ArrowUpToLine size={13} className="text-zinc-500" />
            <span>移到最前</span>
          </Dropdown.Item>
          <Dropdown.Item
            key="edit"
            id="edit"
            textValue="编辑"
            className="flex h-7 cursor-default items-center gap-2 rounded-lg px-2 text-[12.5px] font-medium text-zinc-700 outline-none transition-colors data-[focused]:bg-zinc-100 data-[hovered]:bg-zinc-100"
          >
            <Pencil size={13} className="text-zinc-500" />
            <span>编辑</span>
          </Dropdown.Item>
          <Dropdown.Item
            key="delete"
            id="delete"
            textValue="删除"
            className="flex h-7 cursor-default items-center gap-2 rounded-lg px-2 text-[12.5px] font-medium text-red-600 outline-none transition-colors data-[focused]:bg-red-50 data-[hovered]:bg-red-50"
          >
            <Trash2 size={13} />
            <span>删除</span>
          </Dropdown.Item>
        </Dropdown.Menu>
      </Dropdown.Popover>
    </Dropdown>
  );
}

export function ViewsManagementPage() {
  const sidebarQuery = useQuery({
    ...trpc.assets.sidebarMeta.queryOptions(),
    refetchOnWindowFocus: false,
    staleTime: 30_000,
  });
  const invalidateVaultState = useInvalidateVaultState();
  const confirm = useConfirmModal();
  const deleteSavedView = useMutation(trpc.assets.deleteSavedView.mutationOptions());
  const reorderSavedViews = useMutation(
    trpc.assets.reorderSavedViews.mutationOptions({
      onSuccess: invalidateVaultState,
    }),
  );
  const views = sidebarQuery.data?.views ?? [];
  const [orderedIds, setOrderedIds] = useState<string[]>([]);
  const [modalState, setModalState] = useState<ViewModalState | null>(null);

  useEffect(() => {
    setOrderedIds(views.map((view) => view.id));
  }, [views]);

  const orderedViews = useMemo(() => orderViewsByIds(views, orderedIds), [orderedIds, views]);

  const reorderViewIds = (nextIds: string[]) => {
    setOrderedIds(nextIds);
    reorderSavedViews.mutate({ vaultId: sidebarQuery.data?.vault?.id, orderedIds: nextIds });
  };

  const moveView = (fromIndex: number, toIndex: number) => {
    const currentIds = orderedViews.map((view) => view.id);
    const nextIndex = Math.max(0, Math.min(currentIds.length - 1, toIndex));
    if (fromIndex === nextIndex) return;

    reorderViewIds(arrayMove(currentIds, fromIndex, nextIndex));
  };

  const handleDragEnd = (event: DragEndEvent) => {
    if (event.canceled) return;

    const currentIds = orderedViews.map((view) => view.id);
    const { source } = event.operation;
    if (
      !isSortable(source) ||
      source.initialGroup !== source.group ||
      source.initialIndex === source.index
    )
      return;

    const nextIds = arrayMove(currentIds, source.initialIndex, source.index);

    reorderViewIds(nextIds);
  };

  const handleDelete = (view: SidebarView) => {
    void (async () => {
      const confirmed = await confirm({
        title: `删除 View「${view.name}」？`,
        description: "删除后不会影响资产或 Tags，只会移除这个保存的视图。",
        confirmLabel: "删除",
        cancelLabel: "取消",
        variant: "danger",
        onConfirm: async () => {
          await deleteSavedView.mutateAsync({ id: view.id });
        },
      });
      if (!confirmed) {
        return;
      }
      await invalidateVaultState();
      showToastAfterRefresh(() => {
        toast.success("View 已删除");
      });
    })();
  };

  return (
    <main className="flex h-full min-w-0 flex-col bg-white">
      <PageChrome>
        <div className="window-no-drag flex items-center gap-2">
          <FolderKanban size={15} className="text-zinc-500" />
          <h1 className="text-[13px] font-semibold text-zinc-900">Views 管理</h1>
          <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-[11px] font-medium text-zinc-500">
            {views.length}
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
            新建 View
          </Button>
        </div>
      </PageChrome>

      <ScrollArea className="min-h-0 flex-1" viewportClassName="px-8 py-6">
        <div className="mx-auto max-w-[860px] overflow-visible bg-white">
          <div className="grid grid-cols-[28px_34px_minmax(0,1fr)_76px_104px] items-center gap-3 border-b border-zinc-100 bg-zinc-50 px-4 py-2 text-[11px] font-semibold uppercase tracking-wide text-zinc-400">
            <span />
            <span>Icon</span>
            <span>名称</span>
            <span className="justify-self-end">资产</span>
            <span className="justify-self-end">操作</span>
          </div>
          {orderedViews.length > 0 ? (
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
              {orderedViews.map((view, index) => (
                <SortableViewRow
                  key={view.id}
                  view={view}
                  index={index}
                  isFirst={index === 0}
                  isLast={index === orderedViews.length - 1}
                  onMoveFirst={() => moveView(index, 0)}
                  onMoveUp={() => moveView(index, index - 1)}
                  onMoveDown={() => moveView(index, index + 1)}
                  onEdit={() => setModalState({ kind: "edit", view })}
                  onDelete={() => handleDelete(view)}
                />
              ))}
            </DragDropProvider>
          ) : (
            <div className="grid h-48 place-items-center text-[13px] text-zinc-400">
              {sidebarQuery.isLoading ? "正在读取 Views" : "还没有 View"}
            </div>
          )}
        </div>
      </ScrollArea>

      <ViewFormModal
        isOpen={modalState !== null}
        mode={modalState ?? { kind: "create" }}
        vaultId={sidebarQuery.data?.vault?.id}
        tagOptions={sidebarQuery.data?.tags ?? []}
        sourceOptions={sidebarQuery.data?.sourceOptions ?? []}
        onOpenChange={(open) => {
          if (!open) setModalState(null);
        }}
      />
    </main>
  );
}
