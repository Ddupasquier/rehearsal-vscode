import { ContractError } from "../contracts.js";

export const ENGINE_LIFECYCLE_REASONS = [
  "ready",
  "profile-stopped",
  "unsupported-host",
  "selection-unverified",
  "daemon-unavailable",
  "backend-unqualified",
  "profile-unavailable",
  "ownership-unverified",
  "coordination-active",
  "coordination-unavailable",
  "review-changed",
  "confirmation-required",
  "cancelled-before-dispatch",
  "cancelled-after-dispatch",
  "shutdown-unconfirmed",
  "shutdown-command-failed",
  "shutdown-confirmed",
] as const;
export type EngineLifecycleReason = (typeof ENGINE_LIFECYCLE_REASONS)[number];
export const ENGINE_LIFECYCLE_REASON_LABELS: Record<
  EngineLifecycleReason,
  string
> = {
  ready: "Review the shared VM before shutting it down.",
  "profile-stopped": "Colima reports that its default profile is stopped.",
  "unsupported-host": "VM shutdown is not supported on this host.",
  "selection-unverified":
    "The selected local engine could not be verified. Review your engine selection, then refresh.",
  "daemon-unavailable":
    "The selected engine is not reachable. This does not prove its VM is stopped.",
  "backend-unqualified":
    "Rehearsal cannot shut down this engine through a verified lifecycle adapter. Use its own shutdown controls.",
  "profile-unavailable":
    "The Colima profile state is unavailable. Use its own controls, then refresh.",
  "ownership-unverified":
    "Rehearsal could not bind shutdown to this exact VM. Use the engine's own controls.",
  "coordination-active":
    "A participating Rehearsal operation is active. Finish it before reviewing VM shutdown.",
  "coordination-unavailable":
    "Shared operation coordination could not be verified. No VM shutdown was requested.",
  "review-changed":
    "The engine or shared workloads changed. Refresh and review again.",
  "confirmation-required":
    "Review the current VM and shared workloads before confirming shutdown.",
  "cancelled-before-dispatch":
    "Cancelled before the shutdown command was sent.",
  "cancelled-after-dispatch":
    "Shutdown was requested before cancellation. Its outcome is uncertain; refresh the engine state.",
  "shutdown-unconfirmed":
    "VM shutdown is not confirmed. Refresh and inspect the engine's own controls.",
  "shutdown-command-failed":
    "The graceful shutdown command failed. Inspect the engine's own controls, then refresh.",
  "shutdown-confirmed":
    "The Colima profile is stopped and the exact VM process has exited.",
};
type ObjectValue = Record<string, unknown>;
const invalid = (): never => {
  throw new ContractError(
    "Engine lifecycle evidence is incomplete or unsupported. Refresh with a supported Rehearsal package.",
  );
};
const object = (value: unknown, keys: readonly string[]): ObjectValue => {
  if (!value || typeof value !== "object" || Array.isArray(value))
    return invalid();
  const input = value as ObjectValue;
  if (
    Object.keys(input).length !== keys.length ||
    keys.some((key) => !Object.hasOwn(input, key)) ||
    Object.keys(input).some((key) => !keys.includes(key))
  )
    return invalid();
  return input;
};
const choice = <T extends string>(value: unknown, values: readonly T[]): T => {
  if (typeof value !== "string" || !values.includes(value as T))
    return invalid();
  return value as T;
};
const text = (value: unknown, maximum = 128): string => {
  if (
    typeof value !== "string" ||
    !value.length ||
    value.length > maximum ||
    /[\x00-\x1f\x7f-\x9f\u2028\u2029]/u.test(value)
  )
    return invalid();
  return value;
};
const digest = (value: unknown): string => {
  const result = text(value, 64);
  if (!/^[a-f0-9]{64}$/u.test(result)) return invalid();
  return result;
};
const boolean = (value: unknown): boolean => {
  if (typeof value !== "boolean") return invalid();
  return value;
};
const reason = (value: unknown): EngineLifecycleReason =>
  choice(value, ENGINE_LIFECYCLE_REASONS);
