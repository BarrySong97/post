/**
 * @purpose Render the pointer-positioned context menu for asset card actions.
 * @role    Renderer interaction surface for destructive asset operations.
 * @deps    React portal/events, Lucide icons, shared confirm modal, tRPC, and vault-state invalidation.
 * @gotcha  Render through document.body because masonry ancestors use transforms that trap fixed positioning.
 */

import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { useMutation } from "@tanstack/react-query";
import { Trash2 } from "lucide-react";

import { useConfirmModal } from "@/components/common/confirm-modal";
import { useInvalidateVaultState } from "@/hooks/use-invalidate-vault-state";
import type { Asset } from "@/lib/asset-manager/types";
import { showToastAfterRefresh, toast } from "@/lib/toast";
import { trpc } from "@/lib/trpc";

const MENU_WIDTH = 168;
const MENU_HEIGHT = 42;
const VIEWPORT_MARGIN = 8;

export type AssetCardContextMenuState = {
  asset: Asset;
  x: number;
  y: number;
};

export function AssetCardContextMenu({
  state,
  onClose,
}: {
  state: AssetCardContextMenuState;
  onClose: () => void;
}) {
  const menuRef = useRef<HTMLDivElement>(null);
  const deleteAsset = useMutation(trpc.assets.deleteAsset.mutationOptions());
  const invalidateVaultState = useInvalidateVaultState();
  const confirm = useConfirmModal();

  useEffect(() => {
    menuRef.current?.querySelector<HTMLButtonElement>("[role='menuitem']")?.focus();

    const closeFromPointer = (event: PointerEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) {
        onClose();
      }
    };
    const closeFromKeyboard = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
      }
    };

    window.addEventListener("pointerdown", closeFromPointer);
    window.addEventListener("keydown", closeFromKeyboard);
    window.addEventListener("resize", onClose);
    window.addEventListener("scroll", onClose, true);
    return () => {
      window.removeEventListener("pointerdown", closeFromPointer);
      window.removeEventListener("keydown", closeFromKeyboard);
      window.removeEventListener("resize", onClose);
      window.removeEventListener("scroll", onClose, true);
    };
  }, [onClose]);

  const left = Math.max(
    VIEWPORT_MARGIN,
    Math.min(state.x, window.innerWidth - MENU_WIDTH - VIEWPORT_MARGIN),
  );
  const top = Math.max(
    VIEWPORT_MARGIN,
    Math.min(state.y, window.innerHeight - MENU_HEIGHT - VIEWPORT_MARGIN),
  );

  const requestDelete = () => {
    onClose();
    void (async () => {
      let movedToTrash = false;
      const confirmed = await confirm({
        title: `删除资产「${state.asset.title}」？`,
        description:
          "源文件会移到系统废纸篓，资产会从 Post 中移除。将文件恢复到原路径后可重新索引。",
        confirmLabel: "移到废纸篓",
        cancelLabel: "取消",
        variant: "danger",
        onConfirm: async () => {
          const result = await deleteAsset.mutateAsync({ id: state.asset.id });
          movedToTrash = result.movedToTrash;
        },
      });
      // After modal close: refresh list first, then toast so feedback tracks the board.
      if (!confirmed) {
        return;
      }
      await invalidateVaultState();
      showToastAfterRefresh(() => {
        toast.success(movedToTrash ? "资产已移到废纸篓" : "资产已删除");
      });
    })();
  };

  return createPortal(
    <div
      ref={menuRef}
      role="menu"
      aria-label={`${state.asset.title} 操作`}
      className="fixed z-[180] w-[168px] overflow-hidden rounded-lg border border-zinc-200 bg-white p-1 shadow-[0_14px_34px_rgba(20,18,16,0.14),0_2px_7px_rgba(20,18,16,0.07)]"
      style={{ left, top }}
      onContextMenu={(event) => event.preventDefault()}
    >
      <button
        type="button"
        role="menuitem"
        className="flex h-8 w-full items-center gap-2 rounded-md px-2 text-left text-[12.5px] font-medium text-red-600 outline-none transition-colors hover:bg-red-50 focus-visible:bg-red-50"
        onClick={requestDelete}
      >
        <Trash2 size={13} />
        <span>删除</span>
      </button>
    </div>,
    document.body,
  );
}
