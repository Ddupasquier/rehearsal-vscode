import type { PrismaMigrationToolBinding } from "./migration_review.js";
import {
  parseEnvironmentClassification,
  parseEnvironmentProvenance,
  parseResourceCatalog,
} from "./resource_contract.js";
import {
  parseOperationKind,
  parseOperationVersion,
  parseOperationProgressSnapshot,
  parseRecentOperationProgress,
  parseRecentOperationFailures,
  type OperationProgressSnapshot,
  type RecentOperationProgress,
  type RecentOperationFailure,
} from "./operation_progress.js";

export const RESULT_SCHEMA_VERSION = 1 as const;

export type RehearsalStatus = "success" | "not_ready" | "error";

export interface VersionResult {
  readonly name: "@rehearsal-db/core";
  readonly version: string;
}

export interface ResultEnvelope<Data> {
  readonly schemaVersion: typeof RESULT_SCHEMA_VERSION;
  readonly rehearsalVersion: string;
  readonly command: string;
  readonly status: Exclude<RehearsalStatus, "error">;
  readonly startedAt: string;
  readonly durationMs: number;
  readonly warnings: readonly string[];
  readonly data: Data;
}

export interface ErrorEnvelope {
  readonly schemaVersion: typeof RESULT_SCHEMA_VERSION;
  readonly rehearsalVersion: string;
  readonly status: "error";
  readonly error: {
    readonly category: string;
    readonly code: string;
    readonly message: string;
    readonly suggestions: readonly string[];
    readonly diagnosticId: string;
  };
}

export interface DoctorCheck {
  readonly id: string;
  readonly label: string;
  readonly status: "pass" | "fail" | "warn";
  readonly detail: string;
  readonly remediation?: string;
}

export interface DoctorData {
  readonly state: "READY" | "NOT READY";
  readonly checks: readonly DoctorCheck[];
}

export interface CandidateTarget {
  readonly name: string;
  readonly configPath: string;
  readonly candidateSha256: string;
  readonly candidateCount: number;
  readonly candidates: readonly (CandidateMigration | string)[];
}

export interface CandidateMigration {
  readonly version: string;
  readonly name: string;
  readonly filename: string;
  readonly sha256: string;
  readonly status: "candidate";
  readonly target?: string;
}

export interface CandidatesData {
  readonly baselineGenerationId: string;
  readonly candidateSha256: string;
  readonly candidateCount: number;
  readonly candidates: readonly (CandidateMigration | string)[];
  readonly targets: readonly CandidateTarget[];
}

export interface BaselineData {
  readonly formatVersion?: 1 | 2 | 3;
  readonly nativeMigrations?: PrismaMigrationToolBinding;
  readonly generationId: string;
  readonly createdAt: string | null;
  readonly migrationCutoff: string;
  readonly tableCount: number;
  readonly rowCount: number;
  readonly migrationCount: number;
  readonly verification: string;
  readonly migrationHistorySha256?: string | null;
  readonly sourceSchemaSha256?: string | null;
  readonly sanitizationPolicySha256?: string;
  readonly dataSha256?: string;
  readonly review?: unknown;
  readonly shape?: unknown;
  readonly generations?: readonly {
    readonly generationId: string;
    readonly createdAt: string | null;
    readonly active: boolean;
    readonly formatVersion: 1 | 2 | 3;
    readonly nativeMigrations?: PrismaMigrationToolBinding;
    readonly rowCount: number;
    readonly tableCount: number;
    readonly migrationCount: number;
    readonly migrationCutoff: string;
    readonly storageAssetCount: number;
  }[];
}

export interface ExplainData {
  readonly config: {
    readonly schemaVersion: number;
    readonly sha256?: string;
    readonly path: string;
    readonly project: string;
  };
  readonly environment: {
    readonly target: string;
    readonly applicationUrl: string;
    readonly projectId?: string;
    readonly ports?: Readonly<Record<string, number>>;
    readonly hostedAccess?: "disabled";
    readonly outboundNetwork?: "deny";
    readonly authenticationProviders?: readonly string[];
    readonly authenticationCallback?: string | null;
  };
  readonly lifecycle?: {
    readonly run: "keep-until-stop" | "stop-after-run";
    readonly open: "keep-until-stop" | "stop-on-application-exit";
    readonly dataOnStop: "preserved";
  };
  readonly application?: {
    readonly startCommand: string;
    readonly proofCommand: string;
    readonly readiness: {
      readonly url: string;
      readonly expectedStatus: number;
      readonly timeoutSeconds: number;
    } | null;
  };
  readonly cleanup?: {
    readonly retainBaselineGenerations: number;
  };
  readonly baselineReview?: unknown;
  readonly authenticationReview?: unknown;
  readonly baseline?: BaselineData;
  readonly targets?: readonly {
    readonly name: string;
    readonly plan: Omit<ExplainData, "targets">;
  }[];
}

