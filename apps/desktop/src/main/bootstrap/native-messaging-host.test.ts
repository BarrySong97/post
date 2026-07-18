/**
 * @purpose Verify packaged Desktop keeps both Post extension channels authorized.
 * @role    Regression coverage for the Chrome Native Messaging host manifest builder.
 * @deps    Vitest and the native messaging host bootstrap module.
 * @gotcha  Opening the release app must never disconnect the unpacked Post Dev extension.
 */

import { describe, expect, it } from "vitest";

import { createNativeMessagingHostManifest } from "./native-messaging-host";

describe("native messaging host manifest", () => {
  it("allows both the release and Post Dev extension IDs", () => {
    expect(createNativeMessagingHostManifest("/tmp/com.post.desktop.sh")).toEqual({
      name: "com.post.desktop",
      description: "Post Desktop native messaging bridge",
      path: "/tmp/com.post.desktop.sh",
      type: "stdio",
      allowed_origins: [
        "chrome-extension://mdpiamelfbcdfglbodgnfdkilamgllae/",
        "chrome-extension://odafghdnmoniilcgnopfphmbodgojaoo/",
      ],
    });
  });
});
