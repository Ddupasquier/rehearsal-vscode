import type { ProjectSnapshot } from "./project_snapshot.js";

export interface VerificationReport {
  readonly schemaVersion: 1;
  readonly generatedAt: string;
  readonly project: string;
  readonly rehearsalVersion: string | null;
  readonly availability: ProjectSnapshot["availability"];
  readonly readiness: ProjectSnapshot["readiness"] | null;
  readonly baseline: ProjectSnapshot["baseline"] | null;
  readonly candidates: ProjectSnapshot["candidates"] | null;
  readonly runtime: ProjectSnapshot["runtime"] | null;
  readonly environment: ProjectSnapshot["environment"] | null;
  readonly lifecycle: ProjectSnapshot["lifecycle"] | null;
  readonly checks: {
    readonly completed: readonly string[];
    readonly planned: readonly string[];
    readonly manual: readonly string[];
  };
  readonly limitations: readonly string[];
}

export const buildVerificationReport = (
  snapshot: ProjectSnapshot,
  now = new Date(),
): VerificationReport => ({
  schemaVersion: 1,
  generatedAt: now.toISOString(),
  project: snapshot.workspaceName,
  rehearsalVersion: snapshot.version ?? null,
  availability: snapshot.availability,
  readiness: snapshot.readiness ?? null,
  baseline: snapshot.baseline ?? null,
  candidates: snapshot.candidates ?? null,
  runtime: snapshot.runtime ?? null,
  environment: snapshot.environment ?? null,
  lifecycle: snapshot.lifecycle ?? null,
  checks: {
    completed:
      snapshot.readiness?.checks
        .filter(({ status }) => status === "pass")
        .map(({ label }) => label) ?? [],
    planned: [
      ...(snapshot.readiness?.checks
        .filter(({ status }) => status !== "pass")
        .map(({ label }) => label) ?? []),
      ...((snapshot.candidates?.count ?? 0) > 0
        ? ["Review and rehearse the exact candidate migration digest."]
        : []),
    ],
    manual: [
      "Hosted-provider consent and account selection require separate human observation.",
      "Application behavior outside configured proofs is not asserted by this report.",
    ],
  },
  limitations: [
    "This report contains project-local aggregate evidence only.",
    "It does not include credentials, database rows, environment values, or production URLs.",
    "Manual authentication and application checks are included only when separately observed and recorded.",
  ],
});

const count = (value: number | undefined): string =>
  value === undefined ? "Unavailable" : value.toLocaleString("en-US");

export const renderVerificationReportMarkdown = (
  report: VerificationReport,
): string => `# Rehearsal verification report

- Project: ${report.project}
- Generated: ${report.generatedAt}
- Rehearsal: ${report.rehearsalVersion ?? "Not installed"}
- Project state: ${report.availability}
- Readiness: ${report.readiness?.state ?? "Unavailable"}
- Baseline: ${report.baseline?.generationId ?? "Unavailable"}
- Baseline rows: ${count(report.baseline?.rowCount)}
- Baseline tables: ${count(report.baseline?.tableCount)}
- Candidate migrations: ${count(report.candidates?.count)}
- Candidate digest: ${report.candidates?.digest ?? "Unavailable"}
- Runtime: ${report.runtime?.state ?? "Unavailable"}

## Targets

${
  report.runtime?.targets.length
    ? report.runtime.targets
        .map(
          (target) =>
            `- ${target.name}: ${target.runtimeTarget}, ${target.state}, ${target.verifiedRuntimeAvailable === true ? "verified runtime available" : target.verifiedRuntimeAvailable === false ? "not created" : "runtime receipt unknown"}`,
        )
        .join("\n")
    : "No target evidence is available."
}

## Completed checks

${report.checks.completed.length ? report.checks.completed.map((value) => `- ${value}`).join("\n") : "No completed readiness checks were reported."}

## Planned checks

${report.checks.planned.length ? report.checks.planned.map((value) => `- ${value}`).join("\n") : "No planned checks were reported."}

## Manual checks

${report.checks.manual.map((value) => `- ${value}`).join("\n")}

## Limitations

${report.limitations.map((value) => `- ${value}`).join("\n")}
`;

export const renderVerificationReportJson = (
  report: VerificationReport,
): string => `${JSON.stringify(report, null, 2)}\n`;
