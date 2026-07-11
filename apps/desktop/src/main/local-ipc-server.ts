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

import { asc, eq } from "drizzle-orm";

import { schema } from "@post/db";
import { appEventBus } from "./events";
import { getDatabasePath } from "./db";
import { getLiveFilterSnapshot, type LiveFilterSnapshot } from "./live-filter-state";
import { getDatabase } from "./db";
import { getRequestedOrActiveVault } from "./repositories/vaults-repository";
import {
  commandMessageSchema,
  extensionContextGetMessageSchema,
  extensionImageSaveMessageSchema,
  extensionPostSaveMessageSchema,
  extensionVideoSaveMessageSchema,
  type CommandMessage,
  type CommandOp,
} from "./local-ipc-messages";
import { saveExtensionImage } from "./services/extension-image-import-service";
import { saveExtensionPost } from "./services/extension-post-import-service";
import { saveExtensionVideo } from "./services/extension-video-import-service";

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

type CommandAck = {
  type: "command.ack";
  ok: boolean;
  op: CommandOp | "unknown";
  message?: string;
  snapshot?: LiveFilterSnapshot | null;
};

type ExtensionContextAck = {
  type: "extension.context.ack";
  ok: boolean;
  message?: string;
  context?: {
    vault: {
      id: string;
      name: string;
      rootPath: string;
    };
    tags: Array<{
      id: string;
      name: string;
      color: string | null;
      sortOrder: number;
    }>;
  };
};

type ExtensionImageSaveAck = {
  type: "extension.image.save.ack";
  ok: boolean;
  message?: string;
  asset?: {
    id: string;
    title: string;
    relativePath: string;
    tagId: string | null;
  };
};

type ExtensionVideoSaveAck = {
  type: "extension.video.save.ack";
  ok: boolean;
  message?: string;
  asset?: {
    id: string;
    title: string;
    relativePath: string;
    tagId: string | null;
  };
};

