import {
  describeMigrationCutoff,
  parseDrizzleMigrationIdentity,
} from "./native_migration_contract.js";
import type { ProjectSnapshot } from "./project_snapshot.js";

/** A default leaf inside the chosen workspace, never a user-supplied path. */
export const verificationReportFilename = (
  projectName: string,
  format: "markdown" | "json",
): string => {
  const stem =
    projectName
      .replace(/[^A-Za-z0-9_-]/gu, "-")
      .replace(/^-+|-+$/gu, "")
      .slice(0, 80) || "project";
  return `${stem}-rehearsal-report.${format === "markdown" ? "md" : "json"}`;
};
import {
  COMPARISON_LIMITS,
  comparisonSubjects,
  compareEnvironmentEvidence,
  type EnvironmentComparison,
} from "./environment_comparison.js";

const MAX_READINESS_CHECKS = 1000;

const safeLabel = (value: unknown, fallback: string): string =>
  typeof value === "string" && /^[\p{L}\p{N} ._()—-]{1,120}$/u.test(value)
    ? value
    : fallback;
const hash = (value: unknown): string | null =>
  typeof value === "string" && /^[a-f0-9]{64}$/u.test(value) ? value : null;
const count = (value: unknown): number | null =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= 0
    ? value
    : null;
const version = (value: unknown): string | null =>
  typeof value === "string" &&
  /^\d+\.\d+\.\d+(?:-[A-Za-z0-9.-]+)?$/u.test(value)
    ? value
    : null;
const timestamp = (value: unknown): string | null =>
  typeof value === "string" &&
  /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,3})?Z$/u.test(value) &&
  Number.isFinite(Date.parse(value))
    ? value
    : null;

