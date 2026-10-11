import { realpath } from "node:fs/promises";
import { basename, relative, sep } from "node:path";
import type {
  ActivityData,
  BaselineData,
  CandidatesData,
  DoctorData,
  ExplainData,
  ProjectDiscoveryData,
  ResultEnvelope,
  StatusData,
  VersionResult,
} from "./contracts.js";
import {
  ContractError,
  parseActivityData,
  parseProjectDiscoveryData,
  parseStatusData,
} from "./contracts.js";
import {
  AdapterError,
  RehearsalCliError,
  resolveWorkspaceRehearsal,
  runRehearsalJson,
  runVersion,
} from "./process_adapter.js";
import {
  coreCompatibilityFor,
  type CoreCompatibility,
} from "./version_compatibility.js";

export type ProjectAvailability =
  | "ready"
  | "not_ready"
  | "operation_active"
  | "operation_attention"
  | "untrusted"
  | "package_missing"
  | "package_outdated"
  | "error";

export interface ProjectSnapshot {
  readonly workspaceName: string;
  readonly workspaceRoot: string;
  readonly availability: ProjectAvailability;
  readonly version?: string;
  readonly compatibility?: CoreCompatibility;
  readonly packageLocation?: string;
  readonly discovery?: {
    readonly source: "core" | "bootstrap";
    readonly profile: ProjectDiscoveryData;
  };
  readonly configPath?: string;
  readonly activity?: ActivityData;
  readonly readiness?: {
    readonly state: "READY" | "NOT READY";
    readonly passed: number;
    readonly failed: number;
    readonly checks: readonly DoctorData["checks"][number][];
  };
  readonly baseline?: {
    readonly generationId: string;
    readonly createdAt: string;
    readonly tableCount: number;
    readonly rowCount: number;
    readonly migrationCount: number;
    readonly verification: string;
    readonly generations?: readonly {
      readonly generationId: string;
      readonly createdAt: string | null;
      readonly active: boolean;
      readonly formatVersion: 1 | 2;
      readonly rowCount: number;
      readonly tableCount: number;
      readonly migrationCount: number;
      readonly migrationCutoff: string;
      readonly storageAssetCount: number;
    }[];
  };
  readonly candidates?: {
    readonly count: number;
    readonly digest: string;
    readonly files: readonly (
      | string
      | {
          readonly version: string;
          readonly name: string;
          readonly filename: string;
          readonly sha256: string;
          readonly target: string;
        }
    )[];
    readonly targets: readonly {
      readonly name: string;
      readonly configPath: string;
      readonly count: number;
      readonly digest?: string;
    }[];
  };
  readonly runtime?: {
    readonly state:
      "running" | "stopped" | "unavailable" | "unhealthy" | "mixed";
    readonly targets: readonly {
      readonly name: string;
      readonly state: "running" | "stopped" | "unavailable" | "unhealthy";
      readonly reason:
        | "container_engine_unavailable"
        | "runtime_not_running"
        | "health_check_failed"
        | null;
      readonly runtimeTarget: "supabase" | "postgresql";
      readonly verifiedRuntimeAvailable: boolean | null;
      readonly endpoint:
        | { readonly kind: "http"; readonly url: string }
        | {
            readonly kind: "postgresql";
            readonly host: "127.0.0.1" | "localhost" | "::1";
            readonly port: number;
            readonly database: string;
          }
        | null;
    }[];
  };
  readonly applicationUrl?: string;
  readonly environment?: {
    readonly target: string;
    readonly projectId?: string;
    readonly ports: Readonly<Record<string, number>>;
    readonly authenticationProviders: readonly string[];
    readonly authenticationCallback: string | null;
    readonly hostedAccess: "disabled" | "unknown";
    readonly outboundNetwork: "deny" | "unknown";
  };
  readonly lifecycle?: {
    readonly run: "keep-until-stop" | "stop-after-run";
    readonly open: "keep-until-stop" | "stop-on-application-exit";
    readonly dataOnStop: "preserved";
  };
  readonly configuration?: {
    readonly application: {
      readonly startCommand: string;
      readonly proofCommand: string;
      readonly readinessUrl: string | null;
    };
    readonly cleanup: {
      readonly retainBaselineGenerations: number;
    };
  };
  readonly error?: {
    readonly code: string;
    readonly message: string;
    readonly suggestions: readonly string[];
  };
}

export interface SnapshotClient {
  version(
    workspaceRoot: string,
    signal?: AbortSignal,
  ): Promise<
    VersionResult & {
      readonly packageLocation?: string;
      readonly projectDiscoverySchema?: 1 | null;
    }
  >;
  command<Data>(options: {
    workspaceRoot: string;
    command: readonly string[];
    expectedCommand: string;
    configPath?: string;
    signal?: AbortSignal;
    timeoutMs?: number;
  }): Promise<{ result: ResultEnvelope<Data>; exitCode: number }>;
}

