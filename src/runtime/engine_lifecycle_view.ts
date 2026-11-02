import type { ProjectSnapshot } from "../workspace/project_snapshot.js";
import { ENGINE_LIFECYCLE_REASON_LABELS } from "./engine_lifecycle_contract.js";

const html = (value: string) =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
export type EngineShutdownUiState =
  "running" | "confirmed" | "uncertain" | "refused" | "already-stopped";
export const ENGINE_SHUTDOWN_UI_LABELS: Record<EngineShutdownUiState, string> =
  {
    running: "VM shutdown requested. Waiting for its verified outcome…",
    confirmed:
      "Last shutdown confirmed: the Colima profile stopped and the exact VM process exited.",
    uncertain:
      "Last shutdown outcome is uncertain. Refresh and inspect the engine's own controls before retrying.",
    refused:
      "Last shutdown was refused or failed. Refresh and review the current engine before retrying.",
    "already-stopped":
      "Colima profile already stopped; this request did not verify a previous VM process exit.",
  };
export const engineShutdownAvailable = (snapshot: ProjectSnapshot): boolean =>
  ![
    "untrusted",
    "loading",
    "operation_active",
    "operation_attention",
    "package_missing",
    "package_outdated",
  ].includes(snapshot.availability) &&
  snapshot.activity?.state === "idle" &&
  snapshot.engineLifecycle?.state === "available" &&
  snapshot.engineLifecycle.report.colimaDefault.state === "running" &&
  snapshot.engineLifecycle.report.colimaDefault.shutdownSupported;

export const engineLifecyclePresentation = (snapshot: ProjectSnapshot) => {
  if (snapshot.availability === "untrusted")
    return {
      selected: "Engine not inspected",
      profile: "VM state unknown",
      detail:
        "Trust this workspace before inspecting or reviewing VM shutdown.",
    };
  const observation = snapshot.engineLifecycle;
  if (!observation || observation.state !== "available")
    return {
      selected: "Engine state unavailable",
      profile: "VM state unknown",
      detail:
        observation?.state === "unsupported"
          ? "This core version does not expose VM shutdown controls. Update Rehearsal, then refresh."
          : snapshot.availability === "package_missing"
            ? "Install Rehearsal in this project to inspect its engine and review VM shutdown."
            : "Refresh to inspect the selected engine. Unreachable services do not prove a VM has stopped.",
    };
  const report = observation.report;
  const selected =
    report.selected.state === "running"
      ? `Selected engine: running${report.selected.context ? ` (${report.selected.context})` : ""}`
      : report.selected.state === "unsupported-host"
        ? "Selected engine: unsupported host"
        : report.selected.state === "unavailable"
          ? "Selected engine: unreachable"
          : "Selected engine: unknown";
  const profile =
    report.colimaDefault.state === "running"
      ? "Colima VM: running"
      : report.colimaDefault.state === "stopped"
        ? "Colima profile: stopped"
        : report.colimaDefault.state === "not-observed"
          ? "VM shutdown unavailable"
          : "Colima profile: unknown";
  const detail =
    snapshot.activity?.state !== "idle"
      ? "Finish the active operation and refresh before reviewing VM shutdown."
      : ENGINE_LIFECYCLE_REASON_LABELS[report.colimaDefault.reason];
  return { selected, profile, detail };
};
/** Persistent local engine facts remain separate from the selected project's runtime. */
export const engineLifecycleMarkup = (
  snapshot: ProjectSnapshot,
  _actionUri: string,
  compact = false,
  shutdownState?: EngineShutdownUiState,
): string => {
  const display = engineLifecyclePresentation(snapshot),
    enabled = shutdownState !== "running" && engineShutdownAvailable(snapshot);
  const descriptionId = compact
    ? "engine-shutdown-header-description"
    : "engine-shutdown-resources-description";
  return `<section class="${compact ? "engine-shutdown-bar" : "resource-section"}" aria-label="VM shutdown" data-engine-shutdown-region><div><strong data-engine-shutdown-profile>${html(display.profile)}</strong><span class="control-note" data-engine-shutdown-selected>${html(display.selected)}</span></div><p id="${descriptionId}" class="control-note" role="status" data-engine-shutdown-notice data-engine-shutdown-default-detail="${html(display.detail)}">${html(shutdownState ? ENGINE_SHUTDOWN_UI_LABELS[shutdownState] : display.detail)}</p><button type="button" class="button button--danger" data-engine-shutdown-control${enabled ? "" : " disabled"} aria-describedby="${descriptionId}">Shut down VM…</button>${compact ? "" : '<p class="control-note">Stop project stops this project’s services. VM shutdown affects every workload on that VM and requires a fresh review. Database volumes and baselines are not selected for deletion.</p>'}</section>`;
};

