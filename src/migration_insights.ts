/** Optional, bounded static warnings. Never SQL validity or database safety evidence. */
import { createHash } from "node:crypto";
import type { MigrationReviewPlan } from "./migration_review.js";
import {
  parseMigrationSourceInput,
  type MigrationSourceInput,
} from "./migration_source.js";

export const MIGRATION_INSIGHTS_OUTPUT_BYTES = 8 * 1024 * 1024;
export const MIGRATION_INSIGHTS_LIMITATION =
  "Static lexical warnings only. No detected warning is not a safety or syntax-validity verdict; data impact, permissions, locks and production behavior are not measured.";
export const MIGRATION_INSIGHT_RULES = {
  drop_table: {
    summary: "A table may be removed.",
    suggestion:
      "Review dependent objects and preserve any required rows before dropping the table.",
  },
  drop_column: {
    summary: "A column and its stored values may be removed.",
    suggestion:
      "Review populated values and dependent application code before dropping the column.",
  },
  truncate: {
    summary: "All rows in the selected table may be removed.",
    suggestion:
      "Confirm the intended data loss and review identity, foreign-key and cascade behavior.",
  },
  broad_update: {
    summary: "An UPDATE has no top-level WHERE clause.",
    suggestion:
      "Review the intended row scope; a nested WHERE does not restrict the outer UPDATE.",
  },
  broad_delete: {
    summary: "A DELETE has no top-level WHERE clause.",
    suggestion:
      "Review the intended row scope; a nested WHERE does not restrict the outer DELETE.",
  },
  not_null: {
    summary: "A NOT NULL requirement may reject existing rows.",
    suggestion:
      "Check existing NULL values and apply a reviewed backfill before enforcing the requirement.",
  },
  new_constraint: {
    summary: "A new constraint may reject existing rows.",
    suggestion:
      "Check NULL, duplicate, orphan and CHECK violations as appropriate; SQL text alone cannot establish compliance.",
  },
  cascade: {
    summary: "CASCADE can affect dependent objects or rows.",
    suggestion:
      "Review the dependency graph; this static warning does not measure the cascade's actual reach.",
  },
} as const;
export type MigrationInsightRule = keyof typeof MIGRATION_INSIGHT_RULES;
type Verdict = "static_warnings" | "no_detected_warning" | "unknown";
type UnknownReason = "unsupported_sql" | "malformed_sql" | "input_limit";
export interface MigrationInsightFinding {
  readonly rule: MigrationInsightRule;
  readonly severity: "warning" | "danger";
  readonly line: number;
  readonly column: number;
  readonly summary: string;
  readonly suggestion: string;
}
export interface MigrationInsightEntry extends MigrationSourceInput {
  readonly version: string;
  readonly verdict: Verdict;
  readonly coverage: "recognized_lexical_rules" | "incomplete";
  readonly unknownReasons: readonly UnknownReason[];
  readonly findings: readonly MigrationInsightFinding[];
}
export interface MigrationInsights {
  readonly schemaVersion: 1;
  readonly inspectorVersion: string;
  readonly candidateSha256: string;
  readonly candidateCount: number;
  readonly verdict: Verdict;
  readonly summary: {
    readonly findingCount: number;
    readonly unknownCount: number;
  };
  readonly targets: readonly {
    readonly name: string;
    readonly provider: "postgresql" | "supabase";
    readonly baselineGenerationId: string;
    readonly candidateSha256: string;
    readonly entries: readonly MigrationInsightEntry[];
  }[];
  readonly limits: {
    readonly maximumFiles: 10000;
    readonly maximumDirectoryEntries: 10000;
    readonly maximumCandidates: 1000;
    readonly maximumFileBytes: 2097152;
    readonly maximumTotalBytes: 16777216;
    readonly maximumFindings: 5000;
  };
  readonly safety: {
    readonly readsSqlBodies: true;
    readonly executesSql: false;
    readonly startsEngine: false;
    readonly contactsDatabase: false;
    readonly includesSqlOrRowValues: false;
  };
  readonly limitation: typeof MIGRATION_INSIGHTS_LIMITATION;
}
const fail = (): never => {
  throw new Error(
    "Migration Insights is unavailable or no longer matches the complete current plan. Refresh and review migrations manually.",
  );
};
const object = (value: unknown, keys: string): Record<string, unknown> => {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.keys(value).sort().join(",") !== keys
  )
    return fail();
  return value as Record<string, unknown>;
};
const text = (value: unknown, maximum = 300): string => {
  if (
    typeof value !== "string" ||
    !value ||
    value.length > maximum ||
    /[\x00-\x1f\x7f-\x9f\u061c\u200e\u200f\u2028\u2029\u202a-\u202e\u2066-\u2069]/u.test(
      value,
    )
  )
    return fail();
  return value;
};
const digest = (value: unknown): string => {
  const v = text(value, 64);
  return /^[a-f0-9]{64}$/u.test(v) ? v : fail();
};
const count = (value: unknown, maximum: number): number =>
  typeof value === "number" &&
  Number.isSafeInteger(value) &&
  value >= 0 &&
  value <= maximum
    ? value
    : fail();
