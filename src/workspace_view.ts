import { resolve } from "node:path";
import {
  engineLifecycleMarkup,
  applyEngineShutdownUpdate,
  ENGINE_SHUTDOWN_UI_LABELS,
  type EngineShutdownUiState,
} from "./engine_lifecycle_view.js";
import { ENGINE_LIFECYCLE_REASON_LABELS } from "./engine_lifecycle_contract.js";
import type { ProjectSnapshot } from "./project_snapshot.js";
import {
  extensionReleasePresentation,
  applyExtensionReleaseUpdate,
  type ExtensionReleaseEvidence,
} from "./extension_release_view.js";
import {
  workspaceActionPlan,
  type WorkspaceActionId,
} from "./action_catalog.js";
import type {
  DecisionDiscoveryItem,
  DetectedDiscoveryItem,
  DiscoveryValue,
  ProjectDiscoveryData,
  SuggestedDiscoveryItem,
} from "./contracts.js";
import type { WorkspacePreferences } from "./workspace_preferences.js";
import {
  DEFAULT_WORKSPACE_PREFERENCES,
  isLoopbackUrl,
} from "./workspace_preferences.js";
import type { WorkspaceActivityRecord } from "./workspace_activity.js";
import {
  resourceManagerMarkup,
  resourcePaginationMarkup,
  RESOURCE_MANAGER_SCRIPT,
  SUMMARY_LIST_SCRIPT,
} from "./resource_manager_view.js";
import {
  renderBaselineScopeReview,
  renderAuthenticationReview,
} from "./review_view.js";
import {
  comparisonSubjects,
  compareEnvironmentEvidence,
} from "./environment_comparison.js";
import {
  migrationReviewCheckboxId,
  migrationReviewMarkup,
} from "./migration_view.js";
import { selectMigrationView } from "./migration_filter.js";
import {
  openSandboxSessionState,
  renderOperationProgress,
} from "./operation_progress.js";
import { applyOperationProgressUpdate } from "./workspace_live_update.js";
import { changedConfigurationFormValues } from "./configuration_form.js";
import {
  reconcileWorkspaceFormDrafts,
  workspaceFormDraftIdentity,
} from "./workspace_form_drafts.js";
import { renderBaselineShapeEvidence } from "./shape_view.js";
import {
  knownWorkspaceTargets,
  resolveWorkspaceViewScope,
  reconcileImageSelection,
  reconcileMigrationReview,
  migrationReviewIdentity,
  MIGRATION_REVIEW_PERSISTENCE_LIMIT,
  workspaceExecutionState,
} from "./workspace_view_state.js";
import {
  coreConfigurationControls,
  namedProfileControls,
  CONFIGURATION_CONTROLS_SCRIPT,
} from "./configuration_view.js";

export interface WorkspaceViewAssets {
  readonly engineShutdownState?: EngineShutdownUiState;
  readonly extensionVersion?: string;
  readonly extensionRelease?: ExtensionReleaseEvidence | undefined;
  readonly formDraftRevision?: number;
  readonly resourceSource: string;
  readonly stylesheetUri: string;
  readonly logoUri: string;
  readonly actionUris: Readonly<Record<WorkspaceActionId, string>>;
  readonly scriptNonce: string;
}

export const WORKSPACE_PAGES = [
  "overview",
  "setup",
  "migrations",
  "runtime",
  "data-auth",
  "configuration",
  "activity",
] as const;

export type WorkspacePage = (typeof WORKSPACE_PAGES)[number];

const WORKSPACE_PAGE_DETAILS: Readonly<
  Record<WorkspacePage, { readonly label: string; readonly glyph: string }>
> = {
  overview: { label: "Overview", glyph: "⌂" },
  setup: { label: "Project setup", glyph: "✦" },
  migrations: { label: "Migrations", glyph: "↗" },
  runtime: { label: "Environments", glyph: "◫" },
  "data-auth": { label: "Data & auth", glyph: "◎" },
  configuration: { label: "Configuration", glyph: "⌘" },
  activity: { label: "Activity & reports", glyph: "≋" },
};

type StatusTone = "success" | "warning" | "active" | "muted";

interface ProductStatus {
  readonly label: string;
  readonly detail: string;
  readonly tone: StatusTone;
}

interface JourneyStep {
  readonly label: string;
  readonly value: string;
  readonly state: "done" | "current" | "waiting";
}

type VerifiedRuntimeState = "available" | "missing" | "unknown";

const verifiedRuntimeState = (
  snapshot: ProjectSnapshot,
): VerifiedRuntimeState => {
  const targets = snapshot.runtime?.targets;
  if (!targets || targets.length === 0) return "unknown";
  if (
    targets.some(({ verifiedRuntimeAvailable }) => !verifiedRuntimeAvailable)
  ) {
    return targets.some(
      ({ verifiedRuntimeAvailable }) => verifiedRuntimeAvailable === false,
    )
      ? "missing"
      : "unknown";
  }
  return "available";
};

const escapeHtml = (value: string): string =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");

const formatCount = (value: number | undefined): string =>
  value === undefined ? "—" : value.toLocaleString("en-US");

/** Fixed presentation copy is also serialized into the browser controller. */
export const sandboxSessionPresentation = (
  state: ReturnType<typeof openSandboxSessionState>,
) => {
  switch (state) {
    case "interactive":
      return {
        label: "Sandbox running",
        detail:
          "Your application passed readiness and is open for hands-on testing.",
        guidance:
          "Your sandbox is running. Keep its terminal session open while you test. Press Ctrl+C or Ctrl+Z in that terminal when you are done.",
      };
    case "opening":
      return {
        label: "Opening sandbox",
        detail: "Rehearsal is starting and checking your local application.",
        guidance:
          "Follow startup in the owning terminal. SANDBOX READY confirms when you can begin hands-on testing.",
      };
    case "closing":
      return {
        label: "Closing sandbox",
        detail:
          "The session is ending; review shutdown in its owning terminal.",
        guidance:
          "Check the owning terminal for shutdown and cleanup. Wait for the session to finish before starting another operation.",
      };
    case "unknown":
      return {
        label: "Sandbox session open",
        detail:
          "Application readiness is not confirmed by the available activity details.",
        guidance:
          "Your sandbox session stays open for hands-on testing. Check its owning terminal for SANDBOX READY; you do not need to wait for the session to end.",
      };
    default:
      return null;
  }
};

const statusFor = (snapshot: ProjectSnapshot): ProductStatus => {
  switch (snapshot.availability) {
    case "loading":
      return {
        label: "Checking your project",
        detail:
          "Reading safe, project-local metadata. No project operation is being started.",
        tone: "active",
      };
    case "ready":
      if (snapshot.readiness?.state !== "READY")
        return {
          label: "Project readiness needs review",
          detail: "Refresh the project check before starting a sandbox.",
          tone: "warning",
        };
      if (
        snapshot.resources?.environments.some(
          (environment) => environment.protected,
        )
      )
        return {
          label: "Sandbox data is protected",
          detail:
            "Inspect or resume your sandbox. Review its protection policy before replacing or discarding data.",
          tone: "warning",
        };
      if (verifiedRuntimeState(snapshot) === "missing") {
        return {
          label: "Ready to create a sandbox",
          detail:
            "Your project and baseline are ready. Create the disposable local runtime when you need it.",
          tone: "success",
        };
      }
      if (verifiedRuntimeState(snapshot) === "unknown") {
        return {
          label: "Sandbox state needs review",
          detail:
            "The installed Rehearsal version cannot prove that a prepared runtime exists.",
          tone: "warning",
        };
      }
      if ((snapshot.candidates?.count ?? 0) > 0)
        return {
          label: "Ready to rehearse",
          detail:
            "Review the pending migrations before starting a new rehearsal command.",
          tone: "success",
        };
      {
        const execution = workspaceExecutionState(snapshot);
        const idle =
          execution.command === "idle"
            ? "No Rehearsal command is active. "
            : "";
        if (execution.lastRun)
          return {
            label: `Last rehearsal ${execution.lastRun.progress.state}`,
            detail: `${idle}This is a recorded command result, not the database lifecycle. Review its proof in Activity & reports.`,
            tone:
              execution.lastRun.progress.state === "completed"
                ? "success"
                : "warning",
          };
        return {
          label:
            snapshot.runtime?.state === "running"
              ? "Database sandbox running"
              : "Database sandbox prepared",
          detail: `${idle}Database state does not prove that a rehearsal or application proof passed.`,
          tone: "muted",
        };
      }
    case "not_ready":
      return {
        label: "Setup needs attention",
        detail: "Finish the remaining setup item before running a rehearsal.",
        tone: "warning",
      };
    case "operation_active": {
      const session = sandboxSessionPresentation(
        openSandboxSessionState(snapshot),
      );
      if (session)
        return { label: session.label, detail: session.detail, tone: "active" };
      return {
        label:
          snapshot.activity?.operation?.kind === "run"
            ? "Rehearsal command running"
            : "Project command running",
        detail:
          "A Rehearsal command is active. Database lifecycle and completed proof are separate evidence.",
        tone: "active",
      };
    }
    case "operation_attention":
      return {
        label: "Operation needs review",
        detail: "Check the previous operation before starting another one.",
        tone: "warning",
      };
    case "untrusted":
      return {
        label: "Workspace Trust required",
        detail:
          "Trust this folder before Rehearsal inspects local project state.",
        tone: "warning",
      };
    case "package_missing":
      return {
        label: "Rehearsal is not installed",
        detail: "Install Rehearsal to unlock the complete project profile.",
        tone: "muted",
      };
    case "package_outdated":
      return {
        label: "Rehearsal update required",
        detail: `Update the project from ${snapshot.version ?? "its installed version"} before inspection continues.`,
        tone: "warning",
      };
    case "error":
      if (snapshot.error?.code === "package_link_external")
        return {
          label: "Project package link needs repair",
          detail:
            "Rehearsal resolves outside this repository. Install a project-local copy, then refresh.",
          tone: "warning",
        };
      if (snapshot.error?.code === "platform_unsupported") {
        return {
          label: "Open this project in WSL 2",
          detail:
            "Windows uses a Linux workspace and Rehearsal extension host in WSL 2.",
          tone: "warning",
        };
      }
      if (snapshot.error?.code === "timeout") {
        return {
          label: "Project check timed out",
          detail:
            snapshot.activity?.state === "idle"
              ? "No Rehearsal operation is running. The read-only inspection needs another try or more time."
              : "The read-only inspection needs another try or more time.",
          tone: "warning",
        };
      }
      return {
        label: "Project check unavailable",
        detail: "Review the diagnostic and retry the project check.",
        tone: "warning",
      };
  }
};

const journeyFor = (snapshot: ProjectSnapshot): readonly JourneyStep[] => {
  const execution = workspaceExecutionState(snapshot);
  const lastRun = execution.lastRun;
  return snapshot.availability === "loading"
    ? [
        { label: "Set up", value: "Checking", state: "current" },
        { label: "Baseline", value: "Checking", state: "waiting" },
        { label: "Review", value: "Checking", state: "waiting" },
        { label: "Run", value: "Checking", state: "waiting" },
        { label: "Verify", value: "Checking", state: "waiting" },
      ]
    : snapshot.availability === "operation_active"
      ? ["Set up", "Baseline", "Review", "Run", "Verify"].map((label) => ({
          label,
          value:
            label === "Run"
              ? (sandboxSessionPresentation(openSandboxSessionState(snapshot))
                  ?.label ?? "Operation running")
              : "Inspection on hold",
          state: label === "Run" ? ("current" as const) : ("waiting" as const),
        }))
      : [
          {
            label: "Set up",
            value: snapshot.configPath ? "Configured" : "Needs review",
            state: snapshot.configPath ? "done" : "current",
          },
          {
            label: "Baseline",
            value: snapshot.baseline ? "Verified" : "Waiting",
            state: snapshot.baseline ? "done" : "waiting",
          },
          {
            label: "Review",
            value:
              snapshot.candidates?.count === undefined
                ? "Waiting"
                : snapshot.candidates.count === 0
                  ? "No changes"
                  : `${snapshot.candidates.count} pending`,
            state:
              snapshot.candidates?.count === undefined
                ? "waiting"
                : snapshot.candidates.count > 0
                  ? "current"
                  : "done",
          },
          {
            label: "Run",
            value: lastRun
              ? `Last run ${lastRun.progress.state}`
              : "No completed run evidence",
            state:
              lastRun?.progress.state === "completed"
                ? "done"
                : lastRun
                  ? "current"
                  : "waiting",
          },
          {
            label: "Verify",
            value:
              execution.proof === "recorded_pass"
                ? "CLI proof passed (recorded)"
                : execution.proof === "recorded_failure"
                  ? "Last CLI proof failed"
                  : execution.proofConfigured === true
                    ? "CLI proof configured · not yet proven"
                    : execution.proofConfigured === false
                      ? "CLI proof not configured"
                      : "Proof evidence unavailable",
            state: execution.proof === "recorded_pass" ? "done" : "waiting",
          },
        ];
};

