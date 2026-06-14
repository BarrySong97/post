/**
 * @purpose Support asset manager asset management modals behavior and data shaping.
 * @role    Reusable asset manager component shared by asset manager, tags, views, and layout.
 * @deps    Asset tRPC types, React/HeroUI where UI is present, local storage or URL helpers as needed.
 * @gotcha  Keep asset kind/status/tag/view contracts synchronized with packages/db schema and saved-view JSON.
 */

import {
  type Dispatch,
  type ReactNode,
  type SetStateAction,
  useEffect,
  useMemo,
  useState,
} from "react";
import { Controller, useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation } from "@tanstack/react-query";
import {
  AccordionBody,
  AccordionItem,
  AccordionPanel,
  AccordionRoot,
  Button,
  ColorArea,
  ColorPicker,
  ColorSlider,
  ColorSwatch,
  ColorSwatchPicker,
  FieldError,
  Form,
  Input,
  Label,
  Modal,
  TextField,
  useOverlayState,
} from "@heroui/react";
import { ChevronDown, Hash, Loader2 } from "lucide-react";

import { useInvalidateVaultState } from "@/hooks/use-invalidate-vault-state";
import { toast } from "@/lib/toast";
import { trpc } from "@/lib/trpc";
import { getDefaultAssetFilters, type AssetFilterState } from "@/store/asset-manager-atoms";
import type { SidebarTag, SidebarView } from "@/lib/asset-manager/types";
import {
  AssetFilterFields,
  assetFiltersToSavedViewFilters,
  savedViewFiltersToAssetFilters,
} from "@/components/asset-manager/asset-filter-controls";
import { getTagHue } from "@/lib/asset-manager/asset-model";
import {
  DEFAULT_VIEW_ICON,
  getIconLabel,
  ViewIconPicker,
  ViewIconRenderer,
} from "@/components/asset-manager/view-icon-picker";
import {
  tagFormSchema,
  viewFormSchema,
  type TagFormValues,
  type ViewFormValues,
} from "@/lib/asset-manager/form-schemas";

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

type CollapsibleSectionProps = {
  id: string;
  title: string;
  summary?: ReactNode;
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  children: ReactNode;
};

function CollapsibleSection({
  id,
  title,
  summary,
  isOpen,
  onOpenChange,
  children,
}: CollapsibleSectionProps) {
  return (
    <AccordionRoot
      hideSeparator
      expandedKeys={isOpen ? [id] : []}
      onExpandedChange={(keys) => onOpenChange(keys.has(id))}
      className="overflow-hidden rounded-xl border border-zinc-200 bg-[#fbfbfa]"
    >
      <AccordionItem id={id} className="border-none">
        <button
          type="button"
          className="flex w-full items-center gap-1.5 px-3 py-2.5 text-left"
          onClick={() => onOpenChange(!isOpen)}
        >
          <ChevronDown
            size={12}
            className={`shrink-0 text-zinc-400 transition-transform ${isOpen ? "" : "-rotate-90"}`}
          />
          <span className="text-[12px] font-semibold text-zinc-600">{title}</span>
          {summary != null ? (
            <span className="ml-auto min-w-0 truncate text-[11.5px] text-zinc-400">{summary}</span>
          ) : null}
        </button>
        <AccordionPanel id={`${id}-panel`} className="overflow-hidden">
          <AccordionBody className="px-3 pb-3 pt-2">{children}</AccordionBody>
        </AccordionPanel>
      </AccordionItem>
    </AccordionRoot>
  );
}

type TagFormMode = { kind: "create" } | { kind: "edit"; tag: SidebarTag };

type TagFormModalProps = {
  isOpen: boolean;
  mode: TagFormMode;
  vaultId?: string;
  onOpenChange: (isOpen: boolean) => void;
};

