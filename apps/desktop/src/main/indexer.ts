import { app, dialog } from "electron";
import { is } from "@electron-toolkit/utils";
import { spawn } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import path from "node:path";

import { getDatabasePath } from "./db";

export type IndexerCommand = "scan" | "reconcile" | "watch" | "thumbnails";

export type IndexerEvent = {
  type: string;
  [key: string]: unknown;
};

export type IndexerResult = {
  events: IndexerEvent[];
};

type RunIndexerOptions = {
  onEvent?: (event: IndexerEvent) => void;
};

export async function chooseVaultFolder(): Promise<string | null> {
  const result = await dialog.showOpenDialog({
    title: "选择资产库文件夹",
    properties: ["openDirectory", "createDirectory"],
  });

  if (result.canceled || !result.filePaths[0]) {
    return null;
  }

  return result.filePaths[0];
}

export async function runIndexer(
  command: IndexerCommand,
  input: { vaultId: string; rootPath: string; assetIds?: string[]; limit?: number },
  options: RunIndexerOptions = {},
): Promise<IndexerResult> {
  const { executable, args, cwd } = resolveIndexerInvocation(command, input);

  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, {
      cwd,
      stdio: ["ignore", "pipe", "pipe"],
      env: process.env,
    });
    const events: IndexerEvent[] = [];
    const stderr: string[] = [];
    let stdoutBuffer = "";

    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdoutBuffer += chunk;
      const lines = stdoutBuffer.split(/\r?\n/);
      stdoutBuffer = lines.pop() ?? "";

      for (const line of lines) {
        const event = parseIndexerEvent(line);
        if (event) {
          events.push(event);
          options.onEvent?.(event);
        }
      }
    });

    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk: string) => {
      stderr.push(chunk);
    });

    child.on("error", reject);
    child.on("close", (code) => {
      const trailingEvent = parseIndexerEvent(stdoutBuffer);
      if (trailingEvent) {
        events.push(trailingEvent);
        options.onEvent?.(trailingEvent);
      }

      if (code === 0) {
        resolve({ events });
        return;
      }

      reject(
        new Error(
          `post-indexer exited with code ${code ?? "unknown"}: ${stderr.join("").trim()}`,
        ),
      );
    });
  });
}

export function getThumbnailCacheRoot(): string {
  const root = path.join(app.getPath("userData"), "thumbnails");
  mkdirSync(root, { recursive: true });
  return root;
}

function parseIndexerEvent(line: string): IndexerEvent | null {
  const trimmed = line.trim();
  if (!trimmed.startsWith("{")) {
    return null;
  }

  try {
    return JSON.parse(trimmed) as IndexerEvent;
  } catch {
    return null;
  }
}

function resolveIndexerInvocation(
  command: IndexerCommand,
  input: { vaultId: string; rootPath: string; assetIds?: string[]; limit?: number },
) {
  const indexerArgs = [
    command,
    "--vault-id",
    input.vaultId,
    "--root-path",
    input.rootPath,
    "--db-path",
    getDatabasePath(),
    "--thumbnail-root",
    getThumbnailCacheRoot(),
  ];

  if (input.assetIds?.length) {
    indexerArgs.push("--asset-ids", input.assetIds.join(","));
  }

  if (input.limit) {
    indexerArgs.push("--limit", String(input.limit));
  }

  if (is.dev) {
    const repoRoot = findRepoRoot(process.cwd());
    return {
      executable: "cargo",
      args: ["run", "-p", "post-indexer", "--", ...indexerArgs],
      cwd: repoRoot,
    };
  }

  const executable = path.join(process.resourcesPath, "post-indexer");
  return {
    executable,
    args: indexerArgs,
    cwd: app.getPath("userData"),
  };
}

function findRepoRoot(start: string): string {
  let current = start;

  for (;;) {
    if (existsSync(path.join(current, "Cargo.toml")) && existsSync(path.join(current, "pnpm-workspace.yaml"))) {
      return current;
    }

    const parent = path.dirname(current);
    if (parent === current) {
      return start;
    }

    current = parent;
  }
}
