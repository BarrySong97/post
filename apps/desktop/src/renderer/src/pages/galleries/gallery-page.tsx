/**
 * @purpose Render the dedicated image gallery browsing and management page.
 * @role    Renderer page focused on grouped image viewing, ordering, cover, and membership actions.
 * @deps    React, TanStack Query, tRPC hooks, HeroUI controls, gallery/asset URL helpers.
 * @gotcha  Keep this page image-first; route single-asset metadata work back to /assets/:assetId.
 */

import { useEffect, useState } from "react";
import { Controller, useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery } from "@tanstack/react-query";
import {
  Button,
  Chip,
  FieldError,
  Form,
  Input,
  Label,
  ListBox,
  Select,
  TextArea,
  TextField,
} from "@heroui/react";
import { AnimatePresence, motion } from "motion/react";
import {
  ArrowLeft,
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  ImageOff,
  Images,
  Save,
  Star,
  Trash2,
} from "lucide-react";

import { buildAssetFileUrl, buildAssetThumbnailUrl } from "@/lib/asset-manager/asset-url";
import { galleryFormSchema, type GalleryFormValues } from "@/lib/asset-manager/form-schemas";
import { queryClient, trpc } from "@/lib/trpc";
import type { GalleryDetail, GalleryMember } from "@/lib/asset-manager/types";

const STATUS_OPTIONS: Array<{ value: GalleryFormValues["status"]; label: string }> = [
  { value: "inbox", label: "Inbox" },
  { value: "organized", label: "Organized" },
  { value: "draft", label: "Draft" },
  { value: "published", label: "Published" },
  { value: "archived", label: "Archived" },
] as const;

const PRIVACY_OPTIONS: Array<{ value: GalleryFormValues["privacy"]; label: string }> = [
  { value: "normal", label: "Normal" },
  { value: "private", label: "Private" },
] as const;

function getMemberTitle(member: GalleryMember) {
  return member.asset.title || member.file.fileName;
}

function getMemberImageUrl(member: GalleryMember) {
  return member.file.fileExists ? buildAssetFileUrl(member.asset.id, member.file.fileName) : null;
}

function getMemberThumbnailUrl(member: GalleryMember) {
  if (!member.file.fileExists) {
    return null;
  }

  if (member.image?.status === "ready" && member.image.thumbnailPath) {
    return buildAssetThumbnailUrl(member.asset.id, member.file.fileName);
  }

  return buildAssetFileUrl(member.asset.id, member.file.fileName);
}

function getDimensions(member: GalleryMember | undefined) {
  if (!member?.image?.width || !member.image.height) {
    return "未知尺寸";
  }

  return `${member.image.width} × ${member.image.height}`;
}

function reorderAssetIds(
  members: readonly GalleryMember[],
  assetId: string,
  direction: "previous" | "next",
) {
  const ids = members.map((member) => member.asset.id);
  const index = ids.indexOf(assetId);
  if (index < 0) {
    return ids;
  }

  const targetIndex = direction === "previous" ? index - 1 : index + 1;
  if (targetIndex < 0 || targetIndex >= ids.length) {
    return ids;
  }

  const nextIds = [...ids];
  const [item] = nextIds.splice(index, 1);
  if (item) {
    nextIds.splice(targetIndex, 0, item);
  }

  return nextIds;
}

function MissingImagePlaceholder({ title }: { title: string }) {
  return (
    <div className="grid h-full min-h-[360px] place-items-center bg-zinc-100 text-center">
      <div>
        <ImageOff className="mx-auto text-zinc-300" size={42} strokeWidth={1.5} />
        <div className="mt-3 text-[13px] font-semibold text-zinc-600">文件丢失</div>
        <div className="mt-1 max-w-[280px] truncate text-[12px] text-zinc-400">{title}</div>
      </div>
    </div>
  );
}