const metric = (
  label: string,
  value: string,
  note: string,
  tone: StatusTone = "muted",
  identifier = false,
  sessionLabel = false,
): string => `
  <article class="metric metric--${tone}${identifier ? " metric--identifier" : ""}">
    <div class="metric__top"><span>${escapeHtml(label)}</span><i aria-hidden="true"></i></div>
    <strong${sessionLabel ? " data-sandbox-session-label" : ""}>${escapeHtml(value)}</strong>
    <small>${escapeHtml(note)}</small>
  </article>`;

const navigationItem = (
  target: WorkspacePage,
  label: string,
  glyph: string,
  activePage: WorkspacePage,
  badge?: string,
): string => `
  <button type="button" class="nav-item nav-item--${target}${activePage === target ? " nav-item--active" : ""}" data-rehearsal-page="${target}"${activePage === target ? ' aria-current="page"' : ""}>
    <span class="nav-item__glyph" aria-hidden="true">${escapeHtml(glyph)}</span>
    <span class="nav-item__label">${escapeHtml(label)}</span>
    ${badge ? `<small>${escapeHtml(badge)}</small>` : ""}
  </button>`;

const actionButton = (
  assets: WorkspaceViewAssets,
  action: WorkspaceActionId,
  label: string,
  tone: "primary" | "secondary" | "danger" = "secondary",
): string =>
  `<a class="button button--${tone}" href="${escapeHtml(assets.actionUris[action])}">${escapeHtml(label)}</a>`;

const actionGroup = (...buttons: readonly string[]): string =>
  `<div class="action-group">${buttons.filter(Boolean).join("")}</div>`;

const availableActionButton = (
  snapshot: ProjectSnapshot,
  assets: WorkspaceViewAssets,
  action: WorkspaceActionId,
  label: string,
  tone: "primary" | "secondary" | "danger" = "secondary",
): string => {
  const plan = workspaceActionPlan(snapshot, action);
  if (!plan) return "";
  if (
    plan.kind === "terminal" &&
    !["installPackage", "updatePackage"].includes(action) &&
    ["untrusted", "loading", "package_outdated", "package_missing"].includes(
      snapshot.availability,
    )
  )
    return "";
  if (
    [
      "runRehearsal",
      "migrate",
      "openSandbox",
      "startRuntime",
      "verify",
      "reset",
      "stopRuntime",
      "discardRuntime",
      "identityConnect",
    ].includes(action) &&
    snapshot.readiness?.state !== "READY"
  )
    return "";
  if (
    action === "openSandbox" &&
    (!snapshot.configuration?.application.readinessUrl ||
      !snapshot.configuration.application.startCommand.trim())
  )
    return "";
  if (
    action === "identityConnect" &&
    snapshot.environment?.target !== "supabase"
  )
    return "";
  return actionButton(assets, action, label, tone);
};

const navigationButton = (page: WorkspacePage, label: string): string =>
  `<button type="button" class="button button--secondary" data-rehearsal-page="${page}">${escapeHtml(label)}</button>`;

const journeyMarkup = (snapshot: ProjectSnapshot): string => `
  <ol class="journey" aria-label="Rehearsal workflow">
    ${journeyFor(snapshot)
      .map(
        (step, index) => `
          <li class="journey__step journey__step--${step.state}">
            <span class="journey__marker">${step.state === "done" ? "✓" : String(index + 1)}</span>
            <span><strong>${escapeHtml(step.label)}</strong><small${step.label === "Run" && openSandboxSessionState(snapshot) !== null ? " data-sandbox-session-label" : ""}>${escapeHtml(step.value)}</small></span>
          </li>`,
      )
      .join("")}
  </ol>`;

const nextStepMarkup = (
  snapshot: ProjectSnapshot,
  assets: WorkspaceViewAssets,
  preferences: WorkspacePreferences,
): string => {
  if (snapshot.availability === "loading") {
    return `
      <p>Rehearsal is checking the installed package, project setup, baseline, migrations, runtime, and local resource ownership.</p>
      <div class="loading-steps" role="status" aria-live="polite">
        <span class="loading-spinner" aria-hidden="true"></span>
        <span><strong>Inspection in progress</strong><small>This is read-only and will never start Docker.</small></span>
      </div>`;
  }
  if (snapshot.availability === "package_missing") {
    return `
      <p>Add Rehearsal using this project's detected package manager. The exact command is shown for approval before it runs.</p>
      ${actionGroup(actionButton(assets, "installPackage", "Install Rehearsal", "primary"), actionButton(assets, "documentation", "Read the guide"))}`;
  }
  if (snapshot.availability === "package_outdated") {
    return `
      <p>This project has ${escapeHtml(snapshot.version ?? "an older Rehearsal release")}. Update to ${escapeHtml(snapshot.compatibility?.minimumVersion ?? "the current supported release")} or newer to unlock the workspace.</p>
      ${actionGroup(actionButton(assets, "updatePackage", "Update Rehearsal", "primary"), actionButton(assets, "showOutput", "Open diagnostics"))}`;
  }
  if (snapshot.availability === "untrusted") {
    return `<p>Review the folder, then enable VS Code Workspace Trust to continue.</p>${actionGroup(actionButton(assets, "manageTrust", "Review Workspace Trust", "primary"))}`;
  }
  if (
    snapshot.availability === "ready" &&
    snapshot.resources?.environments.some(
      (environment) => environment.protected,
    )
  )
    return `<p>A configured environment is protected. Review its policy before a rehearsal, reset, or discard. Starting and stopping still preserve its data.</p>${actionGroup(navigationButton("runtime", "Review protected environments"))}`;
  if (snapshot.error) {
    if (snapshot.error.code === "package_link_external")
      return `<p>The workspace Rehearsal package resolves outside its repository. Install a project-local package copy or a reviewed packed candidate, then refresh.</p><ul class="recovery-list"><li>For a local source folder with npm, use <code>--install-links</code> to copy the package instead of creating an external symlink.</li><li>The repository safety boundary remains in place. No database change or editor reset is required.</li></ul>${actionGroup(actionButton(assets, "refresh", "Refresh after installing", "primary"), actionButton(assets, "showOutput", "Open diagnostics"))}`;
    if (snapshot.error.code === "platform_unsupported") {
      return `
        <p>${escapeHtml(snapshot.error.message)}</p>
        <ol class="recovery-list">${snapshot.error.suggestions.map((suggestion) => `<li>${escapeHtml(suggestion)}</li>`).join("")}</ol>
        <p>No inspection process was started. This does not change your files or database.</p>
        ${actionGroup(actionButton(assets, "documentation", "Windows setup guide", "primary"), actionButton(assets, "showOutput", "Open diagnostics"))}`;
    }
    const errorCopy =
      snapshot.error.code === "timeout"
        ? "A read-only project check took longer than the configured limit. Retry it, or increase Rehearsal: Inspection Timeout Seconds for this workspace."
        : "Rehearsal could not safely complete this project check. Retry the inspection or open the bounded diagnostic log.";
    return `
      <p>${escapeHtml(errorCopy)}</p>
      ${snapshot.error.code === "timeout" ? `<p class="diagnostic-detail">${escapeHtml(snapshot.error.message)}</p>` : ""}
      ${snapshot.error.suggestions.length ? `<ul class="recovery-list">${snapshot.error.suggestions.map((suggestion) => `<li>${escapeHtml(suggestion)}</li>`).join("")}</ul>` : ""}
      ${actionGroup(actionButton(assets, "refresh", "Try again", "primary"), ...(snapshot.error.code === "timeout" ? [actionButton(assets, "inspectionSettings", "Adjust timeout")] : []), ...(snapshot.version ? [actionButton(assets, "doctor", "Run Doctor"), actionButton(assets, "supportReport", "Support report")] : []), actionButton(assets, "showOutput", "Open diagnostics"))}`;
  }
  if (snapshot.availability === "operation_active") {
    const session = sandboxSessionPresentation(
      openSandboxSessionState(snapshot),
    );
    const applicationUrl = isLoopbackUrl(preferences.applicationUrl)
      ? preferences.applicationUrl
      : "";
    return `<p${session ? " data-sandbox-session-guidance" : ""}>${escapeHtml(session?.guidance ?? "A project operation is running. View its progress or the owning terminal. Wait for it to finish before a fresh project check.")}</p>
      <p class="control-note">Project inspection is on hold while this operation owns the project lock. This does not pause your application.</p>
      ${session ? `<div class="endpoint-editor"><label><span>Application address</span><input id="active-application-url" type="url" value="${escapeHtml(applicationUrl)}" placeholder="Paste the local address from your terminal" aria-describedby="active-application-help" /></label><button id="open-active-application" class="button button--primary" type="button">Open application</button><small id="active-application-help">Use the HTTP(S) loopback address printed in the owning terminal. Opening a browser does not start the app or verify readiness.</small></div>` : ""}
      ${actionGroup(navigationButton("activity", "View operation progress"), actionButton(assets, "showOutput", "Open diagnostics"))}`;
  }
  if (snapshot.availability === "operation_attention") {
    return `<p>Review the interrupted operation before trying another change.</p>${actionGroup(actionButton(assets, "doctor", "Run Doctor", "primary"), actionButton(assets, "supportReport", "Support report"))}`;
  }
  if (
    snapshot.availability === "not_ready" ||
    snapshot.readiness?.state === "NOT READY"
  ) {
    const failed = snapshot.readiness?.checks.find(
      ({ status }) => status === "fail",
    );
    return `<p>${escapeHtml(failed?.remediation ?? failed?.detail ?? "Complete the remaining setup item.")}</p>${actionGroup(navigationButton("setup", "Review project setup"), availableActionButton(snapshot, assets, "guidedSetup", "Open guided setup", "primary"))}`;
  }
  if (
    snapshot.availability !== "ready" ||
    snapshot.readiness?.state !== "READY" ||
    !snapshot.candidates
  )
    return `<p>Project readiness is not yet proven. Refresh the read-only check or review setup before starting a sandbox.</p>${actionGroup(actionButton(assets, "refresh", "Check project", "primary"), navigationButton("setup", "Review project setup"))}`;
  if ((snapshot.candidates?.count ?? 0) > 0) {
    return `<p>Review the pending migration set before running it locally. A display profile does not change the complete reviewed plan.</p>${actionGroup(navigationButton("migrations", "Review migrations"), availableActionButton(snapshot, assets, "runRehearsal", "Run rehearsal", "primary"))}`;
  }
  if (snapshot.candidates && verifiedRuntimeState(snapshot) !== "available") {
    const legacy = verifiedRuntimeState(snapshot) === "unknown";
    return `<p>${escapeHtml(
      legacy
        ? "This Rehearsal version cannot prove that a prepared sandbox exists. Create a fresh sandbox, or update the package for precise runtime detection."
        : "Create the disposable sandbox from your verified baseline before opening it for hands-on testing.",
    )}</p>${actionGroup(availableActionButton(snapshot, assets, "runRehearsal", "Create sandbox", "primary"), navigationButton("runtime", "Review runtime"))}`;
  }
  const open = availableActionButton(
    snapshot,
    assets,
    "openSandbox",
    "Open sandbox",
    "primary",
  );
  if (!open) {
    const execution = workspaceExecutionState(snapshot);
    return `<p>${
      execution.applicationMode === "database_only"
        ? "Your sandbox is configured for database-only testing. Verify the database or inspect the reviewed migrations; no browser application is required."
        : "Your database sandbox is prepared. Verify the database; application launch is optional and needs its own reviewed start command and readiness URL."
    }</p>${actionGroup(availableActionButton(snapshot, assets, "verify", "Verify database", "primary"), navigationButton("migrations", "Review migrations"), ...(execution.applicationMode === "incomplete" ? [navigationButton("configuration", "Review application launch")] : []))}`;
  }
  return `<p>Your project is ready. Open the sandbox for hands-on testing or review the detected project profile.</p>${actionGroup(open, navigationButton("setup", "Project profile"))}`;
};

const discoveryValue = (value: DiscoveryValue): string =>
  Array.isArray(value)
    ? value.map((entry) => escapeHtml(String(entry))).join(" · ")
    : escapeHtml(String(value));

const evidenceMarkup = (
  evidence: readonly { readonly source: string; readonly detail: string }[],
): string =>
  evidence.length === 0
    ? '<p class="evidence-empty">No additional safe metadata was available.</p>'
    : `<ul class="evidence-list">${evidence
        .map(
          ({ source, detail }) =>
            `<li><code>${escapeHtml(source)}</code><span>${escapeHtml(detail)}</span></li>`,
        )
        .join("")}</ul>`;

const detectedRow = (item: DetectedDiscoveryItem): string => `
  <details class="profile-row profile-row--detected">
    <summary>
      <span class="profile-row__signal" aria-hidden="true"></span>
      <span class="profile-row__copy"><strong>${escapeHtml(item.label)}</strong><span>${discoveryValue(item.value)}</span></span>
      <span class="pill">Detected</span>
    </summary>
    <div class="profile-row__details">
      <h4>Why Rehearsal believes this</h4>
      ${evidenceMarkup(item.evidence)}
    </div>
  </details>`;

