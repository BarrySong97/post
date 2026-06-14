/**
 * @purpose Implement main-process vault file service behavior for desktop workflows.
 * @role    Native capability service called by tRPC routers, tasks, or Electron lifecycle code.
 * @deps    Electron main process APIs, filesystem/process utilities, repositories as needed.
 * @gotcha  Keep native side effects out of renderer code and return preload-safe data shapes.
 */

import path from "node:path";

import { TRPCError } from "@trpc/server";

export function resolveVaultFilePath(rootPath: string, relativePath: string) {
  const resolvedRootPath = path.resolve(rootPath);
  const absolutePath = path.resolve(resolvedRootPath, relativePath);
  const relativeToRoot = path.relative(resolvedRootPath, absolutePath);

  if (relativeToRoot.startsWith("..") || path.isAbsolute(relativeToRoot)) {
    throw new TRPCError({ code: "FORBIDDEN", message: "Asset path is outside of the vault" });
  }

  return absolutePath;
}
