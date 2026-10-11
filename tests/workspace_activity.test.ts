import { describe, expect, it } from "vitest";
import {
  activityStorageKey,
  normalizeActivityHistory,
} from "../src/workspace_activity.js";

describe("workspace activity", () => {
  it("keeps only bounded, structurally valid activity records", () => {
    const valid = Array.from({ length: 25 }, (_, index) => ({
      id: `run-${index}`,
      label: `Run ${index}`,
      startedAt: "2026-10-11T12:00:00.000Z",
      finishedAt: "2026-10-11T12:01:00.000Z",
      outcome: "completed",
      exitCode: 0,
    }));

    const result = normalizeActivityHistory([
      ...valid,
      null,
      { id: "bad", label: "Bad", startedAt: "nope", outcome: "failed" },
    ]);

    expect(result).toHaveLength(20);
    expect(result[0]).toMatchObject({ id: "run-0", outcome: "completed" });
    expect(result.at(-1)?.id).toBe("run-19");
  });

  it("does not expose the workspace path in its storage key", () => {
    expect(activityStorageKey("file:///private/project")).not.toContain(
      "private",
    );
  });
});
