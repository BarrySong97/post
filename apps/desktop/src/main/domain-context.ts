/**
 * @purpose Build shared domain contexts and translate domain errors for desktop routers.
 * @role    Adapter between Electron main database singletons and transport-neutral domain services.
 * @deps    node:crypto, @post/domain, tRPC errors, local database bootstrap.
 * @gotcha  Keep Electron-specific database resolution outside packages/domain.
 */

import { randomUUID } from "node:crypto";

import { TRPCError } from "@trpc/server";
import { DomainError, isDomainError, type DomainContext } from "@post/domain";

import { getDatabase } from "./db";

export function createDesktopDomainContext(activeVaultId?: string): DomainContext {
  return {
    db: getDatabase(),
    activeVaultId,
    now: () => new Date(),
    id: randomUUID,
  };
}

export function toTrpcError(error: unknown): TRPCError {
  if (isDomainError(error)) {
    const code =
      error.status === "NOT_FOUND"
        ? "NOT_FOUND"
        : error.status === "CONFLICT"
          ? "CONFLICT"
          : error.status === "INTERNAL"
            ? "INTERNAL_SERVER_ERROR"
            : "BAD_REQUEST";

    return new TRPCError({ code, message: error.message, cause: error });
  }

  if (error instanceof DomainError) {
    return new TRPCError({ code: "BAD_REQUEST", message: error.message, cause: error });
  }

  return new TRPCError({
    code: "INTERNAL_SERVER_ERROR",
    message: error instanceof Error ? error.message : "Unexpected domain error",
    cause: error,
  });
}

export function runDomain<T>(callback: (ctx: DomainContext) => T): T {
  try {
    return callback(createDesktopDomainContext());
  } catch (error) {
    throw toTrpcError(error);
  }
}
