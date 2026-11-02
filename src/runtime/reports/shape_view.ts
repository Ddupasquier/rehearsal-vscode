import type { BaselineShapeData } from "./shape_contract.js";

const html = (value: string): string =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");

const reasons = {
  "within-tolerance": "Within the reviewed tolerance",
  "outside-tolerance": "Distribution changed more than allowed",
  "missing-required-source-class":
    "The required class was not found safely in the source",
  "insufficient-selected-class":
    "The sample contains too few source representatives",
  "insufficient-sanitized-class":
    "Too few representatives remain after privacy transformation",
  "privacy-cohort":
    "Counts hidden because a privacy cohort could not be safely reported",
} as const;

const renderClasses = (
  goal: BaselineShapeData["distributions"][number],
): string =>
  `<details><summary>Review measured classes</summary><p class="surface-copy">Counts show approved source / selected source / sanitized baseline. Class names refer to the reviewed policy, not private values.</p><ul>${goal.buckets.map((bucket) => `<li><strong>${html(bucket.bucket)}</strong> · ${bucket.suppressed ? "Counts hidden" : `${bucket.sourceCount} / ${bucket.selectedSourceCount} / ${bucket.baselineCount} · ${html(bucket.disposition)}`}<br>${reasons[bucket.reason]}</li>`).join("")}</ul></details>`;

export const renderBaselineShapeEvidence = (
  shape: BaselineShapeData | null | undefined,
): string => {
  if (!shape)
    return '<div class="empty-state"><strong>No measured shape receipt</strong><p>This baseline may still be safe. Its distributions and edge-case coverage have not been certified by an opt-in shape policy.</p></div>';
  return `<div class="baseline-shape"><p class="surface-copy">Measured shape is evidence for your reviewed goals—not a promise that every production edge case is represented.</p>
    <dl class="facts-list"><div><dt>Selected / source rows</dt><dd>${shape.tables.reduce((sum, table) => sum + table.selectedRows, 0).toLocaleString("en-US")} / ${shape.tables.reduce((sum, table) => sum + table.sourceRows, 0).toLocaleString("en-US")}</dd></div>
    <div><dt>Verified relationships</dt><dd>${shape.relationships.length}</dd></div><div><dt>Row budget</dt><dd>${shape.maximumRows.toLocaleString("en-US")}</dd></div><div><dt>Shape policy</dt><dd><code>${shape.policySha256.slice(0, 12)}</code></dd></div></dl>
    <ul class="readiness-list">${shape.distributions.map((goal) => `<li><span class="state-chip">${goal.status === "passed" ? "Proved" : goal.status === "suppressed" ? "Privacy-limited" : "Review needed"}</span><span><strong>${html(goal.id)}</strong><small>${goal.required ? "Required" : "Advisory"} · allowed difference ${(goal.tolerance * 100).toFixed(1)} percentage points${goal.status === "suppressed" ? " · rare bucket counts stay hidden" : ""}</small>${renderClasses(goal)}</span></li>`).join("") || "<li>No distribution goals were declared. Only reviewed relationship integrity was checked.</li>"}</ul>
    <details><summary>What this shape receipt does not prove</summary><ul>${shape.limitations.map((limitation) => `<li>${html(limitation)}</li>`).join("")}</ul></details></div>`;
};