const suggestedRow = (item: SuggestedDiscoveryItem): string => `
  <details class="profile-row profile-row--suggested">
    <summary>
      <span class="profile-row__signal" aria-hidden="true"></span>
      <span class="profile-row__copy"><strong>${escapeHtml(item.label)}</strong><span>${discoveryValue(item.value)}</span></span>
      <span class="pill">${escapeHtml(item.confidence)} confidence</span>
    </summary>
    <div class="profile-row__details">
      <p>${escapeHtml(item.review)}</p>
      <h4>Evidence</h4>
      ${evidenceMarkup(item.evidence)}
    </div>
  </details>`;

const decisionRow = (item: DecisionDiscoveryItem): string => `
  <details class="profile-row profile-row--decision">
    <summary>
      <span class="profile-row__signal" aria-hidden="true"></span>
      <span class="profile-row__copy"><strong>${escapeHtml(item.label)}</strong><span>${escapeHtml(item.question)}</span></span>
      <span class="pill">Your decision</span>
    </summary>
    <div class="profile-row__details">
      <p>${escapeHtml(item.reason)}</p>
      ${evidenceMarkup(item.evidence)}
    </div>
  </details>`;

const profileGroup = (
  title: string,
  description: string,
  tone: string,
  rows: readonly string[],
): string => `
  <section class="profile-group profile-group--${tone}">
    <header>
      <div><h3>${escapeHtml(title)}</h3><p>${escapeHtml(description)}</p></div>
      <span class="count-badge">${rows.length}</span>
    </header>
    <div class="profile-list">
      ${rows.length > 0 ? rows.join("") : '<p class="empty-state">Nothing here yet.</p>'}
    </div>
  </section>`;

const projectProfileMarkup = (snapshot: ProjectSnapshot): string => {
  if (!snapshot.discovery) {
    return '<div class="empty-state empty-state--panel">Project discovery becomes available after Rehearsal can safely inspect this workspace.</div>';
  }
  const { profile, source } = snapshot.discovery;
  return `
    <div class="source-banner">
      <span class="source-banner__icon" aria-hidden="true">✦</span>
      <div><strong>${source === "core" ? "Complete project profile" : "Early project profile"}</strong><span>${source === "core" ? "Generated by Rehearsal core from safe, project-local metadata." : "Generated from a limited VS Code metadata scan. A discovery-capable Rehearsal release provides the complete profile."}</span></div>
      <span class="pill">Read only</span>
    </div>
    <div class="profile-layout">
      ${profileGroup(
        "Detected",
        "Facts Rehearsal can prove.",
        "detected",
        profile.detected.map(detectedRow),
      )}
      ${profileGroup(
        "Suggested",
        "Likely settings for you to review.",
        "suggested",
        profile.suggested.map(suggestedRow),
      )}
      <div class="profile-layout__wide">
        ${profileGroup(
          "Your decisions",
          "Privacy and safety choices only you can make.",
          "decision",
          profile.decisions.map(decisionRow),
        )}
      </div>
    </div>`;
};

const readinessMarkup = (snapshot: ProjectSnapshot): string => {
  const checks = snapshot.readiness?.checks;
  if (!checks || checks.length === 0) {
    return '<div class="empty-state empty-state--panel">Readiness checks appear after Rehearsal can inspect the installed project.</div>';
  }
  return `<section class="readiness-panel" aria-labelledby="readiness-heading">
    <header><div><small>Safety checklist</small><h2 id="readiness-heading">${snapshot.readiness?.state === "READY" ? "Everything required is ready" : "Finish these setup items"}</h2></div><span class="state-chip">${snapshot.readiness?.passed}/${checks.length} passed</span></header>
    <div class="readiness-list">
      ${checks
        .map(
          (
            check,
          ) => `<article class="readiness-row readiness-row--${escapeHtml(check.status)}">
            <span class="readiness-row__icon" aria-hidden="true">${check.status === "pass" ? "✓" : check.status === "warn" ? "!" : "×"}</span>
            <div><strong>${escapeHtml(check.label)}</strong><p>${escapeHtml(check.detail)}</p>${check.remediation ? `<small><b>Next:</b> ${escapeHtml(check.remediation)}</small>` : ""}</div>
          </article>`,
        )
        .join("")}
    </div>
  </section>`;
};

const candidateMarkup = (
  snapshot: ProjectSnapshot,
  preferences: WorkspacePreferences,
): string => {
  const review = migrationReviewMarkup(snapshot, preferences);
  if (review !== null)
    return `${review}<p class="control-note">Date filters compare version-identifier prefixes, not observed file creation times. Sorting changes this review view only.</p>`;
  if (!snapshot.candidates) {
    return '<div class="empty-state">Migration candidates become available after setup is complete.</div>';
  }
  if (snapshot.candidates.files.length === 0) {
    return '<div class="empty-state empty-state--success"><strong>You’re all caught up.</strong><span>No migrations are waiting to be rehearsed.</span></div>';
  }
  const migrations = snapshot.candidates.files.map((candidate) => {
    if (typeof candidate !== "string") return candidate;
    const match = /^(\d{14})_(.+)\.sql$/u.exec(candidate);
    return {
      version: match?.[1] ?? "",
      name: match?.[2] ?? candidate,
      filename: candidate,
      sha256: snapshot.candidates!.digest,
      target: "primary",
    };
  });
  const targets = ["all", ...knownWorkspaceTargets(snapshot)];
  return `<div class="migration-workbench">
    <div class="workbench-toolbar" aria-label="Migration filters">
      <label><span>Find migrations</span><input id="migration-search" type="search" value="${escapeHtml(preferences.migrationQuery)}" placeholder="Name, version, or target" /></label>
      <label><span>Target</span><select id="migration-target">${targets.map((target) => `<option value="${escapeHtml(target)}"${preferences.selectedTarget === target ? " selected" : ""}>${escapeHtml(target === "all" ? "All targets" : target)}</option>`).join("")}</select></label>
      <label><span>Status</span><select id="migration-status"><option value="all"${preferences.migrationStatus === "all" ? " selected" : ""}>All statuses</option><option value="candidate"${preferences.migrationStatus === "candidate" ? " selected" : ""}>Waiting</option></select></label>
      <label><span>Sort</span><select id="migration-sort"><option value="order"${preferences.migrationSort === "order" ? " selected" : ""}>Migration order</option><option value="name"${preferences.migrationSort === "name" ? " selected" : ""}>Name</option><option value="date"${preferences.migrationSort === "date" ? " selected" : ""}>Version prefix</option><option value="target"${preferences.migrationSort === "target" ? " selected" : ""}>Target</option></select></label>
    </div>
    <div class="migration-summary" role="status"><strong id="migration-visible-count">${snapshot.candidates.files.length}</strong> visible · <span id="migration-reviewed-count">0 reviewed</span> · <span>all migrations remain in the exact ordered candidate set</span></div>
    <ul class="migration-list" id="migration-list">${migrations
      .map(
        (migration, index) =>
          `<li data-migration-row data-name="${escapeHtml(migration.filename.toLowerCase())}" data-sort-name="${escapeHtml(migration.name.toLowerCase())}" data-target="${escapeHtml(migration.target)}" data-status="candidate" data-version="${escapeHtml(migration.version ?? "")}" data-order="${index}"><label class="migration-check"><input id="${migrationReviewCheckboxId(`${migration.target}:${migration.version || index}`)}" type="checkbox" data-migration-review="${escapeHtml(`${migration.target}:${migration.version || index}`)}" aria-label="Reviewed ${escapeHtml(migration.filename)}" /><span aria-hidden="true">↗</span><span><code>${escapeHtml(migration.filename)}</code><small>${escapeHtml(migration.target)} · ${escapeHtml(migration.version || "Version unavailable")} · ${escapeHtml(migration.sha256.slice(0, 12))}</small></span><strong class="field-state field-state--suggested">waiting</strong></label></li>`,
      )
      .join("")}</ul>
    <div id="migration-filter-empty" class="empty-state" hidden><strong>No migrations match these filters.</strong><button id="clear-migration-filters" type="button" class="button button--secondary">Clear migration filters</button></div>
    <p class="control-note">The checklist tracks your review only; it starts unchecked. Rehearsal still applies the complete dependency-safe ordered set shown by the digest. Version identifiers do not prove wall-clock creation dates.</p>
  </div>`;
};

const targetMarkup = (snapshot: ProjectSnapshot): string => {
  const targets = snapshot.runtime?.targets;
  if (!targets || targets.length === 0) {
    const configured = snapshot.resources?.environments;
    if (configured?.length)
      return `<div class="runtime-list" data-summary-list="targets">${configured.map((entry) => `<article class="runtime-row" data-display-target="${escapeHtml(entry.target)}" data-summary-row="targets" data-summary-target="${escapeHtml(entry.target)}"><span class="runtime-row__icon" aria-hidden="true">DB</span><span class="runtime-row__copy"><strong>${escapeHtml(entry.target)}</strong><small>${escapeHtml(entry.provider)} · verified receipt unavailable · ${entry.classification?.presence.state === "created" ? "created" : entry.classification?.presence.state === "not-created" ? "not created" : "creation unknown"}</small></span><span class="state-chip">${escapeHtml(entry.state)}</span></article>`).join("")}</div>${resourcePaginationMarkup("targets", "Database targets", "summary")}<p class="control-note">Configured resources are visible, but runtime verification is unavailable while Doctor needs attention. No running service or verified database was inferred.</p>`;
    return '<div class="empty-state">No local runtime targets are available yet.</div>';
  }
  return `<div class="runtime-list" data-summary-list="targets">${targets
    .map(({ name, runtimeTarget, state, reason, verifiedRuntimeAvailable }) => {
      const classification = snapshot.resources?.environments.find(
        (entry) => entry.target === name,
      )?.classification;
      const presence =
        classification?.presence.state === "created"
          ? "created"
          : classification?.presence.state === "not-created"
            ? "not created"
            : "creation unknown";
      return `
        <article class="runtime-row" data-display-target="${escapeHtml(name)}" data-summary-row="targets" data-summary-target="${escapeHtml(name)}">
          <span class="runtime-row__icon" aria-hidden="true">DB</span>
          <span class="runtime-row__copy"><strong>${escapeHtml(name)}</strong><small>${escapeHtml(runtimeTarget)}${reason ? ` · ${escapeHtml(reason.replaceAll("_", " "))}` : ""} · ${verifiedRuntimeAvailable === true ? "verified receipt available" : verifiedRuntimeAvailable === false ? "verified receipt unavailable" : "preparation unknown"} · ${presence}</small></span>
          <span class="state-chip">${escapeHtml(state)}</span>
        </article>`;
    })
    .join(
      "",
    )}</div>${resourcePaginationMarkup("targets", "Database targets", "summary")}`;
};

const formatGiB = (bytes: number): string =>
  `${(bytes / 1024 ** 3).toFixed(1)} GiB`;

const resourceInventoryMarkup = (
  snapshot: ProjectSnapshot,
  preferences: WorkspacePreferences,
): string => {
  const inventory = snapshot.resources;
  if (!inventory) {
    return '<div class="empty-state">Update Rehearsal core to view owned containers and Docker capacity here.</div>';
  }
  const disk = inventory.engine.disk;
  return `<div class="resource-inventory">
    <div class="metrics-grid">
      ${metric("Docker resource inspection", inventory.engine.state === "running" ? "Available" : "Unavailable", inventory.engine.context ?? "Current Docker context")}
      ${metric("Disk used", disk ? `${disk.usedPercent}%` : "Unavailable", disk ? `${formatGiB(disk.availableBytes)} free of ${formatGiB(disk.totalBytes)}` : "This engine does not expose a portable measurement", disk && disk.usedPercent >= 80 ? "warning" : "muted")}
      ${metric("Owned containers", formatCount(inventory.environments.reduce((total, entry) => total + entry.containerCount, 0)), `${formatCount(inventory.environments.reduce((total, entry) => total + entry.runningContainerCount, 0))} running`)}
      ${metric("Cleanup review", formatCount(inventory.stale.stoppedCount), inventory.stale.stoppedCount ? "Stopped environments need an exact preview" : "Nothing stale in this project", inventory.stale.stoppedCount ? "warning" : "success")}
    </div>
    <div class="runtime-list" data-summary-list="resource-targets">${inventory.environments
      .map(
        (
          entry,
        ) => `<article class="runtime-row" data-display-target="${escapeHtml(entry.target)}" data-summary-row="resource-targets" data-summary-target="${escapeHtml(entry.target)}">
          <span class="runtime-row__icon" aria-hidden="true">DB</span>
          <span class="runtime-row__copy"><strong>${escapeHtml(entry.target)}</strong><small>${escapeHtml(entry.provider)} · ${entry.runningContainerCount}/${entry.containerCount} containers running · ${entry.volumeCount} volumes${entry.diskUsageBytes === null ? "" : ` · ${formatGiB(entry.diskUsageBytes)} retained`}${entry.cpuPercent === null ? "" : ` · ${entry.cpuPercent.toFixed(2)}% CPU`}${entry.memoryUsageBytes === null ? "" : ` · ${formatGiB(entry.memoryUsageBytes)} memory`} · stop/start preserves data; reviewed reset/run can replace data and volumes · restart ${escapeHtml(entry.restartPolicies.join(", ") || "not present")}${entry.lastActivityAt ? ` · last observable resource activity ${escapeHtml(entry.lastActivityAt)}` : ""}</small></span>
          <span class="state-chip">${escapeHtml(entry.state)}</span>
        </article>`,
      )
      .join(
        "",
      )}</div>${resourcePaginationMarkup("resource-targets", "Target resource summaries", "summary")}
    ${inventory.engine.resources.length ? `<dl class="facts-list">${inventory.engine.resources.map((entry) => `<div><dt>${escapeHtml(entry.type)}</dt><dd>${escapeHtml(entry.size ?? "Unknown size")}${entry.reclaimable ? ` · ${escapeHtml(entry.reclaimable)} reclaimable` : ""}</dd></div>`).join("")}</dl>` : ""}
    <p class="control-note">Engine totals and shared images describe the whole Docker engine. Target and profile filters limit project-owned rows only; they never imply image ownership or a partial rehearsal. This is read-only evidence from Rehearsal core. Cleanup still requires its exact preview and confirmation.</p>
    ${resourceManagerMarkup(inventory, preferences)}
  </div>`;
};

