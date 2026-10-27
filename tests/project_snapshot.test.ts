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
import { AdapterError, RehearsalCliError } from "../src/process_adapter.js";
import { knownWorkspaceTargets } from "../src/workspace_view_state.js";
import { insightPlan, insightReport } from "./migration_insights_fixture.js";
import { engineShutdownAvailable } from "../src/engine_lifecycle_view.js";
import { lifecycleStatus } from "./engine_lifecycle_fixture.js";

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

const partialConfiguration = {
  schemaVersion: 1,
  path: "rehearsal.config.mjs",
  sourceSha256: "a".repeat(64),
  fields: [],
  profiles: [],
  pathResolution: "Paths resolve from project root.",
  manualFields: "Sensitive settings require review.",
  patchContract: {
    schemaVersion: 1,
    input: "project-local-json-file",
    maximumBytes: 65536,
    writesConfiguration: false,
    executesProposedCommands: false,
    concurrentChanges: "refuse",
  },
};

const migrationPlan = () => ({
  schemaVersion: 1,
  candidateSha256: "a".repeat(64),
  candidateCount: 1,
  selection: "complete-ordered-suffix",
  safety: {
    readsSqlBodiesForSafety: false,
    executesSql: false,
    startsEngine: false,
  },
  targets: [
    {
      name: "primary",
      provider: "postgresql",
      baselineGenerationId: "baseline-1",
      candidateSha256: "a".repeat(64),
      entries: ["20261008000000", "20261009000000", "20261009000100"].map(
        (version, index) => ({
          id: `primary:${version}`,
          target: "primary",
          version,
          timestamp: version,
          name: index === 2 ? "add_index" : "history",
          filename: `${version}_${index === 2 ? "add_index" : "history"}.sql`,
          sha256: "c".repeat(64),
          order: index,
          status: index === 2 ? "candidate" : "represented_by_baseline",
          required: index === 2,
          dependsOn: index
            ? [`primary:${index === 1 ? "20261008000000" : "20261009000000"}`]
            : [],
          warnings: index === 2 ? ["sql_safety_not_inferred"] : [],
          selectionReason: "Complete exact ordered suffix.",
        }),
      ),
    },
  ],
});

describe("independent baseline scope provider consistency", () => {
  it.each(["postgresql", "supabase"] as const)(
    "keeps matching %s scope ready and refuses a contradictory inspection",
    async (provider) => {
      const base = client();
      const inspect = (
        scopeProvider: "postgresql" | "supabase",
        nestedPrimaryProvider?: "postgresql" | "supabase",
      ) =>
        inspectProject({
          workspaceName: "fixture",
          workspaceRoot: "/workspace",
          trusted: true,
          client: {
            ...base,
            command: async <Data>(
              options: Parameters<SnapshotClient["command"]>[0],
            ) => {
              if (options.expectedCommand === "explain") {
                const execution = await base.command<ExplainData>(options);
                return {
                  ...execution,
                  result: {
                    ...execution.result,
                    data: {
                      ...execution.result.data,
                      environment: {
                        ...execution.result.data.environment,
                        target: provider,
                      },
                      ...(nestedPrimaryProvider
                        ? {
                            targets: [
                              {
                                name: "primary",
                                plan: {
                                  ...execution.result.data,
                                  environment: {
                                    ...execution.result.data.environment,
                                    target: nestedPrimaryProvider,
                                  },
                                },
                              },
                            ],
                          }
                        : {}),
                    },
                  },
                } as { result: ResultEnvelope<Data>; exitCode: number };
              }
              if (options.expectedCommand === "inspect baseline") {
                const execution = await base.command<BaselineData>(options);
                return {
                  ...execution,
                  result: {
                    ...execution.result,
                    data: {
                      ...execution.result.data,
                      sanitizationPolicySha256: "a".repeat(64),
                      review: {
                        schemaVersion: 1,
                        provider: scopeProvider,
                        policy: {
                          version: 2,
                          sha256: "a".repeat(64),
                          state: "baseline-bound",
                        },
                        tables: [
                          {
                            schema: "public",
                            name: "widgets",
                            included: true,
                            rowCount: 12,
                            columnCount: 1,
                            relationshipCount: 0,
                            identityColumnCount: 0,
                            transformations: {
                              KEEP: 1,
                              PSEUDONYMIZE: 0,
                              REPLACE: 0,
                              EXCLUDE: 0,
                              DERIVE: 0,
                            },
                          },
                        ],
                        relationships: {
                          declaredCount: 0,
                          excludedReferenceCount: 0,
                          verification: "declared-not-runtime-verified",
                        },
                        storage: { assetCount: 0, bytes: 0, buckets: [] },
                        decisions: {
                          sourcePermission: "local-inputs-only",
                          identityHandling: "no-association-policy",
                          replacement: "separate-core-confirmation",
                        },
                        privacy: {
                          rowValuesIncluded: false,
                          credentialsIncluded: false,
                          sourceContacted: false,
                        },
                      },
                    },
                  },
                } as { result: ResultEnvelope<Data>; exitCode: number };
              }
              return base.command<Data>(options);
            },
          },
        });
      expect((await inspect(provider)).availability).toBe("ready");
      const contradictory = await inspect(
        provider === "postgresql" ? "supabase" : "postgresql",
      );
      expect(contradictory.availability).toBe("error");
      expect(contradictory.baseline).toBeUndefined();
      expect(contradictory.reviewTargets).toBeUndefined();
      const contradictoryNestedProvider =
        provider === "postgresql" ? "supabase" : "postgresql";
      const nested = await inspect(
        contradictoryNestedProvider,
        contradictoryNestedProvider,
      );
      expect(nested.availability).toBe("error");
      expect(nested.baseline).toBeUndefined();
      expect(nested.reviewTargets).toBeUndefined();
    },
  );
});

