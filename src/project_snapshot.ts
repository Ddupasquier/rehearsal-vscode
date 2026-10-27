import {
  parseCommandCapabilities,
  supportsOfflineInspection,
  type CommandCapabilitiesObservation,
} from "./command_capabilities_contract.js";
import type {
  MigrationCutoff,
  DrizzleMigrationIdentity,
} from "./native_migration_contract.js";
import type { NativeMigrationToolBinding } from "./migration_review.js";
import { realpath } from "node:fs/promises";
import {
  parseEngineLifecycleStatus,
  type EngineLifecycleObservation,
} from "./engine_lifecycle_contract.js";
import { basename, relative, resolve, sep } from "node:path";
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
  assertInspectionPlatform,
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
  assertMatchingMigrationCandidates,
  parseMigrationReviewPlan,
  matchingNativeMigrationHistory,
  matchingDrizzleBaselineReview,
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
import {
  MIGRATION_INSIGHTS_OUTPUT_BYTES,
  parseMigrationInsights,
  type MigrationInsights,
} from "./migration_insights.js";

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
  readonly commandCapabilities?: CommandCapabilitiesObservation;
  readonly offlineInspection?: { readonly state: "available" };
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
    readonly formatVersion?: 1 | 2 | 3 | 4;
    readonly nativeMigrations?: NativeMigrationToolBinding;
    readonly migrationCutoff?: MigrationCutoff;
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
      readonly formatVersion: 1 | 2 | 3 | 4;
      readonly nativeMigrations?: NativeMigrationToolBinding;
      readonly rowCount: number;
      readonly tableCount: number;
      readonly migrationCount: number;
      readonly migrationCutoff: MigrationCutoff;
      readonly storageAssetCount?: number;
    }[];
  };
  readonly candidates?: {
    readonly count: number;
    readonly digest: string;
    readonly files: readonly (
      | string
      | {
          readonly version?: string | undefined;
          readonly nativeIdentity?: DrizzleMigrationIdentity;
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
  readonly migrationInsights?:
    | { readonly state: "available"; readonly report: MigrationInsights }
    | { readonly state: "unavailable" };
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
      readonly formatVersion: 1 | 2 | 3 | 4 | null;
      readonly nativeMigrations?: NativeMigrationToolBinding;
      readonly migrationCutoff: MigrationCutoff;
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
    readonly cleanup?: {
      readonly retainBaselineGenerations: number;
    };
  };
  readonly resources?: ResourceInventoryData;
  readonly engineLifecycle?: EngineLifecycleObservation;
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
      readonly drizzleMigrationsSchema?: 1 | null;
      readonly commandCapabilitiesSchema?: 1 | null;
      readonly commandCapabilitiesAdvertised?: boolean;
      readonly migrationInsightsSchema?: 1 | null;
      readonly configurationReviewSchema?: 1 | null;
      readonly engineLifecycleSchema?: 1 | null;
    }
  >;
  command<Data>(options: {
    workspaceRoot: string;
    command: readonly string[];
    expectedCommand: string;
    configPath?: string;
    signal?: AbortSignal;
    timeoutMs?: number;
    outputLimitBytes?: number;
  }): Promise<{ result: ResultEnvelope<Data>; exitCode: number }>;
}

type ObservedVersion = Awaited<ReturnType<SnapshotClient["version"]>>;

