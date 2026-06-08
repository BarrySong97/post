import { BrowserWindow, app, ipcMain, type IpcMainInvokeEvent, type WebContents } from "electron";
import { randomUUID } from "node:crypto";
import { existsSync, chmodSync } from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";

import { schema } from "@post/db";
import { desc } from "drizzle-orm";

import { getDatabase } from "./db";

type NodePtyModule = typeof import("node-pty");
type PtyProcess = import("node-pty").IPty;

type TerminalStartInput = {
  cols?: number;
  rows?: number;
};

type TerminalWriteInput = {
  sessionId: string;
  data: string;
};

type TerminalResizeInput = {
  sessionId: string;
  cols: number;
  rows: number;
};

type TerminalCloseInput = {
  sessionId: string;
};

type TerminalSessionSnapshot = {
  sessionId: string;
  cwd: string;
  pid: number;
  status: "running" | "exited";
  history: string;
};

type TerminalSession = TerminalSessionSnapshot & {
  pty: PtyProcess;
  ownerWebContentsId: number;
};

const MAX_TERMINAL_HISTORY_LENGTH = 200_000;
const DEFAULT_COLS = 120;
const DEFAULT_ROWS = 30;
const sessions = new Map<string, TerminalSession>();
const sessionByCwd = new Map<string, string>();
const requireForNodePty = createRequire(import.meta.url);
let nodePty: NodePtyModule | null = null;
let didEnsureSpawnHelperExecutable = false;

function normalizeDimension(value: unknown, fallback: number, min: number, max: number) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return fallback;
  }

  return Math.min(max, Math.max(min, Math.floor(value)));
}

function getActiveVaultRoot() {
  const vault = getDatabase()
    .select({
      rootPath: schema.vaults.rootPath,
    })
    .from(schema.vaults)
    .orderBy(desc(schema.vaults.lastOpenedAt))
    .get();

  if (!vault?.rootPath) {
    return null;
  }

  return path.resolve(vault.rootPath);
}

function getShellCommand() {
  const shell = process.env.SHELL?.trim();
  if (shell) {
    return shell;
  }

  return process.platform === "darwin" ? "/bin/zsh" : os.platform() === "win32" ? "pwsh.exe" : "/bin/bash";
}

function getShellArgs(shell: string) {
  const shellName = path.basename(shell).toLowerCase();
  if (process.platform !== "win32" && shellName === "zsh") {
    return ["-o", "nopromptsp"];
  }

  if (process.platform === "win32" && (shellName === "pwsh.exe" || shellName === "powershell.exe")) {
    return ["-NoLogo"];
  }

  return [];
}

function getNodePty() {
  if (!nodePty) {
    nodePty = requireForNodePty("node-pty") as NodePtyModule;
  }

  return nodePty;
}

function unpackedAsarPath(candidate: string) {
  return candidate.replace(`${path.sep}app.asar${path.sep}`, `${path.sep}app.asar.unpacked${path.sep}`);
}

function resolveSpawnHelperPath() {
  try {
    const packageJsonPath = requireForNodePty.resolve("node-pty/package.json");
    const packageDir = path.dirname(packageJsonPath);
    const candidates = [
      path.join(packageDir, "build", "Release", "spawn-helper"),
      path.join(packageDir, "build", "Debug", "spawn-helper"),
      path.join(packageDir, "prebuilds", `${process.platform}-${process.arch}`, "spawn-helper"),
    ].flatMap((candidate) => [candidate, unpackedAsarPath(candidate)]);

    return candidates.find((candidate) => existsSync(candidate)) ?? null;
  } catch {
    return null;
  }
}

function ensureSpawnHelperExecutable() {
  if (process.platform === "win32" || didEnsureSpawnHelperExecutable) {
    return;
  }

  didEnsureSpawnHelperExecutable = true;
  const helperPath = resolveSpawnHelperPath();
  if (!helperPath) {
    return;
  }

  try {
    chmodSync(helperPath, 0o755);
  } catch {
    // Best effort only. node-pty can still work when the helper already has execute bits.
  }
}

function sendTerminalEvent<T>(webContents: WebContents, channel: string, payload: T) {
  if (!webContents.isDestroyed()) {
    webContents.send(channel, payload);
  }
}

function appendHistory(session: TerminalSession, data: string) {
  session.history += data;
  if (session.history.length > MAX_TERMINAL_HISTORY_LENGTH) {
    session.history = session.history.slice(-MAX_TERMINAL_HISTORY_LENGTH);
  }
}

function snapshotSession(session: TerminalSession): TerminalSessionSnapshot {
  return {
    sessionId: session.sessionId,
    cwd: session.cwd,
    pid: session.pid,
    status: session.status,
    history: session.history,
  };
}

