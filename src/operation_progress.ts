/** Public bounded operation telemetry. No human output, raw errors or process authority. */
import { ContractError } from "./contracts.js";
import type { ProjectSnapshot } from "./project_snapshot.js";

export const OPERATION_PROGRESS_PHASES = [
  "runtime-lifecycle",
  "dependent-preparation",
  "application-start",
  "application-proof",
  "http-proof",
  "runtime-verification",
  "cleanup",
  "interactive-session",
  "source-preparation",
  "identity-association",
] as const;
export type OperationProgressPhase = (typeof OPERATION_PROGRESS_PHASES)[number];
export type OperationProgressState =
  "running" | "completed" | "failed" | "cancelled";
export type OperationProgressEventCode =
  | "operation.started"
  | "operation.completed"
  | "operation.failed"
  | "operation.cancelled"
  | "stage.started"
  | "stage.completed"
  | "stage.failed"
  | "stage.cancelled";
export interface OperationProgressStage {
  readonly id: number;
  readonly phase: OperationProgressPhase;
  readonly target: string | null;
  readonly state: OperationProgressState;
  readonly startedAt: string;
  readonly endedAt: string | null;
  readonly durationMilliseconds: number;
}
export interface OperationProgressEvent {
  readonly sequence: number;
  readonly code: OperationProgressEventCode;
  readonly phase: OperationProgressPhase | null;
  readonly target: string | null;
  readonly at: string;
}
export interface OperationProgressSnapshot {
  readonly schemaVersion: 1;
  readonly operationId: string;
  readonly state: OperationProgressState;
  readonly startedAt: string;
  readonly updatedAt: string;
  readonly elapsedMilliseconds: number;
  readonly currentStage: OperationProgressStage | null;
  readonly completedStages: readonly OperationProgressStage[];
  readonly events: readonly OperationProgressEvent[];
  readonly truncated: { readonly stages: boolean; readonly events: boolean };
}
export interface RecentOperationProgress {
  readonly kind: string;
  readonly rehearsalVersion: string | null;
  readonly progress: OperationProgressSnapshot;
}
export const OPERATION_KINDS = [
  "stop-stale",
  "baseline create",
  "baseline prepare",
  "baseline refresh",
  "cleanup",
  "discard",
  "guide",
  "help",
  "identity claim",
  "identity connect",
  "init",
  "migrate",
  "open",
  "privacy key",
  "refresh",
  "reset",
  "run",
  "setup",
  "source apply",
  "source retire",
  "start",
  "stop",
] as const;
const states: readonly string[] = [
  "running",
  "completed",
  "failed",
  "cancelled",
];
const eventCodes: readonly string[] = [
  "operation.started",
  "operation.completed",
  "operation.failed",
  "operation.cancelled",
  "stage.started",
  "stage.completed",
  "stage.failed",
  "stage.cancelled",
];
const record = (
  value: unknown,
  fields: readonly string[],
): Record<string, unknown> => {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.keys(value).sort().join("\0") !== [...fields].sort().join("\0")
  )
    throw new ContractError(
      "Operation progress contains missing, unsafe or unexpected fields.",
    );
  return value as Record<string, unknown>;
};
const integer = (value: unknown): number => {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0)
    throw new ContractError(
      "Operation progress duration, sequence or count is invalid.",
    );
  return value;
};
const positive = (value: unknown): number => {
  const result = integer(value);
  if (result < 1)
    throw new ContractError("Operation progress identity is invalid.");
  return result;
};
const timestamp = (value: unknown): string => {
  if (
    typeof value !== "string" ||
    value.length > 32 ||
    !Number.isFinite(Date.parse(value)) ||
    new Date(value).toISOString() !== value
  )
    throw new ContractError("Operation progress timestamp is invalid.");
  return value;
};
const target = (value: unknown): string | null => {
  if (value === null) return null;
  if (typeof value !== "string" || !/^[a-z0-9][a-z0-9-]{0,62}$/u.test(value))
    throw new ContractError("Operation progress target is invalid.");
  return value;
};
const phase = (value: unknown): OperationProgressPhase => {
  if (
    typeof value !== "string" ||
    !(OPERATION_PROGRESS_PHASES as readonly string[]).includes(value)
  )
    throw new ContractError("Operation progress phase is unsupported.");
  return value as OperationProgressPhase;
};
const state = (value: unknown): OperationProgressState => {
  if (typeof value !== "string" || !states.includes(value))
    throw new ContractError("Operation progress state is unsupported.");
  return value as OperationProgressState;
};
const boundedList = (value: unknown, maximum: number): readonly unknown[] => {
  if (!Array.isArray(value) || value.length > maximum)
    throw new ContractError("Operation progress exceeds its bounded history.");
  return value;
};
const stage = (value: unknown): OperationProgressStage => {
  const data = record(value, [
    "id",
    "phase",
    "target",
    "state",
    "startedAt",
    "endedAt",
    "durationMilliseconds",
  ]);
  const currentState = state(data.state);
  const startedAt = timestamp(data.startedAt);
  const endedAt =
    currentState === "running"
      ? data.endedAt === null
        ? null
        : timestamp(data.endedAt)
      : timestamp(data.endedAt);
  if (
    (currentState === "running" && endedAt !== null) ||
    (endedAt !== null && Date.parse(endedAt) < Date.parse(startedAt))
  )
    throw new ContractError("Operation stage lifetime is contradictory.");
  return {
    id: positive(data.id),
    phase: phase(data.phase),
    target: target(data.target),
    state: currentState,
    startedAt,
    endedAt,
    durationMilliseconds: integer(data.durationMilliseconds),
  };
};
const event = (value: unknown): OperationProgressEvent => {
  const data = record(value, ["sequence", "code", "phase", "target", "at"]);
  if (typeof data.code !== "string" || !eventCodes.includes(data.code))
    throw new ContractError("Operation progress event is unsupported.");
  const operationEvent = data.code.startsWith("operation.");
  if (operationEvent && (data.phase !== null || data.target !== null))
    throw new ContractError(
      "Operation event contains contradictory stage details.",
    );
  return {
    sequence: positive(data.sequence),
    code: data.code as OperationProgressEventCode,
    phase: operationEvent ? null : phase(data.phase),
    target: target(data.target),
    at: timestamp(data.at),
  };
};
export const parseOperationKind = (value: unknown): string => {
  if (
    typeof value !== "string" ||
    !(OPERATION_KINDS as readonly string[]).includes(value)
  )
    throw new ContractError("Operation kind is unsupported.");
  return value;
};
export const parseOperationVersion = (value: unknown): string | null => {
  if (value === null) return null;
  if (
    typeof value !== "string" ||
    value.length > 64 ||
    !/^\d+\.\d+\.\d+(?:-[A-Za-z0-9.-]+)?(?:\+[A-Za-z0-9.-]+)?$/u.test(value)
  )
    throw new ContractError("Operation version is invalid.");
  return value;
};