export const processSnapshotClient: SnapshotClient = {
  version: async (workspaceRoot, signal, timeoutMs) => {
    assertInspectionPlatform();
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
        drizzleMigrationsSchema: resolved.drizzleMigrationsSchema ?? null,
        commandCapabilitiesSchema: resolved.commandCapabilitiesSchema ?? null,
        commandCapabilitiesAdvertised:
          resolved.commandCapabilitiesAdvertised ?? false,
        migrationInsightsSchema: resolved.migrationInsightsSchema,
        configurationReviewSchema: resolved.configurationReviewSchema,
        engineLifecycleSchema: resolved.engineLifecycleSchema,
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
      drizzleMigrationsSchema: resolved.drizzleMigrationsSchema ?? null,
      commandCapabilitiesSchema: resolved.commandCapabilitiesSchema ?? null,
      commandCapabilitiesAdvertised:
        resolved.commandCapabilitiesAdvertised ?? false,
      migrationInsightsSchema: resolved.migrationInsightsSchema,
      configurationReviewSchema: resolved.configurationReviewSchema,
      engineLifecycleSchema: resolved.engineLifecycleSchema,
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

/** Explain metadata is untrusted JSON; omitted legacy readiness is not explicit null. */
const snapshotApplication = (
  value: unknown,
): NonNullable<ProjectSnapshot["configuration"]>["application"] | undefined => {
  if (value === undefined) return undefined;
  const invalid = (): never => {
    throw new ContractError(
      "Application configuration metadata is incomplete or unsafe. Refresh with a supported Rehearsal package.",
    );
  };
  if (!value || typeof value !== "object" || Array.isArray(value))
    return invalid();
  const data = value as Record<string, unknown>;
  const command = (source: unknown): string => {
    if (
      typeof source !== "string" ||
      !source.trim() ||
      source.length > 4096 ||
      /[\x00-\x1f\x7f-\x9f\u2028\u2029]/u.test(source)
    )
      return invalid();
    return source;
  };
  const startCommand = command(data.startCommand),
    proofCommand = command(data.proofCommand);
  if (!Object.hasOwn(data, "readiness")) return undefined;
  if (data.readiness === null)
    return { startCommand, proofCommand, readinessUrl: null };
  if (
    !data.readiness ||
    typeof data.readiness !== "object" ||
    Array.isArray(data.readiness)
  )
    return invalid();
  const readiness = data.readiness as Record<string, unknown>;
  if (
    typeof readiness.url !== "string" ||
    readiness.url.length > 4096 ||
    /[\x00-\x20\x7f-\x9f\u2028\u2029]/u.test(readiness.url) ||
    !Number.isSafeInteger(readiness.expectedStatus) ||
    Number(readiness.expectedStatus) < 100 ||
    Number(readiness.expectedStatus) > 599 ||
    !Number.isSafeInteger(readiness.timeoutSeconds) ||
    Number(readiness.timeoutSeconds) <= 0
  )
    return invalid();
  let url: URL;
  try {
    url = new URL(readiness.url);
  } catch {
    return invalid();
  }
  if (
    !["http:", "https:"].includes(url.protocol) ||
    !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) ||
    url.username ||
    url.password
  )
    return invalid();
  return { startCommand, proofCommand, readinessUrl: readiness.url };
};

const failureSnapshot = (
  workspaceName: string,
  workspaceRoot: string,
  error: unknown,
  bootstrapDiscovery?: ProjectDiscoveryData,
  observedVersion?: ObservedVersion,
  partial: Pick<ProjectSnapshot, "activity" | "readiness"> & {
    readonly discovery?: ProjectSnapshot["discovery"];
    readonly engineLifecycle?: EngineLifecycleObservation;
    readonly commandCapabilities?: CommandCapabilitiesObservation;
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
    ...(partial.commandCapabilities
      ? { commandCapabilities: partial.commandCapabilities }
      : {}),
    ...(partial.engineLifecycle
      ? { engineLifecycle: partial.engineLifecycle }
      : {}),
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
        message:
          error.code === "package_link_external"
            ? "The workspace Rehearsal package resolves outside its repository. Install a project-local package copy before refreshing."
            : error.message,
        suggestions:
          error.code === "package_link_external"
            ? [
                "Install the published @rehearsal-db/core package in this project, or install a reviewed packed .tgz candidate.",
                "For a local source folder with npm, use --install-links to install a package copy instead of an external symlink.",
                "Keep the repository boundary intact, then select Refresh. No database action is needed.",
              ]
            : error.code === "platform_unsupported"
              ? [
                  "Install Microsoft's WSL extension in VS Code and use a WSL 2 Linux distribution.",
                  "Keep this project in the distribution's Linux home, not a Windows-mounted drive.",
                  "Use WSL: Open Folder in WSL, then install Rehearsal DB in that WSL extension host.",
                  "Enable Docker Desktop integration for that distribution, or use its local Docker Engine.",
                ]
              : error.code === "timeout"
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
  engineLifecycle,
  commandCapabilities,
}: {
  workspaceName: string;
  workspaceRoot: string;
  version: string;
  packageLocation?: string;
  activity: ActivityData;
  engineLifecycle?: EngineLifecycleObservation;
  commandCapabilities?: CommandCapabilitiesObservation;
}): ProjectSnapshot => ({
  workspaceName,
  workspaceRoot,
  availability:
    activity.state === "busy" ? "operation_active" : "operation_attention",
  version,
  ...(packageLocation ? { packageLocation } : {}),
  compatibility: coreCompatibilityFor(version),
  activity,
  ...(engineLifecycle ? { engineLifecycle } : {}),
  ...(commandCapabilities ? { commandCapabilities } : {}),
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
  let observedEngine: EngineLifecycleObservation | undefined;
  let observedCapabilities: CommandCapabilitiesObservation | undefined;
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
    observedCapabilities = {
      state: version.commandCapabilitiesAdvertised
        ? "unsupported"
        : "not-advertised",
    };
    if (version.commandCapabilitiesSchema === 1) {
      let capabilitiesVersion: string | undefined;
      try {
        const execution = await client.command<unknown>({
          workspaceRoot,
          command: ["inspect", "capabilities"],
          expectedCommand: "inspect capabilities",
          ...(signal ? { signal } : {}),
          ...(timeoutMs ? { timeoutMs } : {}),
        });
        capabilitiesVersion = execution.result.rehearsalVersion;
        requireRehearsalVersion(version.version, [execution.result]);
        if (execution.result.status !== "success" || execution.exitCode !== 0)
          throw new ContractError("Capability inspection was not successful.");
        observedCapabilities = {
          state: "observed",
          report: parseCommandCapabilities(execution.result.data),
        };
      } catch (error) {
        if (error instanceof RehearsalCliError)
          requireRehearsalVersion(version.version, [error.result]);
        if (
          signal?.aborted ||
          (capabilitiesVersion !== undefined &&
            capabilitiesVersion !== version.version)
        )
          throw error;
        observedCapabilities = { state: "unavailable" };
      }
    }
    const activityOptions = {
      workspaceRoot,
      ...(signal ? { signal } : {}),
      ...(timeoutMs ? { timeoutMs } : {}),
    };
    const common = {
      workspaceRoot,
      ...(configPath ? { configPath } : {}),
      ...(signal ? { signal } : {}),
      ...(timeoutMs ? { timeoutMs } : {}),
    };
    observedEngine = { state: "unsupported" };
    if (version.engineLifecycleSchema === 1) {
      observedEngine = { state: "unavailable" };
      let engineVersion: string | undefined;
      try {
        const execution = await client.command<unknown>({
          workspaceRoot,
          command: ["engine", "status"],
          expectedCommand: "engine status",
          ...(signal ? { signal } : {}),
          ...(timeoutMs ? { timeoutMs } : {}),
        });
        engineVersion = execution.result.rehearsalVersion;
        requireRehearsalVersion(version.version, [execution.result]);
        if (execution.result.status !== "success")
          throw new ContractError("Engine inspection was not successful.");
        observedEngine = {
          state: "available",
          report: parseEngineLifecycleStatus(execution.result.data),
        };
      } catch (error) {
        if (
          signal?.aborted ||
          (engineVersion !== undefined && engineVersion !== version.version)
        )
          throw error;
        observedEngine = { state: "unavailable" };
      }
    }
    const activityExecution = await client.command<ActivityData>({
      ...activityOptions,
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
        engineLifecycle: observedEngine,
        commandCapabilities: observedCapabilities,
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
    let offlineOnly = false;
    let checkedConfiguration:
      { result: ResultEnvelope<unknown>; exitCode: number } | undefined;
    if (doctor.result.status === "not_ready") {
      let configurationMetadata: ConfigurationMetadata | undefined;
      let resources: ResourceInventoryData | undefined;
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
          if (metadata.result.status !== "success")
            throw new ContractError(
              "Configuration review did not complete successfully.",
            );
          configurationMetadata = parseConfigurationMetadata(
            metadata.result.data,
          );
          checkedConfiguration = metadata;
          if (
            configurationMetadata.path.replaceAll("\\", "/") !==
            discovery.configuration.activePath.replaceAll("\\", "/")
          )
            configurationMetadata = undefined;
        } catch {
          // An unavailable configuration review must not hide the actionable Doctor result.
        }
      }
      offlineOnly =
        configurationMetadata !== undefined &&
        version.migrationReviewSchema === 1 &&
        supportsOfflineInspection(observedCapabilities, [
          "configuration",
          "explain",
          "inspect baseline",
          "candidates",
          "inspect plan",
        ]);
      if (!offlineOnly) {
        if (configurationMetadata && version.resourceInventorySchema === 1) {
          try {
            // Inventory needs validated configuration, not a baseline or running engine.
            // A detailed endpoint refusal is not authority to bypass its local-engine guard.
            const command =
              version.resourceManagerSchema === 1
                ? "resources"
                : "environments";
            const inventory = await client.command<unknown>({
              ...common,
              configPath: configurationMetadata.path,
              command: [command],
              expectedCommand: command,
            });
            requireRehearsalVersion(version.version, [inventory.result]);
            if (inventory.result.status !== "success")
              throw new ContractError(
                "Resource inventory did not complete successfully.",
              );
            resources = parseResourceInventoryData(inventory.result.data);
          } catch {
            // Keep the original actionable Doctor checks; unavailable/unsafe optional evidence stays absent.
          }
        }
        const finalActivityExecution = await client.command<ActivityData>({
          ...activityOptions,
          command: ["activity"],
          expectedCommand: "activity",
        });
        requireRehearsalVersion(version.version, [
          finalActivityExecution.result,
        ]);
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
            engineLifecycle: observedEngine,
            commandCapabilities: observedCapabilities,
          });
        return {
          workspaceName,
          workspaceRoot,
          availability: "not_ready",
          inspectedAt: new Date().toISOString(),
          version: version.version,
          compatibility,
          ...(version.packageLocation
            ? { packageLocation: version.packageLocation }
            : {}),
          activity: finalActivity,
          engineLifecycle: observedEngine,
          commandCapabilities: observedCapabilities,
          ...discoverySnapshot,
          readiness,
          ...(configurationMetadata
            ? { configurationMetadata, configPath: configurationMetadata.path }
            : {}),
          ...(resources ? { resources } : {}),
        };
      }
    }
    const inspectionOptions =
      offlineOnly && checkedConfiguration
        ? {
            ...common,
            configPath: parseConfigurationMetadata(
              checkedConfiguration.result.data,
            ).path,
          }
        : common;
    const [
      explain,
      baselineExecution,
      candidates,
      status,
      resources,
      migrationReview,
      configurationMetadata,
      migrationInsights,
    ] = await Promise.all([
      client.command<ExplainData>({
        ...inspectionOptions,
        command: ["explain"],
        expectedCommand: "explain",
      }),
      client.command<BaselineData>({
        ...inspectionOptions,
        command: ["inspect", "baseline"],
        expectedCommand: "inspect baseline",
      }),
      client.command<CandidatesData>({
        ...inspectionOptions,
        command: ["candidates"],
        expectedCommand: "candidates",
      }),
      offlineOnly
        ? Promise.resolve(null)
        : client.command<StatusData>({
            ...inspectionOptions,
            command: ["status"],
            expectedCommand: "status",
          }),
      !offlineOnly && version.resourceInventorySchema === 1
        ? client.command<ResourceInventoryData>({
            ...inspectionOptions,
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
            ...inspectionOptions,
            command: ["inspect", "plan"],
            expectedCommand: "inspect plan",
          })
        : Promise.resolve(null),
      checkedConfiguration
        ? Promise.resolve(checkedConfiguration)
        : version.configurationReviewSchema === 1
          ? client.command<unknown>({
              ...inspectionOptions,
              command: ["configuration"],
              expectedCommand: "configuration",
            })
          : Promise.resolve(null),
      version.migrationReviewSchema === 1 &&
      version.migrationInsightsSchema === 1 &&
      (!offlineOnly ||
        supportsOfflineInspection(observedCapabilities, ["inspect insights"]))
        ? client
            .command<unknown>({
              ...inspectionOptions,
              command: ["inspect", "insights"],
              expectedCommand: "inspect insights",
              outputLimitBytes: MIGRATION_INSIGHTS_OUTPUT_BYTES,
            })
            .catch((error: unknown) => {
              if (error instanceof RehearsalCliError)
                requireRehearsalVersion(version.version, [error.result]);
              return null;
            })
        : Promise.resolve(undefined),
    ]);
    const finalActivityExecution = await client.command<ActivityData>({
      ...activityOptions,
      command: ["activity"],
      expectedCommand: "activity",
    });
    if (offlineOnly) {
      const required = [
        explain,
        baselineExecution,
        candidates,
        migrationReview,
        configurationMetadata,
      ];
      if (
        required.some(
          (execution) =>
            !execution ||
            execution.result.status !== "success" ||
            execution.exitCode !== 0,
        )
      )
        throw new ContractError(
          "Offline review did not complete successfully. Runtime readiness remains unproven.",
        );
      const configuration = parseConfigurationMetadata(
        configurationMetadata!.result.data,
      );
      if (
        resolve(workspaceRoot, configuration.path) !==
        explain.result.data.config.path
      )
        throw new ContractError(
          "Offline configuration and project plan identities disagree. Refresh the project.",
        );
    }
    const applicationUrl = explain.result.data.environment.applicationUrl;
    requireRehearsalVersion(version.version, [
      explain.result,
      baselineExecution.result,
      candidates.result,
      ...(status ? [status.result] : []),
      ...(resources ? [resources.result] : []),
      finalActivityExecution.result,
      ...(migrationReview ? [migrationReview.result] : []),
      ...(configurationMetadata ? [configurationMetadata.result] : []),
      ...(migrationInsights ? [migrationInsights.result] : []),
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
        engineLifecycle: observedEngine,
        commandCapabilities: observedCapabilities,
      });
    }
    const statusData = status ? parseStatusData(status.result.data) : null;
    const reviewTargets = parseReviewTargets(explain.result.data);
    const parsedMigrationReview = migrationReview
      ? parseMigrationReviewPlan(migrationReview.result.data)
      : undefined;
    if (parsedMigrationReview) {
      if (
        parsedMigrationReview.targets.some(
          (t) => t.migrationTool?.kind === "drizzle",
        ) &&
        version.drizzleMigrationsSchema !== 1
      )
        throw new ContractError(
          "This Core package does not advertise the supported Drizzle migration contract. Update Core manually and refresh.",
        );
      if (
        migrationReview!.result.status !== "success" ||
        candidates.result.status !== "success"
      )
        throw new ContractError(
          "Migration review did not complete successfully.",
        );
      assertMatchingMigrationCandidates(
        parsedMigrationReview,
        candidates.result.data,
      );
      if (
        reviewTargets.length !== parsedMigrationReview.targets.length ||
        reviewTargets.some((target, index) => {
          const migrationTarget = parsedMigrationReview.targets[index]!;
          return (
            !matchingDrizzleBaselineReview(target.baseline, migrationTarget) ||
            target.name !== migrationTarget.name ||
            target.provider !== migrationTarget.provider ||
            !matchingNativeMigrationHistory(
              target.baseline?.nativeMigrations,
              migrationTarget.migrationTool,
            ) ||
            (target.baseline !== null &&
              target.baseline.generationId !==
                migrationTarget.baselineGenerationId)
          );
        }) ||
        parsedMigrationReview.targets[0]!.baselineGenerationId !==
          baselineExecution.result.data.generationId
      )
        throw new ContractError(
          "Migration plan and project target identities disagree. Refresh the project.",
        );
    }
    let parsedMigrationInsights: ProjectSnapshot["migrationInsights"];
    if (migrationInsights !== undefined && parsedMigrationReview) {
      try {
        if (!migrationInsights || migrationInsights.result.status !== "success")
          throw new Error("Optional static inspection is unavailable.");
        parsedMigrationInsights = {
          state: "available",
          report: parseMigrationInsights(
            migrationInsights.result.data,
            parsedMigrationReview,
            version.version,
          ),
        };
      } catch {
        parsedMigrationInsights = { state: "unavailable" };
      }
    }
    if (
      baselineExecution.result.data.formatVersion === 4 &&
      (version.drizzleMigrationsSchema !== 1 ||
        parsedMigrationReview?.targets[0]?.migrationTool?.kind !== "drizzle")
    )
      throw new ContractError(
        "Core does not advertise the supported Drizzle migration contract. Update Core manually and refresh.",
      );
    const baseline = {
      ...baselineExecution,
      result: {
        ...baselineExecution.result,
        data: parseBaselineInspectionData(
          baselineExecution.result.data,
          reviewTargets[0]!.provider,
        ),
      },
    };
    if (
      parsedMigrationReview &&
      (!matchingDrizzleBaselineReview(
        baseline.result.data,
        parsedMigrationReview.targets[0]!,
      ) ||
        !matchingNativeMigrationHistory(
          baseline.result.data.nativeMigrations,
          parsedMigrationReview.targets[0]!.migrationTool,
        ))
    )
      throw new ContractError(
        "Native baseline and current migration history identities disagree. Refresh the project.",
      );
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
    const statusTargets = statusData
      ? "targets" in statusData
        ? statusData.targets
        : [statusData]
      : [];
    const states = new Set(
      statusTargets.map(({ runtimeStatus }) => runtimeStatus.state),
    );
    const application = snapshotApplication(explain.result.data.application);
    return {
      workspaceName,
      workspaceRoot,
      availability: offlineOnly ? "not_ready" : "ready",
      ...(offlineOnly
        ? { offlineInspection: { state: "available" as const } }
        : {}),
      commandCapabilities: observedCapabilities,
      inspectedAt: new Date().toISOString(),
      version: version.version,
      compatibility,
      ...(version.packageLocation
        ? { packageLocation: version.packageLocation }
        : {}),
      activity: finalActivity,
      engineLifecycle: observedEngine,
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
        ...(baseline.result.data.nativeMigrations
          ? { nativeMigrations: baseline.result.data.nativeMigrations }
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
            ...(baseline.result.data.nativeMigrations
              ? { nativeMigrations: baseline.result.data.nativeMigrations }
              : {}),
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
                ...(candidate.nativeIdentity
                  ? { nativeIdentity: candidate.nativeIdentity }
                  : { version: candidate.version }),
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
      ...(status
        ? {
            runtime: {
              state:
                states.size === 1
                  ? statusTargets[0]!.runtimeStatus.state
                  : "mixed",
              targets: statusTargets.map(({ target, runtimeStatus }) => ({
                name: target,
                state: runtimeStatus.state,
                reason: runtimeStatus.reason,
                runtimeTarget: runtimeStatus.runtimeTarget,
                baselineGenerationId: runtimeStatus.baselineGenerationId,
                candidateSha256: runtimeStatus.candidateSha256,
                verifiedRuntimeAvailable:
                  runtimeStatus.verifiedRuntimeAvailable,
                endpoint: runtimeStatus.endpoint,
              })),
            },
          }
        : {}),
      ...(resources
        ? { resources: parseResourceInventoryData(resources.result.data) }
        : {}),
      ...(!offlineOnly && isLocalEndpoint(applicationUrl)
        ? { applicationUrl }
        : {}),
      ...(parsedMigrationReview
        ? { migrationReview: parsedMigrationReview }
        : {}),
      ...(parsedMigrationInsights
        ? { migrationInsights: parsedMigrationInsights }
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
      reviewTargets,
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
      ...(application
        ? {
            configuration: {
              application,
              ...(explain.result.data.cleanup
                ? { cleanup: explain.result.data.cleanup }
                : {}),
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
        ...(observedEngine ? { engineLifecycle: observedEngine } : {}),
        ...(observedCapabilities
          ? { commandCapabilities: observedCapabilities }
          : {}),
      },
    );
  }
};