type ObservedVersion = Awaited<ReturnType<SnapshotClient["version"]>>;

export const processSnapshotClient: SnapshotClient = {
  version: async (workspaceRoot, signal) => {
    const resolved = await resolveWorkspaceRehearsal(workspaceRoot);
    const location = relative(
      await realpath(workspaceRoot),
      resolved.packageRoot,
    );
    const packageLocation =
      location === "" || location === ".." || location.startsWith(`..${sep}`)
        ? "repository node_modules/@rehearsal-db/core"
        : location;
    if (coreCompatibilityFor(resolved.version).state !== "supported") {
      return {
        name: "@rehearsal-db/core",
        version: resolved.version,
        packageLocation,
        projectDiscoverySchema: resolved.projectDiscoverySchema,
      };
    }
    const version = await runVersion(workspaceRoot, signal ? { signal } : {});
    return {
      ...version,
      packageLocation,
      projectDiscoverySchema: resolved.projectDiscoverySchema,
    };
  },
  command: (options) => runRehearsalJson(options),
};

const requireRehearsalVersion = (
  expected: string,
  results: readonly { readonly rehearsalVersion: string }[],
): void => {
  if (results.some(({ rehearsalVersion }) => rehearsalVersion !== expected)) {
    throw new AdapterError(
      "invalid_cli_contract",
      "The installed Rehearsal package changed during refresh.",
    );
  }
};

const safeWorkspaceRelativePath = (
  workspaceRoot: string,
  absolutePath: string,
): string => {
  const path = relative(workspaceRoot, absolutePath);
  if (path === "" || path === ".." || path.startsWith(`..${sep}`)) {
    return basename(absolutePath);
  }
  return path;
};

const isLoopbackApplicationUrl = (value: string): boolean => {
  try {
    const url = new URL(value);
    return (
      (url.protocol === "http:" || url.protocol === "https:") &&
      ["localhost", "127.0.0.1", "::1"].includes(url.hostname)
    );
  } catch {
    return false;
  }
};

const failureSnapshot = (
  workspaceName: string,
  workspaceRoot: string,
  error: unknown,
  bootstrapDiscovery?: ProjectDiscoveryData,
  observedVersion?: ObservedVersion,
): ProjectSnapshot => {
  const observed = observedVersion
    ? {
        version: observedVersion.version,
        compatibility: coreCompatibilityFor(observedVersion.version),
        ...(observedVersion.packageLocation
          ? { packageLocation: observedVersion.packageLocation }
          : {}),
      }
    : {};
  const safeDiscovery = bootstrapDiscovery
    ? {
        discovery: {
          source: "bootstrap" as const,
          profile: bootstrapDiscovery,
        },
      }
    : {};
  if (error instanceof AdapterError) {
    return {
      workspaceName,
      workspaceRoot,
      availability:
        error.code === "package_missing" ? "package_missing" : "error",
      ...observed,
      ...safeDiscovery,
      error: { code: error.code, message: error.message, suggestions: [] },
    };
  }
  if (error instanceof ContractError) {
    return {
      workspaceName,
      workspaceRoot,
      availability: "error",
      ...observed,
      ...safeDiscovery,
      error: {
        code: error.code,
        message: error.message,
        suggestions: ["Update Rehearsal and refresh the project overview."],
      },
    };
  }
  if (error instanceof RehearsalCliError) {
    return {
      workspaceName,
      workspaceRoot,
      availability: "error",
      ...observed,
      ...safeDiscovery,
      version: error.result.rehearsalVersion,
      error: {
        code: error.result.error.code,
        message: error.result.error.message,
        suggestions: error.result.error.suggestions,
      },
    };
  }
  return {
    workspaceName,
    workspaceRoot,
    availability: "error",
    ...observed,
    ...safeDiscovery,
    error: {
      code: "unexpected_extension_failure",
      message: "The Rehearsal project overview could not be loaded.",
      suggestions: ["Run rehearsal doctor in the workspace for more detail."],
    },
  };
};

const activityOnlySnapshot = ({
  workspaceName,
  workspaceRoot,
  version,
  packageLocation,
  activity,
}: {
  workspaceName: string;
  workspaceRoot: string;
  version: string;
  packageLocation?: string;
  activity: ActivityData;
}): ProjectSnapshot => ({
  workspaceName,
  workspaceRoot,
  availability:
    activity.state === "busy" ? "operation_active" : "operation_attention",
  version,
  ...(packageLocation ? { packageLocation } : {}),
  activity,
});

