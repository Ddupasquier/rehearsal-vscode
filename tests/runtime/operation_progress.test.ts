import { describe, expect, it } from "vitest";
import { parseActivityData } from "../../src/contracts.js";
import {
  parseOperationProgressSnapshot,
  parseRecentOperationProgress,
  renderOperationProgress,
  openSandboxSessionState,
} from "../../src/runtime/operation_progress.js";
import type { ProjectSnapshot } from "../../src/workspace/project_snapshot.js";
import { parseMigrationFailureDiagnostic } from "../../src/migrations/migration_failure.js";

const migrationDiagnostic = () => ({
  schemaVersion: 1,
  provider: "postgresql",
  classification: "constraint",
  sqlState: "23514",
  evidence: "provider_sqlstate",
  summary: "Rows do not satisfy a CHECK constraint.",
  suggestions: [
    "Existing rows may not satisfy the new constraint. Review and backfill incompatible rows before enforcing it; also check values written by the migration.",
    "No automatic SQL change or retry was performed. The failure itself does not prove rollback or cleanup; inspect runtime status before retrying.",
  ],
});

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
  it.each(["busy", "stale"])(
    "accepts a known impact measurement as %s activity without inventing runtime or proof stages",
    (state) => {
      const view = snapshot({
        schemaVersion: 1,
        state,
        operation: {
          kind: "measure impact",
          startedAt,
          rehearsalVersion: "1.2.0",
          progress: null,
        },
        recent: [],
      });
      expect(view.activity?.operation?.kind).toBe("measure impact");
      expect(view.activity?.operation?.progress).toBeNull();
      expect(openSandboxSessionState(view)).toBeNull();
      const html = renderOperationProgress(view);
      expect(html).toContain("measure impact</h2>");
      expect(html).toContain("Phase evidence is unavailable");
      expect(html).not.toContain("Running the application proof");
      expect(html).not.toContain("Preparing the local database runtime");
    },
  );

  it.each(["completed", "failed", "cancelled"] as const)(
    "retains a %s impact receipt during idle activity without relabeling it as a rehearsal",
    (state) => {
      const item = {
        kind: "measure impact",
        rehearsalVersion: "1.2.0",
        progress: {
          ...ended(state),
          currentStage: null,
          completedStages: [],
          events: [
            progress().events[0],
            {
              sequence: 2,
              code: `operation.${state}`,
              phase: null,
              target: null,
              at: updatedAt,
            },
          ],
        },
      };
      const view = snapshot({
        schemaVersion: 1,
        state: "idle",
        operation: null,
        recent: [item],
      });
      expect(view.activity?.recent).toEqual([item]);
      const html = renderOperationProgress(view);
      expect(html).toContain("measure impact</strong>");
      expect(html).toContain(
        state === "completed"
          ? "Completed"
          : state === "failed"
            ? "Failed"
            : "Cancelled",
      );
      expect(html).not.toContain(
        "Recent operation evidence could not be safely read",
      );
      expect(html).not.toContain("Running the application proof");
      expect(html).toContain(
        "A recorded stage or successful command is not a complete acceptance report",
      );
    },
  );

  it.each([
    "measure",
    "inspect impact",
    "Measure Impact",
    "measure impact --target=primary",
    "measure impact PRIVATE_CANARY",
  ])(
    "continues refusing unknown or argument-bearing activity kind %s",
    (kind) => {
      expect(() =>
        parseActivityData({
          schemaVersion: 1,
          state: "busy",
          operation: { kind, startedAt, rehearsalVersion: "1.2.0" },
        }),
      ).toThrow("Operation kind is unsupported.");
      expect(() =>
        parseActivityData({
          schemaVersion: 1,
          state: "idle",
          operation: null,
          recent: [{ kind, rehearsalVersion: "1.2.0", progress: ended() }],
        }),
      ).toThrow("Operation kind is unsupported.");
    },
  );

  it("renders an opaque exact-input link while keeping SQL line mapping unavailable", () => {
    const source = {
      schemaVersion: 1,
      kind: "candidate",
      filename: "20261020000100_broken_migration.sql",
      sha256: "b".repeat(64),
      workspaceRelativePath:
        "database/migrations/20261020000100_broken_migration.sql",
      line: null,
      column: null,
      evidence: "owned_execution_input",
    };
    const data = {
      schemaVersion: 1,
      state: "idle",
      operation: null,
      recent: [
        { kind: "run", rehearsalVersion: "1.0.2", progress: ended("failed") },
      ],
      recentFailures: [
        {
          operationId: progress().operationId,
          diagnostic: { ...migrationDiagnostic(), source },
        },
      ],
    };
    const activity = parseActivityData(data);
    expect(activity.recentFailures?.[0]?.diagnostic.source).toEqual(source);
    const html = renderOperationProgress(snapshot(activity));
    expect(html).toContain(
      `data-open-migration-failure="${progress().operationId}"`,
    );
    expect(html).toContain(source.filename);
    expect(html).toContain("Exact SQL line and column are unavailable");
    expect(html).not.toContain(source.workspaceRelativePath);
    const baseline = parseActivityData({
      ...data,
      recentFailures: [
        {
          ...data.recentFailures[0],
          diagnostic: {
            ...migrationDiagnostic(),
            source: {
              ...source,
              kind: "baseline",
              workspaceRelativePath: null,
            },
          },
        },
      ],
    });
    expect(renderOperationProgress(snapshot(baseline))).not.toContain(
      "data-open-migration-failure",
    );
    for (const invalid of [
      { ...source, line: 7 },
      { ...source, workspaceRelativePath: "../" + source.filename },
      { ...source, sql: "SECRET" },
    ])
      expect(() =>
        parseMigrationFailureDiagnostic({
          ...migrationDiagnostic(),
          source: invalid,
        }),
      ).toThrow();
  });
  it("joins fixed migration diagnosis only to its failed receipt and renders it after refresh", () => {
    const activity = parseActivityData({
      schemaVersion: 1,
      state: "idle",
      operation: null,
      recent: [
        { kind: "run", rehearsalVersion: "1.0.2", progress: ended("failed") },
      ],
      recentFailures: [
        {
          operationId: progress().operationId,
          diagnostic: migrationDiagnostic(),
        },
      ],
    });
    expect(activity.recentFailures?.[0]?.diagnostic.classification).toBe(
      "constraint",
    );
    const html = renderOperationProgress(snapshot(activity));
    expect(html).toContain("Rows do not satisfy a CHECK constraint.");
    expect(html).toContain("SQLSTATE 23514");
    expect(html).toContain("Existing rows may not satisfy the new constraint");
    expect(html).toContain("does not prove rollback or cleanup");
    expect(html).not.toContain("confirmed syntax error");
  });

  it("rejects free text, extra fields, mismatched classification and unbound or oversized failures", () => {
    const entry = {
      operationId: progress().operationId,
      diagnostic: migrationDiagnostic(),
    };
    const activity = {
      schemaVersion: 1,
      state: "idle",
      operation: null,
      recent: [
        { kind: "run", rehearsalVersion: "1.0.2", progress: ended("failed") },
      ],
    };
    for (const diagnostic of [
      { ...migrationDiagnostic(), summary: "<script>SECRET</script>" },
      { ...migrationDiagnostic(), suggestions: ["SECRET"] },
      { ...migrationDiagnostic(), sql: "SECRET" },
      { ...migrationDiagnostic(), classification: "syntax" },
      { ...migrationDiagnostic(), sqlState: "42601" },
      { ...migrationDiagnostic(), evidence: "unavailable" },
      { ...migrationDiagnostic(), provider: ["postgresql"] },
      { ...migrationDiagnostic(), provider: { toString: () => "postgresql" } },
    ])
      expect(() => parseMigrationFailureDiagnostic(diagnostic)).toThrow();
    for (const recentFailures of [
      [entry, entry],
      [{ ...entry, operationId: "b".repeat(64) }],
      [{ ...entry, secret: "SECRET" }],
      Array.from({ length: 21 }, () => entry),
    ])
      expect(() =>
        parseActivityData({ ...activity, recentFailures }),
      ).toThrow();
    for (const recent of [
      undefined,
      null,
      [],
      [{ ...activity.recent[0], progress: ended("completed") }],
    ])
      expect(() =>
        parseActivityData({ ...activity, recent, recentFailures: [entry] }),
      ).toThrow();
  });

  it("keeps absent and unavailable failure evidence distinct without changing legacy receipts", () => {
    const legacy = {
      schemaVersion: 1,
      state: "idle",
      operation: null,
      recent: [
        { kind: "run", rehearsalVersion: "1.0.0", progress: ended("failed") },
      ],
    };
    expect(parseActivityData(legacy)).not.toHaveProperty("recentFailures");
    expect(
      parseActivityData({ ...legacy, recentFailures: null }).recentFailures,
    ).toBeNull();
    expect(
      parseActivityData({ ...legacy, recentFailures: [] }).recentFailures,
    ).toEqual([]);
    expect(parseRecentOperationProgress(legacy.recent)?.[0]).not.toHaveProperty(
      "migrationFailure",
    );
  });

  it("keeps unknown and ambiguous provider evidence explicitly unclassified", () => {
    for (const evidence of ["unavailable", "ambiguous"]) {
      const diagnostic = parseMigrationFailureDiagnostic({
        schemaVersion: 1,
        provider: "supabase",
        classification: "unknown",
        sqlState: null,
        evidence,
        summary:
          "The failure could not be classified from recognized provider SQLSTATE evidence. It is not a confirmed syntax error.",
        suggestions: [
          "Review the exact candidate locally and its database requirements. Do not assume syntax, data or permissions are the cause.",
          migrationDiagnostic().suggestions[1],
        ],
      });
      expect(diagnostic.classification).toBe("unknown");
      expect(diagnostic.sqlState).toBeNull();
      expect(() =>
        parseMigrationFailureDiagnostic({
          ...diagnostic,
          evidence: [evidence],
        }),
      ).toThrow();
    }
  });
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
