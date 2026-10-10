import { describe, expect, it } from "vitest";
import type {
  ActivityData,
  BaselineData,
  CandidatesData,
  DoctorData,
  ExplainData,
  ResultEnvelope,
  StatusData,
  VersionResult,
} from "../src/contracts.js";
import { inspectProject } from "../src/project_snapshot.js";
import type { SnapshotClient } from "../src/project_snapshot.js";

const envelope = <Data>(command: string, data: Data, status = "success") => ({
  result: {
    schemaVersion: 1,
    rehearsalVersion: "0.1.0-rc.2",
    command,
    status,
    startedAt: "2026-10-09T00:00:00.000Z",
    durationMs: 1,
    warnings: [],
    data,
  } as ResultEnvelope<Data>,
  exitCode: status === "not_ready" ? 1 : 0,
});

const client = (
  doctorState: "READY" | "NOT READY" = "READY",
  activityState: ActivityData = {
    schemaVersion: 1,
    state: "idle",
    operation: null,
  },
  observedCommands?: string[],
): SnapshotClient => ({
  async version(): Promise<
    VersionResult & { readonly packageLocation: string }
  > {
    return {
      name: "@rehearsal-db/core",
      version: "0.1.0-rc.2",
      packageLocation: "node_modules/@rehearsal-db/core",
    };
  },
  async command<Data>({
    expectedCommand,
  }: Parameters<SnapshotClient["command"]>[0]) {
    observedCommands?.push(expectedCommand);
    const values: Record<string, unknown> = {
      activity: envelope<ActivityData>("activity", activityState),
      doctor: envelope<DoctorData>(
        "doctor",
        {
          state: doctorState,
          checks: [
            {
              id: "configuration",
              label: "Configuration",
              status: doctorState === "READY" ? "pass" : "fail",
              detail: doctorState,
            },
          ],
        },
        doctorState === "READY" ? "success" : "not_ready",
      ),
      explain: envelope<ExplainData>("explain", {
        config: {
          schemaVersion: 1,
          path: "/workspace/rehearsal.config.mjs",
          project: "fixture",
        },
        environment: {
          target: "postgresql",
          applicationUrl: "http://localhost:5175",
        },
      }),
      "inspect baseline": envelope<BaselineData>("inspect baseline", {
        generationId: "baseline-1",
        createdAt: "2026-10-09T00:00:00Z",
        migrationCutoff: "20261009000000",
        tableCount: 4,
        rowCount: 12,
        migrationCount: 2,
        verification: "checksums_verified",
      }),
      candidates: envelope<CandidatesData>("candidates", {
        baselineGenerationId: "baseline-1",
        candidateSha256: "a".repeat(64),
        candidateCount: 1,
        candidates: ["20261009000100_add_index.sql"],
        targets: [
          {
            name: "primary",
            configPath: "/workspace/rehearsal.config.mjs",
            candidateSha256: "a".repeat(64),
            candidateCount: 1,
            candidates: ["20261009000100_add_index.sql"],
          },
        ],
      }),
      status: envelope<StatusData>("status", {
        action: "status",
        target: "primary",
        durationMs: 1,
        runtimeStatus: {
          schemaVersion: 1,
          state: "stopped",
          reason: "runtime_not_running",
          runtimeTarget: "postgresql",
          projectId: "fixture-rehearsal",
          endpoint: null,
          baselineGenerationId: "baseline-1",
          candidateSha256: "a".repeat(64),
          candidates: ["20261009000100_add_index.sql"],
        },
      }),
    };
    return values[expectedCommand] as {
      result: ResultEnvelope<Data>;
      exitCode: number;
    };
  },
});

