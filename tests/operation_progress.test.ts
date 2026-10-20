import { describe, expect, it } from "vitest";
import { parseActivityData } from "../src/contracts.js";
import {
  parseOperationProgressSnapshot,
  parseRecentOperationProgress,
  renderOperationProgress,
  openSandboxSessionState,
} from "../src/operation_progress.js";
import type { ProjectSnapshot } from "../src/project_snapshot.js";

const startedAt = "2026-10-13T22:59:00.000Z",
  updatedAt = "2026-10-13T23:00:00.000Z",
  phaseAt = "2026-10-13T22:59:30.000Z";
const progress = () => ({
  schemaVersion: 1,
  operationId: "a".repeat(64),
  state: "running",
  startedAt,
  updatedAt,
  elapsedMilliseconds: 60_000,
  currentStage: {
    id: 2,
    phase: "application-proof",
    target: "primary",
    state: "running",
    startedAt: phaseAt,
    endedAt: null,
    durationMilliseconds: 30_000,
  },
  completedStages: [
    {
      id: 1,
      phase: "runtime-lifecycle",
      target: "primary",
      state: "completed",
      startedAt,
      endedAt: phaseAt,
      durationMilliseconds: 30_000,
    },
  ],
  events: [
    {
      sequence: 1,
      code: "operation.started",
      phase: null,
      target: null,
      at: startedAt,
    },
    {
      sequence: 2,
      code: "stage.started",
      phase: "runtime-lifecycle",
      target: "primary",
      at: startedAt,
    },
    {
      sequence: 3,
      code: "stage.completed",
      phase: "runtime-lifecycle",
      target: "primary",
      at: phaseAt,
    },
    {
      sequence: 4,
      code: "stage.started",
      phase: "application-proof",
      target: "primary",
      at: phaseAt,
    },
  ],
  truncated: { stages: false, events: false },
});
const ended = (state: "completed" | "failed" | "cancelled" = "completed") => {
  const item = progress();
  return {
    ...item,
    state,
    currentStage:
      state === "completed"
        ? null
        : { ...item.currentStage, state, endedAt: updatedAt },
    completedStages:
      state === "completed"
        ? [
            ...item.completedStages,
            { ...item.currentStage, state: "completed", endedAt: updatedAt },
          ]
        : item.completedStages,
    events: [
      ...item.events,
      {
        sequence: 5,
        code: `stage.${state}`,
        phase: "application-proof",
        target: "primary",
        at: updatedAt,
      },
      {
        sequence: 6,
        code: `operation.${state}`,
        phase: null,
        target: null,
        at: updatedAt,
      },
    ],
  };
};
const snapshot = (activity: unknown): ProjectSnapshot => ({
  workspaceName: "sample",
  workspaceRoot: "/private/sample",
  availability: "operation_active",
  activity: parseActivityData(activity),
});
describe("safe native operation progress", () => {
  it("distinguishes a proved interactive session from startup, missing evidence and cleanup", () => {
    const activity = {
      schemaVersion: 1,
      state: "busy",
      operation: {
        kind: "open",
        startedAt,
        rehearsalVersion: "1.0.0",
        progress: progress(),
      },
    };
    expect(openSandboxSessionState(snapshot(activity))).toBe("opening");
    const interactive = snapshot({
      ...activity,
      operation: {
        ...activity.operation,
        progress: {
          ...progress(),
          currentStage: {
            ...progress().currentStage,
            phase: "interactive-session",
          },
        },
      },
    });
    expect(openSandboxSessionState(interactive)).toBe("interactive");
    expect(
      openSandboxSessionState({ ...interactive, availability: "error" }),
    ).toBeNull();
    expect(
      openSandboxSessionState(snapshot({ ...activity, state: "stale" })),
    ).toBeNull();
    expect(
      openSandboxSessionState(
        snapshot({
          ...activity,
          operation: { ...activity.operation, kind: "run" },
        }),
      ),
    ).toBeNull();
    for (const missing of [null, undefined])
      expect(
        openSandboxSessionState(
          snapshot({
            ...activity,
            operation: { ...activity.operation, progress: missing },
          }),
        ),
      ).toBe("unknown");
    expect(
      openSandboxSessionState(
        snapshot({
          ...activity,
          operation: { ...activity.operation, progress: ended() },
        }),
      ),
    ).toBe("closing");
    expect(
      openSandboxSessionState(
        snapshot({
          ...activity,
          operation: {
            ...activity.operation,
            progress: {
              ...progress(),
              currentStage: { ...progress().currentStage, phase: "cleanup" },
            },
          },
        }),
      ),
    ).toBe("closing");
  });
  it("preserves exact bounded phases/events/timings and supports completed, failed and cancelled receipts", () => {
    const item = parseOperationProgressSnapshot(progress());
    expect(item.currentStage?.phase).toBe("application-proof");
    expect(item.elapsedMilliseconds).toBe(60_000);
    expect(item.completedStages).toHaveLength(1);
    for (const state of ["completed", "failed", "cancelled"] as const)
      expect(parseOperationProgressSnapshot(ended(state)).state).toBe(state);
  });
  it("never accepts arbitrary log/error/credential text or unsafe event/target values", () => {
    for (const value of [
      { ...progress(), logs: "PRIVATE_CANARY" },
      {
        ...progress(),
        currentStage: { ...progress().currentStage, error: "PRIVATE_CANARY" },
      },
      {
        ...progress(),
        events: [{ ...progress().events[0], message: "PRIVATE_CANARY" }],
      },
      {
        ...progress(),
        currentStage: {
          ...progress().currentStage,
          target: "https://production.example",
        },
      },
      {
        ...progress(),
        currentStage: {
          ...progress().currentStage,
          phase: "raw-provider-error",
        },
      },
    ])
      expect(() => parseOperationProgressSnapshot(value)).toThrow();
    try {
      parseOperationProgressSnapshot({ ...progress(), logs: "PRIVATE_CANARY" });
    } catch (error) {
      expect((error as Error).message).not.toContain("PRIVATE_CANARY");
    }
  });
  it("refuses oversized arrays, negative/nonfinite durations, duplicate stage IDs and out-of-order events", () => {
    const controls = [
      {
        ...progress(),
        events: Array.from({ length: 41 }, () => progress().events[0]),
      },
      {
        ...progress(),
        completedStages: Array.from(
          { length: 21 },
          () => progress().completedStages[0],
        ),
      },
      { ...progress(), elapsedMilliseconds: -1 },
      { ...progress(), elapsedMilliseconds: Infinity },
      {
        ...progress(),
        completedStages: [
          ...progress().completedStages,
          ...progress().completedStages,
        ],
      },
      { ...progress(), events: [...progress().events].reverse() },
    ];
    for (const value of controls)
      expect(() => parseOperationProgressSnapshot(value)).toThrow();
  });
  it("rejects fabricated success, current/history overlap, bad timestamps and contradictory operation events", () => {
    for (const value of [
      { ...progress(), state: "completed" },
      {
        ...progress(),
        completedStages: [
          { ...progress().currentStage, state: "failed", endedAt: updatedAt },
        ],
      },
      { ...progress(), currentStage: { ...progress().currentStage, id: 1 } },
      { ...progress(), updatedAt: "invalid" },
      {
        ...progress(),
        events: [{ ...progress().events[0], target: "primary" }],
      },
    ])
      expect(() => parseOperationProgressSnapshot(value)).toThrow();
    const completed = ended();
    completed.events[completed.events.length - 1]!.code = "operation.failed";
    expect(() => parseOperationProgressSnapshot(completed)).toThrow(
      /terminal event/u,
    );
  });
  it("preserves absent legacy progress and null unsafe-unavailable history without inventing stages", () => {
    const legacy = parseActivityData({
      schemaVersion: 1,
      state: "busy",
      operation: { kind: "run", startedAt, rehearsalVersion: "0.1.0-rc.4" },
    });
    expect(legacy.operation?.progress).toBeUndefined();
    expect(legacy.recent).toBeUndefined();
    expect(
      parseActivityData({
        schemaVersion: 1,
        state: "idle",
        operation: null,
        recent: null,
      }).recent,
    ).toBeNull();
    expect(parseRecentOperationProgress([])).toEqual([]);
  });
  it("binds progress start to owner but permits finishing telemetry while the lock is still busy", () => {
    const activity = {
      schemaVersion: 1,
      state: "busy",
      operation: {
        kind: "run",
        startedAt,
        rehearsalVersion: "0.1.0-rc.4",
        progress: progress(),
      },
      recent: [],
    };
    expect(parseActivityData(activity).operation?.progress?.state).toBe(
      "running",
    );
    expect(() =>
      parseActivityData({
        ...activity,
        operation: { ...activity.operation, startedAt: updatedAt },
      }),
    ).toThrow(/owner/u);
    const finishing = parseActivityData({
      ...activity,
      operation: { ...activity.operation, progress: ended() },
    });
    expect(finishing.operation?.progress?.state).toBe("completed");
    expect(
      renderOperationProgress({ ...snapshot(activity), activity: finishing }),
    ).toContain("Finishing");
  });
  it("refuses unfinished, duplicated, unsafe or oversized recent receipts", () => {
    const entry = {
      kind: "run",
      rehearsalVersion: "0.1.0-rc.4",
      progress: ended(),
    };
    expect(parseRecentOperationProgress([entry])).toHaveLength(1);
    for (const value of [
      [{ ...entry, progress: progress() }],
      [entry, entry],
      Array.from({ length: 21 }, () => entry),
      [{ ...entry, kind: "private-user@example.com" }],
      [{ ...entry, rehearsalVersion: "SECRET_TOKEN" }],
      [{ ...entry, error: "raw-error" }],
    ])
      expect(() => parseRecentOperationProgress(value)).toThrow();
  });
  it("renders target phases, elapsed snapshot times, truthful stage boundaries and static events", () => {
    const view = renderOperationProgress(
      snapshot({
        schemaVersion: 1,
        state: "busy",
        operation: {
          kind: "run",
          startedAt,
          rehearsalVersion: "0.1.0-rc.4",
          progress: progress(),
        },
        recent: [],
      }),
    );
    expect(view).toContain("Running the application proof");
    expect(view).toContain("1m 0s");
    expect(view).toContain("primary");
    expect(view).toContain('aria-live="polite"');
    expect(view).toContain("Safe structured events");
    expect(view).toContain("manual checks need separate observed proof");
    expect(view).not.toContain("/private/sample");
  });
  it("labels a ready interactive sandbox and keeps duration ticks outside live announcements", () => {
    const render = (elapsedMilliseconds: number) =>
      renderOperationProgress(
        snapshot({
          schemaVersion: 1,
          state: "busy",
          operation: {
            kind: "open",
            startedAt,
            rehearsalVersion: "0.1.0-rc.4",
            progress: {
              ...progress(),
              elapsedMilliseconds,
              currentStage: {
                ...progress().currentStage!,
                phase: "interactive-session",
              },
            },
          },
          recent: [],
        }),
      );
    const before = render(60000),
      after = render(62000);
    expect(before).toContain("Sandbox open");
    expect(before).toContain("stays open until you close it");
    const announcement = /<p role="status"[^>]*>(.*?)<\/p>/u;
    expect(before.match(announcement)?.[1]).toBe(
      after.match(announcement)?.[1],
    );
    expect(before.match(announcement)?.[1]).not.toContain("Elapsed");
    expect(before).not.toBe(after);
  });
  it("shows actionable unavailable/legacy/stale guidance without claiming an orphan is running", () => {
    const legacy = renderOperationProgress(
      snapshot({
        schemaVersion: 1,
        state: "busy",
        operation: { kind: "run", startedAt, rehearsalVersion: null },
      }),
    );
    expect(legacy).toContain("owning terminal");
    expect(legacy).toContain("does not expose phase progress");
    const unavailable = renderOperationProgress(
      snapshot({
        schemaVersion: 1,
        state: "idle",
        operation: null,
        recent: null,
      }),
    );
    expect(unavailable).toContain("could not be safely read");
    expect(unavailable).toContain("Doctor");
    const stale = renderOperationProgress(
      snapshot({
        schemaVersion: 1,
        state: "stale",
        operation: {
          kind: "run",
          startedAt,
          rehearsalVersion: null,
          progress: progress(),
        },
        recent: [],
      }),
    );
    expect(stale).toContain("historical, not a claim");
    expect(stale).toContain("Last recorded phase");
  });
  it("limits display to safe terminal receipts and explains truncation rather than claiming complete history", () => {
    const item = ended();
    item.truncated = { stages: true, events: true };
    const view = renderOperationProgress(
      snapshot({
        schemaVersion: 1,
        state: "idle",
        operation: null,
        recent: [
          { kind: "run", rehearsalVersion: "0.1.0-rc.4", progress: item },
        ],
      }),
    );
    expect(view).toContain("earlier stages omitted");
    expect(view).toContain("earlier events omitted");
    expect(view).toContain("does not grant process ownership");
  });
});