export type RuntimeState = "running" | "stopped" | "unavailable" | "unhealthy";

export type RuntimeStateReason =
  | "container_engine_unavailable"
  | "runtime_not_running"
  | "health_check_failed";

export interface RuntimeStatusSnapshot {
  readonly schemaVersion: 1;
  readonly state: RuntimeState;
  readonly reason: RuntimeStateReason | null;
  readonly runtimeTarget: "supabase" | "postgresql";
  readonly projectId: string;
  /** Null means the installed core predates this additive status field. */
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
  readonly baselineGenerationId: string;
  readonly candidateSha256: string;
  readonly candidates: readonly string[];
}

export interface StatusTargetData {
  readonly action: "status";
  readonly target: string;
  readonly durationMs: number;
  readonly runtimeStatus: RuntimeStatusSnapshot;
}

export type StatusData =
  | StatusTargetData
  | {
      readonly action: "status";
      readonly durationMs: number;
      readonly targets: readonly StatusTargetData[];
    };

export type ActivityState = "idle" | "busy" | "stale" | "invalid";

export interface ActivityData {
  readonly schemaVersion: 1;
  readonly state: ActivityState;
  readonly operation: {
    readonly kind: string;
    readonly startedAt: string;
    readonly rehearsalVersion: string | null;
    readonly progress?: OperationProgressSnapshot | null;
  } | null;
  readonly recent?: readonly RecentOperationProgress[] | null;
  readonly recentFailures?: readonly RecentOperationFailure[] | null;
}

export interface ResourceInventoryData {
  readonly catalog?:
    import("./resource_contract.js").ResourceCatalogData | null;
  readonly schemaVersion: 1;
  readonly inspectedAt: string;
  readonly engine: {
    readonly state: "running" | "stopped";
    readonly context: string | null;
    readonly disk: {
      readonly backend: "colima";
      readonly totalBytes: number;
      readonly usedBytes: number;
      readonly availableBytes: number;
      readonly usedPercent: number;
    } | null;
    readonly resources: readonly {
      readonly type: string;
      readonly totalCount: number | null;
      readonly activeCount: number | null;
      readonly size: string | null;
      readonly reclaimable: string | null;
    }[];
  };
  readonly environments: readonly {
    readonly target: string;
    readonly displayName?: string;
    readonly protected?: boolean;
    readonly projectId: string;
    readonly provider: "supabase" | "postgresql";
    readonly configPath: string;
    readonly state: "running" | "stopped" | "absent" | "mixed" | "unavailable";
    readonly containerCount: number;
    readonly runningContainerCount: number;
    readonly volumeCount: number;
    readonly diskUsageBytes: number | null;
    readonly cpuPercent: number | null;
    readonly memoryUsageBytes: number | null;
    readonly memoryLimitBytes: number | null;
    readonly createdAt: string | null;
    readonly lastActivityAt: string | null;
    readonly retention: "persistent" | "disposable";
    readonly cleanupEligibility:
      "running" | "preview-required" | "not-present" | "inspection-unavailable";
    readonly restartPolicies: readonly string[];
    readonly provenance?: import("./resource_contract.js").EnvironmentProvenanceData;
    readonly classification?: import("./resource_contract.js").EnvironmentClassificationData;
  }[];
  readonly stale: {
    readonly stoppedCount: number;
    readonly digest: string | null;
    readonly targets: readonly string[];
  };
}

export type DiscoveryValue = string | number | boolean | readonly string[];

export interface DiscoveryEvidence {
  readonly kind: "file" | "manifest" | "script" | "runtime_probe";
  readonly source: string;
  readonly detail: string;
}

interface DiscoveryItemBase {
  readonly id: string;
  readonly label: string;
  readonly value: DiscoveryValue;
  readonly evidence: readonly DiscoveryEvidence[];
}

export interface DetectedDiscoveryItem extends DiscoveryItemBase {
  readonly category: "detected";
}

export interface SuggestedDiscoveryItem extends DiscoveryItemBase {
  readonly category: "suggested";
  readonly confidence: "high" | "medium" | "low";
  readonly configPath?: string;
  readonly review: string;
}

export interface DecisionDiscoveryItem extends DiscoveryItemBase {
  readonly category: "decision";
  readonly configPath?: string;
  readonly question: string;
  readonly reason: string;
}

export interface DiscoveryConfigurationField {
  readonly path: string;
  readonly status:
    "present_unvalidated" | "suggested" | "decision_required" | "not_detected";
  readonly value?: DiscoveryValue;
  readonly sourceItemIds: readonly string[];
}