export const inspectProject = async ({
  workspaceName,
  workspaceRoot,
  configPath,
  trusted,
  signal,
  timeoutMs,
  bootstrapDiscovery,
  client = processSnapshotClient,
}: {
  readonly workspaceName: string;
  readonly workspaceRoot: string;
  readonly configPath?: string;
  readonly trusted: boolean;
  readonly signal?: AbortSignal;
  readonly timeoutMs?: number;
  readonly bootstrapDiscovery?: ProjectDiscoveryData;
  readonly client?: SnapshotClient;
}): Promise<ProjectSnapshot> => {
  if (!trusted) {
    return { workspaceName, workspaceRoot, availability: "untrusted" };
  }
  let observedVersion: ObservedVersion | undefined;
  try {
    const version = await client.version(workspaceRoot, signal);
    observedVersion = version;
    const compatibility = coreCompatibilityFor(version.version);
    if (compatibility.state !== "supported") {
      return {
        workspaceName,
        workspaceRoot,
        availability:
          compatibility.state === "outdated" ? "package_outdated" : "error",
        version: version.version,
        compatibility,
        ...(version.packageLocation
          ? { packageLocation: version.packageLocation }
          : {}),
        ...(bootstrapDiscovery
          ? {
              discovery: {
                source: "bootstrap" as const,
                profile: bootstrapDiscovery,
              },
            }
          : {}),
        error: {
          code:
            compatibility.state === "outdated"
              ? "package_outdated"
              : "package_version_invalid",
          message:
            compatibility.state === "outdated"
              ? `Rehearsal ${version.version} is too old for this extension.`
              : "The installed Rehearsal version is not valid semantic version metadata.",
          suggestions: [
            compatibility.state === "outdated"
              ? `Update @rehearsal-db/core to ${compatibility.minimumVersion} or newer.`
              : "Reinstall @rehearsal-db/core from the official package.",
          ],
        },
      };
    }
    const common = {
      workspaceRoot,
      ...(configPath ? { configPath } : {}),
      ...(signal ? { signal } : {}),
      ...(timeoutMs ? { timeoutMs } : {}),
    };
    const activityExecution = await client.command<ActivityData>({
      ...common,
      command: ["activity"],
      expectedCommand: "activity",
    });
    requireRehearsalVersion(version.version, [activityExecution.result]);
    const activity = parseActivityData(activityExecution.result.data);
    if (activity.state !== "idle") {
      return activityOnlySnapshot({
        workspaceName,
        workspaceRoot,
        version: version.version,
        ...(version.packageLocation
          ? { packageLocation: version.packageLocation }
          : {}),
        activity,
      });
    }
    const discovery =
      version.projectDiscoverySchema === 1
        ? parseProjectDiscoveryData(
            (
              await client.command<ProjectDiscoveryData>({
                ...common,
                command: ["discover"],
                expectedCommand: "discover",
              })
            ).result.data,
          )
        : bootstrapDiscovery;
    const discoverySnapshot = discovery
      ? {
          discovery: {
            source:
              version.projectDiscoverySchema === 1
                ? ("core" as const)
                : ("bootstrap" as const),
            profile: discovery,
          },
        }
      : {};
    const doctor = await client.command<DoctorData>({
      ...common,
      command: ["doctor"],
      expectedCommand: "doctor",
    });
    requireRehearsalVersion(version.version, [doctor.result]);
    const readiness = {
      state: doctor.result.data.state,
      passed: doctor.result.data.checks.filter(
        ({ status }) => status === "pass",
      ).length,
      failed: doctor.result.data.checks.filter(
        ({ status }) => status === "fail",
      ).length,
      checks: doctor.result.data.checks,
    };
    if (doctor.result.status === "not_ready") {
      return {
        workspaceName,
        workspaceRoot,
        availability: "not_ready",
        version: version.version,
        ...(version.packageLocation
          ? { packageLocation: version.packageLocation }
          : {}),
        activity,
        ...discoverySnapshot,
        readiness,
      };
    }
    const [explain, baseline, candidates, status, finalActivityExecution] =
      await Promise.all([
        client.command<ExplainData>({
          ...common,
          command: ["explain"],
          expectedCommand: "explain",
        }),
        client.command<BaselineData>({
          ...common,
          command: ["inspect", "baseline"],
          expectedCommand: "inspect baseline",
        }),
        client.command<CandidatesData>({
          ...common,
          command: ["candidates"],
          expectedCommand: "candidates",
        }),
        client.command<StatusData>({
          ...common,
          command: ["status"],
          expectedCommand: "status",
        }),
        client.command<ActivityData>({
          ...common,
          command: ["activity"],
          expectedCommand: "activity",
        }),
      ]);
    const applicationUrl = explain.result.data.environment.applicationUrl;
    requireRehearsalVersion(version.version, [
      explain.result,
      baseline.result,
      candidates.result,
      status.result,
      finalActivityExecution.result,
    ]);
    const finalActivity = parseActivityData(finalActivityExecution.result.data);
    if (finalActivity.state !== "idle") {
      return activityOnlySnapshot({
        workspaceName,
        workspaceRoot,
        version: version.version,
        ...(version.packageLocation
          ? { packageLocation: version.packageLocation }
          : {}),
        activity: finalActivity,
      });
    }
    const statusData = parseStatusData(status.result.data);
    const statusTargets =
      "targets" in statusData ? statusData.targets : [statusData];
    const states = new Set(
      statusTargets.map(({ runtimeStatus }) => runtimeStatus.state),
    );
    return {
      workspaceName,
      workspaceRoot,
      availability: "ready",
      version: version.version,
      ...(version.packageLocation
        ? { packageLocation: version.packageLocation }
        : {}),
      activity: finalActivity,
      ...discoverySnapshot,
      configPath: safeWorkspaceRelativePath(
        workspaceRoot,
        explain.result.data.config.path,
      ),
      readiness,
      baseline: {
        generationId: baseline.result.data.generationId,
        createdAt: baseline.result.data.createdAt,
        tableCount: baseline.result.data.tableCount,
        rowCount: baseline.result.data.rowCount,
        migrationCount: baseline.result.data.migrationCount,
        verification: baseline.result.data.verification,
        generations: baseline.result.data.generations ?? [
          {
            generationId: baseline.result.data.generationId,
            createdAt: baseline.result.data.createdAt,
            active: true,
            formatVersion: baseline.result.data.formatVersion ?? 1,
            rowCount: baseline.result.data.rowCount,
            tableCount: baseline.result.data.tableCount,
            migrationCount: baseline.result.data.migrationCount,
            migrationCutoff: baseline.result.data.migrationCutoff,
            storageAssetCount: 0,
          },
        ],
      },
      candidates: {
        count: candidates.result.data.candidateCount,
        digest: candidates.result.data.candidateSha256,
        files: candidates.result.data.candidates.map((candidate) =>
          typeof candidate === "string"
            ? candidate
            : {
                version: candidate.version,
                name: candidate.name,
                filename: candidate.filename,
                sha256: candidate.sha256,
                target: candidate.target ?? "primary",
              },
        ),
        targets: candidates.result.data.targets.map((target) => ({
          name: target.name,
          configPath: safeWorkspaceRelativePath(
            workspaceRoot,
            target.configPath,
          ),
          count: target.candidateCount,
          digest: target.candidateSha256,
        })),
      },
      runtime: {
        state:
          states.size === 1 ? statusTargets[0]!.runtimeStatus.state : "mixed",
        targets: statusTargets.map(({ target, runtimeStatus }) => ({
          name: target,
          state: runtimeStatus.state,
          reason: runtimeStatus.reason,
          runtimeTarget: runtimeStatus.runtimeTarget,
          verifiedRuntimeAvailable: runtimeStatus.verifiedRuntimeAvailable,
          endpoint: runtimeStatus.endpoint,
        })),
      },
      ...(isLoopbackApplicationUrl(applicationUrl) ? { applicationUrl } : {}),
      environment: {
        target: explain.result.data.environment.target,
        ...(explain.result.data.environment.projectId
          ? { projectId: explain.result.data.environment.projectId }
          : {}),
        ports: explain.result.data.environment.ports ?? {},
        authenticationProviders:
          explain.result.data.environment.authenticationProviders ?? [],
        authenticationCallback:
          explain.result.data.environment.authenticationCallback ?? null,
        hostedAccess: explain.result.data.environment.hostedAccess ?? "unknown",
        outboundNetwork:
          explain.result.data.environment.outboundNetwork ?? "unknown",
      },
      ...(explain.result.data.lifecycle
        ? { lifecycle: explain.result.data.lifecycle }
        : {}),
      ...(explain.result.data.application && explain.result.data.cleanup
        ? {
            configuration: {
              application: {
                startCommand: explain.result.data.application.startCommand,
                proofCommand: explain.result.data.application.proofCommand,
                readinessUrl:
                  explain.result.data.application.readiness?.url ?? null,
              },
              cleanup: explain.result.data.cleanup,
            },
          }
        : {}),
    };
  } catch (error) {
    return failureSnapshot(
      workspaceName,
      workspaceRoot,
      error,
      bootstrapDiscovery,
      observedVersion,
    );
  }
};