export const parseOperationProgressSnapshot = (
  value: unknown,
): OperationProgressSnapshot => {
  const data = record(value, [
    "schemaVersion",
    "operationId",
    "state",
    "startedAt",
    "updatedAt",
    "elapsedMilliseconds",
    "currentStage",
    "completedStages",
    "events",
    "truncated",
  ]);
  if (
    data.schemaVersion !== 1 ||
    typeof data.operationId !== "string" ||
    !/^[a-f0-9]{64}$/u.test(data.operationId)
  )
    throw new ContractError(
      "Operation progress schema or identity is unsupported.",
    );
  const currentState = state(data.state),
    startedAt = timestamp(data.startedAt),
    updatedAt = timestamp(data.updatedAt);
  if (Date.parse(updatedAt) < Date.parse(startedAt))
    throw new ContractError(
      "Operation progress timestamps contradict each other.",
    );
  const currentStage =
    data.currentStage === null ? null : stage(data.currentStage);
  const completedStages = boundedList(data.completedStages, 20).map(stage);
  const events = boundedList(data.events, 40).map(event);
  const truncated = record(data.truncated, ["stages", "events"]);
  if (
    typeof truncated.stages !== "boolean" ||
    typeof truncated.events !== "boolean" ||
    completedStages.some((item) => item.state !== "completed") ||
    new Set(completedStages.map((item) => item.id)).size !==
      completedStages.length ||
    events.some(
      (item, index) =>
        index > 0 && item.sequence <= events[index - 1]!.sequence,
    ) ||
    (currentStage !== null &&
      completedStages.some((item) => item.id === currentStage.id)) ||
    (currentState === "completed" && currentStage !== null) ||
    (currentStage !== null &&
      (currentState === "running") !== (currentStage.state === "running"))
  )
    throw new ContractError(
      "Operation progress history or state is contradictory.",
    );
  const terminalCode = `operation.${currentState}`;
  if (
    (currentState !== "running" &&
      events.length > 0 &&
      events.at(-1)?.code !== terminalCode) ||
    (currentState === "running" &&
      events.some((item) =>
        [
          "operation.completed",
          "operation.failed",
          "operation.cancelled",
        ].includes(item.code),
      ))
  )
    throw new ContractError(
      "Operation outcome contradicts its terminal event evidence.",
    );
  return {
    schemaVersion: 1,
    operationId: data.operationId,
    state: currentState,
    startedAt,
    updatedAt,
    elapsedMilliseconds: integer(data.elapsedMilliseconds),
    currentStage,
    completedStages,
    events,
    truncated: { stages: truncated.stages, events: truncated.events },
  };
};
export const parseRecentOperationProgress = (
  value: unknown,
): readonly RecentOperationProgress[] | null => {
  if (value === null) return null;
  const result = boundedList(value, 20).map((value) => {
    const data = record(value, ["kind", "rehearsalVersion", "progress"]);
    const progress = parseOperationProgressSnapshot(data.progress);
    if (progress.state === "running")
      throw new ContractError(
        "Recent history cannot claim an unfinished operation is complete.",
      );
    return {
      kind: parseOperationKind(data.kind),
      rehearsalVersion: parseOperationVersion(data.rehearsalVersion),
      progress,
    };
  });
  if (
    new Set(result.map((item) => item.progress.operationId)).size !==
    result.length
  )
    throw new ContractError("Recent operation identities are duplicated.");
  return result;
};

