/**
 * @purpose Provide renderer ipc trpc link utilities shared across pages and components.
 * @role    Small renderer helper module outside page-specific ownership.
 * @deps    Renderer runtime, tRPC/client/provider code, platform or toast libraries as appropriate.
 * @gotcha  Keep helpers browser-safe unless they intentionally call preload-exposed APIs.
 */

import { TRPCClientError, type TRPCLink } from "@trpc/client";
import { observable } from "@trpc/server/observable";

import type { AppRouter } from "@main/trpc/router";
import { emitAssetProfile, roundProfileNumber } from "./asset-profile";

type IPCResponse =
  | {
      ok: true;
      data: unknown;
    }
  | {
      ok: false;
      error: {
        message: string;
      };
    };

let nextSubscriptionId = 0;

function getAssetTRPCResponseSummary(path: string, data: unknown) {
  if (!path.startsWith("assets.")) {
    return null;
  }

  if (data == null || typeof data !== "object") {
    return {};
  }

  const record = data as {
    items?: unknown;
    total?: unknown;
    nextCursor?: unknown;
    vault?: unknown;
    tags?: unknown;
    views?: unknown;
    summary?: unknown;
  };

  return {
    itemCount: Array.isArray(record.items) ? record.items.length : undefined,
    total: typeof record.total === "number" ? record.total : undefined,
    hasNext: record.nextCursor != null ? true : undefined,
    hasVault: record.vault != null ? true : undefined,
    tagCount: Array.isArray(record.tags) ? record.tags.length : undefined,
    viewCount: Array.isArray(record.views) ? record.views.length : undefined,
    hasSummary: record.summary != null ? true : undefined,
  };
}

export function ipcTRPCLink(): TRPCLink<AppRouter> {
  return () => {
    return ({ op }) => {
      return observable((observer) => {
        if (op.signal?.aborted) {
          observer.error(TRPCClientError.from(new Error("Request aborted")));
          return;
        }

        let isActive = true;

        if (op.type === "subscription") {
          const subscriptionId = `sub_${Date.now().toString(36)}_${(nextSubscriptionId += 1).toString(36)}`;
          const unsubscribeEventListener = window.api.onTRPCSubscriptionEvent((event) => {
            if (!isActive || event.id !== subscriptionId) {
              return;
            }

            if (event.type === "next") {
              observer.next({
                context: op.context,
                result: {
                  data: event.data,
                },
              });
            } else if (event.type === "error") {
              observer.error(TRPCClientError.from(new Error(event.error.message)));
            } else {
              observer.complete();
            }
          });

          window.api.trpcSubscribe({
            id: subscriptionId,
            path: op.path,
            input: op.input,
          });

          return () => {
            isActive = false;
            unsubscribeEventListener();
            window.api.trpcUnsubscribe({ id: subscriptionId });
          };
        }

        const startedAt = performance.now();

        window.api
          .trpcRequest({
            type: op.type,
            path: op.path,
            input: op.input,
          })
          .then((response) => {
            if (!isActive) return;

            const result = response as IPCResponse;
            const responseSummary = result.ok
              ? getAssetTRPCResponseSummary(op.path, result.data)
              : null;
            if (responseSummary) {
              emitAssetProfile("trpc.response", {
                path: op.path,
                type: op.type,
                durationMs: roundProfileNumber(performance.now() - startedAt),
                ok: result.ok,
                ...responseSummary,
              });
            }

            if (!result.ok) {
              observer.error(TRPCClientError.from(new Error(result.error.message)));
              return;
            }

            observer.next({
              context: op.context,
              result: {
                data: result.data,
              },
            });
            observer.complete();
          })
          .catch((error: unknown) => {
            if (!isActive) return;
            if (op.path.startsWith("assets.")) {
              emitAssetProfile("trpc.error", {
                path: op.path,
                type: op.type,
                durationMs: roundProfileNumber(performance.now() - startedAt),
                message: error instanceof Error ? error.message : String(error),
              });
            }
            observer.error(
              TRPCClientError.from(error instanceof Error ? error : new Error(String(error))),
            );
          });

        return () => {
          isActive = false;
        };
      });
    };
  };
}