const verdict = (unknown: number, findings: number): Verdict =>
  unknown ? "unknown" : findings ? "static_warnings" : "no_detected_warning";

/** Closed schema plus independent exact plan/version binding; unknown additions fail closed. */
export const parseMigrationInsights = (
  value: unknown,
  plan: MigrationReviewPlan,
  inspectorVersion: string,
): MigrationInsights => {
  if (
    Buffer.byteLength(JSON.stringify(value) ?? "") >
    MIGRATION_INSIGHTS_OUTPUT_BYTES
  )
    return fail();
  const data = object(
    value,
    "candidateCount,candidateSha256,inspectorVersion,limitation,limits,safety,schemaVersion,summary,targets,verdict",
  );
  const limits = object(
    data.limits,
    "maximumCandidates,maximumDirectoryEntries,maximumFileBytes,maximumFiles,maximumFindings,maximumTotalBytes",
  );
  const safety = object(
    data.safety,
    "contactsDatabase,executesSql,includesSqlOrRowValues,readsSqlBodies,startsEngine",
  );
  if (
    data.schemaVersion !== 1 ||
    data.inspectorVersion !== inspectorVersion ||
    data.limitation !== MIGRATION_INSIGHTS_LIMITATION ||
    limits.maximumFiles !== 10000 ||
    limits.maximumDirectoryEntries !== 10000 ||
    limits.maximumCandidates !== 1000 ||
    limits.maximumFileBytes !== 2097152 ||
    limits.maximumTotalBytes !== 16777216 ||
    limits.maximumFindings !== 5000 ||
    safety.readsSqlBodies !== true ||
    safety.executesSql !== false ||
    safety.startsEngine !== false ||
    safety.contactsDatabase !== false ||
    safety.includesSqlOrRowValues !== false ||
    !Array.isArray(data.targets) ||
    data.targets.length !== plan.targets.length ||
    !data.targets.length ||
    data.targets.length > 32 ||
    data.candidateSha256 !== plan.candidateSha256 ||
    data.candidateCount !== plan.candidateCount
  )
    return fail();
  let entriesCount = 0,
    findingsCount = 0,
    unknownCount = 0;
  const targets = data.targets.map((raw, targetIndex) => {
    const target = object(
        raw,
        "baselineGenerationId,candidateSha256,entries,name,provider",
      ),
      expected = plan.targets[targetIndex]!;
    const pending = expected.entries.filter(
      (entry) => entry.status === "candidate",
    );
    if (
      target.name !== expected.name ||
      target.provider !== expected.provider ||
      target.baselineGenerationId !== expected.baselineGenerationId ||
      target.candidateSha256 !== expected.candidateSha256 ||
      !Array.isArray(target.entries) ||
      target.entries.length !== pending.length
    )
      return fail();
    const entries = target.entries.map(
      (rawEntry, index): MigrationInsightEntry => {
        const entry = object(
            rawEntry,
            "coverage,filename,findings,sha256,unknownReasons,verdict,version,workspaceRelativePath",
          ),
          candidate = pending[index]!;
        const source = parseMigrationSourceInput({
          filename: entry.filename,
          sha256: entry.sha256,
          workspaceRelativePath: entry.workspaceRelativePath,
        });
        if (
          ++entriesCount > 1000 ||
          entry.version !== candidate.version ||
          source.filename !== candidate.filename ||
          source.sha256 !== candidate.sha256 ||
          !Array.isArray(entry.findings) ||
          entry.findings.length > 1000 ||
          !Array.isArray(entry.unknownReasons) ||
          entry.unknownReasons.length > 3 ||
          new Set(entry.unknownReasons).size !== entry.unknownReasons.length ||
          entry.unknownReasons.some(
            (reason) =>
              typeof reason !== "string" ||
              !["unsupported_sql", "malformed_sql", "input_limit"].includes(
                reason,
              ),
          )
        )
          return fail();
        const findings = entry.findings.map(
          (rawFinding): MigrationInsightFinding => {
            const finding = object(
              rawFinding,
              "column,line,rule,severity,suggestion,summary",
            );
            if (
              typeof finding.rule !== "string" ||
              !Object.hasOwn(MIGRATION_INSIGHT_RULES, finding.rule)
            )
              return fail();
            const rule = finding.rule as MigrationInsightRule,
              fixed = MIGRATION_INSIGHT_RULES[rule];
            if (
              ++findingsCount > 5000 ||
              finding.summary !== fixed.summary ||
              finding.suggestion !== fixed.suggestion ||
              finding.severity !==
                (["not_null", "new_constraint"].includes(rule)
                  ? "warning"
                  : "danger")
            )
              return fail();
            const line = count(finding.line, 2097153),
              column = count(finding.column, 2097153);
            if (!line || !column) return fail();
            return {
              rule,
              severity: finding.severity as "warning" | "danger",
              line,
              column,
              ...fixed,
            };
          },
        );
        const incomplete = entry.unknownReasons.length > 0;
        if (
          entry.coverage !==
            (incomplete ? "incomplete" : "recognized_lexical_rules") ||
          entry.verdict !== verdict(incomplete ? 1 : 0, findings.length)
        )
          return fail();
        if (incomplete) unknownCount++;
        return {
          version: candidate.version,
          ...source,
          verdict: entry.verdict as Verdict,
          coverage: incomplete ? "incomplete" : "recognized_lexical_rules",
          unknownReasons: entry.unknownReasons as UnknownReason[],
          findings,
        };
      },
    );
    return {
      name: text(target.name, 120),
      provider: expected.provider,
      baselineGenerationId: text(target.baselineGenerationId),
      candidateSha256: digest(target.candidateSha256),
      entries,
    };
  });
  const summary = object(data.summary, "findingCount,unknownCount");
  if (
    entriesCount !== count(data.candidateCount, 1000) ||
    summary.findingCount !== findingsCount ||
    summary.unknownCount !== unknownCount ||
    data.verdict !== verdict(unknownCount, findingsCount)
  )
    return fail();
  return {
    schemaVersion: 1,
    inspectorVersion,
    candidateSha256: digest(data.candidateSha256),
    candidateCount: entriesCount,
    verdict: data.verdict as Verdict,
    summary: { findingCount: findingsCount, unknownCount },
    targets,
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
  };
};

