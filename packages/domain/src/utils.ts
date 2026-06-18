/**
 * @purpose Share small normalization helpers across Post domain workflows.
 * @role    Internal utility module for strings, arrays, and JSON parsing.
 * @deps    None.
 * @gotcha  Helpers here must stay deterministic for dry-run and commit parity.
 */

export function uniqueStrings<T extends string>(values: readonly T[]): T[] {
  return Array.from(new Set(values));
}

export function normalizeOptionalText(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

export function getStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter((item): item is string => typeof item === "string");
}