export interface ProjectDiscoveryData {
  readonly schemaVersion: 1;
  readonly project: {
    readonly name: string;
    readonly packageManifest: "present" | "missing";
  };
  readonly detected: readonly DetectedDiscoveryItem[];
  readonly suggested: readonly SuggestedDiscoveryItem[];
  readonly decisions: readonly DecisionDiscoveryItem[];
  readonly configuration: {
    readonly state: "missing" | "present_unvalidated" | "ambiguous";
    readonly activePath: string | null;
    readonly discoveredPaths: readonly string[];
    readonly fields: readonly DiscoveryConfigurationField[];
  };
  readonly safety: {
    readonly projectCodeExecuted: false;
    readonly environmentFilesRead: false;
    readonly databaseContacted: false;
    readonly containerEngineStarted: false;
  };
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);

function requireString(value: unknown, field: string): asserts value is string {
  if (typeof value !== "string" || value.length === 0) {
    throw new ContractError(`Expected ${field} to be a non-empty string.`);
  }
}

const requireFiniteNumber = (value: unknown, field: string): number => {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new ContractError(`Expected ${field} to be a finite number.`);
  }
  return value;
};

const requireStringArray = (value: unknown, field: string): string[] => {
  if (
    !Array.isArray(value) ||
    !value.every((entry) => typeof entry === "string" && entry.length > 0)
  ) {
    throw new ContractError(`Expected ${field} to be a string array.`);
  }
  return [...value] as string[];
};

const requireBoundedString = (value: unknown, field: string): string => {
  requireString(value, field);
  if (value.length > 500 || /[\r\n\0]/u.test(value)) {
    throw new ContractError(
      `Expected ${field} to be a bounded single-line string.`,
    );
  }
  return value;
};

const parseDiscoveryValue = (value: unknown, field: string): DiscoveryValue => {
  if (typeof value === "string") return requireBoundedString(value, field);
  if (typeof value === "boolean") return value;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (
    Array.isArray(value) &&
    value.length <= 100 &&
    value.every(
      (entry) =>
        typeof entry === "string" &&
        entry.length > 0 &&
        entry.length <= 500 &&
        !/[\r\n\0]/u.test(entry),
    )
  ) {
    return [...value] as string[];
  }
  throw new ContractError(`Discovery ${field} has an unsupported value.`);
};

const parseDiscoveryEvidence = (
  value: unknown,
  field: string,
): DiscoveryEvidence => {
  if (!isRecord(value)) {
    throw new ContractError(`Discovery ${field} is not an object.`);
  }
  const kinds = ["file", "manifest", "script", "runtime_probe"] as const;
  if (!kinds.includes(value.kind as DiscoveryEvidence["kind"])) {
    throw new ContractError(`Discovery ${field} has an unsupported kind.`);
  }
  const source = requireBoundedString(value.source, `${field}.source`);
  const detail = requireBoundedString(value.detail, `${field}.detail`);
  if (
    (value.kind === "file" ||
      value.kind === "manifest" ||
      value.kind === "script") &&
    (source.startsWith("/") ||
      source.startsWith("../") ||
      source.includes("/../"))
  ) {
    throw new ContractError(`Discovery ${field} escaped the workspace.`);
  }
  return {
    kind: value.kind as DiscoveryEvidence["kind"],
    source,
    detail,
  };
};

const parseDiscoveryEvidenceList = (
  value: unknown,
  field: string,
): readonly DiscoveryEvidence[] => {
  if (!Array.isArray(value) || value.length > 25) {
    throw new ContractError(`Discovery ${field} is not a bounded array.`);
  }
  return value.map((entry, index) =>
    parseDiscoveryEvidence(entry, `${field}[${index}]`),
  );
};

const parseDiscoveryBase = (value: Record<string, unknown>, field: string) => ({
  id: requireBoundedString(value.id, `${field}.id`),
  label: requireBoundedString(value.label, `${field}.label`),
  value: parseDiscoveryValue(value.value, `${field}.value`),
  evidence: parseDiscoveryEvidenceList(value.evidence, `${field}.evidence`),
});

const optionalConfigPath = (
  value: unknown,
  field: string,
): { readonly configPath?: string } =>
  value === undefined ? {} : { configPath: requireBoundedString(value, field) };

