import { useEffect, useMemo, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import {
  Button,
  ColorArea,
  ColorPicker,
  ColorSlider,
  ColorSwatch,
  ColorSwatchPicker,
  Input,
  Label,
  Modal,
  useOverlayState,
} from "@heroui/react";
import { FolderKanban, Hash, Loader2, Plus } from "lucide-react";

import { useInvalidateVaultState } from "@/hooks/use-invalidate-vault-state";
import { toast } from "@/lib/toast";
import { trpc } from "@/lib/trpc";
import {
  getDefaultAssetFilters,
  type AssetFilterState,
} from "@/store/asset-manager-atoms";
import type { SidebarTag, SidebarView } from "@/features/assets/types";
import {
  AssetFilterFields,
  assetFiltersToSavedViewFilters,
  savedViewFiltersToAssetFilters,
} from "@/features/assets/asset-filter-controls";
import { getTagHue } from "@/features/assets/asset-model";

const TAG_COLOR_PRESETS = [
  "#e5484d",
  "#f76808",
  "#f5d90a",
  "#30a46c",
  "#0090ff",
  "#6e56cf",
  "#d6409f",
  "#71717a",
] as const;

const DEFAULT_TAG_COLOR = TAG_COLOR_PRESETS[0];
const HEROUI_PICKER_COLOR_PATTERN = /^(#[\da-f]{3,8}|rgba?\(|hsla?\()/i;

function getHeroUIColorValue(value: string | null | undefined) {
  const nextValue = value?.trim();
  if (!nextValue || !HEROUI_PICKER_COLOR_PATTERN.test(nextValue)) {
    return null;
  }

  return nextValue;
}

type TagFormMode =
  | { kind: "create" }
  | { kind: "edit"; tag: SidebarTag };

type TagFormModalProps = {
  isOpen: boolean;
  mode: TagFormMode;
  vaultId?: string;
  onOpenChange: (isOpen: boolean) => void;
};

export function TagFormModal({ isOpen, mode, vaultId, onOpenChange }: TagFormModalProps) {
  const [name, setName] = useState("");
  const [color, setColor] = useState<string | null>(null);
  const invalidateVaultState = useInvalidateVaultState();
  const isEdit = mode.kind === "edit";

  const createTag = useMutation(trpc.assets.createTag.mutationOptions());
  const updateTag = useMutation(trpc.assets.updateTag.mutationOptions());
  const isPending = createTag.isPending || updateTag.isPending;
  const modalState = useOverlayState({
    isOpen,
    onOpenChange: (open) => {
      if (!isPending) onOpenChange(open);
    },
  });

  useEffect(() => {
    if (!isOpen) return;
    setName(isEdit ? mode.tag.name : "");
    setColor(isEdit ? mode.tag.color : null);
  }, [isEdit, isOpen, mode]);

  const resolvedColor = color ?? (name ? `oklch(0.62 0.14 ${getTagHue(name)})` : TAG_COLOR_PRESETS[0]);
  const pickerColor = getHeroUIColorValue(color) ?? DEFAULT_TAG_COLOR;
  const swatchPickerValue = getHeroUIColorValue(color) ?? undefined;

  const handleSubmit = async () => {
    const nextName = name.trim();
    if (!nextName) {
      toast.warning("请输入标签名称");
      return;
    }

    if (isEdit) {
      await updateTag.mutateAsync({
        id: mode.tag.id,
        name: nextName,
        color,
      });
      toast.success("标签已更新");
    } else {
      await createTag.mutateAsync({
        vaultId,
        name: nextName,
        color,
      });
      toast.success("标签已创建");
    }

    await invalidateVaultState();
    onOpenChange(false);
  };

  return (
    <Modal.Root state={modalState}>
      <Modal.Backdrop isDismissable={!isPending} variant="opaque" className="z-[200]">
        <Modal.Container size="md" placement="center">
          <Modal.Dialog className="outline-none">
            <Modal.Header className="flex items-center gap-3 px-5 pb-3 pt-5">
              <Modal.Icon className="grid h-8 w-8 place-items-center rounded-full bg-zinc-100 text-zinc-700">
                <Hash size={16} />
              </Modal.Icon>
              <Modal.Heading className="text-[15px] font-semibold text-zinc-950">
                {isEdit ? "编辑 Tag" : "新建 Tag"}
              </Modal.Heading>
            </Modal.Header>
            <Modal.Body className="space-y-4 px-5 pb-2 pt-0">
              <label className="block w-full">
                <span className="mb-1.5 block text-[12px] font-semibold text-zinc-500">名称</span>
                <Input.Root
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  placeholder="例如：灵感"
                  className="h-9 w-full rounded-lg border border-zinc-200 bg-white px-3 text-[13px] outline-none"
                  autoFocus
                />
              </label>

              <div>
                <div className="mb-2 text-[12px] font-semibold text-zinc-500">颜色</div>
                <div className="flex flex-wrap items-center gap-2.5">
                  <button
                    type="button"
                    className={`flex h-8 cursor-pointer items-center gap-1.5 rounded-lg border px-2 text-[11px] font-medium transition-colors ${
                      color === null
                        ? "border-zinc-900 bg-zinc-50 text-zinc-900"
                        : "border-zinc-200 text-zinc-500 hover:bg-zinc-50"
                    }`}
                    onClick={() => setColor(null)}
                  >
                    <span
                      className="h-3 w-3 rounded-full"
                      style={{ background: name ? `oklch(0.62 0.14 ${getTagHue(name)})` : "#a1a1aa" }}
                    />
                    自动
                  </button>
                  <ColorSwatchPicker
                    aria-label="快速选择 Tag 颜色"
                    layout="grid"
                    size="sm"
                    variant="square"
                    value={swatchPickerValue}
                    onChange={(nextColor) => setColor(nextColor.toString("hex"))}
                    className="gap-1.5"
                  >
                    {TAG_COLOR_PRESETS.map((preset) => (
                      <ColorSwatchPicker.Item
                        key={preset}
                        color={preset}
                        aria-label={preset}
                        className="cursor-pointer rounded-lg"
                      >
                        <ColorSwatchPicker.Swatch />
                        <ColorSwatchPicker.Indicator />
                      </ColorSwatchPicker.Item>
                    ))}
                  </ColorSwatchPicker>
                  <ColorPicker
                    value={pickerColor}
                    onChange={(nextColor) => setColor(nextColor.toString("hex"))}
                    className="ml-1"
                  >
                    <ColorPicker.Trigger className="flex h-8 cursor-pointer items-center gap-2 rounded-lg border border-zinc-200 bg-white px-2 text-[11px] font-medium text-zinc-600 outline-none transition-colors hover:bg-zinc-50 data-[focus-visible]:ring-2 data-[focus-visible]:ring-zinc-500/25">
                      <ColorSwatch size="sm" shape="circle" />
                      <Label className="cursor-pointer text-[11px] font-medium text-zinc-600">自定义</Label>
                    </ColorPicker.Trigger>
                    <ColorPicker.Popover
                      placement="bottom left"
                      className="z-[230] w-64 rounded-xl border border-zinc-200 bg-white p-3 shadow-[0_18px_44px_rgba(24,24,27,0.16),0_3px_10px_rgba(24,24,27,0.08)]"
                    >
                      <ColorArea
                        colorSpace="hsb"
                        xChannel="saturation"
                        yChannel="brightness"
                        className="h-36 w-full rounded-lg"
                      >
                        <ColorArea.Thumb />
                      </ColorArea>
                      <ColorSlider channel="hue" colorSpace="hsb" className="mt-3">
                        <ColorSlider.Track>
                          <ColorSlider.Thumb />
                        </ColorSlider.Track>
                      </ColorSlider>
                    </ColorPicker.Popover>
                  </ColorPicker>
                </div>
                <div className="mt-2 flex items-center gap-2 text-[12px] text-zinc-500">
                  <span className="h-2.5 w-2.5 rounded-full" style={{ background: resolvedColor }} />
                  预览
                </div>
              </div>
            </Modal.Body>
            <Modal.Footer className="flex items-center justify-end gap-2 px-5 pb-5 pt-4">
              <Button
                size="sm"
                variant="ghost"
                className="h-8 min-h-0 rounded-lg px-3 text-[12px] text-zinc-600"
                isDisabled={isPending}
                onPress={() => onOpenChange(false)}
              >
                取消
              </Button>
              <Button
                size="sm"
                variant="primary"
                className="h-8 min-h-0 rounded-lg px-3 text-[12px] font-semibold"
                isDisabled={isPending}
                onPress={() => void handleSubmit()}
              >
                {isPending ? <Loader2 size={13} className="animate-spin" /> : null}
                {isEdit ? "保存" : "创建"}
              </Button>
            </Modal.Footer>
          </Modal.Dialog>
        </Modal.Container>
      </Modal.Backdrop>
    </Modal.Root>
  );
}

type ViewFormMode =
  | { kind: "create"; initialFilters?: AssetFilterState }
  | { kind: "edit"; view: SidebarView };

type ViewFormModalProps = {
  isOpen: boolean;
  mode: ViewFormMode;
  vaultId?: string;
  tagOptions: SidebarTag[];
  sourceOptions: string[];
  onOpenChange: (isOpen: boolean) => void;
};

export function ViewFormModal({
  isOpen,
  mode,
  vaultId,
  tagOptions,
  sourceOptions,
  onOpenChange,
}: ViewFormModalProps) {
  const [name, setName] = useState("");
  const [icon, setIcon] = useState("#");
  const [filters, setFilters] = useState<AssetFilterState>(getDefaultAssetFilters);
  const invalidateVaultState = useInvalidateVaultState();
  const isEdit = mode.kind === "edit";

  const createSavedView = useMutation(trpc.assets.createSavedView.mutationOptions());
  const updateSavedView = useMutation(trpc.assets.updateSavedView.mutationOptions());
  const isPending = createSavedView.isPending || updateSavedView.isPending;
  const modalState = useOverlayState({
    isOpen,
    onOpenChange: (open) => {
      if (!isPending) onOpenChange(open);
    },
  });

  const effectiveSourceOptions = useMemo(
    () => sourceOptions.length > 0 ? sourceOptions : ["资产库"],
    [sourceOptions],
  );

  useEffect(() => {
    if (!isOpen) return;

    if (isEdit) {
      setName(mode.view.name);
      setIcon(mode.view.icon ?? "#");
      setFilters(savedViewFiltersToAssetFilters(mode.view.filters, tagOptions, mode.view.sort));
      return;
    }

    setName("");
    setIcon("#");
    setFilters(mode.initialFilters ?? getDefaultAssetFilters());
  }, [isEdit, isOpen, mode, tagOptions]);

  const handleSubmit = async () => {
    const nextName = name.trim();
    if (!nextName) {
      toast.warning("请输入 View 名称");
      return;
    }

    const payload = {
      name: nextName,
      icon: icon.trim() || "#",
      filters: assetFiltersToSavedViewFilters(filters, tagOptions),
      sort: filters.sort,
    };

    if (isEdit) {
      await updateSavedView.mutateAsync({
        id: mode.view.id,
        ...payload,
      });
      toast.success("View 已更新");
    } else {
      await createSavedView.mutateAsync({
        vaultId,
        ...payload,
      });
      toast.success("View 已创建");
    }

    await invalidateVaultState();
    onOpenChange(false);
  };

  return (
    <Modal.Root state={modalState}>
      <Modal.Backdrop isDismissable={!isPending} variant="opaque" className="z-[200]">
        <Modal.Container size="lg" placement="center" scroll="inside">
          <Modal.Dialog className="outline-none">
            <Modal.Header className="flex items-center gap-3 px-5 pb-3 pt-5">
              <Modal.Icon className="grid h-8 w-8 place-items-center rounded-full bg-zinc-100 text-zinc-700">
                <FolderKanban size={16} />
              </Modal.Icon>
              <Modal.Heading className="text-[15px] font-semibold text-zinc-950">
                {isEdit ? "编辑 View" : "新建 View"}
              </Modal.Heading>
            </Modal.Header>
            <Modal.Body className="space-y-5 px-5 pb-2 pt-0">
              <div className="grid grid-cols-[minmax(0,1fr)_76px] gap-3">
                <label className="block w-full">
                  <span className="mb-1.5 block text-[12px] font-semibold text-zinc-500">名称</span>
                  <Input.Root
                    value={name}
                    onChange={(event) => setName(event.target.value)}
                    placeholder="例如：图片素材"
                    className="h-9 w-full rounded-lg border border-zinc-200 bg-white px-3 text-[13px] outline-none"
                    autoFocus
                  />
                </label>
                <label className="block">
                  <span className="mb-1.5 block text-[12px] font-semibold text-zinc-500">Icon</span>
                  <Input.Root
                    value={icon}
                    onChange={(event) => setIcon(event.target.value.slice(0, 6))}
                    className="h-9 rounded-lg border border-zinc-200 bg-white px-3 text-center text-[13px] outline-none"
                  />
                </label>
              </div>

              <div className="rounded-xl border border-zinc-200 bg-[#fbfbfa] p-3">
                <div className="mb-3 flex items-center gap-2 text-[12px] font-semibold text-zinc-600">
                  <Plus size={13} />
                  筛选条件
                </div>
                <div className="space-y-3">
                  <AssetFilterFields
                    filters={filters}
                    onFiltersChange={setFilters}
                    tagOptions={tagOptions}
                    sourceOptions={effectiveSourceOptions}
                  />
                </div>
              </div>
            </Modal.Body>
            <Modal.Footer className="flex items-center justify-end gap-2 px-5 pb-5 pt-4">
              <Button
                size="sm"
                variant="ghost"
                className="h-8 min-h-0 rounded-lg px-3 text-[12px] text-zinc-600"
                isDisabled={isPending}
                onPress={() => onOpenChange(false)}
              >
                取消
              </Button>
              <Button
                size="sm"
                variant="primary"
                className="h-8 min-h-0 rounded-lg px-3 text-[12px] font-semibold"
                isDisabled={isPending}
                onPress={() => void handleSubmit()}
              >
                {isPending ? <Loader2 size={13} className="animate-spin" /> : null}
                {isEdit ? "保存" : "创建"}
              </Button>
            </Modal.Footer>
          </Modal.Dialog>
        </Modal.Container>
      </Modal.Backdrop>
    </Modal.Root>
  );
}
