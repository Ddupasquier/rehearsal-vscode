import type { ProjectSnapshot } from "./project_snapshot.js";
import type { WorkspaceActionId } from "./action_catalog.js";
import type {
  DecisionDiscoveryItem,
  DetectedDiscoveryItem,
  DiscoveryValue,
  ProjectDiscoveryData,
  SuggestedDiscoveryItem,
} from "./contracts.js";
import type { WorkspacePreferences } from "./workspace_preferences.js";
import type { WorkspaceActivityRecord } from "./workspace_activity.js";

export interface WorkspaceViewAssets {
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

const statusFor = (snapshot: ProjectSnapshot): ProductStatus => {
  switch (snapshot.availability) {
    case "ready":
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
      return {
        label: "Ready to rehearse",
        detail:
          "Your project and baseline are ready for local migration testing.",
        tone: "success",
      };
    case "not_ready":
      return {
        label: "Setup needs attention",
        detail: "Finish the remaining setup item before running a rehearsal.",
        tone: "warning",
      };
    case "operation_active":
      return {
        label: "Rehearsal in progress",
        detail: "A project operation is currently running.",
        tone: "active",
      };
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
      return {
        label: "Project check unavailable",
        detail: "Review the diagnostic and retry the project check.",
        tone: "warning",
      };
  }
};

const journeyFor = (snapshot: ProjectSnapshot): readonly JourneyStep[] => [
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
    value:
      verifiedRuntimeState(snapshot) === "missing"
        ? "Not created"
        : (snapshot.runtime?.state ?? "Unknown"),
    state:
      snapshot.runtime?.state === "running"
        ? "current"
        : verifiedRuntimeState(snapshot) === "available"
          ? "done"
          : "waiting",
  },
  {
    label: "Verify",
    value: snapshot.applicationUrl ? "App connected" : "Waiting",
    state: snapshot.applicationUrl ? "done" : "waiting",
  },
];