export const parseProjectDiscoveryData = (
  value: unknown,
): ProjectDiscoveryData => {
  if (!isRecord(value) || value.schemaVersion !== 1) {
    throw new ContractError("Project discovery schema is unsupported.");
  }
  if (!isRecord(value.project)) {
    throw new ContractError("Project discovery is missing its project object.");
  }
  const packageManifest = value.project.packageManifest;
  if (packageManifest !== "present" && packageManifest !== "missing") {
    throw new ContractError("Project discovery package state is unsupported.");
  }
  const parseItems = <Item>(
    entries: unknown,
    category: "detected" | "suggested" | "decision",
    parseAdditional: (
      entry: Record<string, unknown>,
      field: string,
    ) => Omit<Item, keyof DiscoveryItemBase | "category">,
  ): readonly Item[] => {
    if (!Array.isArray(entries) || entries.length > 100) {
      throw new ContractError(
        `Project discovery ${category} items are not bounded.`,
      );
    }
    return entries.map((entry, index) => {
      const field = `${category}[${index}]`;
      if (!isRecord(entry) || entry.category !== category) {
        throw new ContractError(
          `Project discovery ${field} has the wrong category.`,
        );
      }
      return {
        category,
        ...parseDiscoveryBase(entry, field),
        ...parseAdditional(entry, field),
      } as Item;
    });
  };
  const detected = parseItems<DetectedDiscoveryItem>(
    value.detected,
    "detected",
    () => ({}),
  );
  const suggested = parseItems<SuggestedDiscoveryItem>(
    value.suggested,
    "suggested",
    (entry, field) => {
      if (!["high", "medium", "low"].includes(String(entry.confidence))) {
        throw new ContractError(
          `Project discovery ${field} has invalid confidence.`,
        );
      }
      return {
        confidence: entry.confidence as SuggestedDiscoveryItem["confidence"],
        review: requireBoundedString(entry.review, `${field}.review`),
        ...optionalConfigPath(entry.configPath, `${field}.configPath`),
      };
    },
  );
  const decisions = parseItems<DecisionDiscoveryItem>(
    value.decisions,
    "decision",
    (entry, field) => ({
      question: requireBoundedString(entry.question, `${field}.question`),
      reason: requireBoundedString(entry.reason, `${field}.reason`),
      ...optionalConfigPath(entry.configPath, `${field}.configPath`),
    }),
  );
  if (!isRecord(value.configuration)) {
    throw new ContractError("Project discovery configuration is missing.");
  }
  const configurationStates = [
    "missing",
    "present_unvalidated",
    "ambiguous",
  ] as const;
  if (
    !configurationStates.includes(
      value.configuration.state as (typeof configurationStates)[number],
    )
  ) {
    throw new ContractError(
      "Project discovery configuration state is unsupported.",
    );
  }
  const discoveredPaths = requireStringArray(
    value.configuration.discoveredPaths,
    "configuration.discoveredPaths",
  );
  if (
    value.configuration.activePath !== null &&
    typeof value.configuration.activePath !== "string"
  ) {
    throw new ContractError("Project discovery active config path is invalid.");
  }
  if (
    !Array.isArray(value.configuration.fields) ||
    value.configuration.fields.length > 100
  ) {
    throw new ContractError("Project discovery fields are not bounded.");
  }
  const fieldStatuses = [
    "present_unvalidated",
    "suggested",
    "decision_required",
    "not_detected",
  ] as const;
  const fields = value.configuration.fields.map((entry, index) => {
    if (!isRecord(entry)) {
      throw new ContractError(`Project discovery field ${index} is invalid.`);
    }
    if (
      !fieldStatuses.includes(entry.status as (typeof fieldStatuses)[number])
    ) {
      throw new ContractError(
        `Project discovery field ${index} has invalid status.`,
      );
    }
    return {
      path: requireBoundedString(
        entry.path,
        `configuration.fields[${index}].path`,
      ),
      status: entry.status as DiscoveryConfigurationField["status"],
      ...(entry.value === undefined
        ? {}
        : {
            value: parseDiscoveryValue(
              entry.value,
              `configuration.fields[${index}].value`,
            ),
          }),
      sourceItemIds: requireStringArray(
        entry.sourceItemIds,
        `configuration.fields[${index}].sourceItemIds`,
      ),
    };
  });
  if (!isRecord(value.safety)) {
    throw new ContractError("Project discovery safety declaration is missing.");
  }
  for (const field of [
    "projectCodeExecuted",
    "environmentFilesRead",
    "databaseContacted",
    "containerEngineStarted",
  ]) {
    if (value.safety[field] !== false) {
      throw new ContractError(`Project discovery did not preserve ${field}.`);
    }
  }
  return {
    schemaVersion: 1,
    project: {
      name: requireBoundedString(value.project.name, "project.name"),
      packageManifest,
    },
    detected,
    suggested,
    decisions,
    configuration: {
      state: value.configuration
        .state as ProjectDiscoveryData["configuration"]["state"],
      activePath:
        value.configuration.activePath === null
          ? null
          : requireBoundedString(
              value.configuration.activePath,
              "configuration.activePath",
            ),
      discoveredPaths,
      fields,
    },
    safety: {
      projectCodeExecuted: false,
      environmentFilesRead: false,
      databaseContacted: false,
      containerEngineStarted: false,
    },
  };
};

const isLoopbackUrl = (value: string): boolean => {
  try {
    const url = new URL(value);
    return (
      ["http:", "https:"].includes(url.protocol) &&
      ["127.0.0.1", "localhost", "::1"].includes(url.hostname)
    );
  } catch {
    return false;
  }
};

