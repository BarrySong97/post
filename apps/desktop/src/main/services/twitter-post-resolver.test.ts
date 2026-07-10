/**
 * @purpose Verify normalized X post parsing and visible-page fallback behavior.
 * @role    Focused unit coverage for post metadata consumed by extension imports.
 * @deps    vitest and twitter-post-resolver.
 * @gotcha  Fixtures model only normalized fields used by Post, not the full provider response.
 */

import { describe, expect, it, vi } from "vitest";

import { parseTwitterPostPayload, resolveTwitterPost } from "./twitter-post-resolver";

const input = {
  postId: "2075123908790165888",
  canonicalUrl: "https://x.com/JameslabiQ/status/2075123908790165888",
  capturedAt: Date.parse("2026-07-10T00:00:00.000Z"),
};

describe("twitter post resolver", () => {
  it("normalizes text, author, direct media, quote, reply, poll, and link metadata", () => {
    const payload = {
      id_str: input.postId,
      text: "Premium motion. https://t.co/media",
      display_text_range: [0, 15],
      created_at: "2026-07-09T07:44:28.000Z",
      lang: "en",
      user: { name: "James Labi", screen_name: "JameslabiQ" },
      in_reply_to_status_id_str: "100",
      in_reply_to_screen_name: "parent",
      mediaDetails: [
        {
          type: "photo",
          media_url_https: "https://pbs.twimg.com/media/example.jpg",
        },
        {
          type: "video",
          video_info: {
            variants: [
              {
                bitrate: 1_280_000,
                content_type: "video/mp4",
                url: "https://video.twimg.com/example/high.mp4",
              },
            ],
          },
        },
      ],
      quoted_tweet: {
        id_str: "200",
        text: "Quoted text",
        user: { name: "Quoted", screen_name: "quoted" },
      },
      card: {
        binding_values: {
          choice1_label: { string_value: "One" },
          choice1_count: { string_value: "12" },
          choice2_label: { string_value: "Two" },
          counts_are_final: { boolean_value: true },
          card_url: { string_value: "https://example.com/story" },
          title: { string_value: "Story" },
        },
      },
    };

    const result = parseTwitterPostPayload(payload, input);
    expect(result).toMatchObject({
      postId: input.postId,
      text: "Premium motion.",
      authorName: "James Labi",
      authorHandle: "JameslabiQ",
      replyToPostId: "100",
      replyToUrl: "https://x.com/parent/status/100",
      quotedPost: {
        postId: "200",
        authorHandle: "quoted",
        text: "Quoted text",
      },
      poll: {
        choices: [{ label: "One", count: 12 }, { label: "Two" }],
        countsFinal: true,
      },
      linkCard: { url: "https://example.com/story", title: "Story" },
    });
    expect(result.media).toHaveLength(2);
    expect(result.media[0]?.url).toContain("name=orig");
    expect(result.media[1]?.candidateUrls).toEqual(["https://video.twimg.com/example/high.mp4"]);
  });

  it("uses the original post identity for repost payloads", () => {
    const result = parseTwitterPostPayload(
      {
        user: { screen_name: "reposter" },
        retweeted_status: {
          id_str: "300",
          text: "Original",
          user: { screen_name: "original" },
        },
      },
      input,
    );

    expect(result.postId).toBe("300");
    expect(result.canonicalUrl).toBe("https://x.com/original/status/300");
    expect(result.repostedByHandle).toBe("reposter");
  });

  it("falls back to visible page content when public metadata is unavailable", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockRejectedValue(new Error("offline"));
    const result = await resolveTwitterPost(
      {
        ...input,
        visibleSnapshot: {
          authorName: "Visible Author",
          authorHandle: "visible",
          text: "Visible text",
          publishedAt: "2026-07-09T00:00:00.000Z",
        },
      },
      fetchImpl,
    );

    expect(result).toMatchObject({
      text: "Visible text",
      authorHandle: "visible",
      warnings: ["Public X metadata was unavailable; saved from the visible page snapshot."],
    });
  });
});
