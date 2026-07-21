/**
 * @purpose Verify user-triggered native requests report when Chrome must open the Post protocol.
 * @role    Node unit coverage for the Chrome Native Messaging host handoff policy.
 * @deps    node:test/assert and the native-host forwarding helper.
 * @gotcha  Only a confirmed unavailable production request may ask the extension to launch Post.
 */

import assert from "node:assert/strict";
import test from "node:test";

import { forwardToDesktop } from "./post-native-host.mjs";

const unavailable = {
  response: { ok: false, message: "Desktop unavailable" },
  failureKind: "unavailable",
};
test("asks Chrome to launch Desktop without replaying a user-triggered save", async () => {
  const sends = [];
  const response = await forwardToDesktop(
    "/tmp/post-prod.sqlite",
    { type: "post.post.save", appEnv: "prod", launchIfNeeded: true },
    { type: "extension.post.save" },
    {
      sendLocalIpc: async (_dbPath, message) => {
        sends.push(message);
        return unavailable;
      },
    },
  );

  assert.equal(sends.length, 1);
  assert.equal(response.ok, false);
  assert.equal(response.launchRequired, true);
  assert.equal(response.launchUrl, "post://extension/open");
});

test("does not request launch for background context refresh", async () => {
  const response = await forwardToDesktop(
    "/tmp/post-prod.sqlite",
    { type: "post.context.get", appEnv: "prod", launchIfNeeded: false },
    { type: "extension.context.get" },
    {
      sendLocalIpc: async () => unavailable,
    },
  );

  assert.equal(response.ok, false);
  assert.equal(response.launchRequired, undefined);
});

test("requests launch for a context request opened by the bookmark popup", async () => {
  const response = await forwardToDesktop(
    "/tmp/post-prod.sqlite",
    { type: "post.context.get", appEnv: "prod", launchIfNeeded: true },
    { type: "extension.context.get" },
    {
      sendLocalIpc: async () => unavailable,
    },
  );

  assert.equal(response.launchRequired, true);
});

test("does not request launch or replay after a connected request times out", async () => {
  let sendCount = 0;
  const response = await forwardToDesktop(
    "/tmp/post-prod.sqlite",
    { type: "post.image.save", appEnv: "prod", launchIfNeeded: true },
    { type: "extension.image.save" },
    {
      sendLocalIpc: async () => {
        sendCount += 1;
        return {
          response: { ok: false, message: "Desktop did not respond" },
          failureKind: "request_failed",
        };
      },
    },
  );

  assert.equal(sendCount, 1);
  assert.equal(response.ok, false);
  assert.equal(response.launchRequired, undefined);
});

test("does not request a packaged-app launch for the dev channel", async () => {
  const response = await forwardToDesktop(
    "/tmp/post-dev.sqlite",
    { type: "post.image.save", appEnv: "dev", launchIfNeeded: true },
    { type: "extension.image.save" },
    { sendLocalIpc: async () => unavailable },
  );

  assert.equal(response.ok, false);
  assert.equal(response.launchRequired, undefined);
});
