/**
 * @purpose Define explicit runtime dependencies for reusable Post domain workflows.
 * @role    Shared context contract passed by desktop main and CLI callers.
 * @deps    @post/db database type.
 * @gotcha  Keep this package free of Electron, tRPC, and app-level singleton imports.
 */

import type { Database } from "@post/db";

export type DomainContext = {
  db: Database;
  activeVaultId?: string;
  now: () => Date;
  id: () => string;
};
