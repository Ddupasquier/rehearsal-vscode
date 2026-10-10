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
  readonly candidates: readonly string[];
}

export interface CandidatesData {
  readonly baselineGenerationId: string;
  readonly candidateSha256: string;
  readonly candidateCount: number;
  readonly candidates: readonly string[];
  readonly targets: readonly CandidateTarget[];
}

export interface BaselineData {
  readonly generationId: string;
  readonly createdAt: string;
  readonly migrationCutoff: string;
  readonly tableCount: number;
  readonly rowCount: number;
  readonly migrationCount: number;
  readonly verification: string;
}

export interface ExplainData {
  readonly config: {
    readonly schemaVersion: number;
    readonly path: string;
    readonly project: string;
  };
  readonly environment: {
    readonly target: string;
    readonly applicationUrl: string;
  };
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
  } | null;
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
  if (state === "idle" || state === "invalid") {
    if (value.operation !== null) {
      throw new ContractError(
        "Inactive activity must not include an operation.",
      );
    }
    return { schemaVersion: 1, state, operation: null };
  }
  if (!isRecord(value.operation)) {
    throw new ContractError("Active activity is missing its operation.");
  }
  requireString(value.operation.kind, "activity.operation.kind");
  requireString(value.operation.startedAt, "activity.operation.startedAt");
  if (!Number.isFinite(Date.parse(value.operation.startedAt))) {
    throw new ContractError("Activity start time is invalid.");
  }
  if (
    value.operation.rehearsalVersion !== null &&
    (typeof value.operation.rehearsalVersion !== "string" ||
      value.operation.rehearsalVersion.length === 0)
  ) {
    throw new ContractError("Activity Rehearsal version is invalid.");
  }
  return {
    schemaVersion: 1,
    state,
    operation: {
      kind: value.operation.kind,
      startedAt: value.operation.startedAt,
      rehearsalVersion: value.operation.rehearsalVersion,
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
