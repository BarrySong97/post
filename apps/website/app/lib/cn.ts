/**
 * @purpose Join conditional className fragments, dropping falsy ones.
 * @role    Small class-name helper for components (no tailwind-merge needed for current call sites).
 * @deps    None.
 */
export function cn(...classes: Array<string | false | null | undefined>): string {
  return classes.filter(Boolean).join(" ");
}