export class ContractError extends Error {
  readonly code = "invalid_cli_contract";
}

export const parseVersionResult = (value: unknown): VersionResult => {
  if (!isRecord(value))
    throw new ContractError("Version result is not an object.");
  if (value.name !== "@rehearsal-db/core") {
    throw new ContractError("Version result names an unexpected package.");
  }
  requireString(value.version, "version");
  return { name: value.name, version: value.version };
};

export const parseEnvelope = <Data>(
  value: unknown,
  expectedCommand: string,
): ResultEnvelope<Data> | ErrorEnvelope => {
  if (!isRecord(value)) throw new ContractError("CLI result is not an object.");
  if (value.schemaVersion !== RESULT_SCHEMA_VERSION) {
    throw new ContractError(
      `Unsupported CLI result schema: ${String(value.schemaVersion)}.`,
    );
  }
  requireString(value.rehearsalVersion, "rehearsalVersion");
  if (value.status === "error") {
    if (!isRecord(value.error)) {
      throw new ContractError("Error result is missing its error object.");
    }
    requireString(value.error.category, "error.category");
    requireString(value.error.code, "error.code");
    requireString(value.error.message, "error.message");
    requireString(value.error.diagnosticId, "error.diagnosticId");
    if (
      !Array.isArray(value.error.suggestions) ||
      !value.error.suggestions.every((entry) => typeof entry === "string")
    ) {
      throw new ContractError("Error suggestions are not a string array.");
    }
    return value as unknown as ErrorEnvelope;
  }
  if (value.status !== "success" && value.status !== "not_ready") {
    throw new ContractError(`Unsupported CLI status: ${String(value.status)}.`);
  }
  if (value.command !== expectedCommand) {
    throw new ContractError(
      `Expected command ${expectedCommand}; received ${String(value.command)}.`,
    );
  }
  if (!("data" in value))
    throw new ContractError("CLI result is missing data.");
  return value as unknown as ResultEnvelope<Data>;
};

const parseRuntimeEndpoint = (
  value: unknown,
  target: RuntimeStatusSnapshot["runtimeTarget"],
): RuntimeStatusSnapshot["endpoint"] => {
  if (value === null) return null;
  if (!isRecord(value)) {
    throw new ContractError("Runtime endpoint is not an object.");
  }
  if (value.kind === "http" && target === "supabase") {
    requireString(value.url, "runtimeStatus.endpoint.url");
    if (!isLoopbackUrl(value.url)) {
      throw new ContractError("Runtime endpoint must stay on loopback.");
    }
    return { kind: "http", url: value.url };
  }
  if (value.kind === "postgresql" && target === "postgresql") {
    requireString(value.host, "runtimeStatus.endpoint.host");
    requireString(value.database, "runtimeStatus.endpoint.database");
    const port = requireFiniteNumber(value.port, "runtimeStatus.endpoint.port");
    if (
      !["127.0.0.1", "localhost", "::1"].includes(value.host) ||
      !Number.isInteger(port) ||
      port < 1 ||
      port > 65_535
    ) {
      throw new ContractError("Runtime PostgreSQL endpoint is invalid.");
    }
    return {
      kind: "postgresql",
      host: value.host as "127.0.0.1" | "localhost" | "::1",
      port,
      database: value.database,
    };
  }
  throw new ContractError("Runtime endpoint does not match its target.");
};

export const parseRuntimeStatus = (value: unknown): RuntimeStatusSnapshot => {
  if (!isRecord(value) || value.schemaVersion !== 1) {
    throw new ContractError("Runtime status schema is unsupported.");
  }
  const states = ["running", "stopped", "unavailable", "unhealthy"] as const;
  if (!states.includes(value.state as RuntimeState)) {
    throw new ContractError("Runtime state is unsupported.");
  }
  const state = value.state as RuntimeState;
  const expectedReason: RuntimeStateReason | null =
    state === "running"
      ? null
      : state === "stopped"
        ? "runtime_not_running"
        : state === "unavailable"
          ? "container_engine_unavailable"
          : "health_check_failed";
  if (value.reason !== expectedReason) {
    throw new ContractError("Runtime state and reason do not match.");
  }
  if (
    value.runtimeTarget !== "supabase" &&
    value.runtimeTarget !== "postgresql"
  ) {
    throw new ContractError("Runtime target is unsupported.");
  }
  requireString(value.projectId, "runtimeStatus.projectId");
  if (
    value.verifiedRuntimeAvailable !== undefined &&
    typeof value.verifiedRuntimeAvailable !== "boolean"
  ) {
    throw new ContractError(
      "Runtime verified-runtime availability is invalid.",
    );
  }
  requireString(
    value.baselineGenerationId,
    "runtimeStatus.baselineGenerationId",
  );
  requireString(value.candidateSha256, "runtimeStatus.candidateSha256");
  if (!/^[a-f0-9]{64}$/u.test(value.candidateSha256)) {
    throw new ContractError("Runtime candidate digest is invalid.");
  }
  const endpoint = parseRuntimeEndpoint(value.endpoint, value.runtimeTarget);
  if ((state === "running") !== (endpoint !== null)) {
    throw new ContractError("Runtime endpoint does not match its state.");
  }
  return {
    schemaVersion: 1,
    state,
    reason: expectedReason,
    runtimeTarget: value.runtimeTarget,
    projectId: value.projectId,
    verifiedRuntimeAvailable:
      typeof value.verifiedRuntimeAvailable === "boolean"
        ? value.verifiedRuntimeAvailable
        : null,
    endpoint,
    baselineGenerationId: value.baselineGenerationId,
    candidateSha256: value.candidateSha256,
    candidates: requireStringArray(
      value.candidates,
      "runtimeStatus.candidates",
    ),
  };
};

