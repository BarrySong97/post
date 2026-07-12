/**
 * @purpose Render and edit all tag bindings on the asset detail surface.
 * @role    Detail-only tag row: list bound tags, unbind, bind existing, create-and-bind.
 * @deps    HeroUI ComboBox/TagGroup/Button/Input/ListBox, Lucide, tRPC addTag/removeTag, i18n.
 * @gotcha  Cards still show primary tag only; do not render the untagged sentinel as a removable pill.
 *          Prefer HeroUI controls per design.md / conventions.md — no native form controls here.
 *          ComboBox popover defaults to radius-3xl (pill-like on short lists); override to rounded-lg
 *          to match dense desktop menus. Cap list height (max-h-48) so large vault tag sets scroll.
 */

import { useMemo, useRef, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Button, ComboBox, Input, ListBox, Tag, TagGroup } from "@heroui/react";
import { Loader2, Plus, X } from "lucide-react";

import { useInvalidateVaultState } from "@/hooks/use-invalidate-vault-state";
import { getTagHue } from "@/lib/asset-manager/asset-model";
import type { Asset, AssetTagRef, SidebarTag } from "@/lib/asset-manager/types";
import { showToastAfterRefresh, toast } from "@/lib/toast";
import { trpc } from "@/lib/trpc";
import { TAG_NAME_MAX_LENGTH } from "@shared/contracts/assets/tags/tag.contract";

