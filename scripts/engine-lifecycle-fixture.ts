/** Synthetic presentation fixtures only. Never inspect or control a real engine. */
import { parseEngineLifecycleStatus } from "../src/engine_lifecycle_contract.js";
import {
  engineShutdownUpdateFor,
  type EngineShutdownUiState,
} from "../src/engine_lifecycle_view.js";
import type { ProjectSnapshot } from "../src/project_snapshot.js";

export const ENGINE_PREVIEW_STATES = [
  "running",
  "missing-config",
  "unsupported",
  "already-stopped",
  "review",
  "cancel",
  "uncertain",
] as const;
export type EnginePreviewState = (typeof ENGINE_PREVIEW_STATES)[number];
export const enginePreviewState = (
  value: string,
): EnginePreviewState | undefined =>
  ENGINE_PREVIEW_STATES.find((state) => state === value);

export function enginePreviewSnapshot(
  state: EnginePreviewState,
): ProjectSnapshot {
  const stopped = state === "already-stopped";
  const unsupported = state === "unsupported";
  return {
    workspaceName: "Synthetic VM control preview · no engine operations",
    workspaceRoot: "/preview-only",
    availability: "not_ready",
    ...(state === "missing-config"
      ? {
          error: {
            code: "CONFIG_MISSING",
            message: "Synthetic project has no Rehearsal configuration.",
            suggestions: [
              "Configure the project independently of VM shutdown.",
            ],
          },
        }
      : {}),
    version: "1.4.0-dev.1",
    activity: { schemaVersion: 1, state: "idle", operation: null },
    engineLifecycle: {
      state: "available",
      report: parseEngineLifecycleStatus({
        schemaVersion: 1,
        selected: {
          state: unsupported
            ? "unsupported-host"
            : stopped
              ? "unavailable"
              : "running",
          context: unsupported ? null : "colima",
          endpointIdentity: unsupported ? null : "a".repeat(64),
          daemonId: unsupported || stopped ? null : "synthetic-daemon",
        },
        colimaDefault: {
          state: unsupported ? "not-observed" : stopped ? "stopped" : "running",
          profile: "default",
          shutdownSupported: !unsupported && !stopped,
          reason: unsupported
            ? "unsupported-host"
            : stopped
              ? "profile-stopped"
              : "ready",
        },
        safety: {
          globalContextSwitchRequested: false,
          dataDeletionRequested: false,
          forceRequested: false,
          enginesStarted: false,
        },
      }),
    },
  };
}

/** Installed before the production controller; messages remain an explicit UI simulation. */
export function enginePreviewBridge(state: EnginePreviewState): string {
  const snapshot = enginePreviewSnapshot(state);
  const outcome: EngineShutdownUiState =
    state === "uncertain" ? "uncertain" : "running";
  const update = engineShutdownUpdateFor(snapshot, outcome);
  return `<script nonce="preview-navigation-nonce">(() => {
    let saved;
    window.acquireVsCodeApi = () => ({getState: () => saved, setState: value => {saved = value;}, postMessage: message => {
      if(!message || Object.keys(message).length !== 1 || message.type !== 'reviewVmShutdown') return;
      const output = document.getElementById('preview-engine-event');
      output.textContent = 'Synthetic review requested. No native confirmation or engine operation occurred.';
      output.dataset.count = String(Number(output.dataset.count || '0') + 1);
      if (${JSON.stringify(state)} === 'cancel') { output.textContent = 'Synthetic confirmation cancelled. No operation started.'; return; }
      if (${JSON.stringify(state)} === 'review') { location.href = '/engine-review-document'; return; }
      window.postMessage(${JSON.stringify(update)}, location.origin);
    }});
    document.addEventListener('DOMContentLoaded', () => {
      const aside = document.createElement('aside'); aside.className = 'preview-live-controls';
      aside.textContent = 'UI fixture only · no VM or host operations. ';
      const output = document.createElement('output'); output.id = 'preview-engine-event'; output.setAttribute('aria-live','polite'); output.textContent = 'No review requested.'; aside.append(output);
      const patch = document.createElement('button'); patch.type = 'button'; patch.id = 'preview-engine-patch'; patch.textContent = 'Simulate uncertain outcome without replacing drafts';
      patch.addEventListener('click', () => window.postMessage(${JSON.stringify(engineShutdownUpdateFor(snapshot, "uncertain"))}, location.origin)); aside.append(patch); document.body.append(aside);
    });
  })();</script>`;
}

/** Exact artifact provenance for a file-only native UI companion, never real Core conformance. */
export function parseNativeEngineFixture(value: unknown) {
  const fail = (): never => {
    throw new Error("Synthetic native engine fixture refused.");
  };
  if (!value || typeof value !== "object" || Array.isArray(value))
    return fail();
  const data = value as Record<string, unknown>;
  if (
    Object.keys(data).sort().join(",") !==
      "candidateSha256,coreArtifactSha256,coreVersion,kind,schemaVersion,status" ||
    data.kind !== "engine-lifecycle-native-fixture" ||
    data.schemaVersion !== 1 ||
    typeof data.coreVersion !== "string" ||
    !/^\d+\.\d+\.\d+(?:-[A-Za-z0-9.-]+)?$/u.test(data.coreVersion) ||
    typeof data.candidateSha256 !== "string" ||
    !/^[a-f0-9]{64}$/u.test(data.candidateSha256) ||
    typeof data.coreArtifactSha256 !== "string" ||
    !/^[a-f0-9]{64}$/u.test(data.coreArtifactSha256)
  )
    return fail();
  const status = parseEngineLifecycleStatus(data.status);
  if (!status.colimaDefault.shutdownSupported) return fail();
  return {
    candidateSha256: data.candidateSha256,
    coreArtifactSha256: data.coreArtifactSha256,
    coreVersion: data.coreVersion,
    status,
  };
}
