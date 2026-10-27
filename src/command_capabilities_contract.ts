/** Closed public Core commandCapabilities:1 reader; requirements are not readiness. */
import { ContractError } from "./contracts.js";

export interface CommandCapability {
  readonly commands: readonly string[];
  readonly backend: "offline" | "native" | "container";
  readonly supportState:
    "supported" | "unsupported" | "unknown" | "not-applicable";
  readonly availability: "available" | "unavailable" | "unknown";
  readonly assuranceWhenCompleted: "inspection" | "partial" | "full";
  readonly reason:
    | "qualified"
    | "qualification_missing"
    | "observation_missing"
    | "feature_unsupported"
    | "version_unqualified";
  readonly requirements: readonly string[];
}
export interface CommandCapabilitiesData {
  readonly schemaVersion: 1;
  readonly assurance: "inspection";
  readonly host: {
    readonly kind:
      "macos" | "linux" | "wsl2" | "wsl-unverified" | "windows" | "other";
    readonly runtimeHostQualified: boolean;
  };
  readonly node: { readonly major: number | null; readonly supported: boolean };
  readonly operations: readonly CommandCapability[];
  readonly receipt: {
    readonly state: "not-requested" | "observed" | "missing" | "refused";
    readonly reason:
      | "not_requested"
      | "recorded_receipt_only"
      | "receipt_missing"
      | "receipt_unverified"
      | "host_filesystem_unqualified";
    readonly target: "postgresql" | "supabase" | null;
    readonly baselineGenerationId: string | null;
    readonly candidateSha256: string | null;
    readonly candidateCount: number | null;
    readonly timestamp: null;
    readonly freshness: "unknown";
    readonly currentInputsMatch: "unknown";
    readonly liveState: "unknown";
  };
  readonly safety: {
    readonly projectConfigurationEvaluated: false;
    readonly childProcessesStarted: false;
    readonly enginesProbed: false;
    readonly databaseObserved: false;
    readonly filesWritten: false;
  };
}
export type CommandCapabilitiesObservation =
  | { readonly state: "not-advertised" | "unsupported" | "unavailable" }
  | { readonly state: "observed"; readonly report: CommandCapabilitiesData };

const invalid = (): never => {
  throw new ContractError(
    "Core command capabilities are unsupported or incomplete. Existing project checks remain in place.",
  );
};
const object = (
  value: unknown,
  keys: readonly string[],
): Record<string, unknown> => {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.keys(value).sort().join(",") !== [...keys].sort().join(",")
  )
    return invalid();
  return value as Record<string, unknown>;
};
const oneOf = <T extends string>(value: unknown, values: readonly T[]): T =>
  typeof value === "string" && values.includes(value as T)
    ? (value as T)
    : invalid();
const boolean = (value: unknown): boolean =>
  typeof value === "boolean" ? value : invalid();
