import { app, dialog } from "electron";
import { is } from "@electron-toolkit/utils";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import path from "node:path";

import { getDatabasePath } from "./db";

export type IndexerCommand = "scan" | "reconcile" | "refresh" | "watch" | "thumbnails";

export type IndexerEvent = {
  type: string;
  [key: string]: unknown;
};

export type IndexerResult = {
  events: IndexerEvent[];
};

export type IndexerWatchScope =
  | {
      type: "vault";
    }
  | {
      type: "note";
      assetId: string;
      relativePath: string;
    };

export type IndexerWatchDaemon = {
  pid: number | undefined;
  setScope: (scope: IndexerWatchScope) => void;
  audit: () => void;
  stop: () => void;
};

type RunIndexerOptions = {
  onEvent?: (event: IndexerEvent) => void;
};

type WatchDaemonOptions = {
  onEvent?: (event: IndexerEvent) => void;
  onError?: (error: Error) => void;
  onExit?: (code: number | null, signal: NodeJS.Signals | null, stderr: string) => void;
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
  input: { vaultId: string; rootPath: string; assetIds?: string[]; paths?: string[]; limit?: number },
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

export function startIndexerWatchDaemon(
  input: { vaultId: string; rootPath: string },
  options: WatchDaemonOptions = {},
): IndexerWatchDaemon {
  const { executable, args, cwd } = resolveIndexerInvocation("watch", input, { daemon: true });
  const child = spawn(executable, args, {
    cwd,
    stdio: ["pipe", "pipe", "pipe"],
    env: process.env,
  });
  const stderr: string[] = [];
  let stdoutBuffer = "";
  let closed = false;

  child.stdout.setEncoding("utf8");
  child.stdout.on("data", (chunk: string) => {
    stdoutBuffer += chunk;
    const lines = stdoutBuffer.split(/\r?\n/);
    stdoutBuffer = lines.pop() ?? "";

    for (const line of lines) {
      const event = parseIndexerEvent(line);
      if (event) {
        options.onEvent?.(event);
      }
    }
  });

  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk: string) => {
    stderr.push(chunk);
  });

  child.on("error", (error) => {
    options.onError?.(error);
  });

  child.on("close", (code, signal) => {
    closed = true;
    const trailingEvent = parseIndexerEvent(stdoutBuffer);
    if (trailingEvent) {
      options.onEvent?.(trailingEvent);
    }
    options.onExit?.(code, signal, stderr.join("").trim());
  });

  const writeCommand = (command: unknown) => {
    if (closed || child.stdin.destroyed) {
      return;
    }

    child.stdin.write(`${JSON.stringify(command)}\n`);
  };

  return {
    pid: child.pid,
    setScope: (scope) => writeCommand({ command: "set_scope", scope }),
    audit: () => writeCommand({ command: "audit_scope" }),
    stop: () => stopWatchDaemon(child, writeCommand),
  };
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
  input: { vaultId: string; rootPath: string; assetIds?: string[]; paths?: string[]; limit?: number },
  options: { daemon?: boolean } = {},
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

  if (options.daemon) {
    indexerArgs.push("--daemon");
  }

  if (input.assetIds?.length) {
    indexerArgs.push("--asset-ids", input.assetIds.join(","));
  }

  if (input.paths?.length) {
    for (const inputPath of input.paths) {
      indexerArgs.push("--path", inputPath);
    }
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

function stopWatchDaemon(
  child: ChildProcessWithoutNullStreams,
  writeCommand: (command: unknown) => void,
): void {
  if (child.killed) {
    return;
  }

  writeCommand({ command: "shutdown" });
  const killTimer = setTimeout(() => {
    if (!child.killed) {
      child.kill();
    }
  }, 1000);
  child.once("close", () => {
    clearTimeout(killTimer);
  });
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
