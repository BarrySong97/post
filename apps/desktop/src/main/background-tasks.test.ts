/**
 * @purpose Verify background task subject/retry and rolling completed digest behavior.
 * @role    Unit coverage for BackgroundTaskManager snapshot fields used by the footer.
 * @deps    vitest, background-tasks, electron mock.
 * @gotcha  Use fake timers for the 30-minute digest TTL window.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { backgroundTaskManager } from "./background-tasks";

describe("backgroundTaskManager subject and digest", () => {
  beforeEach(() => {
    backgroundTaskManager.resetForTests();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-13T12:00:00.000Z"));
  });

  afterEach(() => {
    backgroundTaskManager.resetForTests();
    vi.useRealTimers();
  });

  it("includes subject and retry on snapshot tasks", () => {
    const task = backgroundTaskManager.createTask({
      type: "thumbnails",
      title: "Generating thumbnails",
      subject: { names: ["a.png", "b.png"], count: 2 },
      retry: { kind: "thumbnails", assetIds: ["a", "b"] },
    });
    backgroundTaskManager.startTask(task.id);

    const snapshot = backgroundTaskManager.getSnapshot();
    expect(snapshot.running[0]?.subject).toEqual({ names: ["a.png", "b.png"], count: 2 });
    expect(snapshot.running[0]?.retry).toEqual({ kind: "thumbnails", assetIds: ["a", "b"] });
  });

  it("records completed digest and skips hidden tasks", () => {
    const visible = backgroundTaskManager.createTask({
      type: "thumbnails",
      title: "Generating thumbnails",
      progress: { current: 3, total: 3 },
    });
    backgroundTaskManager.startTask(visible.id);
    backgroundTaskManager.completeTask(visible.id, "done");

    const hidden = backgroundTaskManager.createTask({
      type: "import",
      title: "hidden",
      hidden: true,
      progress: { current: 1, total: 1 },
    });
    backgroundTaskManager.startTask(hidden.id);
    backgroundTaskManager.completeTask(hidden.id, "hidden done");

    const snapshot = backgroundTaskManager.getSnapshot();
    expect(snapshot.completedDigest).toEqual([
      {
        type: "thumbnails",
        taskCount: 1,
        itemCount: 3,
        lastCompletedAt: Date.now(),
      },
    ]);
  });

  it("keeps digest counts after recentlyCompleted prune and drops after 30m", () => {
    for (let index = 0; index < 12; index += 1) {
      const task = backgroundTaskManager.createTask({
        type: "thumbnails",
        title: "Generating thumbnails",
        progress: { current: 1, total: 1 },
      });
      backgroundTaskManager.startTask(task.id);
      backgroundTaskManager.completeTask(task.id, "done");
      vi.setSystemTime(Date.now() + 1_000);
    }

    let snapshot = backgroundTaskManager.getSnapshot();
    expect(snapshot.recentlyCompleted.length).toBeLessThanOrEqual(10);
    expect(snapshot.completedDigest[0]).toMatchObject({
      type: "thumbnails",
      taskCount: 12,
      itemCount: 12,
    });

    vi.setSystemTime(Date.now() + 31 * 60 * 1000);
    snapshot = backgroundTaskManager.getSnapshot();
    expect(snapshot.completedDigest).toEqual([]);
  });
});