function GalleryThumb({
  member,
  active,
  cover,
  onSelect,
}: {
  member: GalleryMember;
  active: boolean;
  cover: boolean;
  onSelect: () => void;
}) {
  const thumbnailUrl = getMemberThumbnailUrl(member);

  return (
    <button
      type="button"
      className={`relative h-20 w-20 shrink-0 overflow-hidden rounded-lg border text-left transition-all duration-150 ease-out ${
        active
          ? "border-zinc-900 shadow-sm ring-2 ring-zinc-900/10"
          : "border-zinc-200 hover:border-zinc-300"
      }`}
      onClick={onSelect}
    >
      {thumbnailUrl ? (
        <img
          src={thumbnailUrl}
          alt={getMemberTitle(member)}
          className="h-full w-full object-cover"
          draggable={false}
        />
      ) : (
        <div className="grid h-full place-items-center bg-zinc-100 text-zinc-300">
          <ImageOff size={18} />
        </div>
      )}
      {cover ? (
        <span className="absolute left-1.5 top-1.5 grid h-5 w-5 place-items-center rounded-md bg-zinc-950/80 text-white">
          <Star size={11} fill="currentColor" />
        </span>
      ) : null}
      {!member.file.fileExists ? (
        <span className="absolute bottom-1.5 left-1.5 rounded bg-amber-50 px-1.5 py-0.5 text-[9px] font-semibold text-amber-800">
          丢失
        </span>
      ) : null}
    </button>
  );
}

