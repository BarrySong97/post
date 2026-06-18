/**
 * @purpose Build domain contexts for CLI commands.
 * @role    Adapter from CLI global options to @post/domain context.
 * @deps    node:crypto, CLI database runtime, @post/domain.
 * @gotcha  Keep id/time injectable so tests and dry-run flows can become deterministic.
 */

import { randomUUID } from "node:crypto";

import type { DomainContext } from "@post/domain";

import { openCliDatabase, type DatabaseRuntime } from "./database";

export type CliGlobalOptions = {
  db?: string;
  env?: string;
  vault?: string;
};

export type CliRuntime = DatabaseRuntime & {
  ctx: DomainContext;
};

export function createCliRuntime(options: CliGlobalOptions): CliRuntime {
  const runtime = openCliDatabase({ dbPath: options.db, appEnv: options.env });

  return {
    ...runtime,
    ctx: {
      db: runtime.db,
      activeVaultId: options.vault,
      now: () => new Date(),
      id: randomUUID,
    },
  };
}