describe("optional Migration Insights inspection", () => {
  const inspect = async (change = "valid") => {
    const base = client(),
      commands: Parameters<SnapshotClient["command"]>[0][] = [];
    const snapshot = await inspectProject({
      workspaceName: "fixture",
      workspaceRoot: "/workspace",
      trusted: change !== "untrusted",
      client: {
        ...base,
        version: async (...args) => ({
          ...(await base.version(...args)),
          ...(change !== "missing-plan"
            ? { migrationReviewSchema: 1 as const }
            : {}),
          ...(change !== "absent"
            ? { migrationInsightsSchema: 1 as const }
            : {}),
        }),
        command: async <Data>(
          options: Parameters<SnapshotClient["command"]>[0],
        ) => {
          commands.push(options);
          if (options.expectedCommand === "inspect plan")
            return envelope("inspect plan", {
              ...insightPlan(),
              safety: {
                readsSqlBodiesForSafety: false,
                executesSql: false,
                startsEngine: false,
              },
            }) as { result: ResultEnvelope<Data>; exitCode: number };
          if (options.expectedCommand === "inspect insights") {
            if (change === "failed" || change === "oversize")
              throw new AdapterError(
                change === "oversize" ? "output_limit" : "timeout",
                "PRIVATE_PROVIDER_OUTPUT",
              );
            const raw = insightReport();
            if (change === "invalid") raw.safety.executesSql = true;
            if (change === "stale-hash")
              raw.targets[0]!.entries[0]!.sha256 = "e".repeat(64);
            if (change === "stale-digest") raw.candidateSha256 = "e".repeat(64);
            const result = envelope("inspect insights", raw);
            return (
              change === "version-drift"
                ? {
                    ...result,
                    result: { ...result.result, rehearsalVersion: "1.1.0" },
                  }
                : result
            ) as { result: ResultEnvelope<Data>; exitCode: number };
          }
          return base.command<Data>(options);
        },
      },
    });
    return { snapshot, commands };
  };
  it("reads bounded optional static evidence without changing ordinary ready controls", async () => {
    const { snapshot, commands } = await inspect();
    expect(snapshot.availability).toBe("ready");
    expect(snapshot.migrationInsights?.state).toBe("available");
    expect(
      commands.find((command) => command.expectedCommand === "inspect insights")
        ?.outputLimitBytes,
    ).toBe(8 * 1024 * 1024);
    expect(
      commands
        .filter((command) => command.expectedCommand !== "inspect insights")
        .every((command) => command.outputLimitBytes === undefined),
    ).toBe(true);
  });
  it.each(["absent", "missing-plan", "untrusted"])(
    "does not launch optional analysis when %s",
    async (change) => {
      const { snapshot, commands } = await inspect(change);
      expect(snapshot.migrationInsights).toBeUndefined();
      expect(
        commands.some(
          (command) => command.expectedCommand === "inspect insights",
        ),
      ).toBe(false);
    },
  );
  it.each(["failed", "oversize", "invalid", "stale-hash", "stale-digest"])(
    "keeps MVP controls ready while refusing %s optional evidence",
    async (change) => {
      const { snapshot } = await inspect(change);
      expect(snapshot.availability).toBe("ready");
      expect(snapshot.migrationReview).toBeDefined();
      expect(snapshot.migrationInsights).toEqual({ state: "unavailable" });
      expect(JSON.stringify(snapshot)).not.toContain("PRIVATE_PROVIDER_OUTPUT");
    },
  );
  it("does not hide an actual package version change as an optional warning failure", async () => {
    const { snapshot } = await inspect("version-drift");
    expect(snapshot.availability).toBe("error");
    expect(snapshot.migrationInsights).toBeUndefined();
    expect(snapshot.migrationReview).toBeUndefined();
  });
});

