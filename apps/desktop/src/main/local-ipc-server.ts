/**
 * @purpose Receive same-machine CLI notifications after external Post data writes.
 * @role    Local IPC bridge from post-cli commits into the main-process app event bus.
 * @deps    Electron app paths, Node net sockets, app event bus, database path resolver.
 * @gotcha  Socket messages are invalidation hints only; ack means the app published the refresh event.
 */

import { createHash } from "node:crypto";
import { existsSync, unlinkSync } from "node:fs";
import net, { type Server, type Socket } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";

import { appEventBus } from "./events";
import { getDatabasePath } from "./db";

type LedgerChangedMessage = {
  type: "ledger.changed";
  source: "post-cli";
  dbPath: string;
  changed?: unknown;
  operationCount?: unknown;
  emittedAt?: unknown;
};

type LocalIpcAck = {
  type: "ledger.changed.ack";
  ok: boolean;
  message?: string;
};

let server: Server | null = null;
let socketAddress: string | null = null;

function getLocalIpcAddress(userDataPath: string): string {
  const hash = createHash("sha256").update(path.resolve(userDataPath)).digest("hex").slice(0, 16);

  if (process.platform === "win32") {
    return `\\\\.\\pipe\\post-ledger-${hash}`;
  }

  return path.join(tmpdir(), `post-ledger-${hash}.sock`);
}

function isLedgerChangedMessage(value: unknown): value is LedgerChangedMessage {
  if (!value || typeof value !== "object") {
    return false;
  }

  const message = value as Partial<LedgerChangedMessage>;
  return (
    message.type === "ledger.changed" &&
    message.source === "post-cli" &&
    typeof message.dbPath === "string"
  );
}

function normalizeChangedScopes(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter((scope): scope is string => typeof scope === "string");
}

function publishLedgerChanged(message: LedgerChangedMessage): boolean {
  if (path.resolve(message.dbPath) !== path.resolve(getDatabasePath())) {
    return false;
  }

  appEventBus.publish({
    type: "ledger.changed",
    emittedAt: typeof message.emittedAt === "number" ? message.emittedAt : Date.now(),
    source: "post-cli",
    dbPath: message.dbPath,
    changed: normalizeChangedScopes(message.changed),
    operationCount: typeof message.operationCount === "number" ? message.operationCount : 1,
  });

  return true;
}

function sendAck(socket: Socket, ack: LocalIpcAck): void {
  socket.write(`${JSON.stringify(ack)}\n`, () => {
    socket.end();
  });
}

function handleSocket(socket: Socket): void {
  let buffer = "";

  socket.setEncoding("utf8");
  socket.on("data", (chunk) => {
    buffer += chunk;

    let newlineIndex = buffer.indexOf("\n");
    while (newlineIndex >= 0) {
      const line = buffer.slice(0, newlineIndex).trim();
      buffer = buffer.slice(newlineIndex + 1);

      if (line.length > 0) {
        try {
          const message: unknown = JSON.parse(line);
          if (isLedgerChangedMessage(message)) {
            const published = publishLedgerChanged(message);
            sendAck(socket, {
              type: "ledger.changed.ack",
              ok: published,
              message: published
                ? undefined
                : "Notification database path did not match the running app.",
            });
          } else {
            sendAck(socket, {
              type: "ledger.changed.ack",
              ok: false,
              message: "Unsupported local IPC message.",
            });
          }
        } catch (error) {
          console.warn("Ignored invalid local IPC message", error);
          sendAck(socket, {
            type: "ledger.changed.ack",
            ok: false,
            message: "Invalid local IPC message.",
          });
        }
      }

      newlineIndex = buffer.indexOf("\n");
    }
  });
}

export function startLocalIpcServer(userDataPath: string): void {
  if (server) {
    return;
  }

  socketAddress = getLocalIpcAddress(userDataPath);

  if (process.platform !== "win32" && existsSync(socketAddress)) {
    unlinkSync(socketAddress);
  }

  server = net.createServer(handleSocket);
  server.on("error", (error) => {
    console.warn("Post local IPC server failed", error);
  });
  server.listen(socketAddress);
  server.unref();
}

export function stopLocalIpcServer(): void {
  const activeServer = server;
  const activeAddress = socketAddress;

  server = null;
  socketAddress = null;
  activeServer?.close();

  if (activeAddress && process.platform !== "win32" && existsSync(activeAddress)) {
    unlinkSync(activeAddress);
  }
}