const metric = (
  label: string,
  value: string,
  note: string,
  tone: StatusTone = "muted",
): string => `
  <article class="metric metric--${tone}">
    <div class="metric__top"><span>${escapeHtml(label)}</span><i aria-hidden="true"></i></div>
    <strong>${escapeHtml(value)}</strong>
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
    <span>${escapeHtml(label)}</span>
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

const navigationButton = (page: WorkspacePage, label: string): string =>
  `<button type="button" class="button button--secondary" data-rehearsal-page="${page}">${escapeHtml(label)}</button>`;

const journeyMarkup = (snapshot: ProjectSnapshot): string => `
  <ol class="journey" aria-label="Rehearsal workflow">
    ${journeyFor(snapshot)
      .map(
        (step, index) => `
          <li class="journey__step journey__step--${step.state}">
            <span class="journey__marker">${step.state === "done" ? "✓" : String(index + 1)}</span>
            <span><strong>${escapeHtml(step.label)}</strong><small>${escapeHtml(step.value)}</small></span>
          </li>`,
      )
      .join("")}
  </ol>`;

const nextStepMarkup = (
  snapshot: ProjectSnapshot,
  assets: WorkspaceViewAssets,
): string => {
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
  if (snapshot.error) {
    const errorCopy =
      snapshot.error.code === "timeout"
        ? "A read-only project check took longer than the configured limit. Retry it, or increase Rehearsal: Inspection Timeout Seconds for this workspace."
        : "Rehearsal could not safely complete this project check. Retry the inspection or open the bounded diagnostic log.";
    return `
      <p>${escapeHtml(errorCopy)}</p>
      ${actionGroup(actionButton(assets, "refresh", "Try again", "primary"), ...(snapshot.version ? [actionButton(assets, "doctor", "Run Doctor"), actionButton(assets, "supportReport", "Support report")] : []), actionButton(assets, "showOutput", "Open diagnostics"))}`;
  }
  if (snapshot.availability === "operation_active") {
    return `<p>Let the active operation finish, then refresh this workspace.</p>${actionGroup(actionButton(assets, "refresh", "Check progress", "primary"), actionButton(assets, "showOutput", "Open diagnostics"))}`;
  }
  if (snapshot.availability === "operation_attention") {
    return `<p>Review the interrupted operation before trying another change.</p>${actionGroup(actionButton(assets, "doctor", "Run Doctor", "primary"), actionButton(assets, "supportReport", "Support report"))}`;
  }
  if (snapshot.readiness?.state === "NOT READY") {
    const failed = snapshot.readiness.checks.find(
      ({ status }) => status === "fail",
    );
    return `<p>${escapeHtml(failed?.remediation ?? failed?.detail ?? "Complete the remaining setup item.")}</p>${actionGroup(navigationButton("setup", "Review project setup"), actionButton(assets, "guidedSetup", "Open guided setup", "primary"))}`;
  }
  if ((snapshot.candidates?.count ?? 0) > 0) {
    return `<p>Review the pending migration set before running it locally.</p>${actionGroup(navigationButton("migrations", "Review migrations"), actionButton(assets, "runRehearsal", "Run rehearsal", "primary"))}`;
  }
  if (snapshot.candidates && verifiedRuntimeState(snapshot) !== "available") {
    const legacy = verifiedRuntimeState(snapshot) === "unknown";
    return `<p>${escapeHtml(
      legacy
        ? "This Rehearsal version cannot prove that a prepared sandbox exists. Create a fresh sandbox, or update the package for precise runtime detection."
        : "Create the disposable sandbox from your verified baseline before opening it for hands-on testing.",
    )}</p>${actionGroup(actionButton(assets, "runRehearsal", "Create sandbox", "primary"), navigationButton("runtime", "Review runtime"))}`;
  }
  return `<p>Your project is ready. Open the sandbox for hands-on testing or review the detected project profile.</p>${actionGroup(actionButton(assets, "openSandbox", "Open sandbox", "primary"), navigationButton("setup", "Project profile"))}`;
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
  if (!snapshot.candidates) {
    return '<div class="empty-state">Migration candidates become available after setup is complete.</div>';
  }
  if (snapshot.candidates.files.length === 0) {
    return '<div class="empty-state empty-state--success"><strong>You’re all caught up.</strong><span>No migrations are waiting to be rehearsed.</span></div>';
  }
  const migrations = snapshot.candidates.files.map((candidate, index) => {
    if (typeof candidate !== "string") return candidate;
    const match = /^(\d{14})_(.+)\.sql$/u.exec(candidate);
    return {
      version: match?.[1] ?? String(index).padStart(14, "0"),
      name: match?.[2] ?? candidate,
      filename: candidate,
      sha256: snapshot.candidates!.digest,
      target: "primary",
    };
  });
  const targets = ["all", ...new Set(migrations.map(({ target }) => target))];
  return `<div class="migration-workbench">
    <div class="workbench-toolbar" aria-label="Migration filters">
      <label><span>Find migrations</span><input id="migration-search" type="search" value="${escapeHtml(preferences.migrationQuery)}" placeholder="Name, version, or target" /></label>
      <label><span>Target</span><select id="migration-target">${targets.map((target) => `<option value="${escapeHtml(target)}"${preferences.selectedTarget === target ? " selected" : ""}>${escapeHtml(target === "all" ? "All targets" : target)}</option>`).join("")}</select></label>
      <label><span>Status</span><select id="migration-status"><option value="all"${preferences.migrationStatus === "all" ? " selected" : ""}>All statuses</option><option value="candidate"${preferences.migrationStatus === "candidate" ? " selected" : ""}>Waiting</option></select></label>
      <label><span>Sort</span><select id="migration-sort"><option value="order"${preferences.migrationSort === "order" ? " selected" : ""}>Migration order</option><option value="name"${preferences.migrationSort === "name" ? " selected" : ""}>Name</option><option value="date"${preferences.migrationSort === "date" ? " selected" : ""}>Timestamp</option><option value="target"${preferences.migrationSort === "target" ? " selected" : ""}>Target</option></select></label>
    </div>
    <div class="migration-summary" role="status"><strong id="migration-visible-count">${snapshot.candidates.files.length}</strong> visible · <span>all migrations remain in the exact ordered candidate set</span></div>
    <ul class="migration-list" id="migration-list">${migrations
      .map(
        (migration, index) =>
          `<li data-migration-row data-name="${escapeHtml(migration.filename.toLowerCase())}" data-target="${escapeHtml(migration.target)}" data-status="candidate" data-version="${escapeHtml(migration.version)}" data-order="${index}"><label class="migration-check"><input type="checkbox" checked aria-label="Reviewed ${escapeHtml(migration.filename)}" /><span aria-hidden="true">↗</span><span><code>${escapeHtml(migration.filename)}</code><small>${escapeHtml(migration.target)} · ${escapeHtml(migration.version)} · ${escapeHtml(migration.sha256.slice(0, 12))}</small></span><strong class="field-state field-state--suggested">waiting</strong></label></li>`,
      )
      .join("")}</ul>
    <p class="control-note">The checklist tracks your review. Rehearsal still applies the complete dependency-safe ordered set shown by the digest.</p>
  </div>`;
};

const targetMarkup = (snapshot: ProjectSnapshot): string => {
  const targets = snapshot.runtime?.targets;
  if (!targets || targets.length === 0) {
    return '<div class="empty-state">No local runtime targets are available yet.</div>';
  }
  return `<div class="runtime-list">${targets
    .map(
      ({ name, runtimeTarget, state, reason, verifiedRuntimeAvailable }) => `
        <article class="runtime-row">
          <span class="runtime-row__icon" aria-hidden="true">DB</span>
          <span class="runtime-row__copy"><strong>${escapeHtml(name)}</strong><small>${escapeHtml(runtimeTarget)}${reason ? ` · ${escapeHtml(reason.replaceAll("_", " "))}` : ""} · ${verifiedRuntimeAvailable === true ? "prepared" : verifiedRuntimeAvailable === false ? "not created" : "preparation unknown"}</small></span>
          <span class="state-chip">${escapeHtml(state)}</span>
        </article>`,
    )
    .join("")}</div>`;
};

const baselineVersionsMarkup = (snapshot: ProjectSnapshot): string => {
  const generations = snapshot.baseline?.generations ?? [];
  if (generations.length === 0) {
    return '<div class="empty-state">No baseline versions are available.</div>';
  }
  return `<div class="version-list">${generations
    .map(
      (
        generation,
      ) => `<article class="version-row${generation.active ? " version-row--active" : ""}">
        <span><strong>${escapeHtml(generation.active ? "Active baseline" : "Retained baseline")}</strong><code>${escapeHtml(generation.generationId)}</code><small>${escapeHtml(generation.createdAt ?? "Creation time unavailable")}</small></span>
        <span><b>${formatCount(generation.rowCount)} rows</b><small>${formatCount(generation.tableCount)} tables · ${formatCount(generation.storageAssetCount)} assets</small></span>
      </article>`,
    )
    .join("")}</div>`;
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

const authenticationMarkup = (snapshot: ProjectSnapshot): string => {
  const providers = snapshot.environment?.authenticationProviders ?? [];
  return `<div class="auth-grid">
    <article class="control-card"><small>Configured providers</small><strong>${providers.length ? providers.map(escapeHtml).join(", ") : "No provider declared"}</strong><p>${providers.length ? "Provider secrets stay in the project-owned service environment and never enter this view." : "Add a supported provider only after reviewing its local callback and secret boundary."}</p></article>
    <article class="control-card"><small>Local callback</small><strong>${escapeHtml(snapshot.environment?.authenticationCallback ?? "Not configured")}</strong><p>Identity association remains a reviewed Rehearsal core operation.</p></article>
    <article class="control-card"><small>Hosted access</small><strong>${escapeHtml(snapshot.environment?.hostedAccess ?? "unknown")}</strong><p>Authentication may contact the selected identity provider; database access remains local.</p></article>
  </div>`;
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
  const applicationUrl =
    preferences.applicationUrl ||
    snapshot.applicationUrl ||
    "http://localhost:5175";
  return `<form id="configuration-controls" class="configuration-controls">
    <div class="form-grid">
      <label><span>Application URL</span><input name="applicationUrl" type="url" value="${escapeHtml(applicationUrl)}" required /><small>HTTP(S) loopback addresses only.</small></label>
      <label><span>Baseline versions to retain</span><input name="retainBaselineGenerations" type="number" value="${snapshot.configuration?.cleanup.retainBaselineGenerations ?? 2}" min="1" max="100" /><small>The active baseline is always protected.</small></label>
      <label><span>Application start command</span><input name="startCommand" type="text" value="${escapeHtml(startCommand)}" /><small>Stored only after an exact diff and confirmation.</small></label>
      <label><span>Application proof command</span><input name="proofCommand" type="text" value="${escapeHtml(proofCommand)}" /><small>Choose the project-owned proof for migration behavior.</small></label>
      <label><span>After a rehearsal run</span><select name="runPersistence"><option value="keep-until-stop"${snapshot.lifecycle?.run === "keep-until-stop" ? " selected" : ""}>Keep environment running</option><option value="stop-after-run"${snapshot.lifecycle?.run === "stop-after-run" ? " selected" : ""}>Stop after proof</option></select></label>
      <label><span>When the application closes</span><select name="openPersistence"><option value="keep-until-stop"${snapshot.lifecycle?.open === "keep-until-stop" ? " selected" : ""}>Keep database running</option><option value="stop-on-application-exit"${snapshot.lifecycle?.open === "stop-on-application-exit" ? " selected" : ""}>Stop database runtime</option></select></label>
    </div>
    <div class="action-group"><button class="button button--primary" type="submit">Review exact configuration diff</button><button class="button button--secondary" type="reset">Restore detected values</button></div>
    <p class="control-note">Nothing is written until you inspect the diff and explicitly approve it. Unsupported or expression-based fields fail closed.</p>
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
      snapshot.configuration
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
    <h1>${escapeHtml(title)}</h1>
    <span>${escapeHtml(description)}</span>
  </header>`;

export const renderWorkspaceDocument = (
  snapshot: ProjectSnapshot,
  assets: WorkspaceViewAssets,
  activePage: WorkspacePage = "overview",
  preferences: WorkspacePreferences = {
    migrationQuery: "",
    migrationSort: "order",
    selectedTarget: "all",
    migrationStatus: "all",
    applicationUrl: "",
    profile: "full",
  },
  activityHistory: readonly WorkspaceActivityRecord[] = [],
): string => {
  const status = statusFor(snapshot);
  const readiness = snapshot.readiness;
  const readinessValue = readiness
    ? `${readiness.passed}/${readiness.passed + readiness.failed}`
    : "—";
  const profile = snapshot.discovery?.profile;
  const safeName = escapeHtml(snapshot.workspaceName);
  const candidateCount = snapshot.candidates?.count;
  const targetCount = snapshot.runtime?.targets.length;
  const decisionCount = profile?.decisions.length;
  const scriptPreferences = JSON.stringify(preferences).replaceAll(
    "<",
    "\\u003c",
  );
  const scriptGenerations = JSON.stringify(
    snapshot.baseline?.generations ?? [],
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
  <body>
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
          <small><i class="status-dot status-dot--${status.tone}" aria-hidden="true"></i>${escapeHtml(status.label)}</small>
        </div>

        <nav class="primary-nav" aria-label="Rehearsal workspace">
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
        <header class="topbar">
          <div class="breadcrumbs"><span>Rehearsal</span><b>/</b><strong>${safeName}</strong></div>
          <div class="topbar__actions">
            <span class="topbar__badge">Local only</span>
            <span class="topbar__badge">Core ${escapeHtml(snapshot.version ?? "not installed")}</span>
            ${actionButton(assets, "refresh", "Refresh", "secondary")}
          </div>
        </header>

        <section id="overview" class="workspace-page${activePage === "overview" ? " workspace-page--active" : ""}"${activePage === "overview" ? "" : " hidden"}>
          <div class="overview-heading">
            <div>
              <p class="kicker">PROJECT OVERVIEW</p>
              <h1>Know what your database change will do.</h1>
              <span>Rehearsal checks your real project shape in a disposable local environment—before deployment.</span>
            </div>
            <div class="hero-status hero-status--${status.tone}" role="status">
              <i aria-hidden="true"></i>
              <span><strong>${escapeHtml(status.label)}</strong><small>${escapeHtml(status.detail)}</small></span>
            </div>
          </div>

          <div class="metrics-grid" aria-label="Project summary">
            ${metric("Readiness", readinessValue, readiness ? `${readiness.failed} checks need attention` : "Waiting for project check", readiness?.failed === 0 ? "success" : "warning")}
            ${metric("Baseline", formatCount(snapshot.baseline?.rowCount), snapshot.baseline ? `${formatCount(snapshot.baseline.tableCount)} tables` : "Not verified")}
            ${metric("Migrations", formatCount(candidateCount), candidateCount === undefined ? "Waiting for project check" : candidateCount === 0 ? "Nothing waiting" : "Ready for review", candidateCount ? "active" : candidateCount === 0 ? "success" : "muted")}
            ${metric("Runtime", snapshot.runtime?.state ?? "Unavailable", targetCount === undefined ? "Targets unavailable" : `${formatCount(targetCount)} local target${targetCount === 1 ? "" : "s"}`)}
          </div>

          <div class="overview-grid">
            <article class="next-step-card">
              <div class="next-step-card__label"><span aria-hidden="true">→</span> Next best step</div>
              <h2>${(candidateCount ?? 0) > 0 ? "Review your pending migration" : status.label}</h2>
              <div>${nextStepMarkup(snapshot, assets)}</div>
            </article>
            <article class="journey-card">
              <div class="card-heading"><span><small>Workflow</small><strong>From setup to proof</strong></span></div>
              ${journeyMarkup(snapshot)}
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
              ${candidateMarkup(snapshot, preferences)}
              ${snapshot.candidates ? actionGroup(actionButton(assets, "reviewPlan", "Review exact plan"), ...(snapshot.candidates.count > 0 ? [actionButton(assets, "runRehearsal", "Run rehearsal", "primary"), ...(verifiedRuntimeState(snapshot) === "available" ? [actionButton(assets, "migrate", "Apply without reset")] : [])] : verifiedRuntimeState(snapshot) === "available" ? [] : [actionButton(assets, "runRehearsal", "Create sandbox", "primary")])) : ""}
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
          ${pageHeader("ENVIRONMENTS", "Choose the local environment you need", "See detected targets and retained baseline versions, then decide exactly what to open or run.")}
          <div class="two-column">
            <article class="surface surface--large">
              <div class="surface-heading"><span><small>Database targets</small><h2>${escapeHtml(snapshot.runtime?.state ?? "Unavailable")}</h2></span><span class="state-chip">${formatCount(targetCount)} ${targetCount === 1 ? "target" : "targets"}</span></div>
              <div class="environment-controls">
                <label><span>View target</span><select id="environment-target"><option value="all"${preferences.selectedTarget === "all" ? " selected" : ""}>All configured targets</option>${(snapshot.runtime?.targets ?? []).map(({ name }) => `<option value="${escapeHtml(name)}"${preferences.selectedTarget === name ? " selected" : ""}>${escapeHtml(name)}</option>`).join("")}</select></label>
                <label><span>View profile</span><select id="workspace-profile"><option value="full"${preferences.profile === "full" ? " selected" : ""}>Full project</option><option value="primary"${preferences.profile === "primary" ? " selected" : ""}>Primary target</option><option value="minimal"${preferences.profile === "minimal" ? " selected" : ""}>Minimal local</option></select></label>
              </div>
              <p class="control-note">These controls organize the workbench. Runtime commands still use the exact configuration and target plan shown by Rehearsal core.</p>
              ${targetMarkup(snapshot)}
              ${snapshot.availability === "ready" ? (verifiedRuntimeState(snapshot) === "available" ? actionGroup(actionButton(assets, "openSandbox", "Open sandbox", "primary"), actionButton(assets, "startRuntime", "Start runtime"), actionButton(assets, "verify", "Verify"), actionButton(assets, "stopRuntime", "Stop")) : actionGroup(actionButton(assets, "runRehearsal", "Create sandbox", "primary"), actionButton(assets, "cleanupPreview", "Inspect local resources"))) : ""}
            </article>
            <article class="surface">
              <div class="surface-heading"><span><small>Application</small><h2>Local connection</h2></span></div>
              <dl class="facts-list">
                <div><dt>URL</dt><dd>${escapeHtml(snapshot.applicationUrl ?? "Not configured")}</dd></div>
                <div><dt>Activity</dt><dd>${escapeHtml(snapshot.activity?.state ?? "Unavailable")}</dd></div>
                <div><dt>Package</dt><dd>${escapeHtml(snapshot.packageLocation ?? "Not installed")}</dd></div>
              </dl>
              <div class="endpoint-editor"><label><span>Open a local address</span><input id="application-url" type="url" value="${escapeHtml(preferences.applicationUrl || snapshot.applicationUrl || "http://localhost:5175")}" /></label><button id="open-custom-application" class="button button--primary" type="button">Open address</button><small>Only HTTP(S) localhost and loopback addresses are accepted.</small></div>
              ${snapshot.applicationUrl ? actionGroup(actionButton(assets, "openApplication", "Open application", "primary"), actionButton(assets, "identityConnect", "Connect account")) : ""}
            </article>
          </div>
          <article class="surface environment-versions">
            <div class="surface-heading"><span><small>Environment versions</small><h2>Retained verified baselines</h2></span><span class="state-chip">${formatCount(snapshot.baseline?.generations?.length)} versions</span></div>
            ${baselineVersionsMarkup(snapshot)}
          </article>
          ${snapshot.availability === "ready" && verifiedRuntimeState(snapshot) === "available" ? `<article class="danger-zone"><div><small>Sandbox maintenance</small><h2>Reset or remove disposable resources</h2><p>These actions remain scoped to this project and require confirmation.</p></div>${actionGroup(actionButton(assets, "cleanupPreview", "Preview cleanup"), actionButton(assets, "reset", "Reset sandbox", "danger"), actionButton(assets, "discardRuntime", "Discard runtime", "danger"))}</article>` : ""}
        </section>

        <section id="data-auth" class="workspace-page${activePage === "data-auth" ? " workspace-page--active" : ""}"${activePage === "data-auth" ? "" : " hidden"}>
          ${pageHeader("DATA & AUTH", "Keep copied data useful and identities safe", "Review aggregate baseline shape, privacy decisions, Storage evidence, and local authentication providers without exposing private values.")}
          <div class="two-column">
            <article class="surface surface--large">
              <div class="surface-heading"><span><small>Baseline evidence</small><h2>${snapshot.baseline ? `${formatCount(snapshot.baseline.rowCount)} rows across ${formatCount(snapshot.baseline.tableCount)} tables` : "Unavailable"}</h2></span><span class="state-chip">${escapeHtml(snapshot.baseline?.verification.replaceAll("_", " ") ?? "not verified")}</span></div>
              ${baselineVersionsMarkup(snapshot)}
            </article>
            <article class="surface">
              <div class="surface-heading"><span><small>Your decisions</small><h2>Privacy scope</h2></span></div>
              ${snapshot.discovery ? profileGroup("Review required", "Rehearsal never decides what production-shaped data may be copied.", "decision", snapshot.discovery.profile.decisions.map(decisionRow)) : '<div class="empty-state">Privacy decisions are unavailable.</div>'}
            </article>
          </div>
          <article class="surface auth-surface"><div class="surface-heading"><span><small>Authentication</small><h2>Reusable local provider setup</h2></span>${snapshot.environment?.authenticationProviders.length ? '<span class="state-chip">configured</span>' : '<span class="state-chip">review needed</span>'}</div>${authenticationMarkup(snapshot)}${actionGroup(actionButton(assets, "identityConnect", "Connect signed-in account", "primary"), actionButton(assets, "openConfig", "Review provider configuration"))}</article>
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
            ${actionGroup(...(snapshot.configPath ? [actionButton(assets, "openConfig", "Open configuration", "primary")] : []), ...(snapshot.version && snapshot.availability !== "package_outdated" ? [actionButton(assets, "guidedSetup", "Open guided setup")] : []))}
          </article>
        </section>

        <section id="activity" class="workspace-page${activePage === "activity" ? " workspace-page--active" : ""}"${activePage === "activity" ? "" : " hidden"}>
          ${pageHeader("ACTIVITY & REPORTS", "Evidence you can understand and share", "See the current operation, preview safe commands, compare retained baselines, and export a redacted verification report.")}
          <div class="metrics-grid">
            ${metric("Activity", snapshot.activity?.state ?? "Unavailable", snapshot.activity?.operation?.kind ?? "No active operation", snapshot.activity?.state === "busy" ? "active" : "success")}
            ${metric("Core", snapshot.version ?? "Not installed", snapshot.compatibility?.state ?? "Compatibility unknown")}
            ${metric("Baseline versions", formatCount(snapshot.baseline?.generations?.length), snapshot.baseline?.generationId ?? "Unavailable")}
            ${metric("Candidate digest", snapshot.candidates?.digest.slice(0, 12) ?? "Unavailable", `${formatCount(snapshot.candidates?.count)} migrations`)}
          </div>
          <div class="two-column">
            <article class="surface surface--large">
              <div class="surface-heading"><span><small>Environment comparison</small><h2>Compare retained baseline evidence</h2></span></div>
              <div class="comparison-controls"><label><span>First version</span><select id="compare-left">${(snapshot.baseline?.generations ?? []).map((item, index) => `<option value="${escapeHtml(item.generationId)}"${index === 0 ? " selected" : ""}>${escapeHtml(item.active ? `${item.generationId} (active)` : item.generationId)}</option>`).join("")}</select></label><label><span>Second version</span><select id="compare-right">${(snapshot.baseline?.generations ?? []).map((item, index) => `<option value="${escapeHtml(item.generationId)}"${index === 1 ? " selected" : ""}>${escapeHtml(item.active ? `${item.generationId} (active)` : item.generationId)}</option>`).join("")}</select></label></div>
              <div id="comparison-result" class="comparison-result" role="status">Choose two versions to compare their aggregate evidence.</div>
            </article>
            <article class="surface">
              <div class="surface-heading"><span><small>Export</small><h2>Privacy-safe verification report</h2></span></div>
              <p class="surface-copy">Reports include versions, digests, aggregate counts, completed checks, and explicit limitations. They never include credentials or database rows.</p>
              <div class="action-group"><button class="button button--primary" type="button" data-export-format="markdown">Export Markdown</button><button class="button button--secondary" type="button" data-export-format="json">Export JSON</button></div>
            </article>
          </div>
          <article class="surface"><div class="surface-heading"><span><small>Safe command center</small><h2>Run only documented Rehearsal operations</h2></span></div><p class="surface-copy">Every operation uses a fixed public command, project-scoped working directory, Rehearsal lock, and core-owned confirmation. There is no unrestricted shell box.</p>${actionGroup(actionButton(assets, "reviewPlan", "Review plan"), actionButton(assets, "doctor", "Run Doctor"), actionButton(assets, "verify", "Verify runtime"), actionButton(assets, "cleanupPreview", "Preview cleanup"), actionButton(assets, "supportReport", "Support report"))}</article>
          <article class="surface activity-history"><div class="surface-heading"><span><small>Recent editor actions</small><h2>Project-local operation history</h2></span><span class="state-chip">${formatCount(activityHistory.length)} entries</span></div>${activityHistory.length ? `<ol>${activityHistory.map((entry) => `<li><span><strong>${escapeHtml(entry.label)}</strong><small>${escapeHtml(entry.startedAt)}</small></span><span class="state-chip">${escapeHtml(entry.outcome)}${entry.exitCode === null ? "" : ` · ${entry.exitCode}`}</span></li>`).join("")}</ol>` : '<div class="empty-state">No Rehearsal operations have been started from this extension yet.</div>'}${actionGroup(...(activityHistory.some(({ outcome }) => outcome === "running") ? [actionButton(assets, "cancelOwnedOperation", "Cancel editor-started operation", "danger")] : []), '<button id="reset-local-state" class="button button--secondary" type="button">Reset saved editor state</button>')}</article>
        </section>

        <footer class="product-footer">
          <span><strong>Safe by design.</strong> Rehearsal core owns every confirmation, local-only boundary, lock, and cleanup rule.</span>
          ${actionGroup(actionButton(assets, "documentation", "Documentation"), ...(snapshot.version && snapshot.availability !== "package_outdated" ? [actionButton(assets, "supportReport", "Support report")] : []), actionButton(assets, "showOutput", "Diagnostics"))}
        </footer>
      </main>
    </div>
    <script nonce="${escapeHtml(assets.scriptNonce)}">
      (() => {
        const vscode = typeof acquireVsCodeApi === "function" ? acquireVsCodeApi() : null;
        const allowedPages = new Set(${JSON.stringify(WORKSPACE_PAGES)});
        const preferences = ${scriptPreferences};
        const generations = ${scriptGenerations};
        const savePreferences = () => vscode?.postMessage({ type: "preferences", preferences });
        const activate = (page) => {
          if (!allowedPages.has(page)) return;
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
          });
          vscode?.postMessage({ type: "navigate", page });
        };
        document.addEventListener("click", (event) => {
          if (!(event.target instanceof Element)) return;
          const control = event.target.closest("[data-rehearsal-page]");
          if (control) activate(control.dataset.rehearsalPage);
        });

        const migrationRows = [...document.querySelectorAll("[data-migration-row]")];
        const migrationSearch = document.querySelector("#migration-search");
        const migrationTarget = document.querySelector("#migration-target");
        const migrationStatus = document.querySelector("#migration-status");
        const migrationSort = document.querySelector("#migration-sort");
        const applyMigrationView = () => {
          const query = migrationSearch?.value.trim().toLowerCase() ?? "";
          const target = migrationTarget?.value ?? "all";
          const status = migrationStatus?.value ?? "all";
          const sort = migrationSort?.value ?? "order";
          migrationRows.sort((left, right) => {
            if (sort === "name") return left.dataset.name.localeCompare(right.dataset.name);
            if (sort === "date") return left.dataset.version.localeCompare(right.dataset.version);
            if (sort === "target") return left.dataset.target.localeCompare(right.dataset.target) || left.dataset.version.localeCompare(right.dataset.version);
            return Number(left.dataset.order) - Number(right.dataset.order);
          });
          const list = document.querySelector("#migration-list");
          let visible = 0;
          migrationRows.forEach((row) => {
            const matchesTarget = target === "all" || row.dataset.target === target;
            const matchesStatus = status === "all" || row.dataset.status === status;
            const matchesQuery = !query || (String(row.dataset.name) + " " + String(row.dataset.target) + " " + String(row.dataset.version)).includes(query);
            row.hidden = !(matchesTarget && matchesStatus && matchesQuery);
            if (!row.hidden) visible += 1;
            list?.append(row);
          });
          const count = document.querySelector("#migration-visible-count");
          if (count) count.textContent = String(visible);
          preferences.migrationQuery = migrationSearch?.value ?? "";
          preferences.migrationSort = sort;
          preferences.selectedTarget = target;
          preferences.migrationStatus = status;
          savePreferences();
        };
        migrationSearch?.addEventListener("input", applyMigrationView);
        migrationTarget?.addEventListener("change", applyMigrationView);
        migrationStatus?.addEventListener("change", applyMigrationView);
        migrationSort?.addEventListener("change", applyMigrationView);

        const environmentTarget = document.querySelector("#environment-target");
        environmentTarget?.addEventListener("change", () => {
          preferences.selectedTarget = environmentTarget.value;
          if (migrationTarget) migrationTarget.value = environmentTarget.value;
          applyMigrationView();
        });
        const workspaceProfile = document.querySelector("#workspace-profile");
        workspaceProfile?.addEventListener("change", () => {
          preferences.profile = workspaceProfile.value;
          if (workspaceProfile.value === "primary") preferences.selectedTarget = "primary";
          if (workspaceProfile.value === "full") preferences.selectedTarget = "all";
          if (environmentTarget && [...environmentTarget.options].some((option) => option.value === preferences.selectedTarget)) {
            environmentTarget.value = preferences.selectedTarget;
          }
          savePreferences();
        });

        const applicationUrl = document.querySelector("#application-url");
        applicationUrl?.addEventListener("change", () => {
          preferences.applicationUrl = applicationUrl.value;
          savePreferences();
        });
        document.querySelector("#open-custom-application")?.addEventListener("click", () => {
          vscode?.postMessage({ type: "openApplication", url: applicationUrl?.value ?? "" });
        });

        document.querySelector("#configuration-controls")?.addEventListener("submit", (event) => {
          event.preventDefault();
          const values = Object.fromEntries(new FormData(event.currentTarget).entries());
          vscode?.postMessage({ type: "reviewConfiguration", values });
        });
        document.querySelectorAll("[data-export-format]").forEach((control) => {
          control.addEventListener("click", () => vscode?.postMessage({ type: "exportReport", format: control.dataset.exportFormat }));
        });
        document.querySelector("#reset-local-state")?.addEventListener("click", () => {
          vscode?.postMessage({ type: "resetLocalState" });
        });

        const compare = () => {
          const leftId = document.querySelector("#compare-left")?.value;
          const rightId = document.querySelector("#compare-right")?.value;
          const result = document.querySelector("#comparison-result");
          if (!result) return;
          const left = generations.find((item) => item.generationId === leftId);
          const right = generations.find((item) => item.generationId === rightId);
          if (!left || !right) {
            result.textContent = "Choose two retained versions to compare.";
            return;
          }
          const rowDelta = right.rowCount - left.rowCount;
          const tableDelta = right.tableCount - left.tableCount;
          const migrationDelta = right.migrationCount - left.migrationCount;
          result.textContent = left.generationId === right.generationId
            ? "These selections refer to the same verified baseline."
            : "Rows " + (rowDelta >= 0 ? "+" : "") + rowDelta.toLocaleString() + "; tables " + (tableDelta >= 0 ? "+" : "") + tableDelta + "; migrations " + (migrationDelta >= 0 ? "+" : "") + migrationDelta + ".";
        };
        document.querySelector("#compare-left")?.addEventListener("change", compare);
        document.querySelector("#compare-right")?.addEventListener("change", compare);
        compare();
      })();
    </script>
  </body>
</html>`;
};
