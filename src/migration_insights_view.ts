/** Compact static warnings inside the existing migration rows, never approval controls. */
import type { ProjectSnapshot } from "./project_snapshot.js";
import {
  MIGRATION_INSIGHTS_LIMITATION,
  migrationInsightIndex,
} from "./migration_insights.js";
const escape = (value: string): string =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
export const migrationInsightsMarkup = (
  snapshot: ProjectSnapshot,
): {
  readonly summary: string;
  readonly entries: ReadonlyMap<string, string>;
} => {
  const entries = new Map<string, string>();
  const state = snapshot.migrationInsights;
  if (!state) return { summary: "", entries };
  if (state.state === "unavailable")
    return {
      summary:
        '<p class="control-note" role="status">Static Migration Insights is unavailable. Your ordinary review and rehearsal controls are unchanged. Refresh or review the SQL manually; unavailable analysis is not evidence of safety.</p>',
      entries,
    };
  const report = state.report;
  const actions = new Map<
    string,
    {
      id: string;
      finding: (typeof report.targets)[number]["entries"][number]["findings"][number];
    }[]
  >();
  for (const [id, item] of migrationInsightIndex(report)) {
    const key = `${item.target}:${item.entry.version}`,
      list = actions.get(key) ?? [];
    list.push({ id, finding: item.finding });
    actions.set(key, list);
  }
  for (const target of report.targets)
    for (const entry of target.entries) {
      const key = `${target.name}:${entry.version}`,
        items = actions.get(key) ?? [];
      const unknown = entry.unknownReasons.length
        ? "<p>Coverage is incomplete: unsupported, malformed or bounded SQL remains unknown. Review this migration manually.</p>"
        : "<p>Only recognized lexical rules were checked; no detected warning does not mean valid or safe SQL.</p>";
      entries.set(
        key,
        `<details class="technical-details"><summary>Static Insights · ${entry.findings.length} warning${entry.findings.length === 1 ? "" : "s"}${entry.coverage === "incomplete" ? " · incomplete analysis" : ""}</summary>${unknown}${
          items.length
            ? `<ul>${items
                .slice(0, 10)
                .map(
                  ({ id, finding }) =>
                    `<li><strong>${finding.severity === "danger" ? "Destructive-operation warning" : "Data-compatibility warning"}: ${escape(finding.summary)}</strong><p>${escape(finding.suggestion)}</p><p>Line ${finding.line}, column ${finding.column} · ${entry.workspaceRelativePath ? `<button type="button" class="button button--secondary" data-open-migration-insight="${id}" aria-label="Open exact ${escape(target.name)} ${escape(entry.filename)} at line ${finding.line}, column ${finding.column}">Open exact migration at finding</button>` : "Project-local source navigation unavailable"}</p></li>`,
                )
                .join("")}</ul>`
            : ""
        }${items.length > 10 ? `<p class="control-note">Showing the first 10 of ${items.length} findings for this migration. Use <code>rehearsal inspect insights --json</code> for the complete bounded report.</p>` : ""}</details>`,
      );
    }
  return {
    summary: `<details class="technical-details"><summary>Static Migration Insights · ${report.summary.findingCount} warning${report.summary.findingCount === 1 ? "" : "s"} · ${report.summary.unknownCount} incomplete analyses</summary><p>${MIGRATION_INSIGHTS_LIMITATION}</p><p>No SQL is executed, no engine is started and no database is contacted. SQL bodies and row values are not included in findings. These hints do not change migration order, approval or rehearsal requirements.</p><p class="control-note">Bounded analysis: 1,000 candidates, 10,000 files and directory entries, 2 MiB per file, 16 MiB total input, 5,000 findings. Only the first 10 findings per migration are expanded here.</p></details>`,
    entries,
  };
};