const parseStatusTarget = (value: unknown): StatusTargetData => {
  if (!isRecord(value) || value.action !== "status") {
    throw new ContractError("Runtime status target is invalid.");
  }
  requireString(value.target, "status.target");
  return {
    action: "status",
    target: value.target,
    durationMs: requireFiniteNumber(value.durationMs, "status.durationMs"),
    runtimeStatus: parseRuntimeStatus(value.runtimeStatus),
  };
};

export const parseStatusData = (value: unknown): StatusData => {
  if (!isRecord(value) || value.action !== "status") {
    throw new ContractError("Runtime status result is invalid.");
  }
  if (Array.isArray(value.targets)) {
    if (value.targets.length === 0) {
      throw new ContractError("Runtime status targets are empty.");
    }
    return {
      action: "status",
      durationMs: requireFiniteNumber(value.durationMs, "status.durationMs"),
      targets: value.targets.map(parseStatusTarget),
    };
  }
  return parseStatusTarget(value);
};

export const parseActivityData = (value: unknown): ActivityData => {
  if (!isRecord(value) || value.schemaVersion !== 1) {
    throw new ContractError("Activity schema is unsupported.");
  }
  const states = ["idle", "busy", "stale", "invalid"] as const;
  if (!states.includes(value.state as ActivityState)) {
    throw new ContractError("Activity state is unsupported.");
  }
  const state = value.state as ActivityState;
  const recent =
    value.recent === undefined
      ? {}
      : { recent: parseRecentOperationProgress(value.recent) };
  const failures =
    value.recentFailures === undefined
      ? {}
      : {
          recentFailures: parseRecentOperationFailures(
            value.recentFailures,
            recent.recent,
          ),
        };
  if (state === "idle" || state === "invalid") {
    if (value.operation !== null) {
      throw new ContractError(
        "Inactive activity must not include an operation.",
      );
    }
    return { schemaVersion: 1, state, operation: null, ...recent, ...failures };
  }
  if (!isRecord(value.operation)) {
    throw new ContractError("Active activity is missing its operation.");
  }
  const kind = parseOperationKind(value.operation.kind);
  requireString(value.operation.startedAt, "activity.operation.startedAt");
  if (!Number.isFinite(Date.parse(value.operation.startedAt))) {
    throw new ContractError("Activity start time is invalid.");
  }
  const rehearsalVersion = parseOperationVersion(
    value.operation.rehearsalVersion,
  );
  const progress =
    value.operation.progress === undefined
      ? undefined
      : value.operation.progress === null
        ? null
        : parseOperationProgressSnapshot(value.operation.progress);
  if (progress && progress.startedAt !== value.operation.startedAt)
    throw new ContractError("Operation progress contradicts its active owner.");
  return {
    schemaVersion: 1,
    state,
    operation: {
      kind,
      startedAt: value.operation.startedAt,
      rehearsalVersion,
      ...(progress !== undefined ? { progress } : {}),
    },
    ...recent,
    ...failures,
  };
};