describe("project overview", () => {
  it("runs nothing for an untrusted workspace", async () => {
    let invoked = false;
    const blockedClient: SnapshotClient = {
      version: async () => {
        invoked = true;
        throw new Error("must not run");
      },
      command: async () => {
        invoked = true;
        throw new Error("must not run");
      },
    };
    const result = await inspectProject({
      workspaceName: "fixture",
      workspaceRoot: "/workspace",
      trusted: false,
      client: blockedClient,
    });
    expect(result.availability).toBe("untrusted");
    expect(invoked).toBe(false);
  });

  it("stops after doctor when a project is not ready", async () => {
    const result = await inspectProject({
      workspaceName: "fixture",
      workspaceRoot: "/workspace",
      trusted: true,
      client: client("NOT READY"),
    });
    expect(result).toMatchObject({
      availability: "not_ready",
      version: "0.1.0-rc.2",
      packageLocation: "node_modules/@rehearsal-db/core",
      activity: { state: "idle", operation: null },
      readiness: { state: "NOT READY", failed: 1 },
    });
    expect(result.baseline).toBeUndefined();
  });

  it("builds a safe ready overview from structured public contracts", async () => {
    const result = await inspectProject({
      workspaceName: "fixture",
      workspaceRoot: "/workspace",
      trusted: true,
      client: client(),
    });
    expect(result).toMatchObject({
      availability: "ready",
      version: "0.1.0-rc.2",
      activity: { state: "idle", operation: null },
      configPath: "rehearsal.config.mjs",
      baseline: { rowCount: 12, tableCount: 4 },
      candidates: { count: 1 },
      runtime: {
        state: "stopped",
        targets: [
          {
            name: "primary",
            state: "stopped",
            reason: "runtime_not_running",
            runtimeTarget: "postgresql",
            endpoint: null,
          },
        ],
      },
      applicationUrl: "http://localhost:5175",
    });
  });

  it("shows only safe operation activity while a mutation is active", async () => {
    const observedCommands: string[] = [];
    const result = await inspectProject({
      workspaceName: "fixture",
      workspaceRoot: "/workspace",
      trusted: true,
      client: client(
        "READY",
        {
          schemaVersion: 1,
          state: "busy",
          operation: {
            kind: "run",
            startedAt: "2026-10-10T00:00:00.000Z",
            rehearsalVersion: "0.1.0-rc.2",
          },
        },
        observedCommands,
      ),
    });

    expect(observedCommands).toEqual(["activity"]);
    expect(result).toMatchObject({
      availability: "operation_active",
      activity: { state: "busy", operation: { kind: "run" } },
    });
    expect(result.readiness).toBeUndefined();
    expect(result.runtime).toBeUndefined();
  });

  it("discards inspected details if an operation starts during refresh", async () => {
    const stable = client();
    let activityCalls = 0;
    const result = await inspectProject({
      workspaceName: "fixture",
      workspaceRoot: "/workspace",
      trusted: true,
      client: {
        ...stable,
        command: async <Data>(
          options: Parameters<SnapshotClient["command"]>[0],
        ): Promise<{ result: ResultEnvelope<Data>; exitCode: number }> => {
          if (options.expectedCommand !== "activity") {
            return stable.command<Data>(options);
          }
          activityCalls += 1;
          return envelope<ActivityData>(
            "activity",
            activityCalls === 1
              ? { schemaVersion: 1, state: "idle", operation: null }
              : {
                  schemaVersion: 1,
                  state: "busy",
                  operation: {
                    kind: "run",
                    startedAt: "2026-10-10T00:00:00.000Z",
                    rehearsalVersion: "0.1.0-rc.2",
                  },
                },
          ) as { result: ResultEnvelope<Data>; exitCode: number };
        },
      },
    });

    expect(activityCalls).toBe(2);
    expect(result).toMatchObject({
      availability: "operation_active",
      activity: { state: "busy", operation: { kind: "run" } },
    });
    expect(result.baseline).toBeUndefined();
    expect(result.candidates).toBeUndefined();
    expect(result.runtime).toBeUndefined();
  });

  it("keeps independent workspace results separate", async () => {
    const [first, second] = await Promise.all([
      inspectProject({
        workspaceName: "first",
        workspaceRoot: "/workspace",
        trusted: true,
        client: client(),
      }),
      inspectProject({
        workspaceName: "second",
        workspaceRoot: "/other",
        trusted: true,
        client: client("NOT READY"),
      }),
    ]);
    expect(first.workspaceName).toBe("first");
    expect(first.availability).toBe("ready");
    expect(second.workspaceName).toBe("second");
    expect(second.availability).toBe("not_ready");
  });

  it("fails closed when the installed package changes during refresh", async () => {
    const changing = client();
    const result = await inspectProject({
      workspaceName: "fixture",
      workspaceRoot: "/workspace",
      trusted: true,
      client: {
        ...changing,
        command: async <Data>(
          options: Parameters<SnapshotClient["command"]>[0],
        ): Promise<{ result: ResultEnvelope<Data>; exitCode: number }> => {
          const execution = await changing.command<Data>(options);
          return {
            ...execution,
            result: {
              ...execution.result,
              rehearsalVersion: "0.2.0",
            },
          };
        },
      },
    });
    expect(result).toMatchObject({
      availability: "error",
      error: { code: "invalid_cli_contract" },
    });
  });

  it("returns safe package diagnostics for a malformed config", async () => {
    const broken = client();
    const result = await inspectProject({
      workspaceName: "fixture",
      workspaceRoot: "/workspace",
      trusted: true,
      client: {
        ...broken,
        command: async () => {
          const { RehearsalCliError } =
            await import("../src/process_adapter.js");
          throw new RehearsalCliError(
            {
              schemaVersion: 1,
              rehearsalVersion: "0.1.0-rc.2",
              status: "error",
              error: {
                category: "configuration_invalid",
                code: "CONFIGURATION_INVALID",
                message: "The Rehearsal configuration is invalid.",
                suggestions: ["Run rehearsal doctor."],
                diagnosticId: "abc123",
              },
            },
            2,
          );
        },
      },
    });
    expect(result).toMatchObject({
      availability: "error",
      error: {
        code: "CONFIGURATION_INVALID",
        message: "The Rehearsal configuration is invalid.",
      },
    });
  });
});
