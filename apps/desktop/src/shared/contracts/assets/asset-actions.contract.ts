/**
 * @purpose Define shared asset action input contracts.
 * @role    Renderer/main boundary schema for file, editor, and thumbnail asset operations.
 * @deps    zod and common id contracts.
 * @gotcha  Keep target values aligned with editor launch support in the main process.
 */

import { z } from "zod";

import { idInputSchema } from "../common/id.contract";

export const editorTargetValues = ["vscode", "cursor", "zed"] as const;
export const vaultLocationTargetValues = [...editorTargetValues, "finder"] as const;

export const assetByIdInputSchema = idInputSchema;
export const deleteAssetInputSchema = idInputSchema;
export const assetMarkdownContentInputSchema = idInputSchema;
export const openFileInputSchema = idInputSchema;
export const copyAssetPathInputSchema = idInputSchema;

export const openVaultLocationInputSchema = z.object({
  target: z.enum(vaultLocationTargetValues),
});

export const openAssetInEditorInputSchema = z.object({
  id: z.string().min(1),
  target: z.enum(editorTargetValues),
});

export const ensureThumbnailsInputSchema = z.object({
  vaultId: z.string().min(1).optional(),
  assetIds: z.array(z.string().min(1)).max(80).default([]),
});

export const importLocalFilesInputSchema = z.object({
  paths: z.array(z.string().min(1)).min(1).max(500),
  vaultId: z.string().min(1).optional(),
});

export type ImportLocalFilesInput = z.infer<typeof importLocalFilesInputSchema>;