/** Build an explicit export allowlist. Never serialize snapshots or arbitrary CLI detail. */
export const buildVerificationReport = (
  snapshot: ProjectSnapshot,
  now = new Date(),
  options: {
    readonly extensionVersion?: string;
    readonly comparison?: { readonly leftId: string; readonly rightId: string };
  } = {},
) => {
  const subjects = comparisonSubjects(snapshot);
  const left = subjects.find(
    (subject) => subject.id === options.comparison?.leftId,
  );
  const right = subjects.find(
    (subject) => subject.id === options.comparison?.rightId,
  );
  const comparison: EnvironmentComparison | null =
    left && right ? compareEnvironmentEvidence(left, right) : null;
  const checks = (snapshot.readiness?.checks ?? [])
    .slice(0, MAX_READINESS_CHECKS)
    .map((check) => ({
      id:
        typeof check.id === "string" &&
        /^[a-z][a-z0-9:_-]{0,120}$/u.test(check.id)
          ? check.id
          : "redacted-check",
      status: ["pass", "fail", "warn"].includes(check.status)
        ? check.status
        : "warn",
    }));
  const detailLimitations = [
    {
      label: "Readiness detail",
      unit: "check",
      length: snapshot.readiness?.checks.length ?? 0,
      limit: MAX_READINESS_CHECKS,
    },
    {
      label: "Runtime and comparison detail",
      unit: "target",
      length: snapshot.runtime?.targets.length ?? 0,
      limit: COMPARISON_LIMITS.runtimeTargets,
    },
    {
      label: "Baseline comparison detail",
      unit: "generation",
      length: snapshot.baseline?.generations?.length ?? 0,
      limit: COMPARISON_LIMITS.baselineGenerations,
    },
  ]
    .filter(({ length, limit }) => length > limit)
    .map(({ label, unit, length, limit }) => {
      const omitted = length - limit;
      return `${label} is limited to the first ${limit.toLocaleString("en-US")} ${unit}s; ${omitted.toLocaleString("en-US")} additional ${unit}${omitted === 1 ? "" : "s"} omitted.`;
    });
  const scope = snapshot.baseline?.review;
  return {
    schemaVersion: 1 as const,
    generatedAt: now.toISOString(),
    inspectedAt: timestamp(snapshot.inspectedAt),
    project: safeLabel(snapshot.workspaceName, "Project"),
    versions: {
      core: version(snapshot.version),
      extension: version(options.extensionVersion),
    },
    rehearsalVersion: version(snapshot.version),
    availability: snapshot.availability,
    readiness: snapshot.readiness
      ? {
          state: snapshot.readiness.state,
          passed: count(snapshot.readiness.passed),
          failed: count(snapshot.readiness.failed),
          checks,
        }
      : null,
    baseline: snapshot.baseline
      ? {
          generationId: safeLabel(
            snapshot.baseline.generationId,
            "Unavailable",
          ),
          createdAt: timestamp(snapshot.baseline.createdAt),
          formatVersion: snapshot.baseline.formatVersion ?? null,
          rowCount: count(snapshot.baseline.rowCount),
          tableCount: count(snapshot.baseline.tableCount),
          migrationCount: count(snapshot.baseline.migrationCount),
          migrationCutoff: (() => {
            const cutoff = snapshot.baseline.migrationCutoff;
            if (typeof cutoff === "string")
              return /^\d{14}$/u.test(cutoff) ? cutoff : null;
            try {
              return describeMigrationCutoff(
                parseDrizzleMigrationIdentity(cutoff),
              );
            } catch {
              return null;
            }
          })(),
          migrationHistorySha256: hash(
            snapshot.baseline.migrationHistorySha256,
          ),
          policySha256: hash(snapshot.baseline.sanitizationPolicySha256),
          dataSha256: hash(snapshot.baseline.dataSha256),
          integrity:
            snapshot.baseline.verification === "checksums_verified"
              ? "checksums_verified"
              : "unavailable",
          shape: snapshot.baseline.shape
            ? {
                evidenceSha256: hash(snapshot.baseline.shape.evidenceSha256),
                policySha256: hash(snapshot.baseline.shape.policySha256),
                rowBudget: count(snapshot.baseline.shape.maximumRows),
                requiredGoals: snapshot.baseline.shape.distributions.filter(
                  (goal) => goal.required,
                ).length,
                provedGoals: snapshot.baseline.shape.distributions.filter(
                  (goal) => goal.status === "passed",
                ).length,
                suppressedGoals: snapshot.baseline.shape.distributions.filter(
                  (goal) => goal.status === "suppressed",
                ).length,
                outsideToleranceGoals:
                  snapshot.baseline.shape.distributions.filter(
                    (goal) => goal.status === "failed",
                  ).length,
                relationshipChecks:
                  snapshot.baseline.shape.relationships.length,
              }
            : null,
          scope: scope
            ? {
                includedTableCount: scope.tables.filter(
                  (table) => table.included,
                ).length,
                excludedTableCount: scope.tables.filter(
                  (table) => !table.included,
                ).length,
                schemaCount: new Set(scope.tables.map((table) => table.schema))
                  .size,
                relationshipCount: scope.relationships.declaredCount,
                excludedReferenceCount:
                  scope.relationships.excludedReferenceCount,
                storageAssetCount: scope.storage.assetCount,
                storageBytes: scope.storage.bytes,
                policyVersion: scope.policy.version,
              }
            : null,
        }
      : null,
    candidates: snapshot.candidates
      ? {
          count: count(snapshot.candidates.count),
          digest: hash(snapshot.candidates.digest),
        }
      : null,
    runtime: snapshot.runtime
      ? {
          state: snapshot.runtime.state,
          targets: snapshot.runtime.targets
            .slice(0, COMPARISON_LIMITS.runtimeTargets)
            .map((target) => ({
              name: safeLabel(target.name, "target"),
              runtimeTarget: target.runtimeTarget,
              state: target.state,
              verifiedRuntimeAvailable: target.verifiedRuntimeAvailable,
              baselineGenerationId: safeLabel(
                target.baselineGenerationId,
                "Unavailable",
              ),
              candidateSha256: hash(target.candidateSha256),
            })),
        }
      : null,
    lifecycle: snapshot.lifecycle
      ? {
          run: snapshot.lifecycle.run,
          open: snapshot.lifecycle.open,
          dataOnStop: "preserved",
        }
      : null,
    authentication: snapshot.authenticationReview
      ? {
          target: snapshot.authenticationReview.target,
          providers: snapshot.authenticationReview.providers.map(
            ({ name, enabled, supported }) => ({ name, enabled, supported }),
          ),
          identityAssociation:
            snapshot.authenticationReview.identityAssociation,
          totpEnrollment: snapshot.authenticationReview.mfa.totpEnrollment,
          totpVerification: snapshot.authenticationReview.mfa.totpVerification,
          verification: "configuration-only",
        }
      : null,
    subjects,
    comparison,
    checks: {
      completed: checks
        .filter((check) => check.status === "pass")
        .map(({ id }) =>
          id === "configuration"
            ? "Configuration validated"
            : `${id} readiness check passed`,
        ),
      planned: [
        ...checks
          .filter((check) => check.status !== "pass")
          .map(({ id }) => `${id} readiness check requires attention`),
        ...((snapshot.candidates?.count ?? 0) > 0
          ? ["Review and rehearse the exact candidate migration digest."]
          : []),
      ],
      manual: [
        "Hosted-provider chooser, consent, local callback and fresh sign-in remain unverified unless separately observed.",
        "Identity claim, idempotence, refresh, restart persistence, account blocking, RLS, MFA and reset invalidation require their own recorded runtime proofs.",
        "Application behavior outside configured proofs is not asserted by this report.",
      ],
    },
    limitations: [
      "This is an unsigned, project-local inspection report, not proof that a rehearsal or browser test passed.",
      "It does not include credentials, database rows, environment values, commands, filesystem paths, table/bucket names or production URLs.",
      "Readiness checks establish readiness only; declared relationships and authentication settings do not certify runtime enforcement.",
      "Unknown and legacy evidence is unavailable, not zero, equal or passed.",
      "Manual authentication and application checks are included only when separately observed and recorded.",
      ...detailLimitations,
    ],
  };
};
export type VerificationReport = ReturnType<typeof buildVerificationReport>;

