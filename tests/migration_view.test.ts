import { describe, expect, it } from "vitest";
import { migrationReviewMarkup } from "../src/migration_view.js";
import { parseMigrationReviewPlan } from "../src/migration_review.js";
import { normalizeWorkspacePreferences } from "../src/workspace_preferences.js";
import type { ProjectSnapshot } from "../src/project_snapshot.js";
import { MIGRATION_REVIEW_PERSISTENCE_LIMIT } from "../src/workspace_view_state.js";

const plan = () => ({
  schemaVersion: 1,
  candidateSha256: "a".repeat(64),
  candidateCount: 1,
  selection: "complete-ordered-suffix",
  safety: {
    readsSqlBodiesForSafety: false,
    executesSql: false,
    startsEngine: false,
  },
  targets: [
    {
      name: "primary",
      provider: "postgresql",
      baselineGenerationId: "generation-1",
      candidateSha256: "b".repeat(64),
      entries: [
        {
          id: "primary:20260101000000",
          target: "primary",
          version: "20260101000000",
          timestamp: "20260101000000",
          name: "create_widgets",
          filename: "20260101000000_create_widgets.sql",
          sha256: "c".repeat(64),
          order: 0,
          status: "represented_by_baseline",
          required: false,
          dependsOn: [],
          warnings: [],
          selectionReason: "Immutable history.",
        },
        {
          id: "primary:20260102000000",
          target: "primary",
          version: "20260102000000",
          timestamp: "20260102000000",
          name: "add_index",
          filename: "20260102000000_add_index.sql",
          sha256: "d".repeat(64),
          order: 1,
          status: "candidate",
          required: true,
          dependsOn: ["primary:20260101000000"],
          warnings: ["sql_safety_not_inferred"],
          selectionReason: "Complete ordered suffix.",
        },
      ],
    },
  ],
});
describe("migration review rendering", () => {
  const snapshotFor = (value = plan()): ProjectSnapshot => ({
    workspaceName: "example",
    workspaceRoot: "/private/example",
    availability: "ready",
    migrationReview: parseMigrationReviewPlan(value),
  });
  it("shows historical/candidate states, dependencies, filters and exact digest without claiming SQL safety", () => {
    const snapshot: ProjectSnapshot = {
      workspaceName: "example",
      workspaceRoot: "/private/example",
      availability: "ready",
      migrationReview: parseMigrationReviewPlan(plan()),
    };
    const markup = migrationReviewMarkup(
      snapshot,
      normalizeWorkspacePreferences(undefined),
    );
    expect(markup).toContain("1 required candidate");
    expect(markup).toContain("migration-from");
    expect(markup).toContain("Required candidate — why it cannot be skipped");
    expect(markup).toContain("SQL safety is not inferred");
    expect(markup).toContain("filters and sorting never alter");
    expect(markup).not.toContain("/private/example");
  });
  it("fails closed on mismatched filenames or fabricated warnings", () => {
    const filename = plan();
    filename.targets[0]!.entries[1]!.filename = "20260102000000_other.sql";
    const warning = plan();
    warning.targets[0]!.entries[1]!.warnings = [];
    expect(() => parseMigrationReviewPlan(filename)).toThrow(/filename/u);
    expect(() => parseMigrationReviewPlan(warning)).toThrow(/warnings/u);
  });

  it("exposes descriptive sort names separately from timestamp-prefixed search filenames", () => {
    const markup = migrationReviewMarkup(
      snapshotFor(),
      normalizeWorkspacePreferences(undefined),
    )!;
    expect(markup).toContain(
      'data-name="20260101000000_create_widgets.sql" data-sort-name="create_widgets"',
    );
    expect(markup).toContain(
      'data-name="20260102000000_add_index.sql" data-sort-name="add_index"',
    );
    expect(markup).toContain('data-order="0"');
    expect(markup).toContain('data-order="1"');
    expect(markup).toContain(plan().candidateSha256);
  });

  it.each([
    ["all", "All statuses"],
    ["candidate", "Waiting"],
    ["represented_by_baseline", "Already in baseline"],
    ["applied_to_current_runtime", "Applied to current sandbox"],
  ])(
    "labels status %s without changing its selected value or row identifiers",
    (status, label) => {
      const markup = migrationReviewMarkup(
        snapshotFor(),
        normalizeWorkspacePreferences({ migrationStatus: status }),
      );
      expect(markup).toContain(
        `<option value="${status}" selected>${label}</option>`,
      );
      expect(markup).toContain('data-status="represented_by_baseline"');
      expect(markup).toContain('data-status="candidate"');
      expect(markup).toContain(
        'data-migration-review="primary:20260102000000"',
      );
      expect(markup).toContain(">Already in baseline</strong>");
      expect(markup).toContain(">Waiting</strong>");
    },
  );

  it.each([
    ["order", "Migration order"],
    ["name", "Name"],
    ["date", "Version prefix"],
    ["target", "Target"],
  ])("labels sort %s without changing its selected value", (sort, label) => {
    const markup = migrationReviewMarkup(
      snapshotFor(),
      normalizeWorkspacePreferences({ migrationSort: sort }),
    );
    expect(markup).toContain(
      `<option value="${sort}" selected>${label}</option>`,
    );
  });

  it("labels applied history while preserving exact current-runtime status", () => {
    const applied = plan();
    applied.candidateCount = 0;
    const entry = applied.targets[0]!.entries[1]!;
    entry.status = "applied_to_current_runtime";
    entry.required = false;
    entry.warnings = [];
    const markup = migrationReviewMarkup(
      snapshotFor(applied),
      normalizeWorkspacePreferences(undefined),
    );
    expect(markup).toContain('data-status="applied_to_current_runtime"');
    expect(markup).toContain(">Applied to current sandbox</strong>");
  });

  it("gives checkboxes stable safe target-bound DOM IDs for focus recovery", () => {
    const value = plan();
    const secondTarget = structuredClone(value.targets[0]!);
    secondTarget.name = "publication<&\"'";
    for (const [index, entry] of secondTarget.entries.entries()) {
      entry.target = secondTarget.name;
      entry.id = `${secondTarget.name}:${entry.version}`;
      entry.dependsOn = index ? [secondTarget.entries[index - 1]!.id] : [];
    }
    value.targets.push(secondTarget);
    value.candidateCount = 2;
    const renderIds = (preferences: unknown) => {
      const markup = migrationReviewMarkup(
        snapshotFor(value),
        normalizeWorkspacePreferences(preferences),
      )!;
      return Array.from(
        markup.matchAll(
          /<input id="(migration-review-[a-f0-9]{24})" type="checkbox" data-migration-review="([^"]+)"/gu,
        ),
        ([, id, entryId]) => [id, entryId],
      );
    };
    const initial = renderIds(undefined);
    expect(initial).toHaveLength(4);
    expect(new Set(initial.map(([id]) => id)).size).toBe(4);
    expect(initial[0]![1]).toBe("primary:20260101000000");
    expect(initial[2]![1]).toBe(
      "publication&lt;&amp;&quot;&#39;:20260101000000",
    );
    expect(
      renderIds({
        migrationQuery: "index",
        migrationSort: "name",
        migrationStatus: "candidate",
      }),
    ).toEqual(initial);
  });

  it.each([
    MIGRATION_REVIEW_PERSISTENCE_LIMIT,
    MIGRATION_REVIEW_PERSISTENCE_LIMIT + 1,
  ])(
    "discloses saved-checkmark limits without truncating %i migrations or execution scope",
    (count) => {
      const value = plan();
      const template = value.targets[0]!.entries[1]!;
      value.targets[0]!.entries = Array.from({ length: count }, (_, index) => {
        const version = String(20260101000000 + index);
        return {
          ...template,
          id: `primary:${version}`,
          version,
          timestamp: version,
          filename: `${version}_${template.name}.sql`,
          order: index,
          dependsOn: index ? [`primary:${20260101000000 + index - 1}`] : [],
        };
      });
      value.candidateCount = count;
      const markup = migrationReviewMarkup(
        snapshotFor(value),
        normalizeWorkspacePreferences(undefined),
      )!;
      expect(markup.match(/data-migration-row /gu)).toHaveLength(count);
      expect(markup).toContain(`${count} required candidates`);
      expect(markup).toContain(value.candidateSha256);
      expect(
        markup.includes("Only the first 1,000 checked migration IDs"),
      ).toBe(count > MIGRATION_REVIEW_PERSISTENCE_LIMIT);
      if (count > MIGRATION_REVIEW_PERSISTENCE_LIMIT) {
        expect(markup).toContain("Additional checkmarks are not persisted");
        expect(markup).toContain("never change the complete execution set");
      }
    },
  );

  it("keeps project labels, review evidence and search text escaped", () => {
    const value = plan();
    const target = value.targets[0]!;
    target.name = "primary<&\"'";
    for (const [index, entry] of target.entries.entries()) {
      entry.target = target.name;
      entry.id = `${target.name}:${entry.version}`;
      entry.dependsOn = index ? [target.entries[index - 1]!.id] : [];
      entry.selectionReason = '<script>untrusted "evidence"</script>';
    }
    const markup = migrationReviewMarkup(
      snapshotFor(value),
      normalizeWorkspacePreferences({
        migrationQuery: '\"><img src="untrusted">',
        selectedTarget: target.name,
      }),
    );
    expect(markup).toContain('value="primary&lt;&amp;&quot;&#39;" selected');
    expect(markup).toContain('data-target="primary&lt;&amp;&quot;&#39;"');
    expect(markup).toContain(
      "&lt;script&gt;untrusted &quot;evidence&quot;&lt;/script&gt;",
    );
    expect(markup).toContain("&quot;&gt;&lt;img src=&quot;untrusted&quot;&gt;");
    expect(markup).not.toContain("<script>");
    expect(markup).not.toContain("<img");
  });
});
