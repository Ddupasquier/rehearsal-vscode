import { realpath } from "node:fs/promises";
import { basename, relative, sep } from "node:path";
import type {
  ActivityData,
  BaselineData,
  CandidatesData,
  DoctorData,
  ExplainData,
  ProjectDiscoveryData,
  ResourceInventoryData,
  ResultEnvelope,
  StatusData,
  VersionResult,
} from "./contracts.js";
import {
  ContractError,
  parseActivityData,
  parseProjectDiscoveryData,
  parseResourceInventoryData,
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
import {
  parseAuthenticationReview,
  parseBaselineScopeReview,
  parseBaselineInspectionData,
  parseReviewTargets,
  type AuthenticationReview,
  type BaselineScopeReview,
} from "./review_contract.js";
import { isLocalEndpoint } from "./local_endpoint.js";
import {
  parseMigrationReviewPlan,
  type MigrationReviewPlan,
} from "./migration_review.js";
import {
  parseConfigurationMetadata,
  type ConfigurationMetadata,
} from "./configuration_contract.js";
import {
  parseBaselineShapeData,
  type BaselineShapeData,
} from "./shape_contract.js";

export type ProjectAvailability =
  | "loading"
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
  readonly inspectedAt?: string;
  readonly availability: ProjectAvailability;
  readonly version?: string;
  readonly compatibility?: CoreCompatibility;
  readonly packageLocation?: string;
  readonly discovery?: {
    readonly source: "core" | "bootstrap";
    readonly profile: ProjectDiscoveryData;
  };
  readonly configPath?: string;
  readonly configurationMetadata?: ConfigurationMetadata;
  readonly activity?: ActivityData;
  readonly readiness?: {
    readonly state: "READY" | "NOT READY";
    readonly passed: number;
    readonly failed: number;
    readonly checks: readonly DoctorData["checks"][number][];
  };
  readonly baseline?: {
    readonly generationId: string;
    readonly createdAt: string | null;
    readonly tableCount: number;
    readonly rowCount: number;
    readonly migrationCount: number;
    readonly verification: string;
    readonly formatVersion?: 1 | 2;
    readonly migrationCutoff?: string;
    readonly migrationHistorySha256?: string | null;
    readonly sourceSchemaSha256?: string | null;
    readonly sanitizationPolicySha256?: string;
    readonly dataSha256?: string;
    readonly review?: BaselineScopeReview;
    readonly shape?: BaselineShapeData | null;
    readonly generations?: readonly {
      readonly generationId: string;
      readonly createdAt: string | null;
      readonly active: boolean;
      readonly formatVersion: 1 | 2;
      readonly rowCount: number;
      readonly tableCount: number;
      readonly migrationCount: number;
      readonly migrationCutoff: string;
      readonly storageAssetCount?: number;
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
  readonly migrationReview?: MigrationReviewPlan;
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
      readonly baselineGenerationId?: string;
      readonly candidateSha256?: string;
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
  readonly authenticationReview?: AuthenticationReview;
  readonly reviewTargets?: readonly {
    readonly name: string;
    readonly provider: "supabase" | "postgresql";
    readonly configurationSha256: string | null;
    readonly baseline: {
      readonly generationId: string;
      readonly formatVersion: 1 | 2 | null;
      readonly migrationCutoff: string;
      readonly migrationHistorySha256: string | null;
      readonly sourceSchemaSha256?: string | null;
      readonly sanitizationPolicySha256: string | null;
      readonly dataSha256: string | null;
      readonly rowCount: number;
      readonly tableCount: number;
      readonly migrationCount: number;
      readonly storageAssetCount: number | null;
      readonly storageBytes: number | null;
    } | null;
  }[];
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
  readonly resources?: ResourceInventoryData;
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
    timeoutMs?: number,
  ): Promise<
    VersionResult & {
      readonly packageLocation?: string;
      readonly projectDiscoverySchema?: 1 | null;
      readonly resourceInventorySchema?: 1 | null;
      readonly resourceManagerSchema?: 1 | null;
      readonly migrationReviewSchema?: 1 | null;
      readonly configurationReviewSchema?: 1 | null;
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
  version: async (workspaceRoot, signal, timeoutMs) => {
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
        resourceInventorySchema: resolved.resourceInventorySchema,
        resourceManagerSchema: resolved.resourceManagerSchema,
        migrationReviewSchema: resolved.migrationReviewSchema,
        configurationReviewSchema: resolved.configurationReviewSchema,
      };
    }
    const version = await runVersion(workspaceRoot, {
      ...(signal ? { signal } : {}),
      ...(timeoutMs !== undefined ? { timeoutMs } : {}),
    });
    return {
      ...version,
      packageLocation,
      projectDiscoverySchema: resolved.projectDiscoverySchema,
      resourceInventorySchema: resolved.resourceInventorySchema,
      resourceManagerSchema: resolved.resourceManagerSchema,
      migrationReviewSchema: resolved.migrationReviewSchema,
      configurationReviewSchema: resolved.configurationReviewSchema,
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

const failureSnapshot = (
  workspaceName: string,
  workspaceRoot: string,
  error: unknown,
  bootstrapDiscovery?: ProjectDiscoveryData,
  observedVersion?: ObservedVersion,
  partial: Pick<ProjectSnapshot, "activity" | "readiness"> & {
    readonly discovery?: ProjectSnapshot["discovery"];
  } = {},
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
  const safeProfile = partial.discovery?.profile ?? bootstrapDiscovery;
  const safeDiscovery = safeProfile
    ? {
        discovery: {
          source: partial.discovery?.source ?? ("bootstrap" as const),
          profile: safeProfile,
        },
      }
    : {};
  const partialEvidence = {
    ...(partial.activity ? { activity: partial.activity } : {}),
    ...(partial.readiness ? { readiness: partial.readiness } : {}),
  };
  if (error instanceof AdapterError) {
    return {
      workspaceName,
      workspaceRoot,
      availability:
        error.code === "package_missing" ? "package_missing" : "error",
      ...observed,
      ...safeDiscovery,
      ...partialEvidence,
      error: {
        code: error.code,
        message: error.message,
        suggestions:
          error.code === "timeout"
            ? [
                "Retry the read-only inspection.",
                "Increase Rehearsal: Inspection Timeout Seconds for this workspace if the project needs longer.",
                "Run Rehearsal Doctor for a focused readiness check.",
              ]
            : [],
      },
    };
  }
  if (error instanceof ContractError) {
    return {
      workspaceName,
      workspaceRoot,
      availability: "error",
      ...observed,
      ...safeDiscovery,
      ...partialEvidence,
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
      ...partialEvidence,
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
    ...partialEvidence,
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
  compatibility: coreCompatibilityFor(version),
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
  let observedActivity: ActivityData | undefined;
  let observedDiscovery: ProjectSnapshot["discovery"] | undefined =
    bootstrapDiscovery
      ? { source: "bootstrap", profile: bootstrapDiscovery }
      : undefined;
  let observedReadiness: ProjectSnapshot["readiness"] | undefined;
  try {
    const version = await client.version(workspaceRoot, signal, timeoutMs);
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
    observedActivity = activity;
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
    observedDiscovery = discovery
      ? {
          source: version.projectDiscoverySchema === 1 ? "core" : "bootstrap",
          profile: discovery,
        }
      : undefined;
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
    observedReadiness = readiness;
    if (doctor.result.status === "not_ready") {
      let configurationMetadata: ConfigurationMetadata | undefined;
      if (
        version.configurationReviewSchema === 1 &&
        discovery?.configuration.activePath
      ) {
        try {
          const metadata = await client.command<unknown>({
            ...common,
            command: ["configuration"],
            expectedCommand: "configuration",
          });
          requireRehearsalVersion(version.version, [metadata.result]);
          configurationMetadata = parseConfigurationMetadata(
            metadata.result.data,
          );
        } catch {
          // An unavailable configuration review must not hide the actionable Doctor result.
        }
      }
      const finalActivityExecution = await client.command<ActivityData>({
        ...common,
        command: ["activity"],
        expectedCommand: "activity",
      });
      requireRehearsalVersion(version.version, [finalActivityExecution.result]);
      const finalActivity = parseActivityData(
        finalActivityExecution.result.data,
      );
      if (finalActivity.state !== "idle")
        return activityOnlySnapshot({
          workspaceName,
          workspaceRoot,
          version: version.version,
          ...(version.packageLocation
            ? { packageLocation: version.packageLocation }
            : {}),
          activity: finalActivity,
        });
      return {
        workspaceName,
        workspaceRoot,
        availability: "not_ready",
        version: version.version,
        compatibility,
        ...(version.packageLocation
          ? { packageLocation: version.packageLocation }
          : {}),
        activity: finalActivity,
        ...discoverySnapshot,
        readiness,
        ...(configurationMetadata
          ? { configurationMetadata, configPath: configurationMetadata.path }
          : {}),
      };
    }
    const [
      explain,
      baselineExecution,
      candidates,
      status,
      resources,
      migrationReview,
      configurationMetadata,
    ] = await Promise.all([
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
      version.resourceInventorySchema === 1
        ? client.command<ResourceInventoryData>({
            ...common,
            command: [
              version.resourceManagerSchema === 1
                ? "resources"
                : "environments",
            ],
            expectedCommand:
              version.resourceManagerSchema === 1
                ? "resources"
                : "environments",
          })
        : Promise.resolve(null),
      version.migrationReviewSchema === 1
        ? client.command<unknown>({
            ...common,
            command: ["inspect", "plan"],
            expectedCommand: "inspect plan",
          })
        : Promise.resolve(null),
      version.configurationReviewSchema === 1
        ? client.command<unknown>({
            ...common,
            command: ["configuration"],
            expectedCommand: "configuration",
          })
        : Promise.resolve(null),
    ]);
    const finalActivityExecution = await client.command<ActivityData>({
      ...common,
      command: ["activity"],
      expectedCommand: "activity",
    });
    const applicationUrl = explain.result.data.environment.applicationUrl;
    requireRehearsalVersion(version.version, [
      explain.result,
      baselineExecution.result,
      candidates.result,
      status.result,
      ...(resources ? [resources.result] : []),
      finalActivityExecution.result,
      ...(migrationReview ? [migrationReview.result] : []),
      ...(configurationMetadata ? [configurationMetadata.result] : []),
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
    const baseline = {
      ...baselineExecution,
      result: {
        ...baselineExecution.result,
        data: parseBaselineInspectionData(baselineExecution.result.data),
      },
    };
    const shape =
      baseline.result.data.shape === undefined ||
      baseline.result.data.shape === null
        ? null
        : parseBaselineShapeData(baseline.result.data.shape);
    if (
      shape &&
      (shape.generationId !== baseline.result.data.generationId ||
        shape.baselineDataSha256 !== baseline.result.data.dataSha256 ||
        shape.privacyPolicySha256 !==
          baseline.result.data.sanitizationPolicySha256)
    )
      throw new ContractError(
        "Shape evidence does not belong to the active baseline and privacy policy.",
      );
    const statusTargets =
      "targets" in statusData ? statusData.targets : [statusData];
    const states = new Set(
      statusTargets.map(({ runtimeStatus }) => runtimeStatus.state),
    );
    return {
      workspaceName,
      workspaceRoot,
      availability: "ready",
      inspectedAt: new Date().toISOString(),
      version: version.version,
      compatibility,
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
        ...(baseline.result.data.shape !== undefined ? { shape } : {}),
        ...(baseline.result.data.formatVersion
          ? { formatVersion: baseline.result.data.formatVersion }
          : {}),
        migrationCutoff: baseline.result.data.migrationCutoff,
        ...(baseline.result.data.migrationHistorySha256 !== undefined
          ? {
              migrationHistorySha256:
                baseline.result.data.migrationHistorySha256,
            }
          : {}),
        ...(baseline.result.data.sourceSchemaSha256 !== undefined
          ? { sourceSchemaSha256: baseline.result.data.sourceSchemaSha256 }
          : {}),
        ...(baseline.result.data.sanitizationPolicySha256
          ? {
              sanitizationPolicySha256:
                baseline.result.data.sanitizationPolicySha256,
            }
          : {}),
        ...(baseline.result.data.dataSha256
          ? { dataSha256: baseline.result.data.dataSha256 }
          : {}),
        ...(baseline.result.data.review !== undefined
          ? { review: parseBaselineScopeReview(baseline.result.data.review) }
          : {}),
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
            ...(baseline.result.data.review
              ? {
                  storageAssetCount: parseBaselineScopeReview(
                    baseline.result.data.review,
                  ).storage.assetCount,
                }
              : {}),
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
          baselineGenerationId: runtimeStatus.baselineGenerationId,
          candidateSha256: runtimeStatus.candidateSha256,
          verifiedRuntimeAvailable: runtimeStatus.verifiedRuntimeAvailable,
          endpoint: runtimeStatus.endpoint,
        })),
      },
      ...(resources
        ? { resources: parseResourceInventoryData(resources.result.data) }
        : {}),
      ...(isLocalEndpoint(applicationUrl) ? { applicationUrl } : {}),
      ...(migrationReview
        ? {
            migrationReview: parseMigrationReviewPlan(
              migrationReview.result.data,
            ),
          }
        : {}),
      ...(configurationMetadata
        ? {
            configurationMetadata: parseConfigurationMetadata(
              configurationMetadata.result.data,
            ),
          }
        : {}),
      ...((explain.result.data.authenticationReview ??
        explain.result.data.targets?.[0]?.plan.authenticationReview) !==
      undefined
        ? {
            authenticationReview: parseAuthenticationReview(
              explain.result.data.authenticationReview ??
                explain.result.data.targets?.[0]?.plan.authenticationReview,
            ),
          }
        : {}),
      reviewTargets: parseReviewTargets(explain.result.data),
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
      {
        ...(observedActivity ? { activity: observedActivity } : {}),
        ...(observedDiscovery ? { discovery: observedDiscovery } : {}),
        ...(observedReadiness ? { readiness: observedReadiness } : {}),
      },
    );
  }
};
