/**
 * @purpose Verify subject-aware footer task title and pill label helpers.
 * @role    Pure unit coverage for buildTaskTitle / buildPillLabel thresholds.
 * @deps    vitest and task-labels.
 * @gotcha  Threshold is 2 names joined vs count-based many string; t stub keys must match i18n.
 */

import { describe, expect, it } from "vitest";

import { buildPillLabel, buildTaskTitle } from "./task-labels";

const t = (key: string, options?: Record<string, unknown>) => {
  if (key.startsWith("shell.taskSubjectMany.")) {
    return `${key}:${String(options?.count ?? "")}`;
  }
  if (key.startsWith("shell.pillRunningNamed.")) {
    return `${key}:${String(options?.name ?? "")}`;
  }
  if (key === "shell.taskRunning") {
    return `running:${String(options?.label ?? "")}`;
  }
  return key;
};

describe("task-labels", () => {
  it("joins one or two names and uses many copy at count 3+", () => {
    expect(
      buildTaskTitle({ type: "import", subject: { names: ["a.png"], count: 1 } }, t, "en"),
    ).toBe("a.png");
    expect(
      buildTaskTitle(
        { type: "import", subject: { names: ["a.png", "b.png"], count: 2 } },
        t,
        "zh-CN",
      ),
    ).toBe("a.png、b.png");
    expect(
      buildTaskTitle(
        { type: "thumbnails", subject: { names: ["a.png", "b.png", "c.png"], count: 3 } },
        t,
        "en",
      ),
    ).toBe("shell.taskSubjectMany.thumbnails:3");
  });

  it("falls back to task type when subject is missing", () => {
    expect(buildTaskTitle({ type: "sync" }, t, "en")).toBe("shell.taskType.sync");
  });

  it("builds pill labels for named and many subjects", () => {
    expect(
      buildPillLabel({ type: "import", subject: { names: ["clip.mp4"], count: 1 } }, t, "en"),
    ).toBe("shell.pillRunningNamed.import:clip.mp4");
    expect(
      buildPillLabel(
        { type: "thumbnails", subject: { names: ["a", "b", "c"], count: 20 } },
        t,
        "en",
      ),
    ).toBe("shell.taskSubjectMany.thumbnails:20");
  });
});