function removeSession(sessionId: string) {
  const session = sessions.get(sessionId);
  if (!session) {
    return;
  }

  sessions.delete(sessionId);
  if (sessionByCwd.get(session.cwd) === sessionId) {
    sessionByCwd.delete(session.cwd);
  }
}

function getSessionOrThrow(sessionId: string) {
  const session = sessions.get(sessionId);
  if (!session) {
    throw new Error("Terminal session not found");
  }

  return session;
}

function startTerminalSession(event: IpcMainInvokeEvent, input: TerminalStartInput = {}) {
  if (process.platform !== "darwin") {
    throw new Error("In-app terminal is only enabled on macOS for now");
  }

  const cwd = getActiveVaultRoot();
  if (!cwd) {
    throw new Error("No active vault selected");
  }

  if (!existsSync(cwd)) {
    throw new Error(`Vault folder does not exist: ${cwd}`);
  }

  const existingSessionId = sessionByCwd.get(cwd);
  const existingSession = existingSessionId ? sessions.get(existingSessionId) : null;
  if (existingSession?.status === "running") {
    existingSession.ownerWebContentsId = event.sender.id;
    return snapshotSession(existingSession);
  }

  ensureSpawnHelperExecutable();
  const pty = getNodePty();
  const shell = getShellCommand();
  const terminalProcess = pty.spawn(shell, getShellArgs(shell), {
    cwd,
    cols: normalizeDimension(input.cols, DEFAULT_COLS, 1, 1000),
    rows: normalizeDimension(input.rows, DEFAULT_ROWS, 1, 500),
    env: {
      ...process.env,
      TERM: "xterm-256color",
      COLORTERM: process.env.COLORTERM ?? "truecolor",
      FORCE_COLOR: process.env.FORCE_COLOR ?? "1",
    },
    name: "xterm-256color",
  });

  const session: TerminalSession = {
    sessionId: randomUUID(),
    cwd,
    pid: terminalProcess.pid,
    status: "running",
    history: "",
    pty: terminalProcess,
    ownerWebContentsId: event.sender.id,
  };
  sessions.set(session.sessionId, session);
  sessionByCwd.set(cwd, session.sessionId);

  terminalProcess.onData((data) => {
    appendHistory(session, data);
    const window = BrowserWindow.fromWebContents(event.sender);
    const targetContents = window?.webContents ?? event.sender;
    sendTerminalEvent(targetContents, "terminal:data", {
      sessionId: session.sessionId,
      data,
    });
  });

  terminalProcess.onExit((exitEvent) => {
    session.status = "exited";
    const window = BrowserWindow.fromWebContents(event.sender);
    const targetContents = window?.webContents ?? event.sender;
    sendTerminalEvent(targetContents, "terminal:exit", {
      sessionId: session.sessionId,
      exitCode: exitEvent.exitCode,
      signal: exitEvent.signal ?? null,
    });
  });

  return snapshotSession(session);
}

function writeTerminalInput(input: TerminalWriteInput) {
  const session = getSessionOrThrow(input.sessionId);
  if (session.status !== "running") {
    throw new Error("Terminal session has exited");
  }

  if (!input.data) {
    return;
  }

  session.pty.write(input.data);
}

function resizeTerminal(input: TerminalResizeInput) {
  const session = getSessionOrThrow(input.sessionId);
  if (session.status !== "running") {
    return;
  }

  session.pty.resize(
    normalizeDimension(input.cols, DEFAULT_COLS, 1, 1000),
    normalizeDimension(input.rows, DEFAULT_ROWS, 1, 500),
  );
}

function closeTerminal(input: TerminalCloseInput) {
  const session = getSessionOrThrow(input.sessionId);
  removeSession(session.sessionId);
  try {
    session.pty.kill();
  } catch {
    // The process may already have exited.
  }
}

export function registerTerminalHandlers() {
  ipcMain.handle("terminal:start", (event, input: TerminalStartInput | undefined) =>
    startTerminalSession(event, input),
  );
  ipcMain.handle("terminal:write", (_event, input: TerminalWriteInput) => writeTerminalInput(input));
  ipcMain.handle("terminal:resize", (_event, input: TerminalResizeInput) => resizeTerminal(input));
  ipcMain.handle("terminal:close", (_event, input: TerminalCloseInput) => closeTerminal(input));

  app.once("before-quit", () => {
    for (const session of sessions.values()) {
      try {
        session.pty.kill();
      } catch {
        // Ignore process cleanup failures during app shutdown.
      }
    }
    sessions.clear();
    sessionByCwd.clear();
  });
}
