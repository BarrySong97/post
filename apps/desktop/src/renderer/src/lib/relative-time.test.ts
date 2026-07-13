/**
 * @purpose Verify relative-time formatting thresholds used by the footer.
 * @role    Pure unit coverage for formatRelativeTime.
 * @deps    vitest.
 * @gotcha  Under 45 seconds returns null so callers can show "just now".
 */

import { describe, expect, it } from "vitest";

import { formatRelativeTime } from "./relative-time";

describe("formatRelativeTime", () => {
  const now = Date.parse("2026-07-13T12:00:00.000Z");

  it("returns null under 45 seconds", () => {
    expect(formatRelativeTime(now - 20_000, "en", now)).toBeNull();
    expect(formatRelativeTime(now - 44_000, "zh-CN", now)).toBeNull();
  });

  it("formats minutes and hours in en and zh", () => {
    expect(formatRelativeTime(now - 5 * 60_000, "en", now)).toMatch(/5 minutes ago|5 min/i);
    expect(formatRelativeTime(now - 2 * 60 * 60_000, "en", now)).toMatch(/2 hours ago|2 hr/i);
    expect(formatRelativeTime(now - 5 * 60_000, "zh-CN", now)).toBeTruthy();
  });
});
