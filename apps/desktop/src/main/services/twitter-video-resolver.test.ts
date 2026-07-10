/**
 * @purpose Verify Twitter/X public embed metadata parsing and variant ordering.
 * @role    Focused unit coverage for extension video URL resolution.
 * @deps    vitest and twitter-video-resolver.
 * @gotcha  Keep the fixture small while preserving both MP4 and HLS response shapes.
 */

import { describe, expect, it, vi } from "vitest";

import {
  getTwitterSyndicationToken,
  parseTwitterVideoVariants,
  resolveTwitterVideoVariants,
} from "./twitter-video-resolver";

const payload = {
  mediaDetails: [
    {
      video_info: {
        variants: [
          { content_type: "application/x-mpegURL", url: "https://video.twimg.com/a/master.m3u8" },
          { bitrate: 432_000, content_type: "video/mp4", url: "https://video.twimg.com/a/low.mp4" },
          {
            bitrate: 1_280_000,
            content_type: "video/mp4",
            url: "https://video.twimg.com/a/high.mp4",
          },
        ],
      },
    },
  ],
  video: {
    variants: [
      { type: "video/mp4", src: "https://video.twimg.com/a/low.mp4" },
      { type: "video/mp4", src: "https://video.twimg.com/a/high.mp4" },
    ],
  },
};

const unifiedCardPayload = {
  card: {
    binding_values: {
      unified_card: {
        string_value: JSON.stringify({
          component_objects: {
            media: {
              data: {
                video_info: {
                  variants: [
                    {
                      bitrate: 10_368_000,
                      content_type: "video/mp4",
                      url: "https://video.twimg.com/card/full-with-audio.mp4",
                    },
                  ],
                },
              },
            },
          },
        }),
      },
    },
  },
};

describe("twitter video resolver", () => {
  it("generates the token used by X public embed metadata", () => {
    expect(getTwitterSyndicationToken("2075123908790165888")).toBe("5136zgj3f5m");
  });

  it("prefers the highest bitrate complete MP4 variant", () => {
    expect(parseTwitterVideoVariants(payload).map((variant) => variant.url)).toEqual([
      "https://video.twimg.com/a/high.mp4",
      "https://video.twimg.com/a/low.mp4",
      "https://video.twimg.com/a/master.m3u8",
    ]);
  });

  it("reads video variants embedded in unified card JSON", () => {
    expect(parseTwitterVideoVariants(unifiedCardPayload)).toEqual([
      {
        bitrate: 10_368_000,
        contentType: "video/mp4",
        url: "https://video.twimg.com/card/full-with-audio.mp4",
      },
    ]);
  });

  it("fetches variants by post ID and falls back cleanly on endpoint failure", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify(payload), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );

    await expect(
      resolveTwitterVideoVariants("2075123908790165888", fetchImpl),
    ).resolves.toHaveLength(3);
    expect(String(fetchImpl.mock.calls[0]?.[0])).toContain("token=5136zgj3f5m");

    fetchImpl.mockRejectedValueOnce(new Error("offline"));
    await expect(resolveTwitterVideoVariants("2075123908790165888", fetchImpl)).resolves.toEqual(
      [],
    );
  });
});