describe("simultaneous migration-plan inspection consistency", () => {
  const inspect = async (plan = migrationPlan()) => {
    const base = client();
    return inspectProject({
      workspaceName: "fixture",
      workspaceRoot: "/workspace",
      trusted: true,
      client: {
        ...base,
        version: async (...args) => ({
          ...(await base.version(...args)),
          migrationReviewSchema: 1,
        }),
        command: async <Data>(
          options: Parameters<SnapshotClient["command"]>[0],
        ) =>
          options.expectedCommand === "inspect plan"
            ? (envelope("inspect plan", plan) as {
                result: ResultEnvelope<Data>;
                exitCode: number;
              })
            : base.command<Data>(options),
      },
    });
  };
  it("keeps matching plan and legacy filename candidate views ready", async () => {
    const snapshot = await inspect();
    expect(snapshot.availability).toBe("ready");
    expect(snapshot.migrationReview?.candidateSha256).toBe(
      snapshot.candidates?.digest,
    );
  });
  it.each(["digest", "count", "target", "provider", "baseline"])(
    "fails closed when the simultaneous %s evidence disagrees",
    async (change) => {
      const plan = migrationPlan();
      if (change === "digest") plan.candidateSha256 = "b".repeat(64);
      else if (change === "count") {
        plan.candidateCount = 0;
        const entry = plan.targets[0]!.entries[2]!;
        entry.status = "applied_to_current_runtime";
        entry.required = false;
        entry.warnings = [];
      } else if (change === "target") {
        const target = plan.targets[0]!;
        target.name = "publication";
        for (const entry of target.entries) {
          entry.target = target.name;
          entry.id = entry.id.replace("primary:", "publication:");
          entry.dependsOn = entry.dependsOn.map((id) =>
            id.replace("primary:", "publication:"),
          );
        }
      } else if (change === "provider") plan.targets[0]!.provider = "supabase";
      else plan.targets[0]!.baselineGenerationId = "foreign-generation";
      const snapshot = await inspect(plan);
      expect(snapshot.availability).toBe("error");
      expect(snapshot.migrationReview).toBeUndefined();
      expect(snapshot.candidates).toBeUndefined();
      expect(snapshot.error?.message).not.toContain("foreign-generation");
    },
  );
});
const partialDiscovery = {
  schemaVersion: 1,
  project: { name: "fixture", packageManifest: "present" },
  detected: [],
  suggested: [],
  decisions: [],
  configuration: {
    state: "present_unvalidated",
    activePath: "rehearsal.config.mjs",
    discoveredPaths: ["rehearsal.config.mjs"],
    fields: [],
  },
  safety: {
    projectCodeExecuted: false,
    environmentFilesRead: false,
    databaseContacted: false,
    containerEngineStarted: false,
  },
};
const partialInventory = () => ({
  schemaVersion: 1,
  inspectedAt: "2026-10-15T12:00:00Z",
  engine: { state: "running", context: "default", disk: null, resources: [] },
  environments: [
    {
      target: "primary",
      projectId: "fixture-rehearsal",
      provider: "postgresql",
      configPath: "/workspace/rehearsal.config.mjs",
      state: "absent",
      containerCount: 0,
      runningContainerCount: 0,
      volumeCount: 0,
      diskUsageBytes: null,
      cpuPercent: null,
      memoryUsageBytes: null,
      memoryLimitBytes: null,
      createdAt: null,
      lastActivityAt: null,
      retention: "persistent",
      cleanupEligibility: "not-present",
      restartPolicies: [],
      classification: {
        schemaVersion: 1,
        role: "configured-environment",
        dataPersistence: "preserved-on-stop",
        presence: {
          state: "not-created",
          reason: "no-owned-resources-observed",
        },
        receipt: {
          state: "unknown",
          reason: "receipt-unavailable",
          scope: "format-and-provider-only",
        },
        review: {
          state: "disabled",
          reason: "cutoff-disabled",
          staleAfterSeconds: null,
          lastObservableActivityAt: null,
        },
      },
    },
  ],
  catalog: { schemaVersion: 1, images: [], volumes: [], otherContainers: [] },
  stale: { stoppedCount: 0, digest: null, targets: [] },
});
const partialClient = (
  options: {
    inventory?: unknown;
    metadata?: unknown;
    discovery?: unknown;
    details?: boolean;
    advertised?: boolean;
    inventoryVersion?: string;
    inventoryFailure?: Error;
    metadataStatus?: string;
    finalBusy?: boolean;
  } = {},
) => {
  const base = client("NOT READY");
  const calls: Parameters<SnapshotClient["command"]>[0][] = [];
  let activityCalls = 0;
  const fake: SnapshotClient = {
    ...base,
    version: async () => ({
      name: "@rehearsal-db/core",
      version: "0.1.0-rc.4",
      projectDiscoverySchema: 1,
      configurationReviewSchema: 1,
      ...(options.advertised === false
        ? {}
        : { resourceInventorySchema: 1 as const }),
      ...(options.details === false
        ? {}
        : { resourceManagerSchema: 1 as const }),
    }),
    command: async <Data>(
      request: Parameters<SnapshotClient["command"]>[0],
    ) => {
      calls.push(request);
      let execution;
      switch (request.expectedCommand) {
        case "discover":
          execution = envelope(
            "discover",
            options.discovery ?? partialDiscovery,
          );
          break;
        case "configuration":
          execution = envelope(
            "configuration",
            options.metadata ?? partialConfiguration,
            options.metadataStatus ?? "success",
          );
          break;
        case "doctor":
          execution = envelope(
            "doctor",
            {
              state: "NOT READY",
              checks: [
                {
                  id: "configuration",
                  label: "Configuration",
                  status: "pass",
                  detail: "Reviewed configuration is valid.",
                },
                {
                  id: "baseline",
                  label: "Verified baseline",
                  status: "fail",
                  detail:
                    "Create the reviewed baseline before starting a rehearsal.",
                  remediation: "Create the baseline.",
                },
              ],
            },
            "not_ready",
          );
          break;
        case "resources":
        case "environments":
          if (options.inventoryFailure) throw options.inventoryFailure;
          execution = envelope(
            request.expectedCommand,
            options.inventory ?? partialInventory(),
          );
          if (options.inventoryVersion)
            execution = {
              ...execution,
              result: {
                ...execution.result,
                rehearsalVersion: options.inventoryVersion,
              },
            };
          break;
        case "activity":
          activityCalls++;
          execution =
            activityCalls > 1 && options.finalBusy
              ? envelope("activity", {
                  schemaVersion: 1,
                  state: "busy",
                  operation: {
                    kind: "run",
                    startedAt: "2026-10-15T12:00:00Z",
                    rehearsalVersion: "0.1.0-rc.4",
                  },
                })
              : await base.command<Data>(request);
          break;
        default:
          throw new Error(
            "A not-ready inspection attempted a readiness-dependent or mutating command.",
          );
      }
      return execution as { result: ResultEnvelope<Data>; exitCode: number };
    },
  };
  return { fake, calls };
};