const baselineVersionsMarkup = (
  snapshot: ProjectSnapshot,
  listId: "baselines" | "baseline-evidence" = "baselines",
): string => {
  const generations = snapshot.baseline?.generations ?? [];
  if (generations.length === 0) {
    return '<div class="empty-state">No baseline versions are available.</div>';
  }
  return `<div class="version-list" data-summary-list="${listId}">${generations
    .map(
      (
        generation,
      ) => `<article class="version-row${generation.active ? " version-row--active" : ""}" data-summary-row="${listId}">
        <span><strong>${escapeHtml(generation.active ? "Active baseline" : "Retained baseline")}</strong><code>${escapeHtml(generation.generationId)}</code><small>${escapeHtml(generation.createdAt ?? "Creation time unavailable")}</small></span>
        <span><b>${formatCount(generation.rowCount)} rows</b><small>${formatCount(generation.tableCount)} tables · ${formatCount(generation.storageAssetCount)} assets</small></span>
      </article>`,
    )
    .join(
      "",
    )}</div>${resourcePaginationMarkup(listId, "Baseline versions", "summary")}`;
};

const discoveryFieldValue = (
  profile: ProjectDiscoveryData | undefined,
  path: string,
): string => {
  const value = profile?.configuration.fields.find(
    (field) => field.path === path,
  )?.value;
  return typeof value === "string" ? value : "";
};

const configurationControlsMarkup = (
  snapshot: ProjectSnapshot,
  preferences: WorkspacePreferences,
): string => {
  const profile = snapshot.discovery?.profile;
  const startCommand =
    snapshot.configuration?.application.startCommand ??
    discoveryFieldValue(profile, "application.startCommand");
  const proofCommand =
    snapshot.configuration?.application.proofCommand ??
    discoveryFieldValue(profile, "application.proofCommand");
  const activeOperation = snapshot.availability === "operation_active";
  const applicationUrl = activeOperation
    ? isLoopbackUrl(preferences.applicationUrl)
      ? preferences.applicationUrl
      : ""
    : preferences.applicationUrl ||
      snapshot.applicationUrl ||
      "http://localhost:5175";
  const addressOrigin = preferences.applicationUrl
    ? "Your custom browser address"
    : activeOperation
      ? "Enter the local address from the owning terminal"
      : snapshot.applicationUrl
        ? "Saved & validated browser address"
        : "Suggested example — choose your application's address";
  const commandOrigin = snapshot.configuration
    ? "Saved & validated"
    : "Suggested — review the project script before saving";
  return `<form id="configuration-controls" class="configuration-controls">
    <div class="form-grid">
      <label><span>Application URL</span><input name="applicationUrl" type="url" value="${escapeHtml(applicationUrl)}" required /><small>${escapeHtml(addressOrigin)} · HTTP(S) loopback only. Does not change the readiness endpoint or provider callback.</small></label>
      <label><span>Baseline versions to retain</span><input name="retainBaselineGenerations" type="number" value="${snapshot.configuration?.cleanup?.retainBaselineGenerations ?? 2}" min="1" max="100" /><small>The active baseline is always protected.</small></label>
      <label><span>Application start command</span><input name="startCommand" type="text" value="${escapeHtml(startCommand)}" /><small>${escapeHtml(commandOrigin)}. Stored only after an exact diff and confirmation.</small></label>
      <label><span>Application proof command</span><input name="proofCommand" type="text" value="${escapeHtml(proofCommand)}" /><small>${escapeHtml(commandOrigin)}. Choose the project-owned proof for migration behavior.</small></label>
      <label><span>After a rehearsal run</span><select name="runPersistence"><option value="keep-until-stop"${snapshot.lifecycle?.run === "keep-until-stop" ? " selected" : ""}>Keep environment running</option><option value="stop-after-run"${snapshot.lifecycle?.run === "stop-after-run" ? " selected" : ""}>Stop after proof</option></select></label>
      <label><span>When the application closes</span><select name="openPersistence"><option value="keep-until-stop"${snapshot.lifecycle?.open === "keep-until-stop" ? " selected" : ""}>Keep database running</option><option value="stop-on-application-exit"${snapshot.lifecycle?.open === "stop-on-application-exit" ? " selected" : ""}>Stop database runtime</option></select></label>
    </div>
    <div class="action-group"><button class="button button--primary" type="submit">Review exact configuration diff</button><button class="button button--secondary" type="reset">Restore form values</button></div>
    <p class="control-note">Readiness endpoint: ${snapshot.configuration?.application.readinessUrl ? `<code>${escapeHtml(snapshot.configuration.application.readinessUrl)}</code> · saved & validated` : "not configured"}. Change it separately in the structured settings or source view. Authentication return paths and provider-console registration require their own review.</p>
    <p class="control-note">Only changed form values are proposed. Nothing is written until you inspect the diff and explicitly approve it. Unsupported or expression-based fields fail closed.</p>
  </form>`;
};

const configurationMarkup = (
  profile: ProjectDiscoveryData,
  snapshot: ProjectSnapshot,
): string => {
  const validated = new Map<string, string>([
    [
      "application.startCommand",
      snapshot.configuration?.application.startCommand ?? "",
    ],
    [
      "application.proofCommand",
      snapshot.configuration?.application.proofCommand ?? "",
    ],
    [
      "application.readiness.url",
      snapshot.configuration?.application.readinessUrl ?? "",
    ],
    [
      "cleanup",
      snapshot.configuration?.cleanup
        ? `Retain ${snapshot.configuration.cleanup.retainBaselineGenerations} baseline versions`
        : "",
    ],
  ]);
  return `
  <div class="configuration-table" role="list" aria-label="Proposed Rehearsal configuration">
    ${profile.configuration.fields
      .map((field) => {
        const current = validated.get(field.path);
        const isValidated = Boolean(current);
        return `
          <div class="configuration-row" role="listitem">
            <span><code>${escapeHtml(field.path)}</code><small>${isValidated ? escapeHtml(current!) : field.value === undefined ? "No safe value detected" : discoveryValue(field.value)}</small></span>
            <strong class="field-state field-state--${isValidated ? "present_unvalidated" : escapeHtml(field.status)}">${isValidated ? "saved & validated" : escapeHtml(field.status.replaceAll("_", " "))}</strong>
          </div>`;
      })
      .join("")}
  </div>`;
};

const pageHeader = (
  eyebrow: string,
  title: string,
  description: string,
): string => `
  <header class="page-heading">
    <p>${escapeHtml(eyebrow)}</p>
    <h1 tabindex="-1">${escapeHtml(title)}</h1>
    <span>${escapeHtml(description)}</span>
  </header>`;

