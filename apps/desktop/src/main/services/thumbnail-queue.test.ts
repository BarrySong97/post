/**
 * @purpose Verify thumbnail queue drain/merge and busy retry behavior.
 * @role    Unit coverage for enqueueThumbnails coalescing used by watcher and extension import.
 * @deps    vitest with mocked runThumbnailTask / hasActiveTask / filter helpers.
 * @gotcha  Dispose the queue between tests so retry timers do not leak across cases.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const hasActiveTask = vi.fn();
const filterThumbnailAssetIdsNeedingWork = vi.fn();
const runThumbnailTask = vi.fn();

vi.mock("../background-tasks", () => ({
  backgroundTaskManager: {
    hasActiveTask: (...args: unknown[]) => hasActiveTask(...args),
  },
}));

vi.mock("./thumbnail-service", () => ({
  filterThumbnailAssetIdsNeedingWork: (...args: unknown[]) =>
    filterThumbnailAssetIdsNeedingWork(...args),
}));

vi.mock("../thumbnail-tasks", () => ({
  runThumbnailTask: (...args: unknown[]) => runThumbnailTask(...args),
}));

import {
  disposeThumbnailQueue,
  enqueueThumbnails,
  getThumbnailQueuePendingCountForTests,
  isThumbnailQueueRunningForTests,
} from "./thumbnail-queue";

const vault = { id: "vault-1", rootPath: "/tmp/vault", name: "Vault" };

describe("thumbnail-queue", () => {
  beforeEach(() => {
    disposeThumbnailQueue();
    hasActiveTask.mockReset();
    filterThumbnailAssetIdsNeedingWork.mockReset();
    runThumbnailTask.mockReset();
    hasActiveTask.mockReturnValue(false);
    filterThumbnailAssetIdsNeedingWork.mockImplementation(
      (_vault: unknown, assetIds: string[]) => assetIds,
    );
    vi.useFakeTimers();
  });

  afterEach(() => {
    disposeThumbnailQueue();
    vi.useRealTimers();
  });

  it("merges enqueues while a batch is running and drains afterwards", async () => {
    let resolveFirst!: () => void;
    runThumbnailTask.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          resolveFirst = resolve;
        }),
    );
    runThumbnailTask.mockResolvedValueOnce(undefined);

    enqueueThumbnails(vault, ["a", "b"]);
    expect(runThumbnailTask).toHaveBeenCalledTimes(1);
    expect(isThumbnailQueueRunningForTests(vault.id)).toBe(true);

    enqueueThumbnails(vault, ["b", "c"]);
    expect(getThumbnailQueuePendingCountForTests(vault.id)).toBe(2);
    expect(runThumbnailTask).toHaveBeenCalledTimes(1);

    resolveFirst();
    await Promise.resolve();
    await Promise.resolve();

    expect(runThumbnailTask).toHaveBeenCalledTimes(2);
    expect(runThumbnailTask.mock.calls[1]?.[1]).toEqual({
      assetIds: ["b", "c"],
      limit: 2,
    });
  });

  it("retries after 1s when a thumbnails task is already active", () => {
    hasActiveTask.mockReturnValue(true);
    runThumbnailTask.mockResolvedValue(undefined);
    enqueueThumbnails(vault, ["a"]);
    expect(runThumbnailTask).not.toHaveBeenCalled();

    hasActiveTask.mockReturnValue(false);
    vi.advanceTimersByTime(1000);
    expect(runThumbnailTask).toHaveBeenCalledTimes(1);
  });

  it("does not start work for an empty pending set after filter", () => {
    filterThumbnailAssetIdsNeedingWork.mockReturnValue([]);
    enqueueThumbnails(vault, ["a"]);
    expect(runThumbnailTask).not.toHaveBeenCalled();
  });
});
