import { basename, relative, sep } from "node:path";
import type {
  ActivityData,
  BaselineData,
  CandidatesData,
  DoctorData,
  ExplainData,
  ResultEnvelope,
  StatusData,
  VersionResult,
} from "./contracts.js";
import {
  ContractError,
  parseActivityData,
  parseStatusData,
} from "./contracts.js";
import {
  AdapterError,
  RehearsalCliError,
  resolveWorkspaceRehearsal,
  runRehearsalJson,
  runVersion,
} from "./process_adapter.js";

export type ProjectAvailability =
  | "ready"
  | "not_ready"
  | "operation_active"
  | "operation_attention"
  | "untrusted"
  | "package_missing"
  | "error";

export interface ProjectSnapshot {
  readonly workspaceName: string;
  readonly workspaceRoot: string;
  readonly availability: ProjectAvailability;
  readonly version?: string;
  readonly packageLocation?: string;
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
  };
  readonly candidates?: {
    readonly count: number;
    readonly digest: string;
    readonly files: readonly string[];
    readonly targets: readonly {
      readonly name: string;
      readonly configPath: string;
      readonly count: number;
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
  ): Promise<VersionResult & { readonly packageLocation?: string }>;
  command<Data>(options: {
    workspaceRoot: string;
    command: readonly string[];
    expectedCommand: string;
    configPath?: string;
    signal?: AbortSignal;
  }): Promise<{ result: ResultEnvelope<Data>; exitCode: number }>;
}

export const processSnapshotClient: SnapshotClient = {
  version: async (workspaceRoot, signal) => {
    const [version, resolved] = await Promise.all([
      runVersion(workspaceRoot, signal ? { signal } : {}),
      resolveWorkspaceRehearsal(workspaceRoot),
    ]);
    const location = relative(workspaceRoot, resolved.packageRoot);
    return {
      ...version,
      packageLocation:
        location === "" || location === ".." || location.startsWith(`..${sep}`)
          ? "repository node_modules/@rehearsal-db/core"
          : location,
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
): ProjectSnapshot => {
  if (error instanceof AdapterError) {
    return {
      workspaceName,
      workspaceRoot,
      availability:
        error.code === "package_missing" ? "package_missing" : "error",
      error: { code: error.code, message: error.message, suggestions: [] },
    };
  }
  if (error instanceof ContractError) {
    return {
      workspaceName,
      workspaceRoot,
      availability: "error",
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
  client = processSnapshotClient,
}: {
  readonly workspaceName: string;
  readonly workspaceRoot: string;
  readonly configPath?: string;
  readonly trusted: boolean;
  readonly signal?: AbortSignal;
  readonly client?: SnapshotClient;
}): Promise<ProjectSnapshot> => {
  if (!trusted) {
    return { workspaceName, workspaceRoot, availability: "untrusted" };
  }
  try {
    const version = await client.version(workspaceRoot, signal);
    const common = {
      workspaceRoot,
      ...(configPath ? { configPath } : {}),
      ...(signal ? { signal } : {}),
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
      },
      candidates: {
        count: candidates.result.data.candidateCount,
        digest: candidates.result.data.candidateSha256,
        files: candidates.result.data.candidates,
        targets: candidates.result.data.targets.map((target) => ({
          name: target.name,
          configPath: safeWorkspaceRelativePath(
            workspaceRoot,
            target.configPath,
          ),
          count: target.candidateCount,
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
          endpoint: runtimeStatus.endpoint,
        })),
      },
      ...(isLoopbackApplicationUrl(applicationUrl) ? { applicationUrl } : {}),
    };
  } catch (error) {
    return failureSnapshot(workspaceName, workspaceRoot, error);
  }
};
