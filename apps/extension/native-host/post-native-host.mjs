#!/usr/bin/env node
/**
 * @purpose Bridge Chrome Native Messaging requests from the Post extension to Desktop local IPC.
 * @role    Stdio native host executable launched by Chromium-family browsers.
 * @deps    Node fs/net/os/path/crypto/process built-ins and Desktop's newline-delimited local IPC.
 * @gotcha  Native Messaging stdout must contain only length-prefixed JSON frames; write diagnostics to stderr.
 */

import { createHash } from "node:crypto";
import net from "node:net";
import { homedir, tmpdir, endianness } from "node:os";
import path from "node:path";

const CONTEXT_IPC_TIMEOUT_MS = 1500;
const IMAGE_IPC_TIMEOUT_MS = 60_000;
const VIDEO_IPC_TIMEOUT_MS = 3 * 60_000;
const POST_IPC_TIMEOUT_MS = 5 * 60_000;
const BOOKMARK_LOOKUP_IPC_TIMEOUT_MS = 2000;
const BOOKMARK_SAVE_IPC_TIMEOUT_MS = 60_000;
const HOST_TIMEOUT_MS = 5000;
const HOST_NAME = "com.post.desktop";

function getDefaultUserDataDir() {
  if (process.env.POST_USER_DATA_DIR) {
    return process.env.POST_USER_DATA_DIR;
  }

  if (process.platform === "darwin") {
    return path.join(homedir(), "Library", "Application Support", "desktop");
  }

  if (process.platform === "win32") {
    return path.join(process.env.APPDATA ?? path.join(homedir(), "AppData", "Roaming"), "desktop");
  }

  return path.join(process.env.XDG_CONFIG_HOME ?? path.join(homedir(), ".config"), "desktop");
}

function resolveDefaultDbPath(appEnv) {
  return path.join(getDefaultUserDataDir(), `post-${appEnv}.sqlite`);
}

function getLocalIpcAddresses(userDataPath) {
  const hash = createHash("sha256").update(path.resolve(userDataPath)).digest("hex").slice(0, 16);

  if (process.platform === "win32") {
    return [`\\\\.\\pipe\\post-ledger-${hash}`];
  }

  return Array.from(
    new Set([
      path.join(tmpdir(), `post-ledger-${hash}.sock`),
      path.join("/tmp", `post-ledger-${hash}.sock`),
      path.join("/private/tmp", `post-ledger-${hash}.sock`),
    ]),
  );
}

function writeNativeMessage(message) {
  const body = Buffer.from(JSON.stringify(message), "utf8");
  const header = Buffer.alloc(4);
  if (endianness() === "LE") {
    header.writeUInt32LE(body.length, 0);
  } else {
    header.writeUInt32BE(body.length, 0);
  }

  process.stdout.write(Buffer.concat([header, body]));
}

function readNativeMessage() {
  return new Promise((resolve, reject) => {
    let buffer = Buffer.alloc(0);
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error("Timed out waiting for a native message."));
    }, HOST_TIMEOUT_MS);

    function cleanup() {
      clearTimeout(timer);
      process.stdin.off("data", onData);
      process.stdin.off("error", onError);
    }

    function onError(error) {
      cleanup();
      reject(error);
    }

    function onData(chunk) {
      buffer = Buffer.concat([buffer, chunk]);
      if (buffer.length < 4) {
        return;
      }

      const length = endianness() === "LE" ? buffer.readUInt32LE(0) : buffer.readUInt32BE(0);
      if (buffer.length < 4 + length) {
        return;
      }

      cleanup();
      const body = buffer.subarray(4, 4 + length).toString("utf8");
      resolve(JSON.parse(body));
    }

    process.stdin.on("data", onData);
    process.stdin.once("error", onError);
    process.stdin.resume();
  });
}

function sendLocalIpcToAddress(address, message, timeoutMs) {
  return new Promise((resolve) => {
    let settled = false;
    let buffer = "";
    const socket = net.createConnection(address);
    const timer = setTimeout(() => {
      settle({
        ok: false,
        message: "Post Desktop did not respond at the local IPC socket.",
      });
    }, timeoutMs);

    function settle(result) {
      if (settled) {
        return;
      }

      settled = true;
      clearTimeout(timer);
      socket.destroy();
      resolve(result);
    }

    socket.once("connect", () => {
      socket.write(`${JSON.stringify(message)}\n`);
    });

    socket.on("data", (chunk) => {
      buffer += chunk.toString("utf8");

      let newlineIndex = buffer.indexOf("\n");
      while (newlineIndex >= 0) {
        const line = buffer.slice(0, newlineIndex).trim();
        buffer = buffer.slice(newlineIndex + 1);

        if (line.length > 0) {
          try {
            settle(JSON.parse(line));
          } catch {
            settle({ ok: false, message: "Post Desktop returned an invalid local IPC response." });
          }
          return;
        }

        newlineIndex = buffer.indexOf("\n");
      }
    });

    socket.once("error", () => {
      settle({
        ok: false,
        message: "Post Desktop is unavailable at the local IPC socket.",
      });
    });
  });
}