export function AssetDetailTags({
  asset,
  vaultTags,
}: {
  asset: Asset;
  vaultTags: readonly SidebarTag[];
}) {
  const { t } = useTranslation();
  const invalidateVaultState = useInvalidateVaultState();
  const [editing, setEditing] = useState(false);
  const [inputValue, setInputValue] = useState("");
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const committingRef = useRef(false);

  const addTag = useMutation(trpc.assets.addTag.mutationOptions());
  const removeTag = useMutation(trpc.assets.removeTag.mutationOptions());
  const isMutating = addTag.isPending || removeTag.isPending;

  const boundIds = useMemo(() => new Set(asset.tags.map((tag) => tag.id)), [asset.tags]);

  const availableTags = useMemo(
    () => vaultTags.filter((tag) => !boundIds.has(tag.id)),
    [boundIds, vaultTags],
  );

  const closeEditor = () => {
    setEditing(false);
    setInputValue("");
    setSelectedKey(null);
  };

  const commitName = async (name: string) => {
    const trimmed = name.trim().slice(0, TAG_NAME_MAX_LENGTH);
    if (!trimmed || isMutating || committingRef.current) {
      return;
    }
    if (asset.tags.some((tag) => tag.name === trimmed)) {
      closeEditor();
      return;
    }

    committingRef.current = true;
    try {
      await addTag.mutateAsync({ assetId: asset.id, name: trimmed });
      await invalidateVaultState();
      showToastAfterRefresh(() => {
        toast.success(t("assets.tagBound", { name: trimmed }));
      });
      closeEditor();
    } catch (error) {
      toast.danger(error instanceof Error ? error.message : t("assets.tagBindFailed"));
    } finally {
      committingRef.current = false;
    }
  };

  const unbindTag = async (tag: AssetTagRef) => {
    if (isMutating) {
      return;
    }

    try {
      await removeTag.mutateAsync({ assetId: asset.id, tagId: tag.id });
      await invalidateVaultState();
      showToastAfterRefresh(() => {
        toast.success(t("assets.tagUnbound", { name: tag.name }));
      });
    } catch (error) {
      toast.danger(error instanceof Error ? error.message : t("assets.tagUnbindFailed"));
    }
  };

  return (
    <div className="mt-3.5 flex flex-wrap items-center gap-2">
      {asset.tags.length > 0 ? (
        <TagGroup
          aria-label={t("assets.assetTags")}
          size="sm"
          onRemove={(keys) => {
            if (isMutating) {
              return;
            }
            for (const key of keys) {
              const tag = asset.tags.find((item) => item.id === String(key));
              if (tag) {
                void unbindTag(tag);
              }
            }
          }}
          className="gap-0"
        >
          <TagGroup.List className="flex flex-wrap gap-1.5">
            {asset.tags.map((tag) => (
              <Tag
                key={tag.id}
                id={tag.id}
                textValue={tag.name}
                className="h-6 min-h-0 cursor-default gap-1.5 rounded-[7px] bg-zinc-100 px-2 py-0 text-[11px] font-medium text-zinc-700"
              >
                <span
                  className="h-1.5 w-1.5 shrink-0 rounded-full"
                  style={{ background: `oklch(0.62 0.14 ${getTagHue(tag.name)})` }}
                />
                {tag.name}
              </Tag>
            ))}
          </TagGroup.List>
        </TagGroup>
      ) : null}

      {editing ? (
        <ComboBox
          aria-label={t("assets.addTag")}
          className="w-[220px]"
          allowsCustomValue
          allowsEmptyCollection
          menuTrigger="focus"
          autoFocus
          isDisabled={isMutating}
          inputValue={inputValue}
          onInputChange={setInputValue}
          selectedKey={selectedKey}
          onSelectionChange={(key) => {
            const nextKey = key == null ? null : String(key);
            setSelectedKey(nextKey);
            if (nextKey == null) {
              return;
            }
            const tag = availableTags.find((item) => item.id === nextKey);
            if (tag) {
              void commitName(tag.name);
            }
          }}
          defaultFilter={(text, filterText) => {
            if (!filterText) {
              return true;
            }
            return text.toLowerCase().includes(filterText.toLowerCase());
          }}
        >
          <ComboBox.InputGroup className="relative h-6 min-h-0 rounded-[7px] border border-zinc-200 bg-white shadow-none transition-[border-color,box-shadow] focus-within:border-zinc-400 focus-within:ring-2 focus-within:ring-zinc-500/25">
            <Input
              placeholder={t("assets.searchOrCreateTag")}
              maxLength={TAG_NAME_MAX_LENGTH}
              // Dense inline field: keep HeroUI Input, suppress its default blue focus ring
              // (focus-field-ring / ring-focus) and put focus chrome on InputGroup instead.
              className="h-6 min-w-0 flex-1 border-0 bg-transparent px-2 text-[12px] text-zinc-800 shadow-none outline-none ring-0 placeholder:text-zinc-400 focus:!border-0 focus:!bg-transparent focus:!shadow-none focus:!outline-none focus:!ring-0 data-[focused]:!border-0 data-[focused]:!bg-transparent data-[focused]:!shadow-none data-[focused]:!outline-none data-[focused]:!ring-0"
              onKeyDown={(event) => {
                if (event.key !== "Enter") {
                  return;
                }
                const name = inputValue.trim();
                if (!name) {
                  return;
                }
                // Let ComboBox finish selecting a focused option, then commit typed/custom text.
                queueMicrotask(() => {
                  void commitName(name);
                });
              }}
            />
            {isMutating ? (
              <Loader2 size={11} className="me-1 shrink-0 animate-spin text-zinc-400" />
            ) : (
              <Button
                isIconOnly
                size="sm"
                variant="ghost"
                aria-label={t("assets.cancelAddTag")}
                className="me-1 h-4 w-4 min-h-4 min-w-4 shrink-0 rounded p-0 text-zinc-400 shadow-none hover:bg-zinc-100 hover:text-zinc-700 [&_svg]:!h-[11px] [&_svg]:!w-[11px]"
                onPress={closeEditor}
              >
                <X aria-hidden className="!h-[11px] !w-[11px]" strokeWidth={2} />
              </Button>
            )}
          </ComboBox.InputGroup>
          <ComboBox.Popover
            className="z-[120] overflow-hidden !rounded-lg border border-zinc-200 bg-white p-1 shadow-[0_14px_34px_rgba(20,18,16,0.14),0_2px_7px_rgba(20,18,16,0.07)]"
            placement="bottom start"
          >
            <ListBox className="max-h-48 overflow-y-auto outline-none">
              {availableTags.length === 0 ? (
                <ListBox.Item
                  id="__empty"
                  textValue={t("assets.noVaultTags")}
                  isDisabled
                  className="px-2.5 py-1.5 text-[12px] text-zinc-400"
                >
                  {vaultTags.length === 0
                    ? t("assets.noVaultTags")
                    : inputValue.trim()
                      ? t("assets.noMatchingTags")
                      : t("assets.allTagsBound")}
                </ListBox.Item>
              ) : (
                availableTags.map((tag) => (
                  <ListBox.Item
                    key={tag.id}
                    id={tag.id}
                    textValue={tag.name}
                    className="flex h-7 cursor-default items-center gap-2 rounded-md px-2 text-[12.5px] text-zinc-700 outline-none data-[focused]:bg-zinc-100 data-[hovered]:bg-zinc-100"
                  >
                    <span
                      className="h-1.5 w-1.5 shrink-0 rounded-full"
                      style={{ background: `oklch(0.62 0.14 ${getTagHue(tag.name)})` }}
                    />
                    <span className="min-w-0 truncate">{tag.name}</span>
                  </ListBox.Item>
                ))
              )}
            </ListBox>
          </ComboBox.Popover>
        </ComboBox>
      ) : (
        <Button
          isIconOnly
          size="sm"
          variant="secondary"
          aria-label={t("assets.addTag")}
          isDisabled={isMutating}
          className="h-6 w-6 min-w-6 rounded-[7px] border border-dashed border-zinc-200 bg-white text-zinc-400 shadow-none hover:border-blue-200 hover:bg-white hover:text-blue-500"
          onPress={() => setEditing(true)}
        >
          <Plus size={13} />
        </Button>
      )}
    </div>
  );
}
