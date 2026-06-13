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