export function TagFormModal({ isOpen, mode, vaultId, onOpenChange }: TagFormModalProps) {
  const invalidateVaultState = useInvalidateVaultState();
  const isEdit = mode.kind === "edit";

  const form = useForm<TagFormValues>({
    resolver: zodResolver(tagFormSchema),
    defaultValues: { name: "", color: null },
  });
  const { control, reset, handleSubmit } = form;

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
    reset(isEdit ? { name: mode.tag.name, color: mode.tag.color } : { name: "", color: null });
  }, [isEdit, isOpen, mode, reset]);

  // Live preview for the header swatch.
  const watchedName = useWatch({ control, name: "name" });
  const watchedColor = useWatch({ control, name: "color" });
  const resolvedColor =
    watchedColor ??
    (watchedName ? `oklch(0.62 0.14 ${getTagHue(watchedName)})` : TAG_COLOR_PRESETS[0]);
  // Gate the submit button on validity (schema-driven, live for both create and edit).
  const canSubmit = tagFormSchema.shape.name.safeParse(watchedName).success;

  const onSubmit = handleSubmit(async (values) => {
    if (isEdit) {
      await updateTag.mutateAsync({ id: mode.tag.id, name: values.name, color: values.color });
      toast.success("标签已更新");
    } else {
      await createTag.mutateAsync({ vaultId, name: values.name, color: values.color });
      toast.success("标签已创建");
    }

    await invalidateVaultState();
    onOpenChange(false);
  });

  return (
    <Modal.Root state={modalState}>
      <Modal.Backdrop isDismissable={!isPending} variant="opaque" className="z-[200]">
        <Modal.Container size="md" placement="center">
          <Modal.Dialog className="outline-none">
            <Form onSubmit={onSubmit} validationBehavior="aria" className="contents">
              <Modal.Header className="items-center px-5 pb-3 pt-5">
                <Modal.Icon
                  className="grid h-8 w-8 place-items-center rounded-full text-white"
                  style={{ background: resolvedColor }}
                >
                  <Hash size={16} />
                </Modal.Icon>
                <Modal.Heading className="text-[15px] font-semibold text-zinc-950">
                  {isEdit ? "编辑 Tag" : "新建 Tag"}
                </Modal.Heading>
              </Modal.Header>
              <Modal.Body className="space-y-4 px-2 py-0">
                <Controller
                  control={control}
                  name="name"
                  render={({ field, fieldState }) => (
                    <TextField.Root
                      value={field.value}
                      onChange={field.onChange}
                      onBlur={field.onBlur}
                      isInvalid={fieldState.invalid}
                      isRequired
                      name={field.name}
                      className="block w-full"
                    >
                      <Label className="mb-1.5 block text-[12px] font-semibold text-zinc-500">
                        名称
                      </Label>
                      <Input.Root
                        placeholder="例如：灵感"
                        autoFocus
                        className={`h-9 w-full rounded-lg border bg-white px-3 text-[13px] outline-none ${
                          fieldState.invalid ? "border-red-400" : "border-zinc-200"
                        }`}
                      />
                      {fieldState.error ? (
                        <FieldError className="mt-1 block text-[11.5px] text-red-600">
                          {fieldState.error.message}
                        </FieldError>
                      ) : null}
                    </TextField.Root>
                  )}
                />

                <div>
                  <div className="mb-2 text-[12px] font-semibold text-zinc-500">颜色</div>
                  <Controller
                    control={control}
                    name="color"
                    render={({ field }) => {
                      const pickerColor = getHeroUIColorValue(field.value) ?? DEFAULT_TAG_COLOR;
                      const swatchPickerValue = getHeroUIColorValue(field.value) ?? undefined;
                      return (
                        <div className="flex flex-wrap items-center justify-between gap-2.5">
                          <ColorPicker
                            value={pickerColor}
                            onChange={(nextColor) => field.onChange(nextColor.toString("hex"))}
                          >
                            <ColorPicker.Trigger className="flex h-8 cursor-pointer items-center gap-2 rounded-lg border border-zinc-200 bg-white px-2 text-[11px] font-medium text-zinc-600 outline-none transition-colors hover:bg-zinc-50 data-[focus-visible]:ring-2 data-[focus-visible]:ring-zinc-500/25">
                              <ColorSwatch size="sm" shape="circle" />
                              <Label className="cursor-pointer text-[11px] font-medium text-zinc-600">
                                自定义
                              </Label>
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
                          <ColorSwatchPicker
                            aria-label="快速选择 Tag 颜色"
                            layout="grid"
                            size="sm"
                            variant="square"
                            value={swatchPickerValue}
                            onChange={(nextColor) => field.onChange(nextColor.toString("hex"))}
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
                        </div>
                      );
                    }}
                  />
                </div>
              </Modal.Body>
              <Modal.Footer>
                <Button
                  size="sm"
                  variant="ghost"
                  className="rounded-lg text-[12px] text-zinc-600"
                  isDisabled={isPending}
                  onPress={() => onOpenChange(false)}
                >
                  取消
                </Button>
                <Button
                  type="submit"
                  size="sm"
                  variant="primary"
                  className="rounded-lg text-[12px] font-semibold"
                  isDisabled={isPending || !canSubmit}
                >
                  {isPending ? <Loader2 size={13} className="animate-spin" /> : null}
                  {isEdit ? "保存" : "创建"}
                </Button>
              </Modal.Footer>
            </Form>
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
  const [iconOpen, setIconOpen] = useState(false);
  const [filterOpen, setFilterOpen] = useState(true);
  const invalidateVaultState = useInvalidateVaultState();
  const isEdit = mode.kind === "edit";

  const form = useForm<ViewFormValues>({
    resolver: zodResolver(viewFormSchema),
    defaultValues: { name: "", icon: DEFAULT_VIEW_ICON, filters: getDefaultAssetFilters() },
  });
  const { control, reset, handleSubmit } = form;

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
    () => (sourceOptions.length > 0 ? sourceOptions : ["资产库"]),
    [sourceOptions],
  );

  useEffect(() => {
    if (!isOpen) return;

    if (isEdit) {
      reset({
        name: mode.view.name,
        icon: mode.view.icon ?? DEFAULT_VIEW_ICON,
        filters: savedViewFiltersToAssetFilters(mode.view.filters, tagOptions, mode.view.sort),
      });
      return;
    }

    reset({
      name: "",
      icon: DEFAULT_VIEW_ICON,
      filters: mode.initialFilters ?? getDefaultAssetFilters(),
    });
  }, [isEdit, isOpen, mode, tagOptions, reset]);

  // Live preview for the header icon + the collapsed-section summary.
  const watchedIcon = useWatch({ control, name: "icon" });
  const watchedName = useWatch({ control, name: "name" });
  // Gate the submit button on validity (schema-driven, live for both create and edit).
  const canSubmit = viewFormSchema.shape.name.safeParse(watchedName).success;

  const onSubmit = handleSubmit(async (values) => {
    const payload = {
      name: values.name,
      icon: values.icon.trim() || DEFAULT_VIEW_ICON,
      filters: assetFiltersToSavedViewFilters(values.filters, tagOptions),
      sort: values.filters.sort,
    };

    if (isEdit) {
      await updateSavedView.mutateAsync({ id: mode.view.id, ...payload });
      toast.success("View 已更新");
    } else {
      await createSavedView.mutateAsync({ vaultId, ...payload });
      toast.success("View 已创建");
    }

    await invalidateVaultState();
    onOpenChange(false);
  });

  return (
    <Modal.Root state={modalState}>
      <Modal.Backdrop isDismissable={!isPending} variant="opaque" className="z-[200]">
        <Modal.Container size="lg" placement="center" scroll="inside">
          <Modal.Dialog className="max-h-full outline-none">
            <Form onSubmit={onSubmit} validationBehavior="aria" className="contents">
              <Modal.Header className="items-center px-5 pb-3 pt-5">
                <Modal.Icon className="grid h-8 w-8 place-items-center rounded-full bg-zinc-100 text-zinc-700">
                  <ViewIconRenderer value={watchedIcon} size={16} />
                </Modal.Icon>
                <Modal.Heading className="text-[15px] font-semibold text-zinc-950">
                  {isEdit ? "编辑 View" : "新建 View"}
                </Modal.Heading>
              </Modal.Header>
              <Modal.Body className="space-y-5 px-2 pb-0 pt-2">
                <Controller
                  control={control}
                  name="name"
                  render={({ field, fieldState }) => (
                    <TextField.Root
                      value={field.value}
                      onChange={field.onChange}
                      onBlur={field.onBlur}
                      isInvalid={fieldState.invalid}
                      isRequired
                      name={field.name}
                      className="block w-full"
                    >
                      <Label className="mb-1.5 block text-[12px] font-semibold text-zinc-500">
                        名称
                      </Label>
                      <Input.Root
                        placeholder="例如：图片素材"
                        autoFocus
                        className={`h-9 w-full rounded-lg border bg-white px-3 text-[13px] outline-none ${
                          fieldState.invalid ? "border-red-400" : "border-zinc-200"
                        }`}
                      />
                      {fieldState.error ? (
                        <FieldError className="mt-1 block text-[11.5px] text-red-600">
                          {fieldState.error.message}
                        </FieldError>
                      ) : null}
                    </TextField.Root>
                  )}
                />

                <Controller
                  control={control}
                  name="icon"
                  render={({ field }) => (
                    <CollapsibleSection
                      id="view-icon"
                      title="Icon"
                      summary={getIconLabel(field.value)}
                      isOpen={iconOpen}
                      onOpenChange={setIconOpen}
                    >
                      <ViewIconPicker
                        value={field.value}
                        onChange={field.onChange}
                        isDisabled={isPending}
                      />
                    </CollapsibleSection>
                  )}
                />

                <Controller
                  control={control}
                  name="filters"
                  render={({ field }) => {
                    // AssetFilterFields uses functional `setState` updaters; adapt them to
                    // RHF's value-only onChange by resolving against the current field value.
                    const handleFiltersChange: Dispatch<SetStateAction<AssetFilterState>> = (
                      update,
                    ) => {
                      field.onChange(
                        typeof update === "function"
                          ? (update as (prev: AssetFilterState) => AssetFilterState)(field.value)
                          : update,
                      );
                    };
                    return (
                      <CollapsibleSection
                        id="view-filters"
                        title="筛选条件"
                        isOpen={filterOpen}
                        onOpenChange={setFilterOpen}
                      >
                        <div className="space-y-3">
                          <AssetFilterFields
                            filters={field.value}
                            onFiltersChange={handleFiltersChange}
                            tagOptions={tagOptions}
                            sourceOptions={effectiveSourceOptions}
                          />
                        </div>
                      </CollapsibleSection>
                    );
                  }}
                />
              </Modal.Body>
              <Modal.Footer>
                <Button
                  size="sm"
                  variant="ghost"
                  className="rounded-lg text-[12px] text-zinc-600"
                  isDisabled={isPending}
                  onPress={() => onOpenChange(false)}
                >
                  取消
                </Button>
                <Button
                  type="submit"
                  size="sm"
                  variant="primary"
                  className="rounded-lg text-[12px] font-semibold"
                  isDisabled={isPending || !canSubmit}
                >
                  {isPending ? <Loader2 size={13} className="animate-spin" /> : null}
                  {isEdit ? "保存" : "创建"}
                </Button>
              </Modal.Footer>
            </Form>
          </Modal.Dialog>
        </Modal.Container>
      </Modal.Backdrop>
    </Modal.Root>
  );
}
