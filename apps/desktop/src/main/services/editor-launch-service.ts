import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { TRPCError } from "@trpc/server";

export type VaultEditorTarget = "vscode" | "cursor" | "zed";

const execFileAsync = promisify(execFile);

const VAULT_EDITOR_TARGETS = {
  vscode: {
    label: "VS Code",
    appName: "Visual Studio Code",
    commands: ["code"],
  },
  cursor: {
    label: "Cursor",
    appName: "Cursor",
    commands: ["cursor"],
  },
  zed: {
    label: "Zed",
    appName: "Zed",
    commands: ["zed", "zeditor"],
  },
} satisfies Record<VaultEditorTarget, { label: string; appName: string; commands: string[] }>;

export async function openVaultInEditor(target: VaultEditorTarget, rootPath: string, filePath?: string) {
  const editor = VAULT_EDITOR_TARGETS[target];
  const errors: string[] = [];
  const args = filePath ? [rootPath, filePath] : [rootPath];

  for (const command of editor.commands) {
    try {
      await execFileAsync(command, args, { timeout: 5000 });
      return;
    } catch (error) {
      errors.push(`${command}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  try {
    await execFileAsync("open", ["-a", editor.appName, rootPath], { timeout: 5000 });
    return;
  } catch (error) {
    errors.push(`open -a ${editor.appName}: ${error instanceof Error ? error.message : String(error)}`);
  }

  throw new TRPCError({
    code: "INTERNAL_SERVER_ERROR",
    message: `Could not open ${editor.label}. Install its CLI (${editor.commands.join(" or ")}) or the macOS app.`,
    cause: errors.join("\n"),
  });
}
