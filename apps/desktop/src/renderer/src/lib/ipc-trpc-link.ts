import { TRPCClientError, type TRPCLink } from "@trpc/client";
import { observable } from "@trpc/server/observable";

import type { AppRouter } from "@main/trpc/router";

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

export function ipcTRPCLink(): TRPCLink<AppRouter> {
  return () => {
    return ({ op }) => {
      return observable((observer) => {
        if (op.signal?.aborted) {
          observer.error(TRPCClientError.from(new Error("Request aborted")));
          return;
        }

        let isActive = true;

        window.api
          .trpcRequest({
            type: op.type,
            path: op.path,
            input: op.input,
          })
          .then((response) => {
            if (!isActive) return;

            const result = response as IPCResponse;
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
            observer.error(TRPCClientError.from(error instanceof Error ? error : new Error(String(error))));
          });

        return () => {
          isActive = false;
        };
      });
    };
  };
}
