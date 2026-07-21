/**
 * @purpose Verify normalized X post parsing and visible-page fallback behavior.
 * @role    Focused unit coverage for post metadata consumed by extension imports.
 * @deps    vitest and twitter-post-resolver.
 * @gotcha  Fixtures model only normalized fields used by Post, not the full provider response.
 */

import { describe, expect, it, vi } from "vitest";

import {
  parseTwitterPostPayload,
  parseTwitterServerRenderedText,
  resolveTwitterPost,
} from "./twitter-post-resolver";

const input = {
  postId: "2075123908790165888",
  canonicalUrl: "https://x.com/JameslabiQ/status/2075123908790165888",
  capturedAt: Date.parse("2026-07-10T00:00:00.000Z"),
};
const noteTweetResultId = "Tm90ZVR3ZWV0UmVzdWx0czoyMDc2NjU4ODIzOTMxMDQzODQw";
const noteTweetRecordId = "Tm90ZVR3ZWV0OjIwNzY2NTg4MjM5MzEwNDM4NDA=";
const completeNoteText =
  "Collapsed beginning followed by the complete server-rendered NoteTweet ending.";
const serverRenderedNoteHtml = `<script>self.$_TSR={relayRecords:{"${noteTweetRecordId}":$R[121]={__id:"${noteTweetRecordId}",__typename:"NoteTweet",text:${JSON.stringify(completeNoteText)},entity_set:$R[122]}}}</script>`;

describe("twitter post resolver", () => {
  it("normalizes text, author, direct media, quote, reply, poll, and link metadata", () => {
    const payload = {
      id_str: input.postId,
      text: "Premium motion. https://t.co/media",
      display_text_range: [0, 15],
      created_at: "2026-07-09T07:44:28.000Z",
      lang: "en",
      user: {
        name: "James Labi",
        screen_name: "JameslabiQ",
        profile_image_url_https: "https://pbs.twimg.com/profile_images/123/avatar_normal.jpg",
      },
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
      authorAvatarUrl: "https://pbs.twimg.com/profile_images/123/avatar_normal.jpg",
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

  it("collapses X image URL variants into one original-resolution media item", () => {
    const result = parseTwitterPostPayload(
      {
        id_str: input.postId,
        text: "One image",
        mediaDetails: [
          {
            type: "photo",
            media_url_https: "https://pbs.twimg.com/media/Example123.jpg?name=small",
          },
        ],
        photos: [
          {
            url: "https://pbs.twimg.com/media/Example123?format=jpg&name=medium",
          },
        ],
      },
      {
        ...input,
        visibleSnapshot: {
          mediaUrls: ["https://pbs.twimg.com/media/Example123.jpg?name=360x360"],
        },
      },
    );

    expect(result.media).toHaveLength(1);
    const mediaUrl = new URL(result.media[0]?.url ?? "");
    expect(mediaUrl.pathname).toBe("/media/Example123");
    expect(mediaUrl.searchParams.get("format")).toBe("jpg");
    expect(mediaUrl.searchParams.get("name")).toBe("orig");
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

  it("prefers complete long-form fields over a truncated root text", () => {
    const noteResult = parseTwitterPostPayload(
      {
        text: "Truncated note…",
        truncated: true,
        note_tweet: {
          note_tweet_results: {
            result: { text: "Complete note text that continues beyond the collapsed preview." },
          },
        },
      },
      input,
    );
    const extendedResult = parseTwitterPostPayload(
      {
        text: "Truncated extended post…",
        truncated: true,
        extended_tweet: {
          full_text: "Complete extended post text.",
          display_text_range: [0, 28],
        },
      },
      input,
    );

    expect(noteResult.text).toBe("Complete note text that continues beyond the collapsed preview.");
    expect(noteResult.warnings).toEqual([]);
    expect(extendedResult.text).toBe("Complete extended post text.");
    expect(extendedResult.warnings).toEqual([]);
  });

  it("uses a confirmed expanded DOM snapshot when it is more complete", () => {
    const result = parseTwitterPostPayload(
      { text: "Collapsed provider text…" },
      {
        ...input,
        visibleSnapshot: {
          text: "Collapsed provider text followed by the complete ending.",
          textTruncated: false,
        },
      },
    );

    expect(result.text).toBe("Collapsed provider text followed by the complete ending.");
    expect(result.warnings).toEqual([]);
  });

  it("extracts and resolves the exact long-form note from server-rendered X records", async () => {
    expect(
      parseTwitterServerRenderedText(
        serverRenderedNoteHtml,
        "2076658823985545506",
        noteTweetResultId,
      ),
    ).toBe(completeNoteText);

    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            id_str: "2076658823985545506",
            text: "Collapsed beginning",
            note_tweet: { id: noteTweetResultId },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
      )
      .mockResolvedValueOnce(new Response(serverRenderedNoteHtml, { status: 200 }));
    const result = await resolveTwitterPost(
      {
        postId: "2076658823985545506",
        canonicalUrl: "https://x.com/vikingmute/status/2076658823985545506",
      },
      fetchImpl,
    );

    expect(result.text).toBe(completeNoteText);
    expect(result.warnings).toEqual([]);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("marks an unresolved long-form note partial even without a provider truncated flag", () => {
    const result = parseTwitterPostPayload(
      { text: "Still truncated…", note_tweet: { id: noteTweetResultId } },
      {
        ...input,
        visibleSnapshot: { text: "Still truncated…", textTruncated: false },
      },
    );

    expect(result.text).toBe("Still truncated…");
    expect(result.warnings).toEqual([
      "X post text may be truncated because the complete text was unavailable.",
    ]);
  });

  it("falls back to visible page content when public metadata is unavailable", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockRejectedValue(new Error("offline"));
    const result = await resolveTwitterPost(
      {
        ...input,
        visibleSnapshot: {
          authorName: "Visible Author",
          authorHandle: "visible",
          authorAvatarUrl: "https://pbs.twimg.com/profile_images/456/visible_normal.jpg",
          text: "Visible text",
          publishedAt: "2026-07-09T00:00:00.000Z",
        },
      },
      fetchImpl,
    );

    expect(result).toMatchObject({
      text: "Visible text",
      authorHandle: "visible",
      authorAvatarUrl: "https://pbs.twimg.com/profile_images/456/visible_normal.jpg",
      warnings: ["Public X metadata was unavailable; saved from the visible page snapshot."],
    });
  });
});