/** Opaque exact-report identity, not an inbound path or execution receipt. */
export const migrationInsightIndex = (
  report: MigrationInsights,
): ReadonlyMap<
  string,
  {
    readonly target: string;
    readonly entry: MigrationInsightEntry;
    readonly finding: MigrationInsightFinding;
  }
> => {
  const binding = createHash("sha256")
    .update(JSON.stringify(report))
    .digest("hex");
  const index = new Map<
    string,
    {
      readonly target: string;
      readonly entry: MigrationInsightEntry;
      readonly finding: MigrationInsightFinding;
    }
  >();
  for (const target of report.targets)
    for (const entry of target.entries)
      for (const [order, finding] of entry.findings.entries()) {
        const id = createHash("sha256")
          .update(
            JSON.stringify([
              binding,
              target.name,
              entry.version,
              entry.sha256,
              order,
              finding,
            ]),
          )
          .digest("hex");
        index.set(id, { target: target.name, entry, finding });
      }
  return index;
};
export const findMigrationInsight = (
  report: MigrationInsights,
  id: string,
): {
  readonly entry: MigrationInsightEntry;
  readonly finding: MigrationInsightFinding;
} | null => {
  if (!/^[a-f0-9]{64}$/u.test(id)) return null;
  return migrationInsightIndex(report).get(id) ?? null;
};
