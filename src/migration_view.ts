import type { ProjectSnapshot } from "./project_snapshot.js";
import type { WorkspacePreferences } from "./workspace_preferences.js";

const statusLabels = {
  all: "All statuses",
  candidate: "Waiting",
  represented_by_baseline: "Already in baseline",
  applied_to_current_runtime: "Applied to current sandbox",
} satisfies Record<WorkspacePreferences["migrationStatus"], string>;

const sortLabels = {
  order: "Migration order",
  name: "Name",
  date: "Version prefix",
  target: "Target",
} satisfies Record<WorkspacePreferences["migrationSort"], string>;

const escape = (value: string): string =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
export const migrationReviewMarkup = (
  snapshot: ProjectSnapshot,
  preferences: WorkspacePreferences,
): string | null => {
  if (!snapshot.migrationReview) return null;
  const plan = snapshot.migrationReview;
  const entries = plan.targets.flatMap((target) => target.entries);
  return `<div class="migration-workbench"><div class="workbench-toolbar" aria-label="Migration filters"><label><span>Find migrations</span><input id="migration-search" type="search" value="${escape(preferences.migrationQuery)}" maxlength="120" placeholder="Name, version, or target" /></label><label><span>Target</span><select id="migration-target"><option value="all">All targets</option>${plan.targets.map((target) => `<option value="${escape(target.name)}"${target.name === preferences.selectedTarget ? " selected" : ""}>${escape(target.name)}</option>`).join("")}</select></label><label><span>Status</span><select id="migration-status">${Object.entries(
    statusLabels,
  )
    .map(
      ([status, label]) =>
        `<option value="${status}"${status === preferences.migrationStatus ? " selected" : ""}>${label}</option>`,
    )
    .join(
      "",
    )}</select></label><label><span>Sort</span><select id="migration-sort">${Object.entries(
    sortLabels,
  )
    .map(
      ([sort, label]) =>
        `<option value="${sort}"${sort === preferences.migrationSort ? " selected" : ""}>${label}</option>`,
    )
    .join(
      "",
    )}</select></label><label><span>From date</span><input id="migration-from" type="date" value="${preferences.migrationFrom}" /></label><label><span>Through date</span><input id="migration-to" type="date" value="${preferences.migrationTo}" /></label><label><span>Warning</span><select id="migration-warning"><option value="all">All entries</option><option value="warnings"${preferences.migrationWarning === "warnings" ? " selected" : ""}>Needs SQL review</option></select></label></div>
    <div class="migration-summary" role="status"><strong id="migration-visible-count">${entries.length}</strong> visible · <b>${plan.candidateCount} required candidate${plan.candidateCount === 1 ? "" : "s"}</b> · <span id="migration-reviewed-count">0 reviewed</span></div><p>Exact approval digest: <code>${plan.candidateSha256}</code></p>
    <ul class="migration-list" id="migration-list">${entries.map((entry, index) => `<li data-migration-row data-name="${escape(entry.filename.toLowerCase())}" data-target="${escape(entry.target)}" data-status="${entry.status}" data-version="${entry.version}" data-order="${index}" data-warning="${entry.warnings.length ? "warnings" : "none"}"><label class="migration-check"><input type="checkbox" data-migration-review="${escape(entry.id)}" aria-label="Reviewed ${escape(entry.filename)}" /><span aria-hidden="true">↗</span><span><code>${escape(entry.filename)}</code><small>${escape(entry.target)} · ${entry.timestamp} · ${entry.sha256.slice(0, 12)}</small></span><strong class="field-state field-state--suggested">${statusLabels[entry.status]}</strong></label><details class="technical-details"><summary>${entry.required ? "Required candidate — why it cannot be skipped" : "History and dependency evidence"}</summary><p>${escape(entry.selectionReason)}</p><p>Predecessor: ${escape(entry.dependsOn.join(", ") || "First migration in this target")}</p>${entry.warnings.length ? "<p>SQL safety is not inferred from names or order. Review the SQL and prove behavior in the disposable runtime.</p>" : ""}</details></li>`).join("")}</ul><div id="migration-filter-empty" class="empty-state" hidden><strong>No migrations match these filters.</strong><button id="clear-migration-filters" type="button" class="button button--secondary">Clear migration filters</button></div><p class="control-note">Checkboxes record your review only. Every required candidate remains in the complete ordered suffix; filters and sorting never alter the execution order or digest.</p></div>`;
};
