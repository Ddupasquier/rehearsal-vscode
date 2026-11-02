/** Harmless display/review state. It never changes runtime selection or approval digests. */
import type { ProjectSnapshot } from "./project_snapshot.js";
import type { NamedWorkspaceProfile } from "../configuration/configuration_contract.js";
import type { RecentOperationProgress } from "../runtime/operation_progress.js";

/** Current activity, historical command results and database liveness are separate evidence. */
export const workspaceExecutionState = (snapshot: ProjectSnapshot) => {
  const application = snapshot.configuration?.application;
  const applicationMode = !application
    ? "unknown"
    : application.readinessUrl === null
      ? "database_only"
      : application.readinessUrl && application.startCommand.trim()
        ? "launch_configured"
        : "incomplete";
  const proofConfigured = application
    ? Boolean(application.proofCommand.trim())
    : null;
  const command =
    snapshot.activity?.state === "busy"
      ? "active"
      : snapshot.activity?.state === "idle"
        ? "idle"
        : snapshot.activity?.state === "stale" ||
            snapshot.activity?.state === "invalid"
          ? "attention"
          : "unknown";
  // Do not let cached receipts turn unsafe/unobserved activity into current success.
  const runs =
    command === "idle" && snapshot.availability === "ready"
      ? (snapshot.activity?.recent ?? [])
          .filter((receipt) => receipt.kind === "run")
          .sort(
            (left, right) =>
              Date.parse(right.progress.startedAt) -
              Date.parse(left.progress.startedAt),
          )
      : [];
  // The public array is not ordered. Equal timestamps cannot prove a latest run.
  const lastRun: RecentOperationProgress | null =
    runs[0] &&
    (!runs[1] || runs[0].progress.startedAt !== runs[1].progress.startedAt)
      ? runs[0]
      : null;
  const primaryProof = lastRun?.progress.completedStages.some(
    (stage) =>
      stage.phase === "application-proof" &&
      stage.target === "primary" &&
      stage.state === "completed",
  );
  const failedProof =
    lastRun?.progress.currentStage?.phase === "application-proof" &&
    lastRun.progress.currentStage.target === "primary" &&
    lastRun.progress.currentStage.state === "failed";
  const proof =
    lastRun?.progress.state === "completed" && primaryProof
      ? "recorded_pass"
      : failedProof
        ? "recorded_failure"
        : "not_recorded";
  return { command, applicationMode, proofConfigured, lastRun, proof } as const;
};

/** Review ticks are display preferences, not approval or execution authority. */
export const MIGRATION_REVIEW_PERSISTENCE_LIMIT = 1000;

export const knownWorkspaceTargets = (
  snapshot: ProjectSnapshot,
): readonly string[] =>
  [
    ...new Set([
      ...(snapshot.runtime?.targets.map((target) => target.name) ?? []),
      ...(snapshot.resources?.environments.map((target) => target.target) ??
        []),
      ...(snapshot.candidates?.targets.map((target) => target.name) ?? []),
      ...(snapshot.migrationReview?.targets.map((target) => target.name) ?? []),
      ...(snapshot.configurationMetadata?.profiles.flatMap(
        (profile) => profile.targets,
      ) ?? []),
    ]),
  ]
    .filter((target) => /^[a-z0-9][a-z0-9-]{0,62}$/u.test(target))
    .slice(0, 32);

/** Self-contained so the same validated display rule can run in the packaged webview. */
export const resolveWorkspaceViewScope = (
  knownTargets: readonly string[],
  profiles: readonly NamedWorkspaceProfile[],
  selection: { readonly profile: string; readonly selectedTarget: string },
) => {
  const known = [...new Set(knownTargets)].slice(0, 32);
  const named = profiles.find(
    (profile) => `named:${profile.name}` === selection.profile,
  );
  const profile =
    ["full", "primary", "minimal"].includes(selection.profile) || named
      ? selection.profile
      : "full";
  const target =
    selection.selectedTarget === "all" ||
    known.includes(selection.selectedTarget)
      ? selection.selectedTarget
      : "all";
  const profileTargets =
    profile === "primary"
      ? known.filter((name) => name === "primary")
      : named
        ? named.targets.filter((name) => known.includes(name))
        : known;
  const targets =
    target === "all"
      ? profileTargets
      : profileTargets.filter((name) => name === target);
  const warning =
    profile !== selection.profile
      ? "The saved profile no longer exists. Full project view is shown; choose a current profile."
      : target !== selection.selectedTarget
        ? "The saved target is no longer available. Review the current configured targets."
        : targets.length === 0 && known.length > 0
          ? "This target is outside the selected profile. Choose All targets or a matching profile."
          : null;
  return {
    targets,
    profile,
    selectedTarget: target,
    onlyProjectOwned: profile === "minimal",
    warning,
  };
};

/** Restore only current eligible full IDs; a cache is never deletion authority. */
export const reconcileImageSelection = (
  saved: unknown,
  eligibleIds: readonly string[],
): readonly string[] => {
  if (!Array.isArray(saved) || saved.length > 100) return [];
  const eligible = new Set(
    eligibleIds.filter((id) => /^sha256:[a-f0-9]{64}$/u.test(id)),
  );
  const selected = new Set<string>();
  for (const id of saved)
    if (
      typeof id === "string" &&
      /^sha256:[a-f0-9]{64}$/u.test(id) &&
      eligible.has(id)
    )
      selected.add(id);
  return [...selected];
};

export const reconcileMigrationReview = (
  saved: unknown,
  savedIdentity: unknown,
  currentIdentity: string,
  currentIds: readonly string[],
  // Keep this default literal self-contained when the function is serialized
  // from CommonJS output. The shared constant is passed by the webview caller.
  maximumRememberedIds = 1000,
): readonly string[] => {
  if (
    savedIdentity !== currentIdentity ||
    !Array.isArray(saved) ||
    saved.length > maximumRememberedIds
  )
    return [];
  const eligible = new Set(currentIds);
  return [
    ...new Set(
      saved.filter(
        (id): id is string =>
          typeof id === "string" &&
          id.length <= 300 &&
          !/[\x00-\x1f\x7f]/u.test(id) &&
          eligible.has(id),
      ),
    ),
  ];
};

export const migrationReviewIdentity = (snapshot: ProjectSnapshot): string =>
  JSON.stringify({
    digest:
      snapshot.candidates?.digest ??
      snapshot.migrationReview?.candidateSha256 ??
      null,
    baselines: snapshot.migrationReview?.targets.map((target) => [
      target.name,
      target.baselineGenerationId,
    ]) ??
      snapshot.runtime?.targets.map((target) => [
        target.name,
        target.baselineGenerationId ??
          (target.name === "primary"
            ? (snapshot.baseline?.generationId ?? null)
            : null),
      ]) ?? [["primary", snapshot.baseline?.generationId ?? null]],
  });