type ExtensionPostSaveAck = {
  type: "extension.post.save.ack";
  ok: boolean;
  message?: string;
  asset?: {
    id: string;
    title: string;
    relativePath: string;
    tagId: string | null;
    status: "created" | "updated";
    childAssetIds: string[];
    warnings: string[];
  };
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

function sendCommandAck(socket: Socket, ack: CommandAck): void {
  socket.write(`${JSON.stringify(ack)}\n`, () => {
    socket.end();
  });
}

function sendExtensionContextAck(socket: Socket, ack: ExtensionContextAck): void {
  socket.write(`${JSON.stringify(ack)}\n`, () => {
    socket.end();
  });
}

function sendExtensionImageSaveAck(socket: Socket, ack: ExtensionImageSaveAck): void {
  socket.write(`${JSON.stringify(ack)}\n`, () => {
    socket.end();
  });
}

function sendExtensionVideoSaveAck(socket: Socket, ack: ExtensionVideoSaveAck): void {
  socket.write(`${JSON.stringify(ack)}\n`, () => {
    socket.end();
  });
}

function sendExtensionPostSaveAck(socket: Socket, ack: ExtensionPostSaveAck): void {
  socket.write(`${JSON.stringify(ack)}\n`, () => {
    socket.end();
  });
}

function isCommandEnvelope(value: unknown): value is { type: string } {
  if (!value || typeof value !== "object") {
    return false;
  }

  const type = (value as { type?: unknown }).type;
  return typeof type === "string" && (type.startsWith("filter.") || type === "asset.open");
}

function isExtensionEnvelope(value: unknown): value is { type: string } {
  if (!value || typeof value !== "object") {
    return false;
  }

  const type = (value as { type?: unknown }).type;
  return (
    type === "extension.context.get" ||
    type === "extension.image.save" ||
    type === "extension.video.save" ||
    type === "extension.post.save"
  );
}

function opForCommand(type: CommandMessage["type"]): CommandOp {
  switch (type) {
    case "filter.apply":
      return "apply";
    case "filter.activateView":
      return "activateView";
    case "filter.selectSidebar":
      return "selectSidebar";
    case "filter.clear":
      return "clear";
    case "filter.get":
      return "get";
    case "asset.open":
      return "openAsset";
  }
}

function handleCommandMessage(socket: Socket, raw: unknown): void {
  const parsed = commandMessageSchema.safeParse(raw);
  if (!parsed.success) {
    sendCommandAck(socket, {
      type: "command.ack",
      ok: false,
      op: "unknown",
      message: "Invalid live command message.",
    });
    return;
  }

  const message = parsed.data;
  const op = opForCommand(message.type);

  if (path.resolve(message.dbPath) !== path.resolve(getDatabasePath())) {
    sendCommandAck(socket, {
      type: "command.ack",
      ok: false,
      op,
      message: "Live command database path did not match the running app.",
    });
    return;
  }

  const emittedAt = typeof message.emittedAt === "number" ? message.emittedAt : Date.now();

  switch (message.type) {
    case "filter.apply":
      appEventBus.publish({
        type: "asset-filter.apply",
        emittedAt,
        filters: message.filters,
        sort: message.sort,
      });
      sendCommandAck(socket, { type: "command.ack", ok: true, op });
      return;
    case "filter.activateView":
      appEventBus.publish({
        type: "asset-filter.activate-view",
        emittedAt,
        viewId: message.viewId,
      });
      sendCommandAck(socket, { type: "command.ack", ok: true, op });
      return;
    case "filter.selectSidebar":
      appEventBus.publish({ type: "asset-filter.select-sidebar", emittedAt, item: message.item });
      sendCommandAck(socket, { type: "command.ack", ok: true, op });
      return;
    case "filter.clear":
      appEventBus.publish({ type: "asset-filter.clear", emittedAt });
      sendCommandAck(socket, { type: "command.ack", ok: true, op });
      return;
    case "asset.open":
      appEventBus.publish({ type: "asset-detail.open", emittedAt, assetId: message.assetId });
      sendCommandAck(socket, { type: "command.ack", ok: true, op });
      return;
    case "filter.get": {
      const snapshot = getLiveFilterSnapshot();
      sendCommandAck(socket, {
        type: "command.ack",
        ok: true,
        op,
        snapshot,
        message: snapshot ? undefined : "No live filter has been reported yet.",
      });
      return;
    }
  }
}

function handleExtensionContextMessage(socket: Socket, raw: unknown): void {
  const parsed = extensionContextGetMessageSchema.safeParse(raw);
  if (!parsed.success) {
    sendExtensionContextAck(socket, {
      type: "extension.context.ack",
      ok: false,
      message: "Invalid extension context message.",
    });
    return;
  }

  const message = parsed.data;
  if (path.resolve(message.dbPath) !== path.resolve(getDatabasePath())) {
    sendExtensionContextAck(socket, {
      type: "extension.context.ack",
      ok: false,
      message: "Extension context database path did not match the running app.",
    });
    return;
  }

  const vault = getRequestedOrActiveVault(message.vaultId);
  if (!vault) {
    sendExtensionContextAck(socket, {
      type: "extension.context.ack",
      ok: false,
      message: "No active vault selected.",
    });
    return;
  }

  const tags = getDatabase()
    .select({
      id: schema.tags.id,
      name: schema.tags.name,
      color: schema.tags.color,
      sortOrder: schema.tags.sortOrder,
    })
    .from(schema.tags)
    .where(eq(schema.tags.vaultId, vault.id))
    .orderBy(asc(schema.tags.sortOrder), asc(schema.tags.name))
    .all();

  sendExtensionContextAck(socket, {
    type: "extension.context.ack",
    ok: true,
    context: {
      vault: {
        id: vault.id,
        name: vault.name,
        rootPath: vault.rootPath,
      },
      tags,
    },
  });
}

async function handleExtensionImageSaveMessage(socket: Socket, raw: unknown): Promise<void> {
  const parsed = extensionImageSaveMessageSchema.safeParse(raw);
  if (!parsed.success) {
    sendExtensionImageSaveAck(socket, {
      type: "extension.image.save.ack",
      ok: false,
      message: "Invalid extension image save message.",
    });
    return;
  }

  const message = parsed.data;
  if (path.resolve(message.dbPath) !== path.resolve(getDatabasePath())) {
    sendExtensionImageSaveAck(socket, {
      type: "extension.image.save.ack",
      ok: false,
      message: "Extension image save database path did not match the running app.",
    });
    return;
  }

  try {
    const saved = await saveExtensionImage({
      srcUrl: message.srcUrl,
      pageUrl: message.pageUrl,
      pageTitle: message.pageTitle,
      tagId: message.tagId,
      vaultId: message.vaultId,
    });

    appEventBus.publish({
      type: "ledger.changed",
      emittedAt: Date.now(),
      source: "post-extension",
      dbPath: message.dbPath,
      changed: ["assets", "assetFiles", "assetTags", "imageCache"],
      operationCount: 1,
    });

    sendExtensionImageSaveAck(socket, {
      type: "extension.image.save.ack",
      ok: true,
      asset: {
        id: saved.assetId,
        title: saved.title,
        relativePath: saved.relativePath,
        tagId: saved.tagId,
      },
    });
  } catch (error) {
    sendExtensionImageSaveAck(socket, {
      type: "extension.image.save.ack",
      ok: false,
      message: error instanceof Error ? error.message : "Image import failed.",
    });
  }
}

async function handleExtensionVideoSaveMessage(socket: Socket, raw: unknown): Promise<void> {
  const parsed = extensionVideoSaveMessageSchema.safeParse(raw);
  if (!parsed.success) {
    sendExtensionVideoSaveAck(socket, {
      type: "extension.video.save.ack",
      ok: false,
      message: "Invalid extension video save message.",
    });
    return;
  }

  const message = parsed.data;
  if (path.resolve(message.dbPath) !== path.resolve(getDatabasePath())) {
    sendExtensionVideoSaveAck(socket, {
      type: "extension.video.save.ack",
      ok: false,
      message: "Extension video save database path did not match the running app.",
    });
    return;
  }

  try {
    const saved = await saveExtensionVideo({
      srcUrl: message.srcUrl,
      candidateUrls: message.candidateUrls,
      pageUrl: message.pageUrl,
      pageTitle: message.pageTitle,
      tweetId: message.tweetId,
      tweetUrl: message.tweetUrl,
      tagId: message.tagId,
      vaultId: message.vaultId,
    });

    appEventBus.publish({
      type: "ledger.changed",
      emittedAt: Date.now(),
      source: "post-extension",
      dbPath: message.dbPath,
      changed: ["assets", "assetFiles", "assetTags", "imageCache"],
      operationCount: 1,
    });

    sendExtensionVideoSaveAck(socket, {
      type: "extension.video.save.ack",
      ok: true,
      asset: {
        id: saved.assetId,
        title: saved.title,
        relativePath: saved.relativePath,
        tagId: saved.tagId,
      },
    });
  } catch (error) {
    sendExtensionVideoSaveAck(socket, {
      type: "extension.video.save.ack",
      ok: false,
      message: error instanceof Error ? error.message : "Video import failed.",
    });
  }
}

async function handleExtensionPostSaveMessage(socket: Socket, raw: unknown): Promise<void> {
  const parsed = extensionPostSaveMessageSchema.safeParse(raw);
  if (!parsed.success) {
    sendExtensionPostSaveAck(socket, {
      type: "extension.post.save.ack",
      ok: false,
      message: "Invalid extension post save message.",
    });
    return;
  }

  const message = parsed.data;
  if (path.resolve(message.dbPath) !== path.resolve(getDatabasePath())) {
    sendExtensionPostSaveAck(socket, {
      type: "extension.post.save.ack",
      ok: false,
      message: "Extension post save database path did not match the running app.",
    });
    return;
  }

  try {
    const saved = await saveExtensionPost({
      postId: message.postId,
      canonicalUrl: message.canonicalUrl,
      pageUrl: message.pageUrl,
      pageTitle: message.pageTitle,
      capturedAt: message.capturedAt,
      visibleSnapshot: message.visibleSnapshot,
      tagId: message.tagId,
      vaultId: message.vaultId,
    });

    appEventBus.publish({
      type: "ledger.changed",
      emittedAt: Date.now(),
      source: "post-extension",
      dbPath: message.dbPath,
      changed: [
        "assets",
        "assetFiles",
        "assetTags",
        "assetLinks",
        "markdownCache",
        "postCache",
        "imageCache",
      ],
      operationCount: 1,
    });

    sendExtensionPostSaveAck(socket, {
      type: "extension.post.save.ack",
      ok: true,
      asset: {
        id: saved.assetId,
        title: saved.title,
        relativePath: saved.relativePath,
        tagId: saved.tagId,
        status: saved.status,
        childAssetIds: saved.childAssetIds,
        warnings: saved.warnings,
      },
    });
  } catch (error) {
    sendExtensionPostSaveAck(socket, {
      type: "extension.post.save.ack",
      ok: false,
      message: error instanceof Error ? error.message : "Post import failed.",
    });
  }
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
          } else if (isCommandEnvelope(message)) {
            handleCommandMessage(socket, message);
          } else if (isExtensionEnvelope(message)) {
            if (message.type === "extension.context.get") {
              handleExtensionContextMessage(socket, message);
            } else if (message.type === "extension.image.save") {
              void handleExtensionImageSaveMessage(socket, message);
            } else if (message.type === "extension.video.save") {
              void handleExtensionVideoSaveMessage(socket, message);
            } else {
              void handleExtensionPostSaveMessage(socket, message);
            }
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