const escaped = (value: string): string =>
  value.replaceAll(/[\\`*_{}\[\]<>|]/gu, (character) => `\\${character}`);
const display = (value: string | number | null | undefined): string =>
  value === null || value === undefined
    ? "Unavailable"
    : typeof value === "number"
      ? value.toLocaleString("en-US")
      : escaped(value);
const bullets = (values: readonly string[], empty: string): string =>
  values.length
    ? values.map((value) => `- ${escaped(value)}`).join("\n")
    : empty;

export const renderVerificationReportMarkdown = (
  report: VerificationReport,
): string => `# Rehearsal verification report

- Project: ${display(report.project)}
- Generated: ${display(report.generatedAt)}
- Inspected: ${display(report.inspectedAt)}
- Rehearsal: ${display(report.versions.core)}
- Extension: ${display(report.versions.extension)}
- Project state: ${display(report.availability)}
- Readiness: ${display(report.readiness?.state)}
- Baseline: ${display(report.baseline?.generationId)}
- Baseline rows: ${display(report.baseline?.rowCount)}
- Baseline tables: ${display(report.baseline?.tableCount)}
- Baseline policy digest: ${display(report.baseline?.policySha256)}
- Migration history digest: ${display(report.baseline?.migrationHistorySha256)}
- Candidate migrations: ${display(report.candidates?.count)}
- Candidate digest: ${display(report.candidates?.digest)}
- Runtime: ${display(report.runtime?.state)}

## Targets

${report.runtime?.targets.length ? report.runtime.targets.map((target) => `- ${display(target.name)}: ${target.runtimeTarget}, ${target.state}, ${target.verifiedRuntimeAvailable === true ? "verified runtime available" : target.verifiedRuntimeAvailable === false ? "not created" : "runtime receipt unknown"}`).join("\n") : "No target evidence is available."}

## Evidence comparison

${report.comparison ? report.comparison.facts.map((fact) => `- ${fact.label}: ${fact.state}; first ${display(fact.left)}, second ${display(fact.right)}`).join("\n") : "No reviewed pair was selected for this export. Available subjects remain in the JSON report."}

## Completed checks

${bullets(report.checks.completed, "No completed readiness checks were reported.")}

## Planned checks

${bullets(report.checks.planned, "No planned checks were reported.")}

## Manual checks

${bullets(report.checks.manual, "No manual checks recorded.")}

## Limitations

${bullets(report.limitations, "No limitations recorded.")}
`;

export const renderVerificationReportJson = (
  report: VerificationReport,
): string => `${JSON.stringify(report, null, 2)}\n`;