const html = (value: string): string =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
const phaseLabels: Readonly<Record<OperationProgressPhase, string>> = {
  "runtime-lifecycle": "Preparing the local database runtime",
  "dependent-preparation": "Preparing a dependent target",
  "application-start": "Starting the sandbox application",
  "application-proof": "Running the application proof",
  "http-proof": "Running the configured HTTP proof",
  "runtime-verification": "Verifying the local runtime",
  cleanup: "Cleaning up owned temporary resources",
  "interactive-session": "Keeping the sandbox open for interaction",
  "source-preparation": "Preparing the reviewed safe baseline",
  "identity-association": "Reviewing local account association",
};
const eventLabels: Readonly<Record<OperationProgressEventCode, string>> = {
  "operation.started": "Operation started",
  "operation.completed": "Operation completed",
  "operation.failed": "Operation stopped after a failure",
  "operation.cancelled": "Operation cancelled",
  "stage.started": "Stage started",
  "stage.completed": "Stage completed",
  "stage.failed": "Stage stopped after a failure",
  "stage.cancelled": "Stage cancelled",
};
const duration = (milliseconds: number): string => {
  const seconds = Math.floor(milliseconds / 1000);
  return seconds < 60
    ? `${seconds}s`
    : `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
};
const progressMarkup = (
  progress: OperationProgressSnapshot,
  live: boolean,
): string => `<dl class="detail-list"><div><dt>Elapsed at inspection</dt><dd>${duration(progress.elapsedMilliseconds)}</dd></div><div><dt>${live ? "Current phase" : "Last recorded phase"}</dt><dd>${progress.currentStage ? html(phaseLabels[progress.currentStage.phase]) : progress.state === "completed" ? "All recorded phases finished" : "No phase evidence available"}</dd></div>${progress.currentStage ? `<div><dt>Target</dt><dd>${html(progress.currentStage.target ?? "Project-wide")}</dd></div><div><dt>Phase elapsed</dt><dd>${duration(progress.currentStage.durationMilliseconds)}</dd></div>` : ""}<div><dt>Updated</dt><dd><time datetime="${progress.updatedAt}">${progress.updatedAt}</time></dd></div></dl>
  <details class="technical-details"><summary>${progress.completedStages.length} recorded successful stages${progress.truncated.stages ? " · earlier stages omitted" : ""}</summary><ol>${progress.completedStages.map((item) => `<li>${html(phaseLabels[item.phase])} · ${html(item.target ?? "Project-wide")} · ${duration(item.durationMilliseconds)}</li>`).join("") || "<li>No successful stage completion was recorded.</li>"}</ol></details>
  <details class="technical-details"><summary>Safe structured events${progress.truncated.events ? " · earlier events omitted" : ""}</summary><ol>${progress.events.map((item) => `<li><time datetime="${item.at}">${item.at}</time> · ${eventLabels[item.code]}${item.phase ? `: ${html(phaseLabels[item.phase])}` : ""}${item.target ? ` · ${html(item.target)}` : ""}</li>`).join("") || "<li>No event evidence is available.</li>"}</ol><p>Only fixed event codes and public phase/target metadata are included. Raw commands, errors, logs, paths and environment values are never rendered.</p></details>`;

export const renderOperationProgress = (snapshot: ProjectSnapshot): string => {
  const activity = snapshot.activity;
  if (!activity)
    return '<article class="surface"><div class="empty-state"><strong>Operation evidence has not been checked</strong><p>Refresh the project or run the documented activity command. Missing information is not proof that an operation passed or is safe to cancel.</p></div></article>';
  const live = activity.state === "busy";
  const progress = activity.operation?.progress;
  const finishing = live && progress && progress.state !== "running";
  const interactive =
    live &&
    activity.operation?.kind === "open" &&
    progress?.state === "running" &&
    progress.currentStage?.phase === "interactive-session";
  const statusMessage = finishing
    ? "Recorded stages have ended. Wait for the owning operation to release its project lock before starting another change."
    : interactive
      ? "The sandbox is ready and stays open until you close it."
      : live
        ? "Rehearsal owns an active project operation."
        : "The operation owner is stale. Recorded progress is historical, not a claim that a process is still running.";
  const phaseNotice =
    live && !finishing && progress?.currentStage
      ? ` ${html(phaseLabels[progress.currentStage.phase])}.`
      : "";
  const current = activity.operation
    ? `<article class="surface"><div class="surface-heading"><span><small>Current operation</small><h2>${html(activity.operation.kind)}</h2></span><span class="state-chip">${finishing ? "Finishing" : interactive ? "Sandbox open" : live ? "Running" : "Review interrupted operation"}</span></div><div><p role="status" aria-live="polite" aria-atomic="true">${statusMessage}${phaseNotice}</p>${progress ? progressMarkup(progress, live && progress.state === "running") : `<div class="empty-state"><strong>${progress === undefined ? "This core does not expose phase progress" : "Phase evidence is unavailable"}</strong><p>Use the owning terminal for live output, then refresh. Do not infer completion, unlock the project or delete resources from missing telemetry.</p></div>`}</div></article>`
    : "";
  const recent = activity.recent;
  const history =
    recent === undefined
      ? '<div class="empty-state"><strong>Detailed operation history is unavailable in this core release</strong><p>Update the installed package for bounded structured receipts. The editor’s action history is separate from native core proof.</p></div>'
      : recent === null
        ? '<div class="empty-state"><strong>Recent operation evidence could not be safely read</strong><p>Run Doctor or request a support report before proceeding. Existing private receipts remain untouched; no successful outcome is inferred.</p></div>'
        : recent.length === 0
          ? '<div class="empty-state"><strong>No recent package-owned operation receipt</strong><p>History is bounded and local. Its absence does not prove a rehearsal or manual check passed.</p></div>'
          : `<div class="version-list">${[...recent]
              .reverse()
              .map(
                (item) =>
                  `<article class="control-card"><div class="surface-heading"><strong>${html(item.kind)}</strong><span class="state-chip">${item.progress.state === "completed" ? "Completed" : item.progress.state === "failed" ? "Failed" : "Cancelled"}</span></div><p>Core ${html(item.rehearsalVersion ?? "version unavailable")} · ${duration(item.progress.elapsedMilliseconds)} elapsed</p>${progressMarkup(item.progress, false)}<details class="technical-details"><summary>Exact operation identity</summary><code>${item.progress.operationId}</code></details></article>`,
              )
              .join("")}</div>`;
  return `${current}<article class="surface"><div class="surface-heading"><span><small>Core-owned evidence</small><h2>Recent operation receipts</h2></span>${recent ? `<span class="state-chip">${recent.length} receipts</span>` : ""}</div>${history}<p class="control-note">A recorded stage or successful command is not a complete acceptance report. Real provider consent, browser behavior, account blocking, MFA and other manual checks need separate observed proof. This view does not grant process ownership or permission to cancel another session.</p></article>`;
};
