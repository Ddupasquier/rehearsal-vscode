import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import type {
  ActivityData,
  BaselineData,
  CandidatesData,
  DoctorData,
  ExplainData,
  ResultEnvelope,
  ResourceInventoryData,
  StatusData,
  VersionResult,
} from "../src/contracts.js";
import {
  inspectProject,
  processSnapshotClient,
} from "../src/project_snapshot.js";
import type { SnapshotClient } from "../src/project_snapshot.js";

const envelope = <Data>(command: string, data: Data, status = "success") => ({
  result: {
    schemaVersion: 1,
    rehearsalVersion: "0.1.0-rc.4",
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
      version: "0.1.0-rc.4",
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
        application: {
          startCommand: "npm run dev",
          proofCommand: "npm test",
          readiness: {
            url: "http://localhost:5175/health",
            expectedStatus: 200,
            timeoutSeconds: 30,
          },
        },
        cleanup: { retainBaselineGenerations: 4 },
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
          verifiedRuntimeAvailable: true,
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

describe("workspace package compatibility", () => {
  it("reports an outdated manifest without executing its unsupported CLI", async () => {
    const workspaceRoot = await mkdtemp(
      resolve(tmpdir(), "rehearsal-vscode-outdated-"),
    );
    try {
      const packageRoot = resolve(
        workspaceRoot,
        "node_modules/@rehearsal-db/core",
      );
      await mkdir(resolve(workspaceRoot, ".git"));
      await mkdir(packageRoot, { recursive: true });
      await writeFile(
        resolve(packageRoot, "package.json"),
        JSON.stringify({
          name: "@rehearsal-db/core",
          version: "0.1.0-rc.2",
          bin: { rehearsal: "cli.mjs" },
        }),
      );
      await writeFile(
        resolve(packageRoot, "cli.mjs"),
        'throw new Error("The outdated CLI must not execute.");\n',
      );

      await expect(
        processSnapshotClient.version(workspaceRoot),
      ).resolves.toMatchObject({
        name: "@rehearsal-db/core",
        version: "0.1.0-rc.2",
        packageLocation: "node_modules/@rehearsal-db/core",
      });
    } finally {
      await rm(workspaceRoot, { recursive: true, force: true });
    }
  });
});

describe("project overview", () => {
  it("checks activity after every detailed query has completed, not concurrently with them", async () => {
    const stable = client();
    let activityCalls = 0;
    let detailsCompleted = false;
    const result = await inspectProject({
      workspaceName: "fixture",
      workspaceRoot: "/workspace",
      trusted: true,
      client: {
        ...stable,
        command: async <Data>(
          options: Parameters<SnapshotClient["command"]>[0],
        ) => {
          if (options.expectedCommand === "inspect baseline") {
            await new Promise<void>((resolve) => queueMicrotask(resolve));
            detailsCompleted = true;
          }
          if (options.expectedCommand === "activity") {
            activityCalls++;
            if (activityCalls === 2) expect(detailsCompleted).toBe(true);
          }
          return stable.command<Data>(options);
        },
      },
    });
    expect(result.availability).toBe("ready");
    expect(result.compatibility?.state).toBe("supported");
    expect(activityCalls).toBe(2);
    expect(result.inspectedAt).toMatch(/^\d{4}-/u);
  });
  it("turns an old core package into an actionable update state without running it", async () => {
    let commandInvoked = false;
    const result = await inspectProject({
      workspaceName: "legacy-project",
      workspaceRoot: "/workspace",
      trusted: true,
      client: {
        async version() {
          return {
            name: "@rehearsal-db/core",
            version: "0.1.0-rc.2",
            packageLocation: "node_modules/@rehearsal-db/core",
          };
        },
        async command() {
          commandInvoked = true;
          throw new Error("must not run an incompatible CLI");
        },
      },
    });

    expect(commandInvoked).toBe(false);
    expect(result).toMatchObject({
      availability: "package_outdated",
      version: "0.1.0-rc.2",
      compatibility: {
        state: "outdated",
        minimumVersion: "0.1.0-rc.4",
      },
      error: { code: "package_outdated" },
    });
  });

  it("loads the versioned core discovery profile when the package declares it", async () => {
    const base = client();
    const profile = {
      schemaVersion: 1 as const,
      project: { name: "fixture", packageManifest: "present" as const },
      detected: [],
      suggested: [],
      decisions: [],
      configuration: {
        state: "present_unvalidated" as const,
        activePath: "rehearsal.config.mjs",
        discoveredPaths: ["rehearsal.config.mjs"],
        fields: [],
      },
      safety: {
        projectCodeExecuted: false as const,
        environmentFilesRead: false as const,
        databaseContacted: false as const,
        containerEngineStarted: false as const,
      },
    };
    const observed: string[] = [];
    const result = await inspectProject({
      workspaceName: "fixture",
      workspaceRoot: "/workspace",
      trusted: true,
      client: {
        ...base,
        version: async () => ({
          name: "@rehearsal-db/core",
          version: "0.1.0-rc.4",
          packageLocation: "node_modules/@rehearsal-db/core",
          projectDiscoverySchema: 1,
        }),
        command: async <Data>(
          options: Parameters<SnapshotClient["command"]>[0],
        ): Promise<{ result: ResultEnvelope<Data>; exitCode: number }> => {
          observed.push(options.expectedCommand);
          if (options.expectedCommand === "discover") {
            return envelope("discover", profile) as {
              result: ResultEnvelope<Data>;
              exitCode: number;
            };
          }
          return base.command<Data>(options);
        },
      },
    });

    expect(observed).toContain("discover");
    expect(result.discovery).toEqual({ source: "core", profile });
  });

  it("keeps a safe bootstrap profile when the installed core predates discovery", async () => {
    const profile = {
      schemaVersion: 1 as const,
      project: { name: "fixture", packageManifest: "present" as const },
      detected: [],
      suggested: [],
      decisions: [],
      configuration: {
        state: "missing" as const,
        activePath: null,
        discoveredPaths: [],
        fields: [],
      },
      safety: {
        projectCodeExecuted: false as const,
        environmentFilesRead: false as const,
        databaseContacted: false as const,
        containerEngineStarted: false as const,
      },
    };
    const result = await inspectProject({
      workspaceName: "fixture",
      workspaceRoot: "/workspace",
      trusted: true,
      bootstrapDiscovery: profile,
      client: client(),
    });

    expect(result.discovery).toEqual({ source: "bootstrap", profile });
  });

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
      version: "0.1.0-rc.4",
      compatibility: { state: "supported" },
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
      version: "0.1.0-rc.4",
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
            verifiedRuntimeAvailable: true,
            endpoint: null,
          },
        ],
      },
      applicationUrl: "http://localhost:5175",
      configuration: {
        application: {
          startCommand: "npm run dev",
          proofCommand: "npm test",
          readinessUrl: "http://localhost:5175/health",
        },
        cleanup: { retainBaselineGenerations: 4 },
      },
    });
  });

  it("loads resource inventory only through the declared core contract", async () => {
    const base = client();
    const inventory: ResourceInventoryData = {
      schemaVersion: 1,
      inspectedAt: "2026-10-12T00:00:00.000Z",
      engine: {
        state: "running",
        context: "colima",
        disk: {
          backend: "colima",
          totalBytes: 100,
          usedBytes: 80,
          availableBytes: 20,
          usedPercent: 80,
        },
        resources: [],
      },
      environments: [
        {
          target: "primary",
          projectId: "fixture-rehearsal",
          provider: "postgresql",
          configPath: "/workspace/rehearsal.config.mjs",
          state: "stopped",
          containerCount: 1,
          runningContainerCount: 0,
          volumeCount: 1,
          diskUsageBytes: 1_500_000_000,
          cpuPercent: null,
          memoryUsageBytes: null,
          memoryLimitBytes: null,
          createdAt: "2026-10-11T00:00:00Z",
          lastActivityAt: "2026-10-11T00:00:00Z",
          retention: "persistent",
          cleanupEligibility: "preview-required",
          restartPolicies: ["no"],
        },
      ],
      stale: { stoppedCount: 1, digest: "b".repeat(64), targets: ["primary"] },
    };
    const observed: string[] = [];
    const result = await inspectProject({
      workspaceName: "fixture",
      workspaceRoot: "/workspace",
      trusted: true,
      client: {
        ...base,
        version: async () => ({
          name: "@rehearsal-db/core",
          version: "0.1.0-rc.4",
          packageLocation: "node_modules/@rehearsal-db/core",
          resourceInventorySchema: 1,
        }),
        command: async <Data>(
          options: Parameters<SnapshotClient["command"]>[0],
        ) => {
          observed.push(options.expectedCommand);
          if (options.expectedCommand === "environments") {
            return envelope("environments", inventory) as {
              result: ResultEnvelope<Data>;
              exitCode: number;
            };
          }
          return base.command<Data>(options);
        },
      },
    });
    expect(observed).toContain("environments");
    expect(result.resources).toEqual(inventory);
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
            rehearsalVersion: "0.1.0-rc.4",
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
                    rehearsalVersion: "0.1.0-rc.4",
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
              rehearsalVersion: "0.1.0-rc.4",
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

  it("preserves package identity and safe discovery when an inspection times out", async () => {
    const profile = {
      schemaVersion: 1 as const,
      project: { name: "fixture", packageManifest: "present" as const },
      detected: [],
      suggested: [],
      decisions: [],
      configuration: {
        state: "missing" as const,
        activePath: null,
        discoveredPaths: [],
        fields: [],
      },
      safety: {
        projectCodeExecuted: false as const,
        environmentFilesRead: false as const,
        databaseContacted: false as const,
        containerEngineStarted: false as const,
      },
    };
    const { AdapterError } = await import("../src/process_adapter.js");
    const base = client();
    const result = await inspectProject({
      workspaceName: "fixture",
      workspaceRoot: "/workspace",
      trusted: true,
      bootstrapDiscovery: profile,
      client: {
        ...base,
        command: async (options) => {
          if (options.expectedCommand === "activity") {
            return base.command(options);
          }
          throw new AdapterError(
            "timeout",
            "The Rehearsal doctor check took longer than 90 seconds.",
          );
        },
      },
    });

    expect(result).toMatchObject({
      availability: "error",
      version: "0.1.0-rc.4",
      packageLocation: "node_modules/@rehearsal-db/core",
      discovery: { source: "bootstrap", profile },
      activity: { state: "idle", operation: null },
      error: {
        code: "timeout",
        suggestions: [
          "Retry the read-only inspection.",
          "Increase Rehearsal: Inspection Timeout Seconds for this workspace if the project needs longer.",
          "Run Rehearsal Doctor for a focused readiness check.",
        ],
      },
    });
  });
});