export const renderWorkspaceDocument = (
  snapshot: ProjectSnapshot,
  assets: WorkspaceViewAssets,
  activePage: WorkspacePage = "overview",
  preferences: WorkspacePreferences = DEFAULT_WORKSPACE_PREFERENCES,
  activityHistory: readonly WorkspaceActivityRecord[] = [],
  inspectionState: "loading" | "idle" = "idle",
): string => {
  const extensionRelease = extensionReleasePresentation(
    assets.extensionVersion ?? "unavailable",
    assets.extensionRelease,
  );
  const configuredTargets = knownWorkspaceTargets(snapshot);
  const viewScope = resolveWorkspaceViewScope(
    configuredTargets,
    snapshot.configurationMetadata?.profiles ?? [],
    preferences,
  );
  preferences = {
    ...preferences,
    profile: viewScope.profile as WorkspacePreferences["profile"],
    selectedTarget: viewScope.selectedTarget,
    ...(snapshot.availability === "operation_active" &&
    !isLoopbackUrl(preferences.applicationUrl)
      ? { applicationUrl: "" }
      : {}),
  };
  const permittedAction = (
    action: WorkspaceActionId,
    label: string,
    tone: "primary" | "secondary" | "danger" = "secondary",
  ) => availableActionButton(snapshot, assets, action, label, tone);
  const isLoading =
    inspectionState === "loading" || snapshot.availability === "loading";
  const guidanceSnapshot = isLoading
    ? ({ ...snapshot, availability: "loading" } as ProjectSnapshot)
    : snapshot;
  const status = statusFor(guidanceSnapshot);
  const sandboxSession = sandboxSessionPresentation(
    openSandboxSessionState(guidanceSnapshot),
  );
  const activeOperation = snapshot.availability === "operation_active";
  const localApplicationUrl = activeOperation
    ? preferences.applicationUrl
    : preferences.applicationUrl ||
      snapshot.applicationUrl ||
      "http://localhost:5175";
  const readiness = snapshot.readiness;
  const readinessValue = readiness
    ? `${readiness.passed}/${readiness.passed + readiness.failed}`
    : isLoading
      ? "Checking…"
      : snapshot.error
        ? "Not checked"
        : "—";
  const profile = snapshot.discovery?.profile;
  const safeName = escapeHtml(snapshot.workspaceName);
  const candidateCount = snapshot.candidates?.count;
  const targetCount = configuredTargets.length || undefined;
  const decisionCount = profile?.decisions.length;
  const summaryMetrics =
    !isLoading && snapshot.availability === "operation_active"
      ? [
          metric(
            "Readiness",
            "On hold",
            "Readiness inspection resumes after the active operation",
            "active",
          ),
          metric(
            "Baseline",
            "On hold",
            "Baseline inspection resumes after the active operation",
            "active",
          ),
          metric(
            "Migrations",
            "On hold",
            "Migration inspection resumes after the operation",
            "active",
          ),
          metric(
            sandboxSession ? "Sandbox session" : "Runtime",
            sandboxSession?.label ?? "Not inspected",
            "Database status is not inspected during the active operation",
            "active",
            false,
            sandboxSession !== null,
          ),
        ].join("")
      : [
          metric(
            "Readiness",
            readinessValue,
            readiness
              ? `${readiness.failed} checks need attention`
              : isLoading
                ? "Reading readiness checks"
                : snapshot.error
                  ? "Follow the recovery steps below"
                  : "Run the project check to continue",
            readiness?.failed === 0
              ? "success"
              : isLoading
                ? "active"
                : "warning",
          ),
          metric(
            "Baseline",
            snapshot.baseline
              ? formatCount(snapshot.baseline.rowCount)
              : isLoading
                ? "Checking…"
                : snapshot.error
                  ? "Not checked"
                  : "Not verified",
            snapshot.baseline
              ? `${formatCount(snapshot.baseline.tableCount)} tables`
              : isLoading
                ? "Looking for a verified baseline"
                : snapshot.error
                  ? "Inspection did not reach this check"
                  : "Create or verify a baseline to continue",
            snapshot.baseline ? "success" : isLoading ? "active" : "muted",
          ),
          metric(
            "Migrations",
            candidateCount === undefined
              ? isLoading
                ? "Checking…"
                : snapshot.error
                  ? "Not checked"
                  : "—"
              : formatCount(candidateCount),
            candidateCount === undefined
              ? isLoading
                ? "Reading migration history"
                : snapshot.error
                  ? "Inspection did not reach this check"
                  : "Run the project check to continue"
              : candidateCount === 0
                ? "Nothing waiting"
                : "Ready for review",
            candidateCount
              ? "active"
              : candidateCount === 0
                ? "success"
                : isLoading
                  ? "active"
                  : "muted",
          ),
          metric(
            "Database",
            snapshot.runtime?.state ??
              (isLoading
                ? "Checking…"
                : snapshot.error
                  ? "Not checked"
                  : "Unknown"),
            targetCount === undefined
              ? isLoading
                ? "Reading configured targets"
                : snapshot.error
                  ? "Inspection did not reach this check"
                  : "Run the project check to continue"
              : `${formatCount(targetCount)} local target${targetCount === 1 ? "" : "s"} · database lifecycle, not command progress`,
            snapshot.runtime?.state === "running"
              ? "active"
              : isLoading
                ? "active"
                : "muted",
          ),
        ].join("");
  const activePageDetails = WORKSPACE_PAGE_DETAILS[activePage];
  const scriptPreferences = JSON.stringify(preferences).replaceAll(
    "<",
    "\\u003c",
  );
  const comparisons = comparisonSubjects(snapshot);
  const activityTone: StatusTone =
    snapshot.activity?.state === "busy"
      ? "active"
      : snapshot.activity?.state === "idle"
        ? "success"
        : snapshot.activity?.state === "stale" ||
            snapshot.activity?.state === "invalid"
          ? "warning"
          : "muted";
  const activityNote =
    snapshot.activity?.operation?.kind ??
    (snapshot.activity?.state === "idle"
      ? "No active operation"
      : snapshot.activity?.state === "busy"
        ? "Operation in progress"
        : snapshot.activity?.state === "stale" ||
            snapshot.activity?.state === "invalid"
          ? "Review operation state"
          : "Activity unavailable");
  const comparisonNotice = isLoading
    ? "Checking comparison evidence. Wait for the project inspection to finish."
    : snapshot.availability === "operation_active"
      ? "Comparison is paused while a project operation is running. Finish the operation or review its owning terminal, then refresh."
      : snapshot.availability === "operation_attention"
        ? "Comparison evidence is unavailable until the interrupted or unsafe operation is reviewed. Open diagnostics, then refresh after resolving it."
        : snapshot.availability === "untrusted"
          ? "Review Workspace Trust before inspecting comparison evidence. No project process has been started."
          : snapshot.availability === "package_missing"
            ? "Install Rehearsal and complete project setup before inspecting comparison evidence."
            : snapshot.availability === "package_outdated"
              ? "Update the project's Rehearsal package before inspecting comparison evidence."
              : snapshot.availability === "error"
                ? "Comparison evidence is unavailable because the project check did not finish safely. Retry the inspection or open diagnostics."
                : comparisons.length === 0
                  ? "No reviewed environment or baseline evidence is available to compare. Review project setup, then refresh. Missing evidence is not equal or verified."
                  : comparisons.length === 1
                    ? "Only one reviewed environment or baseline is available. Comparison needs two distinct entries. Inspect another configured target or retained baseline, then refresh."
                    : null;
  const comparisonOptions = (selected: number) =>
    comparisons
      .map(
        (item, index) =>
          `<option value="${escapeHtml(item.id)}"${index === selected ? " selected" : ""}>${escapeHtml(item.label)}</option>`,
      )
      .join("") || '<option value="">No comparison evidence available</option>';
  // Bound rendered pairs; large histories use the native exported comparison review.
  const visibleComparisons = comparisons.slice(0, 32);
  const comparisonMatrix = visibleComparisons.flatMap((left) =>
    visibleComparisons.map((right) => compareEnvironmentEvidence(left, right)),
  );
  const scriptComparisons = JSON.stringify(comparisonMatrix).replaceAll(
    "<",
    "\\u003c",
  );
  const scriptNamedProfiles = JSON.stringify(
    snapshot.configurationMetadata?.profiles ?? [],
  ).replaceAll("<", "\\u003c");
  const scriptTargets = JSON.stringify(configuredTargets).replaceAll(
    "<",
    "\\u003c",
  );
  const scriptReviewIdentity = JSON.stringify(
    migrationReviewIdentity(snapshot),
  ).replaceAll("<", "\\u003c");
  const scriptFormDraftIdentity = JSON.stringify(
    workspaceFormDraftIdentity(snapshot, assets.formDraftRevision ?? 0),
  );
  const scriptStructuredDraftNames = JSON.stringify(
    snapshot.configurationMetadata?.fields.map((field) => field.path) ?? [],
  ).replaceAll("<", "\\u003c");
  // Secondary targets do not advertise independent configuration source hashes.
  // Do not retain their drafts under the primary configuration's fingerprint.
  const scriptDraftResourceTargets = JSON.stringify(
    snapshot.resources?.environments
      .filter(
        (environment) =>
          snapshot.configPath &&
          resolve(snapshot.workspaceRoot, environment.configPath) ===
            resolve(snapshot.workspaceRoot, snapshot.configPath),
      )
      .map((environment) => environment.target) ?? [],
  ).replaceAll("<", "\\u003c");

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${escapeHtml(assets.resourceSource)}; style-src ${escapeHtml(assets.resourceSource)}; script-src 'nonce-${escapeHtml(assets.scriptNonce)}';" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <link rel="stylesheet" href="${escapeHtml(assets.stylesheetUri)}" />
    <title>${safeName} · Rehearsal</title>
  </head>
  <body${isLoading ? ' aria-busy="true"' : ""}>
    <a class="skip-link" href="#main-content">Skip to content</a>
    <div class="app-shell">
      <aside class="sidebar">
        <div class="brand">
          <img src="${escapeHtml(assets.logoUri)}" width="36" height="36" alt="" />
          <span><strong>rehearsal</strong><small>Database change studio</small></span>
        </div>

        <div class="project-switcher">
          <span>Current project</span>
          <strong>${safeName}</strong>
          <small><i class="status-dot status-dot--${status.tone}" aria-hidden="true"></i><span${sandboxSession ? " data-sandbox-session-label" : ""}>${escapeHtml(status.label)}</span></small>
        </div>

        <button id="compact-navigation-trigger" class="compact-nav-trigger" type="button" aria-expanded="false" aria-controls="workspace-navigation" aria-label="Choose Rehearsal page. Current page: ${escapeHtml(activePageDetails.label)}">
          <span class="compact-nav-trigger__glyph" aria-hidden="true">${escapeHtml(activePageDetails.glyph)}</span>
          <span class="compact-nav-trigger__label">${escapeHtml(activePageDetails.label)}</span>
          <span class="compact-nav-trigger__chevron" aria-hidden="true">⌄</span>
        </button>

        <nav id="workspace-navigation" class="primary-nav" aria-label="Rehearsal workspace">
          ${navigationItem("overview", "Overview", "⌂", activePage)}
          ${navigationItem("setup", "Project setup", "✦", activePage, decisionCount ? String(decisionCount) : undefined)}
          ${navigationItem("migrations", "Migrations", "↗", activePage, candidateCount ? String(candidateCount) : undefined)}
          ${navigationItem("runtime", "Environments", "◫", activePage, targetCount ? String(targetCount) : undefined)}
          ${navigationItem("data-auth", "Data & auth", "◎", activePage)}
          ${navigationItem("configuration", "Configuration", "⌘", activePage)}
          ${navigationItem("activity", "Activity & reports", "≋", activePage)}
        </nav>

        <div class="sidebar__footer">
          <span class="local-badge"><i aria-hidden="true"></i>Local workspace</span>
          <p>Nothing changes until you approve it.</p>
        </div>
      </aside>

      <main id="main-content" class="main-content">
        <div id="inspection-draft-notice" class="source-banner source-banner--warning" role="status" hidden><span>Inspection updated. Your unsaved form values are preserved; review them or discard them to refresh the displayed evidence.</span><button id="discard-form-drafts" type="button" class="button button--secondary">Discard form edits and refresh</button></div>
        <header class="topbar">
          <div class="breadcrumbs"><span>Rehearsal</span><b>/</b><strong>${safeName}</strong></div>
          <div class="topbar__actions">
            <span class="topbar__badge topbar__local">Local only</span>
            <span class="topbar__badge">Core ${escapeHtml(isLoading && !snapshot.version ? "checking" : (snapshot.version ?? (snapshot.error?.code === "platform_unsupported" ? "not inspected" : snapshot.error?.code === "package_link_external" ? "not resolved" : "not installed")))}</span>
            <a id="extension-version" class="topbar__badge topbar__version" href="${escapeHtml(assets.actionUris.checkUpdates)}" title="${escapeHtml(extensionRelease.title)}" data-state="${extensionRelease.state}"><span id="extension-version-label" role="status" aria-live="polite">${escapeHtml(extensionRelease.text)}</span></a>
            ${actionButton(assets, "refresh", "Refresh", "secondary")}
          </div>
        </header>

        ${engineLifecycleMarkup(snapshot, assets.actionUris.shutdownVm, true, assets.engineShutdownState)}

        ${isLoading ? `<div class="inspection-banner" role="status" aria-live="polite"><span class="loading-spinner" aria-hidden="true"></span><span><strong>Checking ${safeName}</strong><small>Reading safe local project information. Existing results remain visible while this finishes.</small></span></div>` : ""}

        <section id="overview" class="workspace-page${activePage === "overview" ? " workspace-page--active" : ""}"${activePage === "overview" ? "" : " hidden"}>
          <div class="overview-heading">
            <div>
              <p class="kicker">PROJECT OVERVIEW</p>
              <h1 tabindex="-1">Know what your database change will do.</h1>
              <span>Rehearsal checks your real project shape in a disposable local environment—before deployment.</span>
            </div>
            <div class="hero-status hero-status--${status.tone}" role="status">
              <i aria-hidden="true"></i>
              <span><strong${sandboxSession ? " data-sandbox-session-label" : ""}>${escapeHtml(status.label)}</strong><small${sandboxSession ? " data-sandbox-session-detail" : ""}>${escapeHtml(status.detail)}</small></span>
            </div>
          </div>

          <div class="metrics-grid" aria-label="Project summary">
            ${summaryMetrics}
          </div>

          <div class="overview-grid">
            <article class="next-step-card">
              <div class="next-step-card__label"><span aria-hidden="true">→</span> Next best step</div>
              <h2${sandboxSession ? " data-sandbox-session-label" : ""}>${sandboxSession ? escapeHtml(status.label) : (candidateCount ?? 0) > 0 ? "Review your pending migration" : escapeHtml(status.label)}</h2>
              <div>${nextStepMarkup(guidanceSnapshot, assets, preferences)}</div>
            </article>
            <article class="journey-card">
              <div class="card-heading"><span><small>Workflow</small><strong>From setup to proof</strong></span></div>
              ${journeyMarkup(guidanceSnapshot)}
              <p class="control-note">Command results and CLI proof are recorded history, not verification of changed configuration or migrations. A database can keep running after its command completes.</p>
            </article>
          </div>
        </section>

        <section id="setup" class="workspace-page${activePage === "setup" ? " workspace-page--active" : ""}"${activePage === "setup" ? "" : " hidden"}>
          ${pageHeader("PROJECT SETUP", "Your project, understood", "Rehearsal separates proven facts from helpful suggestions and decisions only you can make.")}
          ${snapshot.availability === "not_ready" ? actionGroup(actionButton(assets, "guidedSetup", "Open guided setup", "primary"), actionButton(assets, "doctor", "Run Doctor")) : ""}
          ${readinessMarkup(snapshot)}
          ${projectProfileMarkup(snapshot)}
        </section>

        <section id="migrations" class="workspace-page${activePage === "migrations" ? " workspace-page--active" : ""}"${activePage === "migrations" ? "" : " hidden"}>
          ${pageHeader("MIGRATIONS", "Review the exact change set", "See what will be applied before anything touches the disposable runtime.")}
          <div class="two-column">
            <article class="surface surface--large">
              <div class="surface-heading"><span><small>Candidate set</small><h2>${candidateCount === 1 ? "1 migration waiting" : `${formatCount(candidateCount)} migrations waiting`}</h2></span>${snapshot.candidates ? `<code title="Full candidate digest">${escapeHtml(snapshot.candidates.digest.slice(0, 12))}</code>` : ""}</div>
              <p class="control-note" data-scope-summary role="status">${escapeHtml(viewScope.warning ?? `Displaying ${viewScope.targets.length} of ${configuredTargets.length} targets. Profiles and filters never change the complete approval digest.`)}</p>${actionGroup(navigationButton("runtime", "Change display profile"))}
              ${candidateMarkup(snapshot, preferences)}
              ${snapshot.candidates ? actionGroup(permittedAction("reviewPlan", "Review exact plan"), ...(snapshot.candidates.count > 0 ? [permittedAction("runRehearsal", "Run rehearsal", "primary"), permittedAction("migrate", "Apply without reset")] : verifiedRuntimeState(snapshot) === "available" ? [] : [permittedAction("runRehearsal", "Create sandbox", "primary")])) : ""}
            </article>
            <article class="surface">
              <div class="surface-heading"><span><small>Verified baseline</small><h2>${snapshot.baseline ? "Ready" : "Not available"}</h2></span></div>
              <dl class="facts-list">
                <div><dt>Rows</dt><dd>${formatCount(snapshot.baseline?.rowCount)}</dd></div>
                <div><dt>Tables</dt><dd>${formatCount(snapshot.baseline?.tableCount)}</dd></div>
                <div><dt>Migrations</dt><dd>${formatCount(snapshot.baseline?.migrationCount)}</dd></div>
                <div><dt>Integrity</dt><dd>${escapeHtml(snapshot.baseline?.verification.replaceAll("_", " ") ?? "Not verified")}</dd></div>
              </dl>
            </article>
          </div>
        </section>

        <section id="runtime" class="workspace-page${activePage === "runtime" ? " workspace-page--active" : ""}"${activePage === "runtime" ? "" : " hidden"}>
          ${pageHeader("ENVIRONMENTS", "Your local resources, under control", "Browse sandboxes, persistent data volumes, and service images. Review exactly what stays and what can safely go.")}
          <div class="two-column">
            <article class="surface surface--large">
              <div class="surface-heading"><span><small>Database targets</small><h2>${escapeHtml(snapshot.runtime?.state ?? "Unavailable")}</h2></span><span class="state-chip">${formatCount(targetCount)} ${targetCount === 1 ? "target" : "targets"}</span></div>
              <div class="environment-controls">
                <label><span>View target</span><select id="environment-target"><option value="all"${preferences.selectedTarget === "all" ? " selected" : ""}>All configured targets</option>${configuredTargets.map((name) => `<option value="${escapeHtml(name)}"${preferences.selectedTarget === name ? " selected" : ""}>${escapeHtml(name)}</option>`).join("")}</select></label>
                <label><span>View profile</span><select id="workspace-profile"><option value="full"${preferences.profile === "full" ? " selected" : ""}>Full project</option><option value="primary"${preferences.profile === "primary" ? " selected" : ""}>Primary target</option><option value="minimal"${preferences.profile === "minimal" ? " selected" : ""}>Project-owned resources</option>${(snapshot.configurationMetadata?.profiles ?? []).map((profile) => `<option value="${escapeHtml(`named:${profile.name}`)}"${preferences.profile === `named:${profile.name}` ? " selected" : ""}>${escapeHtml(profile.name)}</option>`).join("")}</select></label>
              </div>
              <p class="control-note">Selecting a view never changes data. Use each environment's explicitly target-scoped controls for start, stop, and discard; full rehearsals retain the complete reviewed dependency plan.</p>
              <p id="workspace-scope-summary" class="control-note" role="status">${escapeHtml(viewScope.warning ?? `Showing ${viewScope.targets.length} of ${configuredTargets.length} configured targets. Display only; project operations retain all targets.`)}</p>
              ${namedProfileControls(snapshot)}
              ${targetMarkup(snapshot)}
              ${snapshot.availability === "ready" ? (verifiedRuntimeState(snapshot) === "available" ? actionGroup(permittedAction("openSandbox", "Open sandbox", "primary"), permittedAction("startRuntime", "Start all targets"), permittedAction("verify", "Verify project"), permittedAction("stopRuntime", "Stop project services")) : actionGroup(permittedAction("runRehearsal", "Create sandbox", "primary"), permittedAction("cleanupPreview", "Inspect local resources"))) : ""}
              ${verifiedRuntimeState(snapshot) === "available" && workspaceExecutionState(snapshot).applicationMode === "database_only" ? '<p class="control-note">Database-only testing is configured. A browser application and HTTP readiness endpoint are not required for the CLI proof.</p>' : ""}
            </article>
            <article class="surface">
              <div class="surface-heading"><span><small>Application</small><h2>Local connection</h2></span></div>
              <dl class="facts-list">
                <div><dt>URL</dt><dd>${escapeHtml(activeOperation ? preferences.applicationUrl || "Enter the terminal's local address below" : (snapshot.applicationUrl ?? "Not configured"))}</dd></div>
                <div><dt>Activity</dt><dd>${escapeHtml(snapshot.activity?.state ?? "Unavailable")}</dd></div>
                <div><dt>Package</dt><dd>${escapeHtml(snapshot.packageLocation ?? "Not installed")}</dd></div>
              </dl>
              <div class="endpoint-editor"><label><span>Open a local address</span><input id="application-url" type="url" value="${escapeHtml(localApplicationUrl)}" /></label><button id="open-custom-application" class="button button--primary" type="button">Open address</button><small>Only HTTP(S) localhost and loopback addresses are accepted.</small></div>
              ${!activeOperation && snapshot.applicationUrl ? actionGroup(permittedAction("openApplication", "Open application", "primary"), permittedAction("identityConnect", "Connect account")) : ""}
            </article>
          </div>
          <article class="surface environment-resources">
            <div class="surface-heading"><span><small>Local resources</small><h2>Capacity and ownership</h2></span><span class="state-chip">preview first</span></div>
              ${engineLifecycleMarkup(snapshot, assets.actionUris.shutdownVm, false, assets.engineShutdownState)}
              ${resourceInventoryMarkup(snapshot, preferences)}
            ${actionGroup(actionButton(assets, "refresh", "Refresh inventory"), permittedAction("cleanupPreview", "Preview safe cleanup"), ...(snapshot.configurationMetadata ? ['<button id="review-stale-stop" type="button" class="button button--secondary">Review long-running environments</button>'] : []))}
            ${snapshot.configurationMetadata ? '<p class="control-note">Uses your configured stale cutoff. Age is not proof of inactivity; exact reviewed stop retains all data and the shared engine.</p>' : ""}
          </article>
          <article class="surface environment-versions">
            <div class="surface-heading"><span><small>Environment versions</small><h2>Retained verified baselines</h2></span><span class="state-chip">${formatCount(snapshot.baseline?.generations?.length)} ${snapshot.baseline?.generations?.length === 1 ? "version" : "versions"}</span></div>
            ${baselineVersionsMarkup(snapshot)}
          </article>
          ${snapshot.availability === "ready" && verifiedRuntimeState(snapshot) === "available" ? `<article class="danger-zone"><div><small>Sandbox maintenance</small><h2>Reset or remove disposable resources</h2><p>These actions remain scoped to the whole project and require confirmation. A display filter never narrows deletion.</p></div>${actionGroup(permittedAction("cleanupPreview", "Preview cleanup"), permittedAction("reset", "Reset sandbox", "danger"), permittedAction("discardRuntime", "Discard runtime", "danger"))}</article>` : ""}
        </section>

        <section id="data-auth" class="workspace-page${activePage === "data-auth" ? " workspace-page--active" : ""}"${activePage === "data-auth" ? "" : " hidden"}>
          ${pageHeader("DATA & AUTH", "Keep copied data useful and identities safe", "Review aggregate baseline shape, privacy decisions, Storage evidence, and local authentication providers without exposing private values.")}
          <div class="two-column">
            <article class="surface surface--large">
              <div class="surface-heading"><span><small>Baseline evidence</small><h2>${snapshot.baseline ? `${formatCount(snapshot.baseline.rowCount)} rows across ${formatCount(snapshot.baseline.tableCount)} tables` : "Unavailable"}</h2></span><span class="state-chip">${escapeHtml(snapshot.baseline?.verification.replaceAll("_", " ") ?? "not verified")}</span></div>
              ${baselineVersionsMarkup(snapshot, "baseline-evidence")}
              ${renderBaselineScopeReview(snapshot)}
              ${renderBaselineShapeEvidence(snapshot.baseline?.shape)}
            </article>
            <article class="surface">
              <div class="surface-heading"><span><small>Your decisions</small><h2>Privacy scope</h2></span></div>
              ${snapshot.discovery ? profileGroup("Review required", "Rehearsal never decides what production-shaped data may be copied.", "decision", snapshot.discovery.profile.decisions.map(decisionRow)) : '<div class="empty-state">Privacy decisions are unavailable.</div>'}
            </article>
          </div>
          <article class="surface auth-surface"><div class="surface-heading"><span><small>Authentication</small><h2>Reusable local provider setup</h2></span>${snapshot.environment?.authenticationProviders.length ? '<span class="state-chip">configured</span>' : '<span class="state-chip">review needed</span>'}</div>${renderAuthenticationReview(snapshot)}${actionGroup(permittedAction("identityConnect", "Connect signed-in account", "primary"), permittedAction("openConfig", "Review provider configuration"))}</article>
        </section>

        <section id="configuration" class="workspace-page${activePage === "configuration" ? " workspace-page--active" : ""}"${activePage === "configuration" ? "" : " hidden"}>
          ${pageHeader("CONFIGURATION", "Review before Rehearsal writes", "See which fields are settled, suggested, or waiting for your decision.")}
          <div class="source-banner source-banner--warning">
            <span class="source-banner__icon" aria-hidden="true">!</span>
            <div><strong>No changes have been made.</strong><span>Use guided setup to review Rehearsal's exact plan and approve any project-file changes.</span></div>
            <span class="pill">Safe preview</span>
          </div>
          <article class="surface configuration-surface">
            <div class="surface-heading"><span><small>Active configuration</small><h2>${escapeHtml(profile?.configuration.activePath ?? snapshot.configPath ?? "Not detected")}</h2></span><span class="state-chip">${escapeHtml(profile?.configuration.state.replaceAll("_", " ") ?? "unavailable")}</span></div>
            ${profile ? configurationMarkup(profile, snapshot) : '<div class="empty-state">Configuration suggestions are not available yet.</div>'}
            ${snapshot.configPath ? configurationControlsMarkup(snapshot, preferences) : ""}
            ${coreConfigurationControls(snapshot)}
            ${actionGroup(...(snapshot.configPath ? [actionButton(assets, "openConfig", "Open configuration", "primary")] : []), ...(snapshot.version && snapshot.availability !== "package_outdated" ? [actionButton(assets, "guidedSetup", "Open guided setup")] : []))}
          </article>
        </section>

        <section id="activity" class="workspace-page${activePage === "activity" ? " workspace-page--active" : ""}"${activePage === "activity" ? "" : " hidden"}>
          ${pageHeader("ACTIVITY & REPORTS", "Evidence you can understand and share", "See the current operation, preview safe commands, compare retained baselines, and export a redacted verification report.")}
          ${activityHistory.some(({ outcome }) => outcome === "running") ? actionGroup(actionButton(assets, "cancelOwnedOperation", "Cancel editor-started operation", "danger")) : ""}
          <div id="operation-progress" tabindex="-1">${renderOperationProgress(snapshot)}</div>
          <div class="metrics-grid">
            ${metric("Activity", snapshot.activity?.state ?? "Unavailable", activityNote, activityTone)}
            ${metric("Core", snapshot.version ?? "Not installed", snapshot.compatibility?.state ?? "Compatibility unknown", "muted", true)}
            ${metric("Baseline versions", formatCount(snapshot.baseline?.generations?.length), snapshot.baseline?.generationId ?? "Unavailable")}
            ${metric("Candidate digest", snapshot.candidates?.digest.slice(0, 12) ?? "Unavailable", `${formatCount(snapshot.candidates?.count)} migrations`, "muted", true)}
          </div>
          <div class="two-column">
            <article class="surface surface--large">
              <div class="surface-heading"><span><small>Environment comparison</small><h2>Compare retained baseline evidence</h2></span></div>
              <div class="comparison-controls"><label><span>First environment or baseline</span><select id="compare-left" aria-describedby="comparison-result"${comparisonNotice ? " disabled" : ""}>${comparisonOptions(0)}</select></label><label><span>Second environment or baseline</span><select id="compare-right" aria-describedby="comparison-result"${comparisonNotice ? " disabled" : ""}>${comparisonOptions(comparisons.length > 1 ? 1 : 0)}</select></label></div>
              <div id="comparison-result" class="comparison-result" role="status">${escapeHtml(comparisonNotice ?? "Choose two distinct entries to compare their aggregate evidence.")}</div>
              ${comparisonNotice ? actionGroup(navigationButton("setup", "Review project setup"), actionButton(assets, "refresh", "Refresh comparison evidence"), actionButton(assets, "showOutput", "Open comparison diagnostics")) : ""}
            </article>
            <article class="surface">
              <div class="surface-heading"><span><small>Export</small><h2>Privacy-safe verification report</h2></span></div>
              <p class="surface-copy">Reports include versions, digests, aggregate counts, completed checks, and explicit limitations. They never include credentials or database rows.</p>
              <div class="action-group"><button class="button button--primary" type="button" data-export-format="markdown">Export Markdown</button><button class="button button--secondary" type="button" data-export-format="json">Export JSON</button></div>
            </article>
          </div>
          <article class="surface"><div class="surface-heading"><span><small>Safe command center</small><h2>Run only documented Rehearsal operations</h2></span></div><p class="surface-copy">Every operation uses a fixed public command, project-scoped working directory, Rehearsal lock, and core-owned confirmation. There is no unrestricted shell box.</p>${actionGroup(permittedAction("reviewPlan", "Review plan"), permittedAction("doctor", "Run Doctor"), permittedAction("verify", "Verify runtime"), permittedAction("cleanupPreview", "Preview cleanup"), permittedAction("supportReport", "Support report"))}</article>
          <article class="surface activity-history"><div class="surface-heading"><span><small>Recent editor actions</small><h2>Project-local operation history</h2></span><span class="state-chip">${formatCount(activityHistory.length)} entries</span></div>${activityHistory.length ? `<ol>${activityHistory.map((entry) => `<li><span><strong>${escapeHtml(entry.label)}</strong><small>${escapeHtml(entry.startedAt)}</small></span><span class="state-chip">${escapeHtml(entry.outcome)}${entry.exitCode === null ? "" : ` · ${entry.exitCode}`}</span></li>`).join("")}</ol>` : '<div class="empty-state">No Rehearsal operations have been started from this extension yet.</div>'}${actionGroup('<button id="reset-local-state" class="button button--secondary" type="button">Reset saved editor state</button>')}</article>
        </section>

        <footer class="product-footer">
          <span><strong>Safe by design.</strong> Rehearsal core owns every confirmation, local-only boundary, lock, and cleanup rule.</span>
          ${actionGroup(actionButton(assets, "documentation", "Documentation"), actionButton(assets, "checkUpdates", "Check for updates"), ...(snapshot.version && snapshot.availability !== "package_outdated" ? [actionButton(assets, "supportReport", "Support report")] : []), actionButton(assets, "showOutput", "Diagnostics"))}
        </footer>
      </main>
    </div>
    <script nonce="${escapeHtml(assets.scriptNonce)}">
      (() => {
        // tsx may retain function names in serialized helpers; naming grants no capability.
        const __name = value => value;
        const vscode = typeof acquireVsCodeApi === "function" ? acquireVsCodeApi() : null;
        const savedUi = vscode?.getState()?.view ?? {};
        const allowedPages = new Set(${JSON.stringify(WORKSPACE_PAGES)});
        const preferences = ${scriptPreferences};
        const namedProfiles = ${scriptNamedProfiles};
        const configuredTargets = ${scriptTargets};
        const resolveViewScope = ${resolveWorkspaceViewScope.toString()};
        const currentViewScope = () => resolveViewScope(configuredTargets,namedProfiles,preferences);
        const reconcileImageSelection = ${reconcileImageSelection.toString()};
        const MIGRATION_REVIEW_PERSISTENCE_LIMIT = ${MIGRATION_REVIEW_PERSISTENCE_LIMIT};
        const reconcileMigrationReview = ${reconcileMigrationReview.toString()};
        const reviewIdentity = ${scriptReviewIdentity};
        ${CONFIGURATION_CONTROLS_SCRIPT}
        const comparisonMatrix = ${scriptComparisons};
        const comparisonNotice = ${JSON.stringify(comparisonNotice)};
        const compactNavigationQuery = window.matchMedia("(max-width: 1050px)");
        const compactNavigationTrigger = document.querySelector("#compact-navigation-trigger");
        const workspaceNavigation = document.querySelector("#workspace-navigation");
        const setCompactNavigation = (open) => {
          compactNavigationTrigger?.setAttribute("aria-expanded", String(open));
          workspaceNavigation?.classList.toggle("primary-nav--open", open);
        };
        const updateCompactNavigation = (page) => {
          const selected = workspaceNavigation?.querySelector('[data-rehearsal-page="' + page + '"]');
          const label = selected?.querySelector(".nav-item__label")?.textContent?.trim() ?? page;
          const glyph = selected?.querySelector(".nav-item__glyph")?.textContent?.trim() ?? "";
          const labelElement = compactNavigationTrigger?.querySelector(".compact-nav-trigger__label");
          const glyphElement = compactNavigationTrigger?.querySelector(".compact-nav-trigger__glyph");
          if (labelElement) labelElement.textContent = label;
          if (glyphElement) glyphElement.textContent = glyph;
          compactNavigationTrigger?.setAttribute("aria-label", "Choose Rehearsal page. Current page: " + label);
        };
        const savePreferences = () => vscode?.postMessage({ type: "preferences", preferences });
        const rememberUi = () => {
          const active = document.activeElement;
          const focus = active instanceof HTMLElement && /^[a-z0-9-]{1,100}$/i.test(active.id) ? active.id : null;
          const reviewed = [...document.querySelectorAll('[data-migration-review]:checked')].slice(0,MIGRATION_REVIEW_PERSISTENCE_LIMIT).map(control=>control.dataset.migrationReview);
          const eligibleImageInputs=imageCheckboxes.filter(control=>!control.disabled);
          const images=reconcileImageSelection(eligibleImageInputs.filter(control=>control.checked).map(control=>control.dataset.imageId),eligibleImageInputs.map(control=>control.dataset.imageId));
          const formFocus=configurationFocusFor(active)??(focus===null?reviewFormFocus:null);
          const formDrafts=reconcileWorkspaceFormDrafts({version:1,identity:formDraftIdentity,forms:configurationDraftForms.filter(entry=>dirtyForms.has(entry.form)).map(draftFormSnapshot),focus:formFocus},formDraftIdentity,configurationDraftForms.map(draftFormSnapshot),configurationDraftFocus);
          vscode?.setState({...vscode?.getState(),view:{focus,scroll:Math.max(0,Math.min(1000000,document.scrollingElement?.scrollTop??0)),reviewed,reviewIdentity,images,resourcePages:{...resourcePaging.pages},resourceSummaryPages:{...resourcePaging.summaryPages},resourcePageSize:resourcePaging.pageSize,formDrafts}});
        };
        document.addEventListener('focusin',rememberUi);
        document.addEventListener('change',rememberUi);
        document.addEventListener('scroll',rememberUi,{passive:true,capture:true});
        const configurationForms = [...document.querySelectorAll('#configuration-controls,#core-configuration-controls,#named-profile-controls,.resource-environment-form')];
        const initialFormValues = new Map(configurationForms.map(form=>[form,JSON.stringify([...new FormData(form).entries()])]));
        const dirtyForms = new Set();
        const formDraftIdentity = ${scriptFormDraftIdentity};
        const reconcileWorkspaceFormDrafts = ${reconcileWorkspaceFormDrafts.toString()};
        const approvedDraftNames = {
          'configuration-controls':['applicationUrl','retainBaselineGenerations','startCommand','proofCommand','runPersistence','openPersistence'],
          'core-configuration-controls':${scriptStructuredDraftNames},
          'named-profile-controls':['name','target','applicationUrl'],
          resource:['environmentName','protectEnvironment']
        };
        const draftResourceTargets=${scriptDraftResourceTargets};
        const configurationDraftForms = configurationForms.flatMap(form=>{
          const target=form.dataset?.resourceTarget;
          const key=Object.hasOwn(approvedDraftNames,form.id)?form.id:typeof target==='string'&&draftResourceTargets.includes(target)&&/^[a-z0-9][a-z0-9-]{0,62}$/.test(target)?'resource:'+target:null;
          if(!key)return[];
          const allowedNames=new Set(approvedDraftNames[key.startsWith('resource:')?'resource':key]);
          const fields=[];const focus=[];const occurrences=new Map();let buttons=0;
          [...(form.elements??[])].forEach(control=>{
            const tag=control.tagName?.toLowerCase();const type=String(control.type??'').toLowerCase();
            if(control.disabled)return;
            if(tag==='button' || (tag==='input'&&['submit','reset','button'].includes(type))) {
              focus.push({key:'button:'+type+':'+buttons++,node:control});return;
            }
            if(!['input','select','textarea'].includes(tag)||!allowedNames.has(control.name)||(tag==='input'&&!['text','url','number','checkbox','radio'].includes(type))||control.multiple)return;
            const kind=['checkbox','radio'].includes(type)?'checked':'value';
            const base=JSON.stringify([kind,control.name,kind==='checked'?String(control.value):'']);
            const occurrence=occurrences.get(base)??0;occurrences.set(base,occurrence+1);
            const key=base+':'+occurrence;
            fields.push({key,kind,node:control});focus.push({key,node:control});
          });
          return[{key,form,fields,focus}];
        });
        const draftFormSnapshot=entry=>({key:entry.key,fields:entry.fields.map(field=>({key:field.key,kind:field.kind,value:field.kind==='checked'?field.node.checked:field.node.value}))});
        const configurationDraftFocus=configurationDraftForms.flatMap(entry=>entry.focus.map(control=>({form:entry.key,control:control.key})));
        const configurationFocusFor=node=>{
          for(const entry of configurationDraftForms){const control=entry.focus.find(control=>control.node===node);if(control)return{form:entry.key,control:control.key};}
          return null;
        };
        const restoredFormDrafts=reconcileWorkspaceFormDrafts(savedUi.formDrafts,formDraftIdentity,configurationDraftForms.map(draftFormSnapshot),configurationDraftFocus);
        let reviewFormFocus=restoredFormDrafts?.focus??null;
        restoredFormDrafts?.forms.forEach(saved=>{
          const entry=configurationDraftForms.find(entry=>entry.key===saved.key);
          saved.fields.forEach(savedField=>{
            const field=entry?.fields.find(field=>field.key===savedField.key);
            if(!field)return;
            if(field.kind==='checked')field.node.checked=savedField.value;
            else if((field.node.maxLength??-1)<0||savedField.value.length<=field.node.maxLength) {
              if(field.node.tagName?.toLowerCase()!=='select'||[...(field.node.options??[])].some(option=>option.value===savedField.value))field.node.value=savedField.value;
            }
          });
        });
        configurationForms.forEach(form=>{if(JSON.stringify([...new FormData(form).entries()])!==initialFormValues.get(form))dirtyForms.add(form);});
        if(dirtyForms.size)vscode?.postMessage({type:'editing',editing:true});
        const updateFormDraft = form => {
          if(JSON.stringify([...new FormData(form).entries()])===initialFormValues.get(form)) dirtyForms.delete(form);
          else dirtyForms.add(form);
          vscode?.postMessage({type:'editing',editing:dirtyForms.size>0});
          rememberUi();
        };
        configurationForms.forEach(form=>{
          form.addEventListener('input',()=>updateFormDraft(form));
          form.addEventListener('change',()=>updateFormDraft(form));
          form.addEventListener('reset',()=>queueMicrotask(()=>updateFormDraft(form)));
          form.addEventListener('submit',event=>{
            const entry=configurationDraftForms.find(entry=>entry.form===form);
            const submit=entry?.focus.find(control=>String(control.node.type).toLowerCase()==='submit');
            reviewFormFocus=configurationFocusFor(event.submitter)??configurationFocusFor(document.activeElement)??(entry&&submit?{form:entry.key,control:submit.key}:null);
            rememberUi();
          },true);
        });
        document.querySelector('#review-stale-stop')?.addEventListener('click',()=>vscode?.postMessage({type:'reviewStaleStop'}));
        document.querySelectorAll('[data-engine-shutdown-control]').forEach(control=>control.addEventListener('click',()=>{if(!control.disabled)vscode?.postMessage({type:'reviewVmShutdown'});}));
        document.querySelector('#discard-form-drafts')?.addEventListener('click',()=>vscode?.postMessage({type:'editing',editing:false}));
        const applyOperationProgressUpdate = ${applyOperationProgressUpdate.toString()};
        const applyExtensionReleaseUpdate = ${applyExtensionReleaseUpdate.toString()};
        const applyEngineShutdownUpdate = ${applyEngineShutdownUpdate.toString()};
        const sandboxSessionPresentation = ${sandboxSessionPresentation.toString()};
        window.addEventListener('message',event=>{ if(event.data?.type==='engineShutdownUpdated'){applyEngineShutdownUpdate(document,event.data,${JSON.stringify({ outcomes: ENGINE_SHUTDOWN_UI_LABELS, reasons: ENGINE_LIFECYCLE_REASON_LABELS })});} else if(event.data?.type==='extensionReleaseUpdated') { applyExtensionReleaseUpdate(document,event.data); } else if(event.data?.type==='operationProgressUpdated') { applyOperationProgressUpdate(document,{type:event.data.type,html:event.data.html}); const session=sandboxSessionPresentation(event.data.sandboxSessionState); if(session) { document.querySelectorAll('[data-sandbox-session-label]').forEach(node=>{node.textContent=session.label;}); document.querySelectorAll('[data-sandbox-session-detail]').forEach(node=>{node.textContent=session.detail;}); document.querySelectorAll('[data-sandbox-session-guidance]').forEach(node=>{node.textContent=session.guidance;}); } } else if(event.data?.type==='inspectionUpdated') { const notice=document.querySelector('#inspection-draft-notice'); if(notice) notice.hidden=false; } });
        ${RESOURCE_MANAGER_SCRIPT}
        ${SUMMARY_LIST_SCRIPT}
        let displayedPage = ${JSON.stringify(activePage)};
        const activate = (page, sourceControl) => {
          if (!allowedPages.has(page)) return;
          const changedPage = page !== displayedPage;
          let selectedSection = null;
          document.querySelectorAll("[data-rehearsal-page]").forEach((control) => {
            const selected = control.dataset.rehearsalPage === page;
            if (control.classList.contains("nav-item")) {
              control.classList.toggle("nav-item--active", selected);
              if (selected) control.setAttribute("aria-current", "page");
              else control.removeAttribute("aria-current");
            }
          });
          document.querySelectorAll(".workspace-page").forEach((section) => {
            const selected = section.id === page;
            section.classList.toggle("workspace-page--active", selected);
            section.hidden = !selected;
            if (selected) selectedSection = section;
          });
          updateCompactNavigation(page);
          setCompactNavigation(false);
          if (sourceControl?.closest("#workspace-navigation") && compactNavigationQuery.matches) {
            compactNavigationTrigger?.focus({preventScroll:true});
          } else if (changedPage && sourceControl && !sourceControl.closest("#workspace-navigation")) {
            selectedSection?.querySelector("h1")?.focus({preventScroll:true});
          }
          if (changedPage) document.scrollingElement?.scrollTo({top:0,left:0,behavior:"instant"});
          displayedPage = page;
          vscode?.postMessage({ type: "navigate", page });
        };
        compactNavigationTrigger?.addEventListener("click", () => {
          setCompactNavigation(compactNavigationTrigger.getAttribute("aria-expanded") !== "true");
        });
        document.addEventListener("click", (event) => {
          if (!(event.target instanceof Element)) return;
          const reviewed = event.target.closest("[data-open-reviewed-migration]");
          if(reviewed){ vscode?.postMessage({type:"openReviewedMigration",sourceId:reviewed.dataset.openReviewedMigration}); return; }
          const insight = event.target.closest("[data-open-migration-insight]");
          if (insight) {
            vscode?.postMessage({type:"openMigrationInsight",findingId:insight.dataset.openMigrationInsight});
            return;
          }
          const failure = event.target.closest("[data-open-migration-failure]");
          if (failure) {
            vscode?.postMessage({type:"openMigrationFailure",operationId:failure.dataset.openMigrationFailure});
            return;
          }
          const control = event.target.closest("[data-rehearsal-page]");
          if (control) activate(control.dataset.rehearsalPage, control);
          else if (!event.target.closest(".sidebar")) setCompactNavigation(false);
        });
        document.addEventListener("keydown", (event) => {
          if (event.key !== "Escape" || compactNavigationTrigger?.getAttribute("aria-expanded") !== "true") return;
          setCompactNavigation(false);
          compactNavigationTrigger.focus();
        });
        compactNavigationQuery.addEventListener("change", () => setCompactNavigation(false));

        const migrationRows = [...document.querySelectorAll("[data-migration-row]")];
        const migrationSearch = document.querySelector("#migration-search");
        const migrationTarget = document.querySelector("#migration-target");
        const migrationStatus = document.querySelector("#migration-status");
        const migrationSort = document.querySelector("#migration-sort");
        const migrationFrom = document.querySelector("#migration-from");
        const migrationTo = document.querySelector("#migration-to");
        const migrationWarning = document.querySelector("#migration-warning");
        const selectMigrationView = ${selectMigrationView.toString()};
        const applyMigrationView = () => {
          const scope = currentViewScope();
          const status = migrationStatus?.value ?? "all";
          const sort = migrationSort?.value ?? "order";
          const selection=selectMigrationView(migrationRows.map(row=>({row,name:String(row.dataset.name),sortName:row.dataset.sortName,target:String(row.dataset.target),status:String(row.dataset.status),version:String(row.dataset.version),...(row.dataset.nativeWhen?{nativeIdentity:{when:Number(row.dataset.nativeWhen),idx:Number(row.dataset.nativeIdx),tag:String(row.dataset.nativeTag)}}:{}),order:Number(row.dataset.order),hasWarning:row.dataset.warning==='warnings'})),{query:migrationSearch?.value??'',targets:scope.targets,status,sort,from:migrationFrom?.value??'',to:migrationTo?.value??'',warning:migrationWarning?.value??'all'});
          const visibleRows=new Set(selection.visible.map(entry=>entry.row));
          const list = document.querySelector("#migration-list");
          selection.ordered.forEach(({row}) => {
            row.hidden = !visibleRows.has(row);
            list?.append(row);
          });
          const visible=selection.visible.length;
          const count = document.querySelector("#migration-visible-count");
          if (count) count.textContent = String(visible);
          const empty = document.querySelector('#migration-filter-empty');
          if(empty) empty.hidden = visible !== 0;
          preferences.migrationQuery = migrationSearch?.value ?? "";
          preferences.migrationSort = sort;
          preferences.migrationStatus = status;
          preferences.migrationFrom = migrationFrom?.value ?? '';
          preferences.migrationTo = migrationTo?.value ?? '';
          preferences.migrationWarning = migrationWarning?.value ?? 'all';
          savePreferences();
        };
        const updateReviewedCount = () => {
          const count=document.querySelector('#migration-reviewed-count');
          const reviewedCount=document.querySelectorAll('[data-migration-review]:checked').length;
          if(count)count.textContent=String(reviewedCount)+' reviewed'+(reviewedCount>MIGRATION_REVIEW_PERSISTENCE_LIMIT?' · Only the first '+MIGRATION_REVIEW_PERSISTENCE_LIMIT+' review checks are remembered after refresh.':'');
        };
        const updateDisplayScope = () => {
          const scope=currentViewScope();
          preferences.profile=scope.profile;preferences.selectedTarget=scope.selectedTarget;
          const targetControls=[migrationTarget,document.querySelector('#environment-target')];
          targetControls.forEach(control=>{if(control&&[...control.options].some(option=>option.value===scope.selectedTarget))control.value=scope.selectedTarget;});
          const profileControl=document.querySelector('#workspace-profile');if(profileControl)profileControl.value=scope.profile;
          document.querySelectorAll('[data-display-target]').forEach(row=>{row.hidden=!scope.targets.includes(row.dataset.displayTarget);});
          const summary=scope.warning??'Displaying '+scope.targets.length+' of '+configuredTargets.length+' targets'+(scope.onlyProjectOwned?' · project-owned resources only':' · shared images and engine totals remain global')+'. Display only; project operations retain the complete plan.';
          document.querySelectorAll('#workspace-scope-summary,[data-scope-summary]').forEach(control=>{control.textContent=summary;});
          applyMigrationView();updateResourceView();savePreferences();rememberUi();
        };
        migrationSearch?.addEventListener("input", applyMigrationView);
        migrationTarget?.addEventListener("change", () => {preferences.selectedTarget=migrationTarget.value;updateDisplayScope();});
        migrationStatus?.addEventListener("change", applyMigrationView);
        migrationSort?.addEventListener("change", applyMigrationView);
        document.querySelector('#clear-migration-filters')?.addEventListener('click',()=>{if(migrationSearch)migrationSearch.value='';preferences.selectedTarget='all';preferences.profile='full';if(migrationStatus)migrationStatus.value='all';if(migrationFrom)migrationFrom.value='';if(migrationTo)migrationTo.value='';if(migrationWarning)migrationWarning.value='all';updateDisplayScope();migrationSearch?.focus();});
        [migrationFrom,migrationTo,migrationWarning].forEach(control => control?.addEventListener('change',applyMigrationView));
        document.querySelectorAll('[data-migration-review]').forEach(control => control.addEventListener('change',updateReviewedCount));

        const environmentTarget = document.querySelector("#environment-target");
        environmentTarget?.addEventListener("change", () => {
          preferences.selectedTarget = environmentTarget.value;
          updateDisplayScope();
        });
        const workspaceProfile = document.querySelector("#workspace-profile");
        workspaceProfile?.addEventListener("change", () => {
          preferences.profile = workspaceProfile.value;
          if (workspaceProfile.value === "primary") preferences.selectedTarget = "primary";
          if (workspaceProfile.value === "full") preferences.selectedTarget = "all";
          const named = namedProfiles.find(profile => 'named:'+profile.name === workspaceProfile.value);
          if (named) { preferences.selectedTarget = named.targets.length === 1 ? named.targets[0] : 'all'; if(named.applicationUrl) { preferences.applicationUrl=named.applicationUrl; ['#application-url','#active-application-url'].forEach(selector=>{const address=document.querySelector(selector);if(address)address.value=named.applicationUrl;}); } }
          updateDisplayScope();
        });

        const applicationUrl = document.querySelector("#application-url");
        const activeApplicationUrl = document.querySelector("#active-application-url");
        const rememberApplicationUrl = (source) => {
          preferences.applicationUrl = source.value;
          [applicationUrl,activeApplicationUrl].forEach(control=>{if(control&&control!==source)control.value=source.value;});
          savePreferences();
        };
        [applicationUrl,activeApplicationUrl].forEach(control=>control?.addEventListener("change",()=>rememberApplicationUrl(control)));
        [["#open-custom-application",applicationUrl],["#open-active-application",activeApplicationUrl]].forEach(([selector,control])=>document.querySelector(selector)?.addEventListener("click",()=>{if(!control)return;rememberApplicationUrl(control);vscode?.postMessage({type:"openApplication",url:control.value});}));

        const simpleConfigurationForm = document.querySelector("#configuration-controls");
        const initialSimpleConfiguration = simpleConfigurationForm ? Object.fromEntries(JSON.parse(initialFormValues.get(simpleConfigurationForm)??'[]')) : {};
        const changedConfigurationFormValues = ${changedConfigurationFormValues.toString()};
        simpleConfigurationForm?.addEventListener("submit", (event) => {
          event.preventDefault();
          const values = changedConfigurationFormValues(initialSimpleConfiguration,Object.fromEntries(new FormData(event.currentTarget).entries()));
          vscode?.postMessage({ type: "reviewConfiguration", values });
        });
        document.querySelectorAll("[data-export-format]").forEach((control) => {
          control.addEventListener("click", () => vscode?.postMessage({ type: "exportReport", format: control.dataset.exportFormat, leftId: document.querySelector("#compare-left")?.value, rightId: document.querySelector("#compare-right")?.value }));
        });
        document.querySelector("#reset-local-state")?.addEventListener("click", () => {
          vscode?.postMessage({ type: "resetLocalState" });
        });

        const compare = () => {
          const leftId = document.querySelector("#compare-left")?.value;
          const rightId = document.querySelector("#compare-right")?.value;
          const result = document.querySelector("#comparison-result");
          if (!result) return;
          if (comparisonNotice) {
            result.textContent = comparisonNotice;
            return;
          }
          if (leftId === rightId) {
            result.textContent = "Choose two distinct environments or baselines. Comparing an entry with itself does not establish a change.";
            return;
          }
          const comparison = comparisonMatrix.find((item) => item.leftId === leftId && item.rightId === rightId);
          if (!comparison) {
            result.textContent = "This selected pair is outside the first 32 environments/versions available for live comparison. Choose entries within that limit or export a report for the larger history.";
            return;
          }
          result.replaceChildren();
          comparison.facts.forEach((fact) => { const row = document.createElement("p"); row.textContent = fact.label + ": " + fact.state + " — " + String(fact.left ?? "Unavailable") + " / " + String(fact.right ?? "Unavailable"); result.append(row); });
          const note = document.createElement("p"); note.textContent = comparison.limitations.join(" "); result.append(note);
        };
        document.querySelector("#compare-left")?.addEventListener("change", compare);
        document.querySelector("#compare-right")?.addEventListener("change", compare);
        compare();
        const migrationReviewControls=[...document.querySelectorAll('[data-migration-review]')];
        const restoredReviewIds=new Set(reconcileMigrationReview(savedUi.reviewed,savedUi.reviewIdentity,reviewIdentity,migrationReviewControls.map(control=>control.dataset.migrationReview),MIGRATION_REVIEW_PERSISTENCE_LIMIT));
        migrationReviewControls.forEach(control=>{control.checked=restoredReviewIds.has(control.dataset.migrationReview);});
        updateReviewedCount();updateDisplayScope();
        if(typeof savedUi.focus==='string' && /^[a-z0-9-]{1,100}$/i.test(savedUi.focus)) document.getElementById(savedUi.focus)?.focus({preventScroll:true});
        else if(restoredFormDrafts?.focus){
          const reference=restoredFormDrafts.focus;
          const node=configurationDraftForms.find(entry=>entry.key===reference.form)?.focus.find(control=>control.key===reference.control)?.node;
          if(node&&node.isConnected!==false&&!node.closest?.('[data-resource-row]')?.hidden){
            for(let ancestor=node.parentElement;ancestor;ancestor=ancestor.parentElement)if(ancestor.tagName?.toLowerCase()==='details')ancestor.open=true;
            node.focus({preventScroll:true});
          }
        }
        if(Number.isFinite(savedUi.scroll)) document.scrollingElement?.scrollTo({top:Math.max(0,Math.min(1000000,savedUi.scroll))});
      })();
    </script>
  </body>
</html>`;
};
