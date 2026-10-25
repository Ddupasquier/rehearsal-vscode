import type { ProjectSnapshot } from "../src/project_snapshot.js";
export const lifecycleSafety = {
  globalContextSwitchRequested: false,
  dataDeletionRequested: false,
  forceRequested: false,
  enginesStarted: false,
} as const;
export const lifecycleStatus = () => ({
  schemaVersion: 1,
  selected: {
    state: "running",
    context: "colima",
    endpointIdentity: "a".repeat(64),
    daemonId: "fixture-daemon",
  },
  colimaDefault: {
    state: "running",
    profile: "default",
    shutdownSupported: true,
    reason: "ready",
  },
  safety: lifecycleSafety,
});
export const lifecyclePreview = () => ({
  schemaVersion: 1,
  action: "engine-stop",
  state: "review-required",
  reason: "ready",
  consentDigest: "b".repeat(64),
  engine: {
    backend: "colima",
    profile: "default",
    context: "colima",
    endpointIdentity: "a".repeat(64),
    daemonId: "fixture-daemon",
    bootId: "a".repeat(32),
    vmIdentity: "c".repeat(64),
  },
  impact: {
    containers: [
      {
        id: "d".repeat(64),
        name: "another-project",
        state: "running",
        restartCount: 0,
        startedAt: "2026-10-25T00:00:00Z",
        finishedAt: "0001-01-01T00:00:00Z",
      },
    ],
    runningCount: 1,
  },
  safety: lifecycleSafety,
});
export const lifecycleResult = () => ({
  schemaVersion: 1,
  status: "stopped",
  reason: "shutdown-confirmed",
  engine: lifecyclePreview().engine,
  confirmed: { profileStopped: true, vmProcessAbsent: true },
  selectionAfter: {
    state: "unavailable",
    context: "default",
    endpointIdentity: "e".repeat(64),
    daemonId: null,
  },
  safety: lifecycleSafety,
});
export const engineSnapshot = (): ProjectSnapshot => ({
  workspaceName: "fixture",
  workspaceRoot: "/workspace",
  availability: "not_ready",
  version: "1.4.0-dev.1",
  activity: { schemaVersion: 1, state: "idle", operation: null },
  engineLifecycle: { state: "available", report: lifecycleStatus() as never },
});
