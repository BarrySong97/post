/**
 * @purpose Notify a running Post desktop app after CLI commits mutate organization data.
 * @role    Best-effort local IPC client used by command write flows.
 * @deps    Node net sockets, path/os/crypto helpers.
 * @gotcha  Notification failures must remain warnings; warnings: [] means the desktop app acknowledged refresh.
 */

import { createHash } from "node:crypto";
import net from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";

import type { OutputWarning } from "../output/format";

type NotifyInput = {
  dbPath: string;
  changed: string[];
  operationCount: number;
};

type LocalIpcAck = {
  type: "ledger.changed.ack";
  ok: boolean;
  message?: string;
};

const NOTIFY_TIMEOUT_MS = 500;

function getLocalIpcAddress(userDataPath: string): string {
  const hash = createHash("sha256").update(path.resolve(userDataPath)).digest("hex").slice(0, 16);

  if (process.platform === "win32") {
    return `\\\\.\\pipe\\post-ledger-${hash}`;
  }

  return path.join(tmpdir(), `post-ledger-${hash}.sock`);
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isLocalIpcAck(value: unknown): value is LocalIpcAck {
  if (!value || typeof value !== "object") {
    return false;
  }

  const ack = value as Partial<LocalIpcAck>;
  return ack.type === "ledger.changed.ack" && typeof ack.ok === "boolean";
}

export function notifyDesktopLedgerChanged(input: NotifyInput): Promise<OutputWarning[]> {
  const address = getLocalIpcAddress(path.dirname(input.dbPath));

  return new Promise((resolve) => {
    let settled = false;
    let buffer = "";
    const socket = net.createConnection(address);
    const timer = setTimeout(() => {
      if (settled) {
        return;
      }

      settled = true;
      socket.destroy();
      resolve([
        {
          code: "APP_NOTIFICATION_TIMEOUT",
          message:
            "Data was committed, but the running Post app did not acknowledge the refresh notification.",
          details: { address },
        },
      ]);
    }, NOTIFY_TIMEOUT_MS);

    const settle = (warnings: OutputWarning[]): void => {
      if (settled) {
        return;
      }

      settled = true;
      clearTimeout(timer);
      socket.destroy();
      resolve(warnings);
    };

    socket.once("connect", () => {
      socket.write(
        `${JSON.stringify({
          type: "ledger.changed",
          source: "post-cli",
          dbPath: input.dbPath,
          changed: input.changed,
          operationCount: input.operationCount,
          emittedAt: Date.now(),
        })}\n`,
      );
    });

    socket.on("data", (chunk) => {
      buffer += chunk.toString("utf8");

      let newlineIndex = buffer.indexOf("\n");
      while (newlineIndex >= 0) {
        const line = buffer.slice(0, newlineIndex).trim();
        buffer = buffer.slice(newlineIndex + 1);

        if (line.length > 0) {
          try {
            const ack: unknown = JSON.parse(line);
            if (isLocalIpcAck(ack) && ack.ok) {
              settle([]);
              return;
            }

            settle([
              {
                code: "APP_NOTIFICATION_REJECTED",
                message:
                  isLocalIpcAck(ack) && ack.message
                    ? ack.message
                    : "Data was committed, but the running Post app rejected the refresh notification.",
                details: { address },
              },
            ]);
            return;
          } catch (error) {
            settle([
              {
                code: "APP_NOTIFICATION_INVALID_ACK",
                message:
                  "Data was committed, but the running Post app returned an invalid refresh acknowledgement.",
                details: { address, reason: getErrorMessage(error) },
              },
            ]);
            return;
          }
        }

        newlineIndex = buffer.indexOf("\n");
      }
    });

    socket.once("error", (error) => {
      settle([
        {
          code: "APP_NOTIFICATION_FAILED",
          message: "Data was committed, but the running Post app was not notified to refresh.",
          details: { address, reason: getErrorMessage(error) },
        },
      ]);
    });
  });
}

type CommandAck = {
  type: "command.ack";
  ok: boolean;
  op?: string;
  message?: string;
  snapshot?: unknown;
};

export type LiveCommandResult =
  | { status: "ok"; op?: string; snapshot?: unknown }
  | { status: "rejected"; reason: string }
  | { status: "unreachable"; reason: string };

function isCommandAck(value: unknown): value is CommandAck {
  if (!value || typeof value !== "object") {
    return false;
  }

  const ack = value as Partial<CommandAck>;
  return ack.type === "command.ack" && typeof ack.ok === "boolean";
}

/**
 * Send a live UI command to the running desktop app and await its `command.ack`.
 * Unlike ledger notifications, these commands are live-only: an unreachable app is an error,
 * not a warning, because there is no database fallback for UI control.
 */
export function sendLiveCommand(
  dbPath: string,
  message: Record<string, unknown>,
): Promise<LiveCommandResult> {
  const address = getLocalIpcAddress(path.dirname(dbPath));

  return new Promise((resolve) => {
    let settled = false;
    let buffer = "";
    const socket = net.createConnection(address);
    const timer = setTimeout(() => {
      if (settled) {
        return;
      }

      settled = true;
      socket.destroy();
      resolve({
        status: "unreachable",
        reason: "The running Post app did not respond in time.",
      });
    }, NOTIFY_TIMEOUT_MS);

    const settle = (result: LiveCommandResult): void => {
      if (settled) {
        return;
      }

      settled = true;
      clearTimeout(timer);
      socket.destroy();
      resolve(result);
    };

    socket.once("connect", () => {
      socket.write(
        `${JSON.stringify({ ...message, source: "post-cli", dbPath, emittedAt: Date.now() })}\n`,
      );
    });

    socket.on("data", (chunk) => {
      buffer += chunk.toString("utf8");

      let newlineIndex = buffer.indexOf("\n");
      while (newlineIndex >= 0) {
        const line = buffer.slice(0, newlineIndex).trim();
        buffer = buffer.slice(newlineIndex + 1);

        if (line.length > 0) {
          try {
            const ack: unknown = JSON.parse(line);
            if (isCommandAck(ack)) {
              if (ack.ok) {
                settle({ status: "ok", op: ack.op, snapshot: ack.snapshot });
              } else {
                settle({
                  status: "rejected",
                  reason: ack.message ?? "The running Post app rejected the live command.",
                });
              }
              return;
            }

            settle({
              status: "rejected",
              reason: "The running Post app returned an invalid acknowledgement.",
            });
            return;
          } catch (error) {
            settle({ status: "rejected", reason: getErrorMessage(error) });
            return;
          }
        }

        newlineIndex = buffer.indexOf("\n");
      }
    });

    socket.once("error", (error) => {
      settle({ status: "unreachable", reason: getErrorMessage(error) });
    });
  });
}

export function requestFilterState(dbPath: string): Promise<LiveCommandResult> {
  return sendLiveCommand(dbPath, { type: "filter.get" });
}