async function sendLocalIpc(dbPath, message) {
  const addresses = getLocalIpcAddresses(path.dirname(dbPath));
  const timeoutMs =
    message.type === "extension.context.get"
      ? CONTEXT_IPC_TIMEOUT_MS
      : message.type === "extension.bookmark.lookup"
        ? BOOKMARK_LOOKUP_IPC_TIMEOUT_MS
        : message.type === "extension.bookmark.save"
          ? BOOKMARK_SAVE_IPC_TIMEOUT_MS
          : message.type === "extension.image.save"
            ? IMAGE_IPC_TIMEOUT_MS
            : message.type === "extension.video.save"
              ? VIDEO_IPC_TIMEOUT_MS
              : POST_IPC_TIMEOUT_MS;
  let lastResult = null;

  for (const address of addresses) {
    const result = await sendLocalIpcToAddress(address, message, timeoutMs);
    if (result && typeof result === "object" && result.ok !== false) {
      return result;
    }

    lastResult = result;
  }

  return (
    lastResult ?? {
      ok: false,
      message: "Post Desktop is unavailable. Start Post Desktop and reload the extension.",
    }
  );
}

function getAppEnv(value) {
  return value === "prod" ? "prod" : "dev";
}

async function handleMessage(message) {
  if (!message || typeof message !== "object") {
    return { ok: false, message: "Invalid native host message." };
  }

  if (
    message.type !== "post.context.get" &&
    message.type !== "post.image.save" &&
    message.type !== "post.video.save" &&
    message.type !== "post.post.save" &&
    message.type !== "post.bookmark.lookup" &&
    message.type !== "post.bookmark.save"
  ) {
    return { ok: false, message: `Unsupported native host message for ${HOST_NAME}.` };
  }

  const dbPath = resolveDefaultDbPath(getAppEnv(message.appEnv));
  let localMessage;
  if (message.type === "post.context.get") {
    localMessage = {
      type: "extension.context.get",
      source: "post-extension",
      dbPath,
      emittedAt: Date.now(),
    };
  } else if (message.type === "post.image.save") {
    localMessage = {
      type: "extension.image.save",
      source: "post-extension",
      dbPath,
      emittedAt: Date.now(),
      srcUrl: message.srcUrl,
      pageUrl: message.pageUrl,
      pageTitle: message.pageTitle,
      tagId: message.tagId,
    };
  } else if (message.type === "post.video.save") {
    localMessage = {
      type: "extension.video.save",
      source: "post-extension",
      dbPath,
      emittedAt: Date.now(),
      srcUrl: message.srcUrl,
      candidateUrls: message.candidateUrls,
      pageUrl: message.pageUrl,
      pageTitle: message.pageTitle,
      tweetId: message.tweetId,
      tweetUrl: message.tweetUrl,
      tagId: message.tagId,
    };
  } else if (message.type === "post.post.save") {
    localMessage = {
      type: "extension.post.save",
      source: "post-extension",
      dbPath,
      emittedAt: Date.now(),
      postId: message.postId,
      canonicalUrl: message.canonicalUrl,
      pageUrl: message.pageUrl,
      pageTitle: message.pageTitle,
      capturedAt: message.capturedAt,
      visibleSnapshot: message.visibleSnapshot,
      tagId: message.tagId,
    };
  } else if (message.type === "post.bookmark.lookup") {
    localMessage = {
      type: "extension.bookmark.lookup",
      source: "post-extension",
      dbPath,
      emittedAt: Date.now(),
      capture: message.capture,
    };
  } else {
    localMessage = {
      type: "extension.bookmark.save",
      source: "post-extension",
      dbPath,
      emittedAt: Date.now(),
      capture: message.capture,
      titleOverride: message.titleOverride,
      note: message.note,
      tagIds: message.tagIds,
      action: message.action,
    };
  }
  const ack = await sendLocalIpc(dbPath, localMessage);

  if (!ack || typeof ack !== "object") {
    return { ok: false, message: "Post Desktop returned an unsupported extension response." };
  }

  if (message.type === "post.context.get") {
    if (ack.type !== "extension.context.ack") {
      return { ok: false, message: "Post Desktop returned an unsupported context response." };
    }

    if (ack.ok && ack.context) {
      return { ok: true, context: ack.context };
    }

    return { ok: false, message: ack.message ?? "Post Desktop rejected the context request." };
  }

  if (message.type === "post.bookmark.lookup") {
    if (ack.type !== "extension.bookmark.lookup.ack") {
      return { ok: false, message: "Post Desktop returned an unsupported lookup response." };
    }
    if (ack.ok && Array.isArray(ack.duplicates)) {
      return { ok: true, duplicates: ack.duplicates };
    }
    return { ok: false, message: ack.message ?? "Post Desktop rejected the bookmark lookup." };
  }

  const expectedAckType =
    message.type === "post.image.save"
      ? "extension.image.save.ack"
      : message.type === "post.video.save"
        ? "extension.video.save.ack"
        : message.type === "post.post.save"
          ? "extension.post.save.ack"
          : "extension.bookmark.save.ack";

  if (ack.type !== expectedAckType) {
    return { ok: false, message: "Post Desktop returned an unsupported save response." };
  }

  if (ack.ok && ack.asset) {
    return { ok: true, asset: ack.asset };
  }

  return { ok: false, message: ack.message ?? "Post Desktop rejected the save request." };
}

try {
  const message = await readNativeMessage();
  writeNativeMessage(await handleMessage(message));
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  writeNativeMessage({ ok: false, message: "Post native host failed." });
}
