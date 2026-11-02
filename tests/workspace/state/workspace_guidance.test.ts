import { describe, expect, it } from "vitest";
import type { ProjectSnapshot } from "../../../src/workspace/inspection/project_snapshot.js";
import type { RecentOperationProgress } from "../../../src/runtime/operations/operation_progress.js";
import {
  journeyFor,
  sandboxSessionPresentation,
  statusFor,
  verifiedRuntimeState,
  type StatusTone,
} from "../../../src/workspace/state/workspace_guidance.js";

const snapshot = (
  overrides: Partial<ProjectSnapshot> = {},
): ProjectSnapshot => ({
  workspaceName: "Guidance fixture",
  workspaceRoot: "/guidance-fixture",
  availability: "ready",
  version: "2.2.0",
  configPath: "rehearsal.config.mjs",
  readiness: { state: "READY", passed: 1, failed: 0, checks: [] },
  activity: { schemaVersion: 1, state: "idle", operation: null },
  ...overrides,
});

const runtime = (
  available: boolean | null,
  running = false,
): NonNullable<ProjectSnapshot["runtime"]> => ({
  state: running ? "running" : "stopped",
  targets: [
    {
      name: "primary",
      state: running ? "running" : "stopped",
      reason: running ? null : "runtime_not_running",
      runtimeTarget: "postgresql",
      verifiedRuntimeAvailable: available,
      endpoint: running
        ? {
            kind: "postgresql",
            host: "127.0.0.1",
            port: 58322,
            database: "postgres",
          }
        : null,
    },
  ],
});

const completedRun = (proof: boolean): RecentOperationProgress => ({
  kind: "run",
  rehearsalVersion: "2.2.0",
  progress: {
    schemaVersion: 1,
    operationId: "a".repeat(32),
    state: "completed",
    startedAt: "2026-11-02T00:00:00.000Z",
    updatedAt: "2026-11-02T00:00:01.000Z",
    elapsedMilliseconds: 1000,
    currentStage: null,
    completedStages: proof
      ? [
          {
            id: 1,
            phase: "application-proof",
            target: "primary",
            state: "completed",
            startedAt: "2026-11-02T00:00:00.000Z",
            endedAt: "2026-11-02T00:00:01.000Z",
            durationMilliseconds: 1000,
          },
        ]
      : [],
    events: [],
    truncated: { stages: false, events: false },
  },
});

describe("dashboard guidance", () => {
  const unavailable: readonly [
    ProjectSnapshot["availability"],
    string,
    StatusTone,
  ][] = [
    ["loading", "Checking your project", "active"],
    ["not_ready", "Setup needs attention", "warning"],
    ["operation_attention", "Operation needs review", "warning"],
    ["untrusted", "Workspace Trust required", "warning"],
    ["package_missing", "Rehearsal is not installed", "muted"],
    ["package_outdated", "Rehearsal update required", "warning"],
    ["error", "Project check unavailable", "warning"],
  ];
  it.each(unavailable)(
    "keeps %s distinct from readiness or successful proof",
    (availability, label, tone) => {
      expect(statusFor(snapshot({ availability }))).toMatchObject({
        label,
        tone,
      });
    },
  );

  it("distinguishes absent runtime evidence, explicit missing runtimes and verified availability", () => {
    expect(verifiedRuntimeState(snapshot())).toBe("unknown");
    expect(verifiedRuntimeState(snapshot({ runtime: runtime(null) }))).toBe(
      "unknown",
    );
    expect(verifiedRuntimeState(snapshot({ runtime: runtime(false) }))).toBe(
      "missing",
    );
    expect(verifiedRuntimeState(snapshot({ runtime: runtime(true) }))).toBe(
      "available",
    );
    expect(
      verifiedRuntimeState(
        snapshot({
          runtime: {
            state: "mixed",
            targets: [
              ...runtime(null).targets,
              { ...runtime(false).targets[0]!, name: "publication" },
            ],
          },
        }),
      ),
    ).toBe("missing");
    expect(statusFor(snapshot({ runtime: runtime(null) })).label).toBe(
      "Sandbox state needs review",
    );
    expect(statusFor(snapshot({ runtime: runtime(false) })).label).toBe(
      "Ready to create a sandbox",
    );
  });

  it("requires readiness before reporting a create-sandbox next step", () => {
    expect(
      statusFor(
        snapshot({
          runtime: runtime(false),
          readiness: { state: "NOT READY", passed: 0, failed: 1, checks: [] },
        }),
      ),
    ).toMatchObject({
      label: "Project readiness needs review",
      tone: "warning",
    });
  });

  it("does not turn a running database or a completed run into recorded CLI proof", () => {
    const running = snapshot({ runtime: runtime(true, true) });
    expect(statusFor(running)).toMatchObject({
      label: "Database sandbox running",
      tone: "muted",
    });
    expect(
      journeyFor(running).find((step) => step.label === "Run")?.state,
    ).toBe("waiting");
    const withoutProof = snapshot({
      runtime: runtime(true, true),
      activity: {
        schemaVersion: 1,
        state: "idle",
        operation: null,
        recent: [completedRun(false)],
      },
    });
    expect(
      journeyFor(withoutProof).find((step) => step.label === "Run")?.state,
    ).toBe("done");
    expect(
      journeyFor(withoutProof).find((step) => step.label === "Verify")?.state,
    ).toBe("waiting");
    const withProof = snapshot({
      ...withoutProof,
      activity: {
        schemaVersion: 1,
        state: "idle",
        operation: null,
        recent: [completedRun(true)],
      },
    });
    expect(
      journeyFor(withProof).find((step) => step.label === "Verify"),
    ).toMatchObject({ value: "CLI proof passed (recorded)", state: "done" });
  });

  it("does not borrow old success while an open session lacks readiness evidence", () => {
    const active = snapshot({
      availability: "operation_active",
      activity: {
        schemaVersion: 1,
        state: "busy",
        operation: {
          kind: "open",
          startedAt: "2026-11-02T00:01:00.000Z",
          rehearsalVersion: "2.2.0",
        },
        recent: [completedRun(true)],
      },
    });
    expect(statusFor(active)).toMatchObject({
      label: "Sandbox session open",
      tone: "active",
    });
    expect(
      journeyFor(active).find((step) => step.label === "Verify"),
    ).toMatchObject({ value: "Inspection on hold", state: "waiting" });
    expect(sandboxSessionPresentation("unknown")?.detail).toContain(
      "not confirmed",
    );
    expect(sandboxSessionPresentation("interactive")?.label).toBe(
      "Sandbox running",
    );
    expect(sandboxSessionPresentation(null)).toBeNull();
  });
});
