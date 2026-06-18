/**
 * @purpose Adapt Electron IPC requests to the main-process tRPC app router.
 * @role    Presentation-layer transport adapter for query, mutation, and subscription calls.
 * @deps    Electron ipcMain/WebContents and the appRouter caller API.
 * @gotcha  Keep subscription cleanup tied to WebContents destruction to avoid leaked observers.
 */

import { ipcMain, type WebContents } from "electron";

import { appRouter } from "../../trpc/router";

type TRPCRequest = {
  type: "query" | "mutation" | "subscription";
  path: string;
  input: unknown;
};

type TRPCSubscriptionRequest = {
  id: string;
  path: string;
  input: unknown;
};

type TRPCUnsubscribeRequest = {
  id: string;
};

type TRPCSubscriptionEvent =
  | {
      id: string;
      type: "next";
      data: unknown;
    }
  | {
      id: string;
      type: "error";
      error: {
        message: string;
      };
    }
  | {
      id: string;
      type: "complete";
    };

type ObservableSubscription = {
  unsubscribe: () => void;
};

type ObservableLike = {
  subscribe: (observer: {
    next: (value: unknown) => void;
    error: (error: unknown) => void;
    complete: () => void;
  }) => ObservableSubscription | (() => void) | void;
};

function getCallerProcedure(caller: unknown, path: string): unknown {
  return path.split(".").reduce<unknown>((target, segment) => {
    if (target && (typeof target === "object" || typeof target === "function")) {
      return (target as Record<string, unknown>)[segment];
    }

    return undefined;
  }, caller);
}

function getTRPCSubscriptionKey(senderId: number, subscriptionId: string): string {
  return `${senderId}:${subscriptionId}`;
}

function serializeError(error: unknown): { message: string } {
  return {
    message: error instanceof Error ? error.message : String(error),
  };
}

function isObservableLike(value: unknown): value is ObservableLike {
  return (
    value != null &&
    typeof value === "object" &&
    typeof (value as { subscribe?: unknown }).subscribe === "function"
  );
}

function sendTRPCSubscriptionEvent(sender: WebContents, payload: TRPCSubscriptionEvent): void {
  if (!sender.isDestroyed()) {
    sender.send("trpc:subscription:event", payload);
  }
}

export function registerTRPCIPCHandler(): void {
  const caller = appRouter.createCaller({});
  const subscriptions = new Map<string, { senderId: number; unsubscribe: () => void }>();
  const trackedSenders = new Set<number>();

  const disposeSubscription = (key: string): void => {
    const subscription = subscriptions.get(key);
    if (!subscription) {
      return;
    }

    subscriptions.delete(key);
    subscription.unsubscribe();
  };

  const disposeSubscriptionsForSender = (senderId: number): void => {
    for (const [key, subscription] of subscriptions.entries()) {
      if (subscription.senderId === senderId) {
        disposeSubscription(key);
      }
    }
  };

  ipcMain.handle("trpc:request", async (_event, request: TRPCRequest) => {
    if (request.type === "subscription") {
      return {
        ok: false,
        error: {
          message: "Subscriptions are not supported over this IPC link",
        },
      };
    }

    const procedure = getCallerProcedure(caller, request.path);
    if (typeof procedure !== "function") {
      return {
        ok: false,
        error: {
          message: `Unknown tRPC procedure: ${request.path}`,
        },
      };
    }

    try {
      const data = await procedure(request.input);
      return { ok: true, data };
    } catch (error) {
      return {
        ok: false,
        error: {
          message: serializeError(error).message,
        },
      };
    }
  });

  ipcMain.on("trpc:subscribe", async (event, request: TRPCSubscriptionRequest) => {
    const senderId = event.sender.id;
    const key = getTRPCSubscriptionKey(senderId, request.id);

    disposeSubscription(key);

    if (!trackedSenders.has(senderId)) {
      trackedSenders.add(senderId);
      event.sender.once("destroyed", () => {
        disposeSubscriptionsForSender(senderId);
        trackedSenders.delete(senderId);
      });
    }

    const procedure = getCallerProcedure(caller, request.path);
    if (typeof procedure !== "function") {
      sendTRPCSubscriptionEvent(event.sender, {
        id: request.id,
        type: "error",
        error: {
          message: `Unknown tRPC subscription: ${request.path}`,
        },
      });
      return;
    }

    try {
      const observableResult = await procedure(request.input);
      if (!isObservableLike(observableResult)) {
        sendTRPCSubscriptionEvent(event.sender, {
          id: request.id,
          type: "error",
          error: {
            message: `tRPC procedure is not subscribable: ${request.path}`,
          },
        });
        return;
      }

      const subscription = observableResult.subscribe({
        next: (data) => {
          sendTRPCSubscriptionEvent(event.sender, {
            id: request.id,
            type: "next",
            data,
          });
        },
        error: (error) => {
          sendTRPCSubscriptionEvent(event.sender, {
            id: request.id,
            type: "error",
            error: serializeError(error),
          });
          subscriptions.delete(key);
        },
        complete: () => {
          sendTRPCSubscriptionEvent(event.sender, {
            id: request.id,
            type: "complete",
          });
          subscriptions.delete(key);
        },
      });
      const unsubscribe =
        typeof subscription === "function" ? subscription : () => subscription?.unsubscribe();

      subscriptions.set(key, {
        senderId,
        unsubscribe,
      });
    } catch (error) {
      sendTRPCSubscriptionEvent(event.sender, {
        id: request.id,
        type: "error",
        error: serializeError(error),
      });
    }
  });

  ipcMain.on("trpc:unsubscribe", (event, request: TRPCUnsubscribeRequest) => {
    disposeSubscription(getTRPCSubscriptionKey(event.sender.id, request.id));
  });
}