const strings = (
  value: unknown,
  pattern: RegExp,
  maximum: number,
): string[] => {
  if (
    !Array.isArray(value) ||
    value.length > maximum ||
    value.some((x) => typeof x !== "string" || !pattern.test(x)) ||
    new Set(value).size !== value.length
  )
    return invalid();
  return value as string[];
};
export const parseCommandCapabilities = (
  value: unknown,
): CommandCapabilitiesData => {
  const x = object(value, [
    "schemaVersion",
    "assurance",
    "host",
    "node",
    "operations",
    "receipt",
    "safety",
  ]);
  if (x.schemaVersion !== 1 || x.assurance !== "inspection") return invalid();
  const host = object(x.host, ["kind", "runtimeHostQualified"]),
    node = object(x.node, ["major", "supported"]);
  if (
    node.major !== null &&
    (typeof node.major !== "number" ||
      !Number.isSafeInteger(node.major) ||
      node.major < 0 ||
      node.major > 999)
  )
    return invalid();
  if (
    !Array.isArray(x.operations) ||
    x.operations.length < 1 ||
    x.operations.length > 32
  )
    return invalid();
  const seen = new Set<string>();
  const operations = x.operations.map((raw) => {
    const row = object(raw, [
      "commands",
      "backend",
      "supportState",
      "availability",
      "assuranceWhenCompleted",
      "reason",
      "requirements",
    ]);
    const commands = strings(row.commands, /^[A-Za-z][A-Za-z0-9 -]{0,95}$/, 32);
    if (!commands.length || commands.some((command) => seen.has(command)))
      return invalid();
    for (const command of commands) seen.add(command);
    return {
      commands,
      backend: oneOf(row.backend, ["offline", "native", "container"] as const),
      supportState: oneOf(row.supportState, [
        "supported",
        "unsupported",
        "unknown",
        "not-applicable",
      ] as const),
      availability: oneOf(row.availability, [
        "available",
        "unavailable",
        "unknown",
      ] as const),
      assuranceWhenCompleted: oneOf(row.assuranceWhenCompleted, [
        "inspection",
        "partial",
        "full",
      ] as const),
      reason: oneOf(row.reason, [
        "qualified",
        "qualification_missing",
        "observation_missing",
        "feature_unsupported",
        "version_unqualified",
      ] as const),
      requirements: strings(row.requirements, /^[a-z][a-z0-9-]{0,95}$/, 32),
    };
  });
  const receipt = object(x.receipt, [
    "state",
    "reason",
    "target",
    "baselineGenerationId",
    "candidateSha256",
    "candidateCount",
    "timestamp",
    "freshness",
    "currentInputsMatch",
    "liveState",
  ]);
  const receiptState = oneOf(receipt.state, [
    "not-requested",
    "observed",
    "missing",
    "refused",
  ] as const);
  const reason = oneOf(receipt.reason, [
    "not_requested",
    "recorded_receipt_only",
    "receipt_missing",
    "receipt_unverified",
    "host_filesystem_unqualified",
  ] as const);
  if (
    receipt.timestamp !== null ||
    receipt.freshness !== "unknown" ||
    receipt.currentInputsMatch !== "unknown" ||
    receipt.liveState !== "unknown"
  )
    return invalid();
  if (receiptState === "observed") {
    if (
      reason !== "recorded_receipt_only" ||
      !["postgresql", "supabase"].includes(String(receipt.target)) ||
      typeof receipt.baselineGenerationId !== "string" ||
      !/^[A-Za-z0-9][A-Za-z0-9_-]{0,159}$/.test(receipt.baselineGenerationId) ||
      typeof receipt.candidateSha256 !== "string" ||
      !/^[a-f0-9]{64}$/.test(receipt.candidateSha256) ||
      typeof receipt.candidateCount !== "number" ||
      !Number.isSafeInteger(receipt.candidateCount) ||
      receipt.candidateCount < 0 ||
      receipt.candidateCount > 10000
    )
      return invalid();
  } else if (
    receipt.target !== null ||
    receipt.baselineGenerationId !== null ||
    receipt.candidateSha256 !== null ||
    receipt.candidateCount !== null ||
    (receiptState === "not-requested"
      ? reason !== "not_requested"
      : receiptState === "missing"
        ? reason !== "receipt_missing"
        : !["receipt_unverified", "host_filesystem_unqualified"].includes(
            reason,
          ))
  )
    return invalid();
  const safety = object(x.safety, [
    "projectConfigurationEvaluated",
    "childProcessesStarted",
    "enginesProbed",
    "databaseObserved",
    "filesWritten",
  ]);
  if (Object.values(safety).some((value) => value !== false)) return invalid();
  return {
    schemaVersion: 1,
    assurance: "inspection",
    host: {
      kind: oneOf(host.kind, [
        "macos",
        "linux",
        "wsl2",
        "wsl-unverified",
        "windows",
        "other",
      ] as const),
      runtimeHostQualified: boolean(host.runtimeHostQualified),
    },
    node: {
      major: node.major as number | null,
      supported: boolean(node.supported),
    },
    operations,
    receipt: receipt as unknown as CommandCapabilitiesData["receipt"],
    safety: safety as unknown as CommandCapabilitiesData["safety"],
  };
};

/** Permission to attempt these existing read-only commands, never proof they succeeded. */
export const supportsOfflineInspection = (
  observation: CommandCapabilitiesObservation | undefined,
  commands: readonly string[],
): boolean => {
  if (observation?.state !== "observed") return false;
  const data = observation.report;
  return (
    data.host.runtimeHostQualified &&
    ["macos", "linux", "wsl2"].includes(data.host.kind) &&
    data.node.supported &&
    data.node.major !== null &&
    data.node.major > 0 &&
    data.receipt.state === "not-requested" &&
    commands.every((command) =>
      data.operations.some(
        (row) =>
          row.commands.includes(command) &&
          row.backend === "offline" &&
          row.supportState === "supported" &&
          ["qualified", "observation_missing"].includes(row.reason) &&
          row.availability !== "unavailable" &&
          row.assuranceWhenCompleted === "inspection",
      ),
    )
  );
};
