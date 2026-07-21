/**
 * @purpose Verify X/Twitter thumbnail URLs resolve to the original Post photo variant.
 * @role    Focused unit coverage for direct extension image saves and Post media imports.
 * @deps    Vitest and twitter-image-url.
 * @gotcha  Rewrites are deliberately limited to the /media/ CDN namespace.
 */

import { describe, expect, it } from "vitest";

import { toOriginalTwitterImageUrl } from "./twitter-image-url";

describe("toOriginalTwitterImageUrl", () => {
  it("upgrades a modern X thumbnail URL to name=orig", () => {
    expect(
      toOriginalTwitterImageUrl("https://pbs.twimg.com/media/Example123?format=jpg&name=360x360"),
    ).toBe("https://pbs.twimg.com/media/Example123?format=jpg&name=orig");
  });

  it("moves a path extension into X's modern format parameter", () => {
    expect(toOriginalTwitterImageUrl("https://pbs.twimg.com/media/Example123.png?name=small")).toBe(
      "https://pbs.twimg.com/media/Example123?format=png&name=orig",
    );
  });

  it("upgrades X's deprecated colon size syntax", () => {
    expect(toOriginalTwitterImageUrl("https://pbs.twimg.com/media/Example123.jpg:large")).toBe(
      "https://pbs.twimg.com/media/Example123?format=jpg&name=orig",
    );
  });

  it("does not rewrite avatars, cards, or non-X images", () => {
    const urls = [
      "https://pbs.twimg.com/profile_images/123/avatar_normal.jpg",
      "https://pbs.twimg.com/card_img/123/card?format=jpg&name=small",
      "https://example.com/image.jpg?name=small",
    ];
    expect(urls.map(toOriginalTwitterImageUrl)).toEqual(urls);
  });
});
