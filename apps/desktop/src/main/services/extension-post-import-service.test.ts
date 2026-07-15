/**
 * @purpose Verify generated X post Markdown updates preserve user-owned content.
 * @role    Pure formatting coverage for the extension post import workflow.
 * @deps    vitest and extension-post-import-service.
 * @gotcha  Generated markers may change, but content after them belongs to the user.
 */

import { describe, expect, it } from "vitest";

import { mergePostMarkdown } from "./extension-post-import-service";
import type { ResolvedTwitterPost } from "./twitter-post-resolver";

const post: ResolvedTwitterPost = {
  platform: "x",
  postId: "2075123908790165888",
  canonicalUrl: "https://x.com/example/status/2075123908790165888",
  text: "Updated post text",
  authorName: "Example",
  authorHandle: "example",
  authorAvatarUrl: "https://pbs.twimg.com/profile_images/123/example_normal.jpg",
  publishedAt: new Date("2026-07-09T07:44:28.000Z"),
  capturedAt: new Date("2026-07-10T00:00:00.000Z"),
  media: [],
  warnings: [],
};

describe("extension post markdown", () => {
  it("preserves unknown frontmatter and notes while replacing generated content", () => {
    const existing = `---
type: x-post
post_id: "2075123908790165888"
custom_field: keep-me
---

<!-- post:generated:start -->
Old generated text
<!-- post:generated:end -->

## Notes

My private note.
`;

    const result = mergePostMarkdown(existing, post, "assets/web-clips/posts/post.md", [], []);

    expect(result).toContain("custom_field: keep-me");
    expect(result).toContain("Updated post text");
    expect(result).not.toContain("Old generated text");
    expect(result).toContain("My private note.");
    expect(result).toContain("capture_status: complete");
    expect(result).toContain(
      "author_avatar_url: https://pbs.twimg.com/profile_images/123/example_normal.jpg",
    );
  });

  it("records partial capture warnings in frontmatter and generated content", () => {
    const result = mergePostMarkdown(
      undefined,
      post,
      "assets/web-clips/posts/post.md",
      [],
      ["Video download failed"],
    );

    expect(result).toContain("capture_status: partial");
    expect(result).toContain("## Capture Warnings");
    expect(result).toContain("Video download failed");
    expect(result).toContain("## Notes");
  });

  it("writes direct media as renderable Markdown image and video nodes", () => {
    const result = mergePostMarkdown(
      undefined,
      post,
      "assets/web-clips/posts/post.md",
      [
        {
          kind: "image",
          assetId: "image-1",
          relativePath: "assets/web-clips/media/post-1.jpg",
          sourceUrl: "https://pbs.twimg.com/media/post-1.jpg",
        },
        {
          kind: "video",
          assetId: "video-1",
          relativePath: "assets/web-clips/media/post-2.mp4",
          sourceUrl: "https://video.twimg.com/post-2.mp4",
        },
      ],
      [],
    );

    expect(result).toContain("![Post image](../media/post-1.jpg)");
    expect(result).toContain("[Post video](../media/post-2.mp4)");
    expect(result).not.toContain("Open local video");
  });
});