export const parseResourceInventoryData = (
  value: unknown,
): ResourceInventoryData => {
  if (!isRecord(value) || value.schemaVersion !== 1) {
    throw new ContractError("Resource inventory schema is unsupported.");
  }
  const inspectedAt = requireBoundedString(
    value.inspectedAt,
    "inventory.inspectedAt",
  );
  if (!Number.isFinite(Date.parse(inspectedAt))) {
    throw new ContractError("Resource inventory time is invalid.");
  }
  if (
    !isRecord(value.engine) ||
    !["running", "stopped"].includes(String(value.engine.state))
  ) {
    throw new ContractError("Resource inventory engine state is invalid.");
  }
  const disk = value.engine.disk;
  let parsedDisk: ResourceInventoryData["engine"]["disk"] = null;
  if (disk !== null) {
    if (!isRecord(disk) || disk.backend !== "colima") {
      throw new ContractError("Resource inventory disk is invalid.");
    }
    parsedDisk = {
      backend: "colima",
      totalBytes: requireFiniteNumber(
        disk.totalBytes,
        "inventory.disk.totalBytes",
      ),
      usedBytes: requireFiniteNumber(
        disk.usedBytes,
        "inventory.disk.usedBytes",
      ),
      availableBytes: requireFiniteNumber(
        disk.availableBytes,
        "inventory.disk.availableBytes",
      ),
      usedPercent: requireFiniteNumber(
        disk.usedPercent,
        "inventory.disk.usedPercent",
      ),
    };
    if (parsedDisk.usedPercent < 0 || parsedDisk.usedPercent > 100) {
      throw new ContractError("Resource inventory disk percentage is invalid.");
    }
  }
  if (
    !Array.isArray(value.engine.resources) ||
    value.engine.resources.length > 20
  ) {
    throw new ContractError(
      "Resource inventory resource totals are not bounded.",
    );
  }
  const nullableNumber = (entry: unknown, field: string): number | null =>
    entry === null ? null : requireFiniteNumber(entry, field);
  const nullableNonnegativeNumber = (
    entry: unknown,
    field: string,
  ): number | null => {
    const parsed = nullableNumber(entry, field);
    if (parsed !== null && parsed < 0)
      throw new ContractError(`${field} cannot be negative.`);
    return parsed;
  };
  const nullableString = (entry: unknown, field: string): string | null =>
    entry === null ? null : requireBoundedString(entry, field);
  const resources = value.engine.resources.map((entry, index) => {
    if (!isRecord(entry))
      throw new ContractError(`Resource inventory total ${index} is invalid.`);
    return {
      type: requireBoundedString(
        entry.type,
        `inventory.resources[${index}].type`,
      ),
      totalCount: nullableNumber(
        entry.totalCount,
        `inventory.resources[${index}].totalCount`,
      ),
      activeCount: nullableNumber(
        entry.activeCount,
        `inventory.resources[${index}].activeCount`,
      ),
      size: nullableString(entry.size, `inventory.resources[${index}].size`),
      reclaimable: nullableString(
        entry.reclaimable,
        `inventory.resources[${index}].reclaimable`,
      ),
    };
  });
  if (!Array.isArray(value.environments) || value.environments.length > 25) {
    throw new ContractError("Resource inventory environments are not bounded.");
  }
  const states = [
    "running",
    "stopped",
    "absent",
    "mixed",
    "unavailable",
  ] as const;
  const cleanupStates = [
    "running",
    "preview-required",
    "not-present",
    "inspection-unavailable",
  ] as const;
  const environments = value.environments.map((entry, index) => {
    if (!isRecord(entry))
      throw new ContractError(`Resource environment ${index} is invalid.`);
    if (!states.includes(entry.state as (typeof states)[number]))
      throw new ContractError(
        `Resource environment ${index} state is invalid.`,
      );
    if (entry.provider !== "supabase" && entry.provider !== "postgresql")
      throw new ContractError(
        `Resource environment ${index} provider is invalid.`,
      );
    if (entry.retention !== "persistent" && entry.retention !== "disposable")
      throw new ContractError(
        `Resource environment ${index} retention is invalid.`,
      );
    if (
      !cleanupStates.includes(
        entry.cleanupEligibility as (typeof cleanupStates)[number],
      )
    )
      throw new ContractError(
        `Resource environment ${index} cleanup state is invalid.`,
      );
    const createdAt =
      entry.createdAt === null
        ? null
        : requireBoundedString(
            entry.createdAt,
            `inventory.environments[${index}].createdAt`,
          );
    const lastActivityAt =
      entry.lastActivityAt === null
        ? null
        : requireBoundedString(
            entry.lastActivityAt,
            `inventory.environments[${index}].lastActivityAt`,
          );
    if (lastActivityAt !== null && !Number.isFinite(Date.parse(lastActivityAt)))
      throw new ContractError(
        `Resource environment ${index} activity time is invalid.`,
      );
    if (createdAt !== null && !Number.isFinite(Date.parse(createdAt)))
      throw new ContractError(
        `Resource environment ${index} creation time is invalid.`,
      );
    const restartPolicies = requireStringArray(
      entry.restartPolicies,
      `inventory.environments[${index}].restartPolicies`,
    );
    const classification = parseEnvironmentClassification(
      entry.classification,
      inspectedAt,
    );
    const provenance = parseEnvironmentProvenance(entry.provenance);
    if (
      classification &&
      ((entry.state === "unavailable" &&
        classification.presence.state !== "unknown") ||
        (classification.presence.state === "created" &&
          !(
            Number(entry.containerCount) > 0 || Number(entry.volumeCount) > 0
          )) ||
        (classification.presence.state === "not-created" &&
          (Number(entry.containerCount) !== 0 ||
            Number(entry.volumeCount) !== 0)) ||
        (classification.review.state === "due" &&
          Number(entry.runningContainerCount) < 1) ||
        (classification.review.reason === "not-running" &&
          (Number(entry.runningContainerCount) > 0 ||
            entry.state === "running" ||
            entry.state === "mixed")) ||
        (classification.review.reason === "recent-observable-activity" &&
          Number(entry.runningContainerCount) < 1))
    )
      throw new ContractError(
        "Environment classification contradicts observed resources.",
      );
    if (classification && provenance) {
      const requiredReceiptReason =
        provenance.runtimeReason === "receipt-invalid"
          ? "receipt-invalid"
          : provenance.runtimeReason === "receipt-unavailable"
            ? "receipt-unavailable"
            : provenance.runtime?.migrationReason ===
                "receipt-does-not-match-baseline"
              ? "receipt-binding-mismatch"
              : null;
      if (
        requiredReceiptReason !== null
          ? classification.receipt.reason !== requiredReceiptReason
          : ![
              "supported-receipt-format-and-provider",
              "provider-not-recorded",
            ].includes(classification.receipt.reason)
      )
        throw new ContractError(
          "Environment classification contradicts recorded provenance.",
        );
    }
    return {
      target: requireBoundedString(
        entry.target,
        `inventory.environments[${index}].target`,
      ),
      ...(entry.displayName === undefined
        ? {}
        : {
            displayName: requireBoundedString(
              entry.displayName,
              "inventory.environment.displayName",
            ),
          }),
      ...(entry.protected === undefined
        ? {}
        : {
            protected: (() => {
              if (typeof entry.protected !== "boolean")
                throw new ContractError("Environment protection is invalid.");
              return entry.protected;
            })(),
          }),
      projectId: requireBoundedString(
        entry.projectId,
        `inventory.environments[${index}].projectId`,
      ),
      provider: entry.provider as "supabase" | "postgresql",
      configPath: requireBoundedString(
        entry.configPath,
        `inventory.environments[${index}].configPath`,
      ),
      state: entry.state as (typeof states)[number],
      containerCount: requireFiniteNumber(
        entry.containerCount,
        `inventory.environments[${index}].containerCount`,
      ),
      runningContainerCount: requireFiniteNumber(
        entry.runningContainerCount,
        `inventory.environments[${index}].runningContainerCount`,
      ),
      volumeCount: requireFiniteNumber(
        entry.volumeCount,
        `inventory.environments[${index}].volumeCount`,
      ),
      diskUsageBytes:
        entry.diskUsageBytes === null
          ? null
          : requireFiniteNumber(
              entry.diskUsageBytes,
              `inventory.environments[${index}].diskUsageBytes`,
            ),
      cpuPercent: nullableNonnegativeNumber(
        entry.cpuPercent,
        `inventory.environments[${index}].cpuPercent`,
      ),
      memoryUsageBytes: nullableNonnegativeNumber(
        entry.memoryUsageBytes,
        `inventory.environments[${index}].memoryUsageBytes`,
      ),
      memoryLimitBytes: nullableNonnegativeNumber(
        entry.memoryLimitBytes,
        `inventory.environments[${index}].memoryLimitBytes`,
      ),
      createdAt,
      lastActivityAt,
      retention: entry.retention as "persistent" | "disposable",
      cleanupEligibility:
        entry.cleanupEligibility as (typeof cleanupStates)[number],
      restartPolicies,
      ...(classification ? { classification } : {}),
      ...(provenance ? { provenance } : {}),
    };
  });
  if (!isRecord(value.stale) || !Array.isArray(value.stale.targets)) {
    throw new ContractError("Resource inventory stale summary is invalid.");
  }
  const digest = value.stale.digest;
  if (
    digest !== null &&
    (typeof digest !== "string" || !/^[a-f0-9]{64}$/u.test(digest))
  ) {
    throw new ContractError("Resource inventory stale digest is invalid.");
  }
  const catalog = parseResourceCatalog(value.catalog);
  return {
    schemaVersion: 1,
    inspectedAt,
    ...(catalog === undefined ? {} : { catalog }),
    engine: {
      state: value.engine.state as "running" | "stopped",
      context: nullableString(value.engine.context, "inventory.engine.context"),
      disk: parsedDisk,
      resources,
    },
    environments,
    stale: {
      stoppedCount: requireFiniteNumber(
        value.stale.stoppedCount,
        "inventory.stale.stoppedCount",
      ),
      digest,
      targets: requireStringArray(
        value.stale.targets,
        "inventory.stale.targets",
      ),
    },
  };
};

export const parseJson = (source: string): unknown => {
  try {
    return JSON.parse(source) as unknown;
  } catch {
    throw new ContractError("Rehearsal returned malformed JSON.");
  }
};
