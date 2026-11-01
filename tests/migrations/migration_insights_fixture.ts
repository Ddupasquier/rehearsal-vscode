import {
  MIGRATION_INSIGHTS_LIMITATION,
  MIGRATION_INSIGHT_RULES,
} from "../../src/migrations/migration_insights.js";
import type { MigrationReviewPlan } from "../../src/migrations/migration_review.js";
export const insightPlan = (): MigrationReviewPlan => ({
  schemaVersion: 1,
  candidateSha256: "a".repeat(64),
  candidateCount: 1,
  selection: "complete-ordered-suffix",
  targets: [
    {
      name: "primary",
      provider: "postgresql",
      baselineGenerationId: "baseline-1",
      candidateSha256: "a".repeat(64),
      entries: [
        {
          id: "primary:20261009000100",
          target: "primary",
          version: "20261009000100",
          name: "add_index",
          filename: "20261009000100_add_index.sql",
          sha256: "d".repeat(64),
          order: 0,
          timestamp: "20261009000100",
          status: "candidate",
          required: true,
          dependsOn: [],
          warnings: ["sql_safety_not_inferred"],
          selectionReason: "Complete ordered suffix.",
        },
      ],
    },
  ],
});
export const insightReport = (inspectorVersion = "0.1.0-rc.4") => ({
  schemaVersion: 1,
  inspectorVersion,
  candidateSha256: "a".repeat(64),
  candidateCount: 1,
  verdict: "static_warnings",
  summary: { findingCount: 1, unknownCount: 0 },
  targets: [
    {
      name: "primary",
      provider: "postgresql",
      baselineGenerationId: "baseline-1",
      candidateSha256: "a".repeat(64),
      entries: [
        {
          version: "20261009000100",
          filename: "20261009000100_add_index.sql",
          sha256: "d".repeat(64),
          workspaceRelativePath:
            "database/migrations/20261009000100_add_index.sql",
          verdict: "static_warnings",
          coverage: "recognized_lexical_rules",
          unknownReasons: [] as string[],
          findings: [
            {
              rule: "not_null",
              severity: "warning",
              line: 1,
              column: 1,
              ...MIGRATION_INSIGHT_RULES.not_null,
            },
          ] as {
            rule: string;
            severity: string;
            line: number;
            column: number;
            summary: string;
            suggestion: string;
          }[],
        },
      ],
    },
  ],
  limits: {
    maximumFiles: 10000,
    maximumDirectoryEntries: 10000,
    maximumCandidates: 1000,
    maximumFileBytes: 2097152,
    maximumTotalBytes: 16777216,
    maximumFindings: 5000,
  },
  safety: {
    readsSqlBodies: true,
    executesSql: false,
    startsEngine: false,
    contactsDatabase: false,
    includesSqlOrRowValues: false,
  },
  limitation: MIGRATION_INSIGHTS_LIMITATION,
});