describe("not-ready configured environment inspection", () => {
  it("retains public resource choices for a valid configuration with no baseline, without inventing verified runtime state", async () => {
    const { fake, calls } = partialClient();
    const snapshot = await inspectProject({
      workspaceName: "Fresh",
      workspaceRoot: "/workspace",
      trusted: true,
      client: fake,
    });
    expect(snapshot).toMatchObject({
      availability: "not_ready",
      configPath: "rehearsal.config.mjs",
      readiness: { state: "NOT READY", passed: 1, failed: 1 },
      resources: {
        environments: [
          { target: "primary", provider: "postgresql", state: "absent" },
        ],
      },
    });
    expect(knownWorkspaceTargets(snapshot)).toEqual(["primary"]);
    expect(snapshot.runtime).toBeUndefined();
    expect(snapshot.baseline).toBeUndefined();
    expect(snapshot.candidates).toBeUndefined();
    expect(calls.map((call) => call.expectedCommand)).toEqual([
      "activity",
      "discover",
      "doctor",
      "configuration",
      "resources",
      "activity",
    ]);
    expect(
      calls.find((call) => call.expectedCommand === "resources")?.configPath,
    ).toBe("rehearsal.config.mjs");
    expect(snapshot.readiness?.checks[1]?.remediation).toBe(
      "Create the baseline.",
    );
  });
  it("keeps stopped-engine configured resources unknown rather than absent without starting it", async () => {
    const raw = partialInventory();
    const inventory = {
      ...raw,
      engine: { ...raw.engine, state: "stopped" },
      environments: raw.environments.map((entry) => ({
        ...entry,
        state: "unavailable",
        cleanupEligibility: "inspection-unavailable",
        classification: {
          ...entry.classification,
          presence: {
            state: "unknown",
            reason: "ownership-inspection-unavailable",
          },
          review: {
            state: "unknown",
            reason: "ownership-inspection-unavailable",
            staleAfterSeconds: null,
            lastObservableActivityAt: null,
          },
        },
      })),
      catalog: null,
    };
    const { fake, calls } = partialClient({ inventory });
    const snapshot = await inspectProject({
      workspaceName: "Stopped",
      workspaceRoot: "/workspace",
      trusted: true,
      client: fake,
    });
    expect(snapshot.availability).toBe("not_ready");
    expect(snapshot.resources).toMatchObject({
      engine: { state: "stopped" },
      environments: [{ state: "unavailable" }],
      catalog: null,
    });
    expect(knownWorkspaceTargets(snapshot)).toEqual(["primary"]);
    expect(
      calls.every((call) =>
        [
          "activity",
          "discover",
          "doctor",
          "configuration",
          "resources",
        ].includes(call.expectedCommand),
      ),
    ).toBe(true);
  });
  it("uses the advertised aggregate contract when individual-resource browsing is unsupported", async () => {
    const { fake, calls } = partialClient({ details: false });
    const snapshot = await inspectProject({
      workspaceName: "Aggregate",
      workspaceRoot: "/workspace",
      trusted: true,
      client: fake,
    });
    expect(snapshot.resources?.environments[0]?.target).toBe("primary");
    expect(calls.map((call) => call.expectedCommand)).toContain("environments");
    expect(calls.map((call) => call.expectedCommand)).not.toContain(
      "resources",
    );
  });
  it("does not inspect resources without validated active configuration and an advertised inventory contract", async () => {
    for (const options of [
      { advertised: false },
      { metadataStatus: "not_ready" },
      { metadata: { ...partialConfiguration, sourceSha256: "unsafe" } },
      { metadata: { ...partialConfiguration, path: "other.config.mjs" } },
      {
        discovery: {
          ...partialDiscovery,
          configuration: {
            ...partialDiscovery.configuration,
            activePath: null,
          },
        },
      },
    ]) {
      const { fake, calls } = partialClient(options);
      const snapshot = await inspectProject({
        workspaceName: "Unavailable",
        workspaceRoot: "/workspace",
        trusted: true,
        client: fake,
      });
      expect(snapshot.availability).toBe("not_ready");
      expect(snapshot.readiness?.failed).toBe(1);
      expect(snapshot.resources).toBeUndefined();
      expect(
        calls.some((call) =>
          ["resources", "environments"].includes(call.expectedCommand),
        ),
      ).toBe(false);
    }
  });
  it("refuses malformed/version-drifted inventory and keeps the original Doctor guidance", async () => {
    for (const options of [
      { inventory: { ...partialInventory(), schemaVersion: 2 } },
      { inventoryVersion: "9.9.9" },
      {
        inventoryFailure: new AdapterError(
          "timeout",
          "Read-only inventory timed out.",
        ),
      },
    ]) {
      const { fake, calls } = partialClient(options);
      const snapshot = await inspectProject({
        workspaceName: "Refused",
        workspaceRoot: "/workspace",
        trusted: true,
        client: fake,
      });
      expect(snapshot.availability).toBe("not_ready");
      expect(snapshot.readiness?.checks[1]?.detail).toBe(
        "Create the reviewed baseline before starting a rehearsal.",
      );
      expect(snapshot.resources).toBeUndefined();
      expect(calls.at(-1)?.expectedCommand).toBe("activity");
    }
  });
  it("does not bypass a detailed local-endpoint refusal through an aggregate command", async () => {
    const failure = new RehearsalCliError(
      {
        schemaVersion: 1,
        rehearsalVersion: "0.1.0-rc.4",
        status: "error",
        error: {
          category: "runtime_dependency_failure",
          code: "RUNTIME_DEPENDENCY_FAILURE",
          message: "The resource endpoint could not be verified.",
          suggestions: ["Select the reviewed local engine."],
          diagnosticId: "safe",
        },
      },
      9,
    );
    const { fake, calls } = partialClient({ inventoryFailure: failure });
    const snapshot = await inspectProject({
      workspaceName: "Refused",
      workspaceRoot: "/workspace",
      trusted: true,
      client: fake,
    });
    expect(snapshot.availability).toBe("not_ready");
    expect(snapshot.resources).toBeUndefined();
    expect(calls.map((call) => call.expectedCommand)).not.toContain(
      "environments",
    );
  });
  it("drops partial resources and configuration if an operation starts before the final activity barrier", async () => {
    const { fake } = partialClient({ finalBusy: true });
    const snapshot = await inspectProject({
      workspaceName: "Busy",
      workspaceRoot: "/workspace",
      trusted: true,
      client: fake,
    });
    expect(snapshot.availability).toBe("operation_active");
    expect(snapshot.resources).toBeUndefined();
    expect(snapshot.configurationMetadata).toBeUndefined();
    expect(snapshot.readiness).toBeUndefined();
  });
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
  it("stops at the platform boundary and supplies WSL recovery without inspecting the project", async () => {
    const observed: string[] = [];
    const stable = client("READY", undefined, observed);
    const result = await inspectProject({
      workspaceName: "Windows app",
      workspaceRoot: "C:\\projects\\app",
      trusted: true,
      client: {
        ...stable,
        version: async () => {
          throw new AdapterError("platform_unsupported", "Use WSL 2.");
        },
      },
    });
    expect(result.availability).toBe("error");
    expect(result.error?.code).toBe("platform_unsupported");
    expect(result.error?.suggestions.join(" ")).toContain("Linux home");
    expect(observed).toEqual([]);
    expect(result.readiness).toBeUndefined();
  });
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

  it("retains validated database-only proof configuration when optional cleanup metadata is absent", async () => {
    const base = client();
    const snapshot = await inspectProject({
      workspaceName: "Database-only",
      workspaceRoot: "/workspace",
      trusted: true,
      client: {
        ...base,
        async command<Data>(options: Parameters<SnapshotClient["command"]>[0]) {
          const observed = await base.command<Data>(options);
          if (options.expectedCommand !== "explain") return observed;
          const explanation = observed.result.data as ExplainData;
          const { cleanup: _cleanup, ...withoutCleanup } = explanation;
          return {
            ...observed,
            result: {
              ...observed.result,
              data: {
                ...withoutCleanup,
                application: { ...explanation.application!, readiness: null },
              } as Data,
            },
          };
        },
      },
    });
    expect(snapshot.configuration?.application).toEqual({
      startCommand: "npm run dev",
      proofCommand: "npm test",
      readinessUrl: null,
    });
    expect(snapshot.configuration?.cleanup).toBeUndefined();
  });

  it("offers fixed external-link recovery only for the dedicated adapter reason", async () => {
    for (const code of ["package_link_external", "package_invalid"] as const) {
      const snapshot = await inspectProject({
        workspaceName: "Linked checkout",
        workspaceRoot: "/workspace",
        trusted: true,
        client: {
          ...client(),
          async version() {
            throw new AdapterError(code, "private-adapter-canary");
          },
        },
      });
      expect(snapshot.availability).toBe("error");
      expect(snapshot.error?.code).toBe(code);
      if (code === "package_link_external") {
        expect(snapshot.error?.message).not.toContain("private-adapter-canary");
        expect(snapshot.error?.suggestions.join(" ")).toContain(
          "--install-links",
        );
      } else {
        expect(snapshot.error?.suggestions.join(" ")).not.toContain(
          "--install-links",
        );
      }
    }
  });

  it("keeps omitted legacy readiness unknown rather than inventing database-only configuration", async () => {
    const base = client();
    const snapshot = await inspectProject({
      workspaceName: "Legacy application metadata",
      workspaceRoot: "/workspace",
      trusted: true,
      client: {
        ...base,
        async command<Data>(options: Parameters<SnapshotClient["command"]>[0]) {
          const observed = await base.command<Data>(options);
          if (options.expectedCommand !== "explain") return observed;
          return {
            ...observed,
            result: {
              ...observed.result,
              data: {
                ...observed.result.data,
                application: {
                  startCommand: "npm run dev",
                  proofCommand: "npm test",
                },
              } as Data,
            },
          };
        },
      },
    });
    expect(snapshot.availability).toBe("ready");
    expect(snapshot.configuration).toBeUndefined();
  });

  it.each([
    {},
    { startCommand: "npm run dev", proofCommand: "npm test", readiness: {} },
    {
      startCommand: "npm run dev",
      proofCommand: "npm test",
      readiness: undefined,
    },
    { startCommand: "npm run dev", proofCommand: "npm test", readiness: false },
    {
      startCommand: "npm run dev",
      proofCommand: "npm test",
      readiness: {
        url: "https://outside.example/health",
        expectedStatus: 200,
        timeoutSeconds: 30,
      },
    },
    {
      startCommand: "npm run dev",
      proofCommand: "npm test",
      readiness: {
        url: "http://user:private@127.0.0.1:5511/health",
        expectedStatus: 200,
        timeoutSeconds: 30,
      },
    },
    {
      startCommand: "npm run dev",
      proofCommand: "npm test",
      readiness: { url: "http://127.0.0.1:5511/health" },
    },
    { startCommand: "npm run dev", proofCommand: {}, readiness: null },
    { startCommand: null, proofCommand: "npm test", readiness: null },
    { startCommand: "npm run dev", proofCommand: " ", readiness: null },
    {
      startCommand: "private-invalid-command\nnext",
      proofCommand: "npm test",
      readiness: null,
    },
    {
      startCommand: "npm run dev",
      proofCommand: "x".repeat(4097),
      readiness: null,
    },
  ])(
    "refuses malformed application metadata without raw-value leakage",
    async (application) => {
      const base = client();
      const snapshot = await inspectProject({
        workspaceName: "Malformed application metadata",
        workspaceRoot: "/workspace",
        trusted: true,
        client: {
          ...base,
          async command<Data>(
            options: Parameters<SnapshotClient["command"]>[0],
          ) {
            const observed = await base.command<Data>(options);
            if (options.expectedCommand !== "explain") return observed;
            return {
              ...observed,
              result: {
                ...observed.result,
                data: { ...observed.result.data, application } as Data,
              },
            };
          },
        },
      });
      expect(snapshot.availability).toBe("error");
      expect(snapshot.error?.code).toBe("invalid_cli_contract");
      expect(snapshot.configuration).toBeUndefined();
      expect(snapshot.error?.message).not.toContain("private-invalid-command");
      expect(snapshot.error?.message).not.toContain("user:private");
    },
  );

  it("accepts bounded proof commands and core loopback readiness independently of editor-input port restrictions", async () => {
    const base = client();
    const snapshot = await inspectProject({
      workspaceName: "Core loopback metadata",
      workspaceRoot: "/workspace",
      trusted: true,
      client: {
        ...base,
        async command<Data>(options: Parameters<SnapshotClient["command"]>[0]) {
          const observed = await base.command<Data>(options);
          if (options.expectedCommand !== "explain") return observed;
          return {
            ...observed,
            result: {
              ...observed.result,
              data: {
                ...observed.result.data,
                application: {
                  startCommand: "x".repeat(4096),
                  proofCommand: "npm test",
                  readiness: {
                    url: "http://[::1]/health",
                    expectedStatus: 204,
                    timeoutSeconds: 30,
                  },
                },
              } as Data,
            },
          };
        },
      },
    });
    expect(snapshot.availability).toBe("ready");
    expect(snapshot.configuration?.application.startCommand.length).toBe(4096);
    expect(snapshot.configuration?.application.readinessUrl).toBe(
      "http://[::1]/health",
    );
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

  it.each(["run", "measure impact"])(
    "shows only safe %s activity while an owned operation is active",
    async (kind) => {
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
              kind,
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
        activity: { state: "busy", operation: { kind } },
      });
      expect(result.readiness).toBeUndefined();
      expect(result.runtime).toBeUndefined();
    },
  );

  it("keeps a completed impact measurement receipt from making an idle project unavailable", async () => {
    const at = "2026-10-10T00:00:00.000Z";
    const recent = [
      {
        kind: "measure impact",
        rehearsalVersion: "1.2.0",
        progress: {
          schemaVersion: 1 as const,
          operationId: "f".repeat(64),
          state: "completed" as const,
          startedAt: at,
          updatedAt: at,
          elapsedMilliseconds: 0,
          currentStage: null,
          completedStages: [],
          events: [],
          truncated: { stages: false, events: false },
        },
      },
    ];
    const observedCommands: string[] = [];
    const result = await inspectProject({
      workspaceName: "fixture",
      workspaceRoot: "/workspace",
      trusted: true,
      client: client(
        "READY",
        {
          schemaVersion: 1,
          state: "idle",
          operation: null,
          recent,
        },
        observedCommands,
      ),
    });
    expect(result.availability).toBe("ready");
    expect(result.activity?.recent).toEqual(recent);
    expect(result.readiness).toBeDefined();
    expect(result.runtime).toBeDefined();
    expect(
      observedCommands.filter((command) => command === "activity"),
    ).toHaveLength(2);
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

describe("configuration-independent engine lifecycle inspection", () => {
  const engineClient = (
    activity: ActivityData = {
      schemaVersion: 1,
      state: "idle",
      operation: null,
    },
    fail: boolean | "version-drift" = false,
  ) => {
    const base = client("NOT READY", activity),
      commands: Parameters<SnapshotClient["command"]>[0][] = [];
    const capable: SnapshotClient = {
      ...base,
      version: async (...args) => ({
        ...(await base.version(...args)),
        engineLifecycleSchema: 1,
      }),
      command: async <Data>(
        request: Parameters<SnapshotClient["command"]>[0],
      ) => {
        commands.push(request);
        if (request.expectedCommand === "activity" && request.configPath)
          throw new Error(
            "Explicit project configuration is missing or unsafe.",
          );
        if (request.expectedCommand === "engine status") {
          if (fail === true) throw Error("private provider failure");
          const result = envelope("engine status", lifecycleStatus());
          return (fail === "version-drift"
            ? {
                ...result,
                result: { ...result.result, rehearsalVersion: "9.9.9" },
              }
            : result) as unknown as {
            result: ResultEnvelope<Data>;
            exitCode: number;
          };
        }
        return base.command<Data>(request);
      },
    };
    return { capable, commands };
  };
  it("reads engine facts before missing-configuration readiness without passing a config path", async () => {
    const { capable, commands } = engineClient();
    const result = await inspectProject({
      workspaceName: "fixture",
      workspaceRoot: "/workspace",
      trusted: true,
      configPath: "missing.mjs",
      client: capable,
    });
    expect(result.availability).toBe("not_ready");
    expect(result.engineLifecycle).toEqual({
      state: "available",
      report: lifecycleStatus(),
    });
    expect(commands[0]).toMatchObject({ command: ["engine", "status"] });
    expect(commands[0]).not.toHaveProperty("configPath");
    expect(
      commands
        .filter((command) => command.expectedCommand === "activity")
        .every((command) => command.configPath === undefined),
    ).toBe(true);
    expect(
      commands.find((command) => command.expectedCommand === "doctor")
        ?.configPath,
    ).toBe("missing.mjs");
    expect(result.activity?.state).toBe("idle");
    expect(engineShutdownAvailable(result)).toBe(true);
  });
  it("retains independent engine facts while project activity blocks mutations", async () => {
    const { capable, commands } = engineClient({
      schemaVersion: 1,
      state: "busy",
      operation: {
        kind: "run",
        startedAt: "2026-10-25T00:00:00Z",
        rehearsalVersion: "0.1.0-rc.4",
      },
    });
    const result = await inspectProject({
      workspaceName: "fixture",
      workspaceRoot: "/workspace",
      trusted: true,
      client: capable,
    });
    expect(result.availability).toBe("operation_active");
    expect(result.engineLifecycle?.state).toBe("available");
    expect(commands.map((request) => request.expectedCommand)).toEqual([
      "engine status",
      "activity",
    ]);
  });
  it("keeps optional inspection failure unavailable without hiding Doctor guidance", async () => {
    const { capable } = engineClient(undefined, true);
    const result = await inspectProject({
      workspaceName: "fixture",
      workspaceRoot: "/workspace",
      trusted: true,
      client: capable,
    });
    expect(result.availability).toBe("not_ready");
    expect(result.engineLifecycle).toEqual({ state: "unavailable" });
    expect(JSON.stringify(result)).not.toContain("private provider failure");
  });
  it("never hides actual package version drift as an optional unavailable result", async () => {
    const { capable, commands } = engineClient(undefined, "version-drift");
    const result = await inspectProject({
      workspaceName: "fixture",
      workspaceRoot: "/workspace",
      trusted: true,
      client: capable,
    });
    expect(result.availability).toBe("error");
    expect(result.error?.code).toBe("invalid_cli_contract");
    expect(result.engineLifecycle).toEqual({ state: "unavailable" });
    expect(commands.map((entry) => entry.expectedCommand)).toEqual([
      "engine status",
    ]);
  });
});

describe("Drizzle snapshot public cross-view binding", () => {
  const inspectDrizzle = async (
    change = "valid",
    offline = false,
    calls: string[] = [],
  ) => {
    const { rawPlan, baseline: rawBaseline } =
        await import("./drizzle_fixture.js"),
      base = client(offline ? "NOT READY" : "READY"),
      plan = rawPlan(),
      baseline = rawBaseline(),
      candidate = plan.targets[0]!.entries[1]!;
    if (change === "unknown-plan-schema") plan.schemaVersion = 2;
    if (change === "cutoff-drift")
      baseline.migrationCutoff = { ...baseline.migrationCutoff, tag: "other" };
    if (change === "count-drift") baseline.migrationCount = 2;
    if (change === "append")
      plan.targets[0]!.migrationTool.journalSha256 = "b".repeat(64);
    if (change === "prefix-drift")
      plan.targets[0]!.baselineHistorySha256 = "b".repeat(64);
    if (change === "unverified-prefix")
      plan.targets[0]!.baselinePrefixVerification = "unknown";
    return inspectProject({
      workspaceName: "fixture",
      workspaceRoot: "/workspace",
      trusted: true,
      client: {
        ...base,
        version: async (...args) => ({
          ...(await base.version(...args)),
          ...(offline
            ? {
                projectDiscoverySchema: 1 as const,
                configurationReviewSchema: 1 as const,
                commandCapabilitiesSchema: 1 as const,
              }
            : {}),
          ...(change === "missing-plan"
            ? {}
            : {
                migrationReviewSchema:
                  change === "unknown-plan" ? null : (1 as const),
              }),
          ...(change === "old-core" ? {} : { drizzleMigrationsSchema: 1 }),
        }),
        command: async <Data>(
          options: Parameters<SnapshotClient["command"]>[0],
        ) => {
          calls.push(options.expectedCommand);
          if (offline && options.expectedCommand === "inspect capabilities")
            return envelope(
              "inspect capabilities",
              (
                await import("./command_capabilities_fixture.js")
              ).commandCapabilitiesFixture(),
            ) as { result: ResultEnvelope<Data>; exitCode: number };
          if (offline && options.expectedCommand === "discover")
            return envelope("discover", partialDiscovery) as {
              result: ResultEnvelope<Data>;
              exitCode: number;
            };
          if (offline && options.expectedCommand === "configuration")
            return envelope("configuration", partialConfiguration) as {
              result: ResultEnvelope<Data>;
              exitCode: number;
            };
          if (options.expectedCommand === "inspect plan")
            return envelope("inspect plan", plan) as {
              result: ResultEnvelope<Data>;
              exitCode: number;
            };
          if (options.expectedCommand === "inspect baseline")
            return envelope("inspect baseline", baseline) as {
              result: ResultEnvelope<Data>;
              exitCode: number;
            };
          if (options.expectedCommand === "candidates") {
            const c = {
              nativeIdentity: candidate.nativeIdentity,
              name: candidate.name,
              filename: candidate.filename,
              sha256: candidate.sha256,
              status: "candidate",
            };
            return envelope("candidates", {
              baselineGenerationId: "baseline-1",
              candidateSha256: plan.candidateSha256,
              candidateCount: 1,
              candidates: [c],
              targets: [
                {
                  name: "primary",
                  configPath: "/workspace/rehearsal.config.mjs",
                  candidateSha256: plan.targets[0]!.candidateSha256,
                  candidateCount: 1,
                  candidates: [c],
                },
              ],
            }) as { result: ResultEnvelope<Data>; exitCode: number };
          }
          const execution = await base.command<Data>(options);
          if (options.expectedCommand === "explain") {
            const explained = execution.result.data as unknown as ExplainData;
            return {
              ...execution,
              result: {
                ...execution.result,
                data: {
                  ...explained,
                  targets: [
                    { name: "primary", plan: { ...explained, baseline } },
                  ],
                },
              },
            } as { result: ResultEnvelope<Data>; exitCode: number };
          }
          return execution;
        },
      },
    });
  };
  it("preserves format4/cutoff/native candidates with matching independent baseline evidence", async () => {
    const result = await inspectDrizzle();
    expect(result.availability).toBe("ready");
    expect(result.baseline?.formatVersion).toBe(4);
    expect(
      result.migrationReview?.targets[0]!.entries[1]!.nativeIdentity?.kind,
    ).toBe("drizzle");
    expect(result.candidates?.files[0]).not.toHaveProperty("version");
  });
  it("accepts a verified append with changed raw journal bytes", async () =>
    expect((await inspectDrizzle("append")).availability).toBe("ready"));
  it.each([
    "old-core",
    "missing-plan",
    "unknown-plan",
    "unknown-plan-schema",
    "prefix-drift",
    "unverified-prefix",
    "cutoff-drift",
    "count-drift",
  ])("fails closed for %s", async (change) => {
    const result = await inspectDrizzle(change);
    expect(result.availability).toBe("error");
    expect(result.migrationReview).toBeUndefined();
  });
  it("retains the exact Drizzle semantic-prefix/candidate guards during offline review", async () => {
    const calls: string[] = [];
    const result = await inspectDrizzle("valid", true, calls);
    expect(result.availability).toBe("not_ready");
    expect(result.offlineInspection).toEqual({ state: "available" });
    expect(result.baseline?.formatVersion).toBe(4);
    expect(result.migrationReview?.targets[0]?.migrationTool?.kind).toBe(
      "drizzle",
    );
    expect(result.runtime).toBeUndefined();
    expect(calls).not.toContain("status");
    for (const change of [
      "old-core",
      "prefix-drift",
      "cutoff-drift",
      "unknown-plan-schema",
    ]) {
      const refused = await inspectDrizzle(change, true);
      expect(refused.offlineInspection).toBeUndefined();
      expect(refused.migrationReview).toBeUndefined();
    }
  });
});

describe("capability-negotiated offline review", () => {
  const inspectOffline = async (
    change = "valid",
    variant: "sql" | "prisma" = "sql",
  ) => {
    const { commandCapabilitiesFixture } =
      await import("./command_capabilities_fixture.js");
    const base = client("NOT READY"),
      capabilities = commandCapabilitiesFixture(),
      plan = migrationPlan();
    const calls: Parameters<SnapshotClient["command"]>[0][] = [];
    const native = {
      schemaVersion: 1,
      kind: "prisma",
      version: "7.10.1",
      provider: "postgresql",
      lockSha256: "b".repeat(64),
      toolchainSha256: "c".repeat(64),
    };
    if (variant === "prisma")
      for (const entry of plan.targets[0]!.entries)
        entry.filename = `${entry.version}_${entry.name}/migration.sql`;
    if (change === "unsupported-operation")
      capabilities.operations[0]!.supportState = "unsupported";
    if (change === "container-operation")
      capabilities.operations[0]!.backend = "container";
    if (change === "unsafe-capabilities")
      capabilities.safety.enginesProbed = true;
    if (change === "candidate-drift") plan.candidateSha256 = "f".repeat(64);
    let activityReads = 0;
    const snapshot = await inspectProject({
      workspaceName: "offline",
      workspaceRoot: "/workspace",
      trusted: change !== "untrusted",
      client: {
        ...base,
        version: async (...args) => ({
          ...(await base.version(...args)),
          projectDiscoverySchema: 1,
          configurationReviewSchema: 1,
          migrationReviewSchema: 1,
          ...(change === "missing-capability"
            ? {}
            : {
                commandCapabilitiesSchema:
                  change === "unknown-capability" ? null : (1 as const),
                commandCapabilitiesAdvertised: true,
              }),
        }),
        command: async <Data>(
          request: Parameters<SnapshotClient["command"]>[0],
        ) => {
          calls.push(request);
          let result;
          if (request.expectedCommand === "inspect capabilities") {
            result = envelope("inspect capabilities", capabilities);
            if (change === "capability-version-drift")
              result = {
                ...result,
                result: { ...result.result, rehearsalVersion: "9.9.9" },
              };
          } else if (request.expectedCommand === "discover")
            result = envelope("discover", partialDiscovery);
          else if (request.expectedCommand === "doctor")
            result = envelope(
              "doctor",
              {
                state: "NOT READY",
                checks: [
                  {
                    id: "docker",
                    label: "Docker",
                    status: "fail",
                    detail: "No selected engine",
                    remediation: "Configure a local engine for runtime work.",
                  },
                ],
              },
              "not_ready",
            );
          else if (request.expectedCommand === "configuration")
            result = envelope(
              "configuration",
              change === "bad-config"
                ? { ...partialConfiguration, path: "other.config.mjs" }
                : partialConfiguration,
            );
          else if (request.expectedCommand === "inspect plan")
            result = envelope("inspect plan", {
              ...plan,
              targets: plan.targets.map((target) => ({
                ...target,
                ...(variant === "prisma" ? { migrationTool: native } : {}),
              })),
            });
          else if (
            request.expectedCommand === "activity" &&
            ++activityReads > 1 &&
            change === "busy-final"
          )
            result = envelope("activity", {
              schemaVersion: 1,
              state: "busy",
              operation: {
                kind: "run",
                startedAt: "2026-10-27T00:00:00Z",
                rehearsalVersion: "0.1.0-rc.4",
              },
            });
          else {
            result = await base.command<Data>(request);
            if (
              variant === "prisma" &&
              request.expectedCommand === "inspect baseline"
            )
              result = envelope("inspect baseline", {
                ...(result.result.data as object),
                formatVersion: 3,
                nativeMigrations: native,
              });
            if (variant === "prisma" && request.expectedCommand === "explain") {
              const baseline = (
                await base.command<BaselineData>({
                  ...request,
                  expectedCommand: "inspect baseline",
                })
              ).result.data;
              const explained = result.result.data as ExplainData;
              result = envelope("explain", {
                ...explained,
                targets: [
                  {
                    name: "primary",
                    plan: {
                      ...explained,
                      baseline: {
                        ...baseline,
                        formatVersion: 3,
                        nativeMigrations: native,
                      },
                    },
                  },
                ],
              });
            }
            if (
              variant === "prisma" &&
              request.expectedCommand === "candidates"
            ) {
              const data = result.result.data as CandidatesData;
              const candidate = plan.targets[0]!.entries[2]!;
              const rows = [
                {
                  version: candidate.version,
                  name: candidate.name,
                  filename: candidate.filename,
                  sha256: candidate.sha256,
                  status: "candidate",
                },
              ];
              result = envelope("candidates", {
                ...data,
                candidates: rows,
                targets: data.targets.map((target) => ({
                  ...target,
                  candidates: rows,
                })),
              });
            }
            if (
              change === "unsuccessful-baseline" &&
              request.expectedCommand === "inspect baseline"
            )
              result = envelope(
                "inspect baseline",
                result.result.data,
                "not_ready",
              );
          }
          return result as { result: ResultEnvelope<Data>; exitCode: number };
        },
      },
    });
    return { snapshot, calls };
  };
  it.each(["sql", "prisma"] as const)(
    "keeps verified %s review without claiming runtime readiness or dispatching runtime queries",
    async (variant) => {
      const { snapshot, calls } = await inspectOffline("valid", variant);
      expect(snapshot.availability).toBe("not_ready");
      expect(snapshot.offlineInspection).toEqual({ state: "available" });
      expect(snapshot.baseline?.generationId).toBe("baseline-1");
      expect(snapshot.candidates?.count).toBe(1);
      expect(snapshot.migrationReview).toBeDefined();
      expect(snapshot.runtime).toBeUndefined();
      expect(snapshot.resources).toBeUndefined();
      expect(snapshot.applicationUrl).toBeUndefined();
      expect(
        calls.some((call) =>
          ["status", "resources", "environments", "run", "start"].includes(
            call.expectedCommand,
          ),
        ),
      ).toBe(false);
      expect(
        calls.find((call) => call.expectedCommand === "inspect capabilities")
          ?.configPath,
      ).toBeUndefined();
      expect(
        calls.find((call) => call.expectedCommand === "inspect plan")
          ?.configPath,
      ).toBe("rehearsal.config.mjs");
    },
  );
  it.each([
    "missing-capability",
    "unknown-capability",
    "unsafe-capabilities",
    "unsupported-operation",
    "container-operation",
    "bad-config",
  ])("retains prior Doctor fallback for %s", async (change) => {
    const { snapshot, calls } = await inspectOffline(change);
    expect(snapshot.availability).toBe("not_ready");
    expect(snapshot.offlineInspection).toBeUndefined();
    expect(snapshot.baseline).toBeUndefined();
    expect(calls.some((call) => call.expectedCommand === "inspect plan")).toBe(
      false,
    );
  });
  it.each([
    "candidate-drift",
    "unsuccessful-baseline",
    "capability-version-drift",
  ])("refuses %s without promoting retained evidence", async (change) => {
    const { snapshot } = await inspectOffline(change);
    expect(snapshot.availability).toBe("error");
    expect(snapshot.offlineInspection).toBeUndefined();
    expect(snapshot.baseline).toBeUndefined();
  });
  it("final activity drift discards all offline project evidence", async () => {
    const { snapshot } = await inspectOffline("busy-final");
    expect(snapshot.availability).toBe("operation_active");
    expect(snapshot.offlineInspection).toBeUndefined();
    expect(snapshot.baseline).toBeUndefined();
  });
  it("untrusted workspaces never invoke capability or project code", async () => {
    const { calls, snapshot } = await inspectOffline("untrusted");
    expect(snapshot.availability).toBe("untrusted");
    expect(calls).toEqual([]);
  });
});
