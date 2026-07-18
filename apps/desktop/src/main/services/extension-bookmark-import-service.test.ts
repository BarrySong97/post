/**
 * @purpose Verify bookmark normalization, shortcut formatting, and partial-capture warnings.
 * @role    Focused pure coverage for the browser bookmark import service.
 * @deps    Vitest and extension-bookmark-import-service helpers.
 * @gotcha  Integration file/database coverage is handled separately from these pure rules.
 */

import { describe, expect, it } from "vitest";

import {
  bookmarkCaptureWarnings,
  internetShortcutContents,
  normalizeBookmarkCapture,
} from "./extension-bookmark-import-service";

describe("extension bookmark import helpers", () => {
  it("normalizes YouTube variants to one canonical watch URL", () => {
    const capture = normalizeBookmarkCapture({
      kind: "youtube",
      videoId: "abc_123-Z",
      canonicalUrl: "https://youtu.be/abc_123-Z?t=30#chapter",
      pageUrl: "https://www.youtube.com/shorts/abc_123-Z",
      sourceTitle: "  Demo video  ",
      capturedAt: 1_700_000_000_000,
    });

    expect(capture).toMatchObject({
      kind: "youtube",
      videoId: "abc_123-Z",
      canonicalUrl: "https://www.youtube.com/watch?v=abc_123-Z",
      sourceTitle: "Demo video",
      liveStatus: "unknown",
    });
  });

  it("removes generic page fragments and writes a portable Internet Shortcut", () => {
    const capture = normalizeBookmarkCapture({
      kind: "web",
      canonicalUrl: "https://example.com/article?q=one#comments",
      pageUrl: "https://example.com/article?q=one#comments",
      sourceTitle: "Article",
      capturedAt: 1_700_000_000_000,
    });

    expect(capture.canonicalUrl).toBe("https://example.com/article?q=one");
    expect(internetShortcutContents(capture.canonicalUrl)).toBe(
      "[InternetShortcut]\nURL=https://example.com/article?q=one\n",
    );
  });

  it("marks missing stable YouTube metadata as partial without requiring live duration", () => {
    const capture = normalizeBookmarkCapture({
      kind: "youtube",
      videoId: "live123",
      canonicalUrl: "https://www.youtube.com/live/live123",
      pageUrl: "https://www.youtube.com/live/live123",
      sourceTitle: "Live now",
      liveStatus: "live",
      capturedAt: 1_700_000_000_000,
    });
    const warnings = bookmarkCaptureWarnings(capture);

    expect(warnings).toContain("YouTube channel was unavailable.");
    expect(warnings).not.toContain("YouTube duration was unavailable.");
  });

  it("rejects malformed YouTube identifiers", () => {
    expect(() =>
      normalizeBookmarkCapture({
        kind: "youtube",
        videoId: "../../bad",
        canonicalUrl: "https://www.youtube.com/watch?v=bad",
        pageUrl: "https://www.youtube.com/watch?v=bad",
        capturedAt: 1_700_000_000_000,
      }),
    ).toThrow("YouTube video ID is invalid");
  });
});
