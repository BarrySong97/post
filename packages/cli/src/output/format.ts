/**
 * @purpose Render CLI responses for humans and AI callers.
 * @role    Output adapter for stable JSON envelopes and concise text.
 * @deps    @post/domain errors.
 * @gotcha  Keep JSON envelope stable; agents rely on ok/data/error shape.
 */

import { isDomainError } from "@post/domain";

export type OutputOptions = {
  json?: boolean;
};

export type OutputWarning = {
  code: string;
  message: string;
  details?: Record<string, unknown>;
};

export function writeSuccess(
  data: unknown,
  options: OutputOptions = {},
  warnings: OutputWarning[] = [],
): void {
  if (options.json) {
    process.stdout.write(`${JSON.stringify({ ok: true, data, warnings }, null, 2)}\n`);
    return;
  }

  if (typeof data === "string") {
    process.stdout.write(`${data}\n`);
  } else {
    process.stdout.write(`${JSON.stringify(data, null, 2)}\n`);
  }

  for (const warning of warnings) {
    process.stderr.write(`Warning: ${warning.message}\n`);
  }
}

export function writeError(
  error: unknown,
  options: OutputOptions = {},
  operationIndex?: number,
): void {
  const payload = isDomainError(error)
    ? {
        code: error.code,
        message: error.message,
        operationIndex,
        details: error.details,
      }
    : {
        code: "UNEXPECTED_ERROR",
        message: error instanceof Error ? error.message : "Unexpected error",
        operationIndex,
        details: {},
      };

  if (options.json) {
    process.stderr.write(`${JSON.stringify({ ok: false, error: payload }, null, 2)}\n`);
    return;
  }

  process.stderr.write(`Error: ${payload.message}\n`);
}

export function exitCodeForError(error: unknown): number {
  if (!isDomainError(error)) {
    return 4;
  }

  return error.status === "INTERNAL" ? 4 : 1;
}
