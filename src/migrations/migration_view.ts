import { migrationSourceReviewId } from "./migration_source_review.js";
import { describeMigrationCutoff } from "./native_migration_contract.js";
import { createHash } from "node:crypto";
import type { ProjectSnapshot } from "../workspace/project_snapshot.js";
import type { WorkspacePreferences } from "../workspace/workspace_preferences.js";
import { MIGRATION_REVIEW_PERSISTENCE_LIMIT } from "../workspace/workspace_view_state.js";
import { migrationInsightsMarkup } from "./migration_insights_view.js";

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

/** Stable presentation identity only; never runtime or approval authority. */
export const migrationReviewCheckboxId = (entryId: string): string =>
  `migration-review-${createHash("sha256").update(entryId).digest("hex").slice(0, 24)}`;

export const migrationReviewMarkup = (
  snapshot: ProjectSnapshot,
  preferences: WorkspacePreferences,
): string | null => {
  if (!snapshot.migrationReview) return null;
  const plan = snapshot.migrationReview;
  const insights = migrationInsightsMarkup(snapshot);
  const entries = plan.targets.flatMap((target) => target.entries);
  const allKnex =
    entries.length > 0 &&
    entries.every((entry) => entry.nativeIdentity?.kind === "knex");
  const hasKnex = entries.some(
    (entry) => entry.nativeIdentity?.kind === "knex",
  );
  const displayedSortLabels = allKnex
    ? { ...sortLabels, date: "Time unavailable for Knex" }
    : entries.some((entry) => entry.nativeIdentity?.kind === "drizzle")
      ? { ...sortLabels, date: "Migration time" }
      : sortLabels;
  const persistenceNotice =
    entries.length > MIGRATION_REVIEW_PERSISTENCE_LIMIT
      ? `<p class="control-note">Only the first ${MIGRATION_REVIEW_PERSISTENCE_LIMIT.toLocaleString("en-US")} checked migration IDs are remembered after refresh. Additional checkmarks are not persisted. Review checkmarks are not approval and never change the complete execution set.</p>`
      : "";
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
    displayedSortLabels,
  )
    .map(
      ([sort, label]) =>
        `<option value="${sort}"${sort === (allKnex && preferences.migrationSort === "date" ? "order" : preferences.migrationSort) ? " selected" : ""}${allKnex && sort === "date" ? " disabled" : ""}>${label}</option>`,
    )
    .join(
      "",
    )}</select></label><label><span>From date</span><input id="migration-from" type="date" value="${allKnex ? "" : preferences.migrationFrom}"${allKnex ? " disabled" : ""} /></label><label><span>Through date</span><input id="migration-to" type="date" value="${allKnex ? "" : preferences.migrationTo}"${allKnex ? " disabled" : ""} /></label><label><span>Warning</span><select id="migration-warning"><option value="all">All entries</option><option value="warnings"${preferences.migrationWarning === "warnings" ? " selected" : ""}>${hasKnex ? "Needs review" : "Needs SQL review"}</option></select></label></div>
    <div class="migration-summary" role="status"><strong id="migration-visible-count">${entries.length}</strong> visible · <b>${plan.candidateCount} required candidate${plan.candidateCount === 1 ? "" : "s"}</b> · <span id="migration-reviewed-count">0 reviewed</span></div>${persistenceNotice}${hasKnex ? '<p class="control-note" role="status">Knex historical applied-file checksums are unavailable. Current reviewed bytes do not prove past applied bytes. JavaScript requires Core’s isolated worker and current doctor readiness; the editor never executes it on the host. Knex names provide no migration timestamp.</p>' : ""}${insights.summary}<p>Exact approval digest: <code>${plan.candidateSha256}</code></p>
    <ul class="migration-list" id="migration-list">${entries.map((entry, index) => `<li data-migration-row data-name="${escape(entry.filename.toLowerCase())}" data-sort-name="${escape(entry.name.toLowerCase())}" data-target="${escape(entry.target)}" data-status="${entry.status}" data-version="${escape(entry.version ?? "")}" ${entry.nativeIdentity?.kind === "knex" ? `data-native-kind="knex" data-native-name="${escape(entry.nativeIdentity.name)}"` : entry.nativeIdentity ? `data-native-kind="drizzle" data-native-when="${entry.nativeIdentity.when}" data-native-idx="${entry.nativeIdentity.idx}" data-native-tag="${escape(entry.nativeIdentity.tag)}"` : ""} data-order="${index}" data-warning="${entry.warnings.length ? "warnings" : "none"}"><label class="migration-check"><input id="${migrationReviewCheckboxId(entry.id)}" type="checkbox" data-migration-review="${escape(entry.id)}" aria-label="Reviewed ${escape(entry.filename)}" /><span aria-hidden="true">↗</span><span><code>${escape(entry.filename)}</code><small>${escape(entry.target)} · ${escape(describeMigrationCutoff(entry.nativeIdentity ?? entry.timestamp))} · ${entry.sha256.slice(0, 12)}</small></span><strong class="field-state field-state--suggested">${statusLabels[entry.status]}</strong></label><details class="technical-details"><summary>${entry.required ? "Required candidate — why it cannot be skipped" : "History and dependency evidence"}</summary><p>${escape(entry.selectionReason)}</p><p>Predecessor: ${escape(entry.dependsOn.join(", ") || "First migration in this target")}</p>${entry.nativeIdentity?.kind === "knex" ? "<p>Historical file checksums are unavailable. JavaScript execution requires Core’s isolated worker; current reviewed code is not historical applied-byte evidence.</p>" : entry.warnings.length ? "<p>SQL safety is not inferred from names or order. Review the SQL and prove behavior in the disposable runtime.</p>" : ""}</details>${entry.nativeIdentity ? `<p><button type="button" class="button button--secondary" data-open-reviewed-migration="${migrationSourceReviewId(plan, entry)}" aria-label="Open exact reviewed ${escape(entry.filename)}">Open exact migration input</button></p>` : ""}${insights.entries.get(entry.id) ?? ""}</li>`).join("")}</ul><div id="migration-filter-empty" class="empty-state" hidden><strong>No migrations match these filters.</strong><button id="clear-migration-filters" type="button" class="button button--secondary">Clear migration filters</button></div><p class="control-note">Checkboxes record your review only. Every required candidate remains in the complete ordered suffix; filters and sorting never alter the execution order or digest.</p></div>`;
};
