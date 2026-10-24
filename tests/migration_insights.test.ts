import { describe, expect, it } from "vitest";
import {
  findMigrationInsight,
  MIGRATION_INSIGHT_RULES,
  migrationInsightIndex,
  parseMigrationInsights,
} from "../src/migration_insights.js";
import { migrationInsightsMarkup } from "../src/migration_insights_view.js";
import { parseWorkspaceMessage } from "../src/workspace_preferences.js";
import { insightPlan, insightReport } from "./migration_insights_fixture.js";
import { migrationReviewMarkup } from "../src/migration_view.js";
import { normalizeWorkspacePreferences } from "../src/workspace_preferences.js";
import { parseMigrationReviewPlan } from "../src/migration_review.js";

describe("optional exact static migration insights", () => {
  it.each(["DropWidgets", "ajouter_étiquette", "约束", "add-index"])(
    "accepts actual bounded plan and Insights inventory name %s",
    (name) => {
      const planned = insightPlan(),
        raw = insightReport(),
        filename = `20261009000100_${name}.sql`;
      const plan = parseMigrationReviewPlan({
        ...planned,
        safety: {
          readsSqlBodiesForSafety: false,
          executesSql: false,
          startsEngine: false,
        },
        targets: planned.targets.map((target) => ({
          ...target,
          entries: target.entries.map((entry) => ({
            ...entry,
            name,
            filename,
          })),
        })),
      });
      raw.targets[0]!.entries[0]!.filename = filename;
      raw.targets[0]!.entries[0]!.workspaceRelativePath = `migrations/${filename}`;
      expect(
        parseMigrationInsights(raw, plan, raw.inspectorVersion).targets[0]!
          .entries[0]!.filename,
      ).toBe(filename);
    },
  );
  it.each([
    "bad/name",
    "bad\\name",
    "bad%name",
    "bad:name",
    "bad?name",
    "bad#name",
    "bad\u202ename",
    "bad\nname",
    "字".repeat(90),
  ])("does not widen plan validation to unsafe inventory name %s", (name) => {
    const planned = insightPlan(),
      filename = `20261009000100_${name}.sql`;
    expect(() =>
      parseMigrationReviewPlan({
        ...planned,
        safety: {
          readsSqlBodiesForSafety: false,
          executesSql: false,
          startsEngine: false,
        },
        targets: planned.targets.map((target) => ({
          ...target,
          entries: target.entries.map((entry) => ({
            ...entry,
            name,
            filename,
          })),
        })),
      }),
    ).toThrow();
  });
  it("accepts fixed useful warnings and binds opaque source actions to the whole exact report", () => {
    const report = parseMigrationInsights(
      insightReport("1.2.0"),
      insightPlan(),
      "1.2.0",
    );
    const id = [...migrationInsightIndex(report).keys()][0]!;
    expect(id).toMatch(/^[a-f0-9]{64}$/u);
    expect(findMigrationInsight(report, id)?.finding.summary).toContain(
      "existing rows",
    );
    const changed = { ...report, inspectorVersion: "1.3.0" };
    expect(findMigrationInsight(changed, id)).toBeNull();
    expect(findMigrationInsight(report, "not-an-id")).toBeNull();
    expect(
      parseWorkspaceMessage({ type: "openMigrationInsight", findingId: id }),
    ).toEqual({ type: "openMigrationInsight", findingId: id });
    expect(
      parseWorkspaceMessage({
        type: "openMigrationInsight",
        findingId: id,
        path: "/outside.sql",
      }),
    ).toBeNull();
  });
  it("accepts each fixed rule and its declared severity without arbitrary provider output", () => {
    for (const [rule, fixed] of Object.entries(MIGRATION_INSIGHT_RULES)) {
      const raw = insightReport();
      raw.targets[0]!.entries[0]!.findings[0] = {
        rule,
        severity: ["not_null", "new_constraint"].includes(rule)
          ? "warning"
          : "danger",
        line: 1,
        column: 2,
        ...fixed,
      };
      expect(
        parseMigrationInsights(raw, insightPlan(), raw.inspectorVersion).summary
          .findingCount,
      ).toBe(1);
    }
  });
  it("keeps unknown coverage and no-warning results explicitly distinct from safety", () => {
    const raw = insightReport(),
      entry = raw.targets[0]!.entries[0]!;
    raw.verdict = entry.verdict = "unknown";
    entry.coverage = "incomplete";
    entry.unknownReasons = ["unsupported_sql", "malformed_sql", "input_limit"];
    raw.summary.unknownCount = 1;
    const parsed = parseMigrationInsights(
      raw,
      insightPlan(),
      raw.inspectorVersion,
    );
    expect(parsed.verdict).toBe("unknown");
    entry.findings = [];
    entry.unknownReasons = [];
    entry.coverage = "recognized_lexical_rules";
    raw.verdict = entry.verdict = "no_detected_warning";
    raw.summary = { findingCount: 0, unknownCount: 0 };
    expect(
      parseMigrationInsights(raw, insightPlan(), raw.inspectorVersion)
        .limitation,
    ).toContain("not a safety or syntax-validity verdict");
  });
  it.each([
    "schema",
    "version",
    "digest",
    "count",
    "target",
    "provider",
    "baseline",
    "target-digest",
    "entry-version",
    "filename",
    "hash",
    "path",
    "raw-sql",
    "rule",
    "summary",
    "suggestion",
    "severity",
    "position",
    "verdict",
    "coverage",
    "unknown",
    "duplicate-unknown",
    "coerced-unknown",
    "totals",
    "limits",
    "safety",
    "limitation",
    "oversize",
  ])("refuses inconsistent or expanded %s evidence", (change) => {
    const value = insightReport(),
      entry = value.targets[0]!.entries[0]!,
      finding = entry.findings[0]!;
    const raw = value as unknown as Record<string, unknown>;
    if (change === "schema") value.schemaVersion = 2;
    if (change === "version") value.inspectorVersion = "1.1.0";
    if (change === "digest") value.candidateSha256 = "b".repeat(64);
    if (change === "count") value.candidateCount = 0;
    if (change === "target") value.targets[0]!.name = "other";
    if (change === "provider") value.targets[0]!.provider = "supabase";
    if (change === "baseline") value.targets[0]!.baselineGenerationId = "other";
    if (change === "target-digest")
      value.targets[0]!.candidateSha256 = "b".repeat(64);
    if (change === "entry-version") entry.version = "20261009000200";
    if (change === "filename") entry.filename = "20261009000100_other.sql";
    if (change === "hash") entry.sha256 = "e".repeat(64);
    if (change === "path") entry.workspaceRelativePath = "../" + entry.filename;
    if (change === "raw-sql") raw.sql = "PRIVATE_SQL";
    if (change === "rule") finding.rule = "arbitrary";
    if (change === "summary") finding.summary = "PRIVATE_SQL";
    if (change === "suggestion") finding.suggestion = "PRIVATE_SQL";
    if (change === "severity") finding.severity = "danger";
    if (change === "position") finding.line = 0;
    if (change === "verdict") value.verdict = "safe";
    if (change === "coverage") entry.coverage = "valid_sql";
    if (change === "unknown") entry.unknownReasons = ["provider_said_so"];
    if (change === "duplicate-unknown")
      entry.unknownReasons = ["input_limit", "input_limit"];
    if (change === "coerced-unknown")
      (entry as unknown as Record<string, unknown>).unknownReasons = [
        ["input_limit"],
      ];
    if (change === "totals") value.summary.findingCount = 2;
    if (change === "limits") value.limits.maximumDirectoryEntries++;
    if (change === "safety") value.safety.executesSql = true;
    if (change === "limitation") raw.limitation = "Safe to deploy";
    if (change === "oversize") raw.extra = "x".repeat(8 * 1024 * 1024);
    expect(() =>
      parseMigrationInsights(value, insightPlan(), "0.1.0-rc.4"),
    ).toThrow();
  });
  it("renders static/unknown/limit guidance without paths or inbound source authority", () => {
    const report = parseMigrationInsights(
      insightReport(),
      insightPlan(),
      "0.1.0-rc.4",
    );
    const view = migrationInsightsMarkup({
      workspaceName: "fixture",
      workspaceRoot: "/private/fixture",
      availability: "ready",
      migrationInsights: { state: "available", report },
    });
    expect(view.summary).toContain("not a safety or syntax-validity verdict");
    expect(view.summary).toContain("No SQL is executed");
    expect(view.summary).toContain("1,000 candidates");
    expect([...view.entries.values()].join("")).toContain(
      "Open exact migration at finding",
    );
    expect([...view.entries.values()].join("")).toContain(
      'aria-label="Open exact primary 20261009000100_add_index.sql at line 1, column 1"',
    );
    expect([...view.entries.values()].join("")).not.toContain(
      "database/migrations/",
    );
    expect(view.summary).not.toContain("/private/fixture");
    expect(
      migrationInsightsMarkup({
        workspaceName: "fixture",
        workspaceRoot: "/private/fixture",
        availability: "ready",
        migrationInsights: { state: "unavailable" },
      }).summary,
    ).toContain("controls are unchanged");
  });
  it("integrates bounded findings into their existing exact migration row and explicitly omits surplus detail", () => {
    const raw = insightReport(),
      entry = raw.targets[0]!.entries[0]!;
    entry.findings = Array.from({ length: 12 }, (_, index) => ({
      ...entry.findings[0]!,
      line: index + 1,
    }));
    raw.summary.findingCount = 12;
    const plan = insightPlan(),
      report = parseMigrationInsights(raw, plan, raw.inspectorVersion);
    const markup = migrationReviewMarkup(
      {
        workspaceName: "fixture",
        workspaceRoot: "/private/fixture",
        availability: "ready",
        migrationReview: plan,
        migrationInsights: { state: "available", report },
      },
      normalizeWorkspacePreferences(undefined),
    )!;
    expect(markup).toContain("Static Migration Insights");
    expect(markup).toContain("Showing the first 10 of 12 findings");
    expect(markup.match(/data-open-migration-insight=/gu)).toHaveLength(10);
    expect(markup.match(/data-migration-row /gu)).toHaveLength(1);
    expect(markup).toContain("Every required candidate remains");
  });
});