export const engineShutdownUpdateFor = (
  snapshot: ProjectSnapshot,
  state?: EngineShutdownUiState,
) => {
  const report =
    snapshot.engineLifecycle?.state === "available"
      ? snapshot.engineLifecycle.report
      : undefined;
  return {
    type: "engineShutdownUpdated" as const,
    state: state ?? null,
    canReview: state !== "running" && engineShutdownAvailable(snapshot),
    selectedState: report?.selected.state ?? null,
    profileState: report?.colimaDefault.state ?? null,
    reason: report?.colimaDefault.reason ?? null,
  };
};
interface EngineShutdownNode {
  textContent: string | null;
  tagName?: string;
  disabled?: boolean;
  tabIndex?: number;
  getAttribute(name: string): string | null;
  setAttribute(name: string, value: string): void;
  removeAttribute(name: string): void;
}
interface EngineShutdownDocument {
  querySelectorAll(selector: string): Iterable<EngineShutdownNode>;
}
/** Serialized into the webview: update fixed nodes only, without touching forms or focus. */
export const applyEngineShutdownUpdate = (
  document: EngineShutdownDocument,
  raw: unknown,
  labels: {
    outcomes: Readonly<Record<string, string>>;
    reasons: Readonly<Record<string, string>>;
  },
): boolean => {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return false;
  const input = raw as Record<string, unknown>;
  const keys = [
    "type",
    "state",
    "canReview",
    "selectedState",
    "profileState",
    "reason",
  ];
  if (
    Object.keys(input).length !== keys.length ||
    keys.some((key) => !Object.hasOwn(input, key)) ||
    input.type !== "engineShutdownUpdated" ||
    typeof input.canReview !== "boolean" ||
    (input.state !== null &&
      (typeof input.state !== "string" ||
        !Object.hasOwn(labels.outcomes, input.state))) ||
    (input.reason !== null &&
      (typeof input.reason !== "string" ||
        !Object.hasOwn(labels.reasons, input.reason))) ||
    ![null, "running", "unavailable", "unknown", "unsupported-host"].includes(
      input.selectedState as never,
    ) ||
    ![null, "running", "stopped", "unknown", "not-observed"].includes(
      input.profileState as never,
    )
  )
    return false;
  const running = input.state === "running",
    enabled = input.canReview && !running;
  for (const node of document.querySelectorAll("[data-engine-shutdown-notice]"))
    node.textContent =
      input.state === null
        ? input.reason === null
          ? (node.getAttribute("data-engine-shutdown-default-detail") ??
            "Refresh to inspect the engine state.")
          : labels.reasons[input.reason as string]!
        : labels.outcomes[input.state as string]!;
  for (const node of document.querySelectorAll(
    "[data-engine-shutdown-selected]",
  ))
    node.textContent =
      input.selectedState === "running"
        ? "Selected engine: running"
        : input.selectedState === "unavailable"
          ? "Selected engine: unreachable"
          : input.selectedState === "unsupported-host"
            ? "Selected engine: unsupported host"
            : "Selected engine: unknown";
  for (const node of document.querySelectorAll(
    "[data-engine-shutdown-profile]",
  ))
    node.textContent =
      input.profileState === "running"
        ? "Colima VM: running"
        : input.profileState === "stopped"
          ? "Colima profile: stopped"
          : input.profileState === "not-observed"
            ? "VM shutdown unavailable"
            : "VM state unknown";
  for (const node of document.querySelectorAll(
    "[data-engine-shutdown-control]",
  )) {
    node.setAttribute("aria-disabled", String(!enabled));
    if (node.tagName?.toUpperCase() === "BUTTON") node.disabled = !enabled;
  }
  for (const node of document.querySelectorAll("[data-engine-shutdown-region]"))
    node.setAttribute("aria-busy", String(running));
  return true;
};