function GalleryEditor({
  detail,
  currentMember,
}: {
  detail: GalleryDetail;
  currentMember: GalleryMember | undefined;
}) {
  const form = useForm<GalleryFormValues>({
    resolver: zodResolver(galleryFormSchema),
    defaultValues: {
      title: detail.gallery.title,
      description: detail.gallery.description ?? "",
      status: detail.gallery.status,
      privacy: detail.gallery.privacy,
    },
  });
  const { control, handleSubmit, reset } = form;
  const updateGallery = useMutation(
    trpc.galleries.update.mutationOptions({
      onSuccess: () => void queryClient.invalidateQueries(),
    }),
  );
  const watchedTitle = useWatch({ control, name: "title" });
  const canSubmit = galleryFormSchema.shape.title.safeParse(watchedTitle).success;

  useEffect(() => {
    reset({
      title: detail.gallery.title,
      description: detail.gallery.description ?? "",
      status: detail.gallery.status,
      privacy: detail.gallery.privacy,
    });
  }, [
    detail.gallery.description,
    detail.gallery.privacy,
    detail.gallery.status,
    detail.gallery.title,
    reset,
  ]);

  const onSubmit = handleSubmit((values) =>
    updateGallery.mutate({
      galleryId: detail.gallery.id,
      title: values.title,
      description: values.description,
      status: values.status,
      privacy: values.privacy,
    }),
  );

  return (
    <aside className="flex h-full w-[292px] shrink-0 flex-col border-l border-zinc-100 bg-white">
      <div className="border-b border-zinc-100 px-4 py-4">
        <div className="flex items-center gap-2 text-[12px] font-semibold text-zinc-500">
          <Images size={14} />
          图集信息
        </div>
        <Form onSubmit={onSubmit} validationBehavior="aria" className="mt-3 space-y-3">
          <Controller
            control={control}
            name="title"
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
                <Label className="mb-1 block text-[11px] font-medium text-zinc-500">标题</Label>
                <Input.Root
                  className={`h-8 w-full rounded-lg border bg-white px-2 text-[13px] font-medium outline-none ${
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
            name="description"
            render={({ field, fieldState }) => (
              <TextField.Root
                value={field.value}
                onChange={field.onChange}
                onBlur={field.onBlur}
                isInvalid={fieldState.invalid}
                name={field.name}
                className="block w-full"
              >
                <Label className="mb-1 block text-[11px] font-medium text-zinc-500">描述</Label>
                <TextArea.Root
                  value={field.value}
                  rows={3}
                  className={`w-full resize-none rounded-lg border bg-white px-2 py-1.5 text-[13px] outline-none ${
                    fieldState.invalid ? "border-red-400" : "border-zinc-200"
                  }`}
                  onChange={(event) => field.onChange(event.currentTarget.value)}
                  onBlur={field.onBlur}
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
            name="status"
            render={({ field }) => (
              <div>
                <Label className="mb-1.5 block text-[11px] font-medium text-zinc-500">状态</Label>
                <Select.Root
                  selectedKey={field.value}
                  onSelectionChange={(key) => field.onChange(String(key))}
                  className="w-full"
                >
                  <Select.Trigger className="flex h-8 items-center justify-between gap-2 rounded-lg border border-zinc-200 bg-white px-2 text-[12px] text-zinc-700 hover:bg-zinc-50">
                    <Select.Value />
                    <Select.Indicator />
                  </Select.Trigger>
                  <Select.Popover>
                    <ListBox.Root className="rounded-xl border border-zinc-200 bg-white py-1 shadow-lg">
                      {STATUS_OPTIONS.map((option) => (
                        <ListBox.Item
                          key={option.value}
                          id={option.value}
                          className="cursor-pointer px-3 py-1.5 text-[12.5px] text-zinc-700 hover:bg-zinc-50"
                        >
                          {option.label}
                        </ListBox.Item>
                      ))}
                    </ListBox.Root>
                  </Select.Popover>
                </Select.Root>
              </div>
            )}
          />
          <Controller
            control={control}
            name="privacy"
            render={({ field }) => (
              <div>
                <Label className="mb-1.5 block text-[11px] font-medium text-zinc-500">隐私</Label>
                <Select.Root
                  selectedKey={field.value}
                  onSelectionChange={(key) => field.onChange(String(key))}
                  className="w-full"
                >
                  <Select.Trigger className="flex h-8 items-center justify-between gap-2 rounded-lg border border-zinc-200 bg-white px-2 text-[12px] text-zinc-700 hover:bg-zinc-50">
                    <Select.Value />
                    <Select.Indicator />
                  </Select.Trigger>
                  <Select.Popover>
                    <ListBox.Root className="rounded-xl border border-zinc-200 bg-white py-1 shadow-lg">
                      {PRIVACY_OPTIONS.map((option) => (
                        <ListBox.Item
                          key={option.value}
                          id={option.value}
                          className="cursor-pointer px-3 py-1.5 text-[12.5px] text-zinc-700 hover:bg-zinc-50"
                        >
                          {option.label}
                        </ListBox.Item>
                      ))}
                    </ListBox.Root>
                  </Select.Popover>
                </Select.Root>
              </div>
            )}
          />
          <Button
            type="submit"
            size="sm"
            className="h-8 w-full gap-1.5 rounded-lg bg-zinc-900 text-[12px] font-semibold text-white"
            isDisabled={!canSubmit || updateGallery.isPending}
          >
            <Save size={13} />
            保存
          </Button>
        </Form>
      </div>
      <div className="border-b border-zinc-100 px-4 py-4">
        <div className="text-[11px] font-semibold uppercase tracking-wide text-zinc-400">
          当前图片
        </div>
        {currentMember ? (
          <div className="mt-2 space-y-1.5 text-[12px] text-zinc-600">
            <div className="truncate font-medium text-zinc-900">
              {getMemberTitle(currentMember)}
            </div>
            <div>{getDimensions(currentMember)}</div>
            <div className="truncate">{currentMember.file.relativePath}</div>
            <div className="flex flex-wrap gap-1 pt-1">
              {currentMember.tags.length > 0 ? (
                currentMember.tags.map((tag) => (
                  <Chip key={tag.id} size="sm" className="h-5 min-h-0 px-2 text-[10px]">
                    {tag.name}
                  </Chip>
                ))
              ) : (
                <span className="text-zinc-400">无标签</span>
              )}
            </div>
          </div>
        ) : (
          <div className="mt-2 text-[12px] text-zinc-400">没有图片</div>
        )}
      </div>
      <div className="mt-auto border-t border-zinc-100 px-4 py-3 text-[11px] text-zinc-400">
        {detail.members.length} 张图片
      </div>
    </aside>
  );
}

export function GalleryPage({ galleryId }: { galleryId: string }) {
  const [currentAssetId, setCurrentAssetId] = useState<string | null>(null);
  const galleryQuery = useQuery(trpc.galleries.byId.queryOptions({ galleryId }));
  const detail = galleryQuery.data;
  const members = detail?.members ?? [];
  const currentIndex = Math.max(
    0,
    members.findIndex((member) => member.asset.id === currentAssetId),
  );
  const currentMember = members[currentIndex];
  const imageUrl = currentMember ? getMemberImageUrl(currentMember) : null;
  const setCover = useMutation(
    trpc.galleries.setCover.mutationOptions({
      onSuccess: () => void queryClient.invalidateQueries(),
    }),
  );
  const removeItems = useMutation(
    trpc.galleries.removeItems.mutationOptions({
      onSuccess: (nextDetail) => {
        void queryClient.invalidateQueries();
        if (!nextDetail) {
          window.location.hash = "/";
        }
      },
    }),
  );
  const reorderItems = useMutation(
    trpc.galleries.reorderItems.mutationOptions({
      onSuccess: () => void queryClient.invalidateQueries(),
    }),
  );

  useEffect(() => {
    if (!detail) {
      return;
    }

    if (!currentAssetId || !members.some((member) => member.asset.id === currentAssetId)) {
      setCurrentAssetId(detail.gallery.coverAssetId ?? members[0]?.asset.id ?? null);
    }
  }, [currentAssetId, detail, members]);

  const goToMember = (offset: -1 | 1) => {
    if (members.length === 0) {
      return;
    }

    const nextIndex = (currentIndex + offset + members.length) % members.length;
    setCurrentAssetId(members[nextIndex]?.asset.id ?? null);
  };

  if (galleryQuery.isPending) {
    return (
      <main className="grid h-full place-items-center bg-white text-sm text-zinc-400">
        正在读取图集
      </main>
    );
  }

  if (galleryQuery.isError || !detail) {
    return (
      <main className="grid h-full place-items-center bg-white text-sm text-zinc-400">
        {galleryQuery.error?.message ?? "图集不存在"}
      </main>
    );
  }

  return (
    <main className="flex h-full min-w-0 bg-white">
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex h-14 shrink-0 items-center gap-2 border-b border-zinc-100 px-6">
          <Button
            size="sm"
            variant="ghost"
            className="h-7 gap-1 px-2 text-[12.5px] font-semibold text-zinc-800"
            onPress={() => {
              window.location.hash = "/";
            }}
          >
            <ArrowLeft size={13} />
            返回
          </Button>
          <div className="min-w-0 flex-1">
            <div className="truncate text-[14px] font-semibold text-zinc-950">
              {detail.gallery.title}
            </div>
            <div className="text-[11px] text-zinc-400">
              {detail.members.length} 张 ·{" "}
              {detail.members.filter((member) => !member.file.fileExists).length} 丢失
            </div>
          </div>
          {currentMember ? (
            <div className="flex items-center gap-1.5">
              <Button
                size="sm"
                variant="ghost"
                className="h-7 gap-1.5 rounded-lg border border-zinc-200 px-2 text-[11px]"
                onPress={() => window.location.assign(`#/assets/${currentMember.asset.id}`)}
              >
                <ExternalLink size={12} />
                资产详情
              </Button>
              <Button
                size="sm"
                variant="ghost"
                className="h-7 gap-1.5 rounded-lg border border-zinc-200 px-2 text-[11px]"
                isDisabled={
                  setCover.isPending || detail.gallery.coverAssetId === currentMember.asset.id
                }
                onPress={() =>
                  setCover.mutate({ galleryId: detail.gallery.id, assetId: currentMember.asset.id })
                }
              >
                <Star size={12} />
                设封面
              </Button>
              <Button
                size="sm"
                variant="ghost"
                className="h-7 gap-1.5 rounded-lg border border-red-100 px-2 text-[11px] text-red-600"
                isDisabled={removeItems.isPending}
                onPress={() =>
                  removeItems.mutate({
                    galleryId: detail.gallery.id,
                    assetIds: [currentMember.asset.id],
                  })
                }
              >
                <Trash2 size={12} />
                移出
              </Button>
            </div>
          ) : null}
        </div>
        <div className="flex min-h-0 flex-1 flex-col">
          <div className="relative min-h-0 min-w-0 flex-1 bg-zinc-950">
            <AnimatePresence mode="wait" initial={false}>
              <motion.div
                key={currentMember?.asset.id ?? "empty"}
                className="absolute inset-0"
                initial={{ opacity: 0, scale: 0.985 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 1.01 }}
                transition={{ duration: 0.16, ease: "easeOut" }}
              >
                {currentMember ? (
                  imageUrl ? (
                    <img
                      src={imageUrl}
                      alt={getMemberTitle(currentMember)}
                      className="h-full w-full object-contain"
                      draggable={false}
                    />
                  ) : (
                    <MissingImagePlaceholder title={getMemberTitle(currentMember)} />
                  )
                ) : (
                  <MissingImagePlaceholder title="空图集" />
                )}
              </motion.div>
            </AnimatePresence>
            {members.length > 1 ? (
              <>
                <button
                  type="button"
                  className="absolute left-4 top-1/2 grid h-9 w-9 -translate-y-1/2 place-items-center rounded-full bg-white/85 text-zinc-900 shadow-sm backdrop-blur"
                  onClick={() => goToMember(-1)}
                >
                  <ChevronLeft size={18} />
                </button>
                <button
                  type="button"
                  className="absolute right-4 top-1/2 grid h-9 w-9 -translate-y-1/2 place-items-center rounded-full bg-white/85 text-zinc-900 shadow-sm backdrop-blur"
                  onClick={() => goToMember(1)}
                >
                  <ChevronRight size={18} />
                </button>
              </>
            ) : null}
            {currentMember ? (
              <div className="absolute bottom-4 left-1/2 flex -translate-x-1/2 items-center gap-2 rounded-full bg-white/88 px-2 py-1 shadow-sm backdrop-blur">
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-7 rounded-full px-2 text-[11px]"
                  isDisabled={currentIndex <= 0 || reorderItems.isPending}
                  onPress={() =>
                    reorderItems.mutate({
                      galleryId: detail.gallery.id,
                      orderedAssetIds: reorderAssetIds(members, currentMember.asset.id, "previous"),
                    })
                  }
                >
                  前移
                </Button>
                <Label className="px-1 text-[11px] text-zinc-500">
                  {currentIndex + 1} / {members.length}
                </Label>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-7 rounded-full px-2 text-[11px]"
                  isDisabled={currentIndex >= members.length - 1 || reorderItems.isPending}
                  onPress={() =>
                    reorderItems.mutate({
                      galleryId: detail.gallery.id,
                      orderedAssetIds: reorderAssetIds(members, currentMember.asset.id, "next"),
                    })
                  }
                >
                  后移
                </Button>
              </div>
            ) : null}
          </div>
          <div className="h-[112px] shrink-0 border-t border-zinc-100 bg-zinc-50/80">
            <div className="flex h-full gap-2 overflow-x-auto overflow-y-hidden p-3">
              {members.map((member) => (
                <GalleryThumb
                  key={member.asset.id}
                  member={member}
                  active={member.asset.id === currentMember?.asset.id}
                  cover={member.asset.id === detail.gallery.coverAssetId}
                  onSelect={() => setCurrentAssetId(member.asset.id)}
                />
              ))}
            </div>
          </div>
        </div>
      </div>
      <GalleryEditor detail={detail} currentMember={currentMember} />
    </main>
  );
}
