/**
 * @purpose Format relative timestamps for footer task rows.
 * @role    Pure helper shared by the global status line.
 * @deps    Intl.RelativeTimeFormat.
 * @gotcha  Returns null under 45s so callers can show a "just now" fallback.
 */

const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

export function formatRelativeTime(
  timestamp: number,
  locale: string,
  now: number = Date.now(),
): string | null {
  const delta = timestamp - now;
  const abs = Math.abs(delta);

  if (abs < 45 * SECOND) {
    return null;
  }

  const formatter = new Intl.RelativeTimeFormat(locale, { numeric: "auto" });

  if (abs < HOUR) {
    return formatter.format(Math.round(delta / MINUTE), "minute");
  }
  if (abs < DAY) {
    return formatter.format(Math.round(delta / HOUR), "hour");
  }
  return formatter.format(Math.round(delta / DAY), "day");
}
