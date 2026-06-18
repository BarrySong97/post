/**
 * @purpose Provide structured domain errors for desktop routers and CLI commands.
 * @role    Transport-neutral error model for Post organization workflows.
 * @deps    None.
 * @gotcha  Keep codes stable; CLI JSON output and AI repair loops depend on them.
 */

export type DomainErrorStatus = "BAD_REQUEST" | "NOT_FOUND" | "CONFLICT" | "INTERNAL";

export class DomainError extends Error {
  readonly code: string;
  readonly status: DomainErrorStatus;
  readonly details: Record<string, unknown>;

  constructor(
    code: string,
    message: string,
    options: { status?: DomainErrorStatus; details?: Record<string, unknown> } = {},
  ) {
    super(message);
    this.name = "DomainError";
    this.code = code;
    this.status = options.status ?? "BAD_REQUEST";
    this.details = options.details ?? {};
  }
}

export function isDomainError(error: unknown): error is DomainError {
  return error instanceof DomainError;
}