const count = (value: unknown): number => {
  if (!Number.isSafeInteger(value) || Number(value) < 0) return invalid();
  return Number(value);
};
const timestamp = (value: unknown): string => {
  const result = text(value, 40);
  if (!Number.isFinite(Date.parse(result))) return invalid();
  return result;
};
const safety = (value: unknown) => {
  const input = object(value, [
    "globalContextSwitchRequested",
    "dataDeletionRequested",
    "forceRequested",
    "enginesStarted",
  ]);
  if (Object.values(input).some((entry) => entry !== false)) return invalid();
  return {
    globalContextSwitchRequested: false,
    dataDeletionRequested: false,
    forceRequested: false,
    enginesStarted: false,
  } as const;
};
const selected = (value: unknown) => {
  const input = object(value, [
    "state",
    "context",
    "endpointIdentity",
    "daemonId",
  ]);
  const result = {
    state: choice(input.state, [
      "running",
      "unavailable",
      "unknown",
      "unsupported-host",
    ] as const),
    context: input.context === null ? null : text(input.context),
    endpointIdentity:
      input.endpointIdentity === null ? null : digest(input.endpointIdentity),
    daemonId: input.daemonId === null ? null : text(input.daemonId, 256),
  };
  if (
    result.state === "running" &&
    (!result.context || !result.endpointIdentity || !result.daemonId)
  )
    return invalid();
  return result;
};
const engine = (value: unknown) => {
  if (value === null) return null;
  const input = object(value, [
    "backend",
    "profile",
    "context",
    "endpointIdentity",
    "daemonId",
    "bootId",
    "vmIdentity",
  ]);
  if (input.backend !== "colima" || input.profile !== "default")
    return invalid();
  const bootId = text(input.bootId, 64);
  if (!/^[a-f0-9-]{16,64}$/u.test(bootId)) return invalid();
  return {
    backend: "colima" as const,
    profile: "default" as const,
    context: text(input.context),
    endpointIdentity: digest(input.endpointIdentity),
    daemonId: text(input.daemonId, 256),
    bootId,
    vmIdentity: digest(input.vmIdentity),
  };
};
export const parseEngineLifecycleStatus = (value: unknown) => {
  const input = object(value, [
    "schemaVersion",
    "selected",
    "colimaDefault",
    "safety",
  ]);
  if (input.schemaVersion !== 1) return invalid();
  const profile = object(input.colimaDefault, [
    "state",
    "profile",
    "shutdownSupported",
    "reason",
  ]);
  if (profile.profile !== "default") return invalid();
  if (
    profile.shutdownSupported === true &&
    (profile.state !== "running" ||
      (input.selected as Record<string, unknown>)?.state !== "running")
  )
    return invalid();
  return {
    schemaVersion: 1 as const,
    selected: selected(input.selected),
    colimaDefault: {
      state: choice(profile.state, [
        "running",
        "stopped",
        "unknown",
        "not-observed",
      ] as const),
      profile: "default" as const,
      shutdownSupported: boolean(profile.shutdownSupported),
      reason: reason(profile.reason),
    },
    safety: safety(input.safety),
  };
};
export type EngineLifecycleStatus = ReturnType<
  typeof parseEngineLifecycleStatus
>;
export type EngineLifecycleObservation =
  | { readonly state: "available"; readonly report: EngineLifecycleStatus }
  | { readonly state: "unsupported" | "unavailable" };
export const parseEngineShutdownPreview = (value: unknown) => {
  const input = object(value, [
    "schemaVersion",
    "action",
    "state",
    "reason",
    "consentDigest",
    "engine",
    "impact",
    "safety",
  ]);
  if (input.schemaVersion !== 1 || input.action !== "engine-stop")
    return invalid();
  const state = choice(input.state, [
    "review-required",
    "already-stopped",
    "unsupported",
    "blocked",
  ] as const);
  const bound = engine(input.engine),
    consentDigest =
      input.consentDigest === null ? null : digest(input.consentDigest);
  let impact = null;
  if (input.impact !== null) {
    const raw = object(input.impact, ["containers", "runningCount"]);
    if (!Array.isArray(raw.containers) || raw.containers.length > 1024)
      return invalid();
    const containers = raw.containers.map((value) => {
      const entry = object(value, [
        "id",
        "name",
        "state",
        "restartCount",
        "startedAt",
        "finishedAt",
      ]);
      return {
        id: digest(entry.id),
        name: text(entry.name, 256),
        state: choice(entry.state, [
          "created",
          "running",
          "paused",
          "restarting",
          "removing",
          "exited",
          "dead",
        ] as const),
        restartCount: count(entry.restartCount),
        startedAt: timestamp(entry.startedAt),
        finishedAt: timestamp(entry.finishedAt),
      };
    });
    if (new Set(containers.map((entry) => entry.id)).size !== containers.length)
      return invalid();
    const runningCount = count(raw.runningCount);
    if (
      runningCount !==
      containers.filter((entry) =>
        ["running", "paused", "restarting"].includes(entry.state),
      ).length
    )
      return invalid();
    impact = { containers, runningCount };
  }
  if (state === "review-required" && (!bound || !consentDigest || !impact))
    return invalid();
  return {
    schemaVersion: 1 as const,
    action: "engine-stop" as const,
    state,
    reason: reason(input.reason),
    consentDigest,
    engine: bound,
    impact,
    safety: safety(input.safety),
  };
};
export type EngineShutdownPreview = ReturnType<
  typeof parseEngineShutdownPreview
>;
export const parseEngineShutdownResult = (value: unknown) => {
  const input = object(value, [
    "schemaVersion",
    "status",
    "reason",
    "engine",
    "confirmed",
    "selectionAfter",
    "safety",
  ]);
  if (input.schemaVersion !== 1) return invalid();
  const confirmed = object(input.confirmed, [
    "profileStopped",
    "vmProcessAbsent",
  ]);
  const status = choice(input.status, [
    "stopped",
    "already-stopped",
    "refused",
    "failed",
    "cancelled",
    "unknown",
  ] as const);
  const proof = {
    profileStopped: boolean(confirmed.profileStopped),
    vmProcessAbsent: boolean(confirmed.vmProcessAbsent),
  };
  if (status === "stopped" && (!proof.profileStopped || !proof.vmProcessAbsent))
    return invalid();
  if (status === "already-stopped" && !proof.profileStopped) return invalid();
  const boundEngine = engine(input.engine);
  if (proof.profileStopped && proof.vmProcessAbsent && !boundEngine)
    return invalid();
  return {
    schemaVersion: 1 as const,
    status,
    reason: reason(input.reason),
    engine: boundEngine,
    confirmed: proof,
    selectionAfter:
      input.selectionAfter === null ? null : selected(input.selectionAfter),
    safety: safety(input.safety),
  };
};
