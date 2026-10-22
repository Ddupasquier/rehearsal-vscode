import { describe, expect, it } from "vitest";
import { compareEnvironmentEvidence } from "../src/environment_comparison.js";
import {
  buildVerificationReport,
  renderVerificationReportJson,
  renderVerificationReportMarkdown,
} from "../src/verification_report.js";
import type { ProjectSnapshot } from "../src/project_snapshot.js";

const { verifyComparisonExport } =
  require("../scripts/native-comparison-evidence.cjs") as {
    verifyComparisonExport(
      json: string,
      markdown: string | undefined,
      expected: Record<string, unknown>,
      owners: Record<string, unknown>,
    ): Record<string, unknown>;
  };
const now = "2026-10-22T14:00:01.000Z";
const hash = "a".repeat(64);
const owners = { compareEnvironmentEvidence, renderVerificationReportMarkdown };
const expected = {
  coreVersion: "1.0.2",
  extensionVersion: "0.1.23",
  baselineGeneration: "active-generation",
  baselineDataSha256: hash,
  candidateDigest: hash,
  leftId: "target:primary",
  rightId: "baseline:retained-generation",
  startedAt: Date.parse("2026-10-22T14:00:00.000Z"),
  finishedAt: Date.parse("2026-10-22T14:00:03.000Z"),
  withheld: ["/private/native-report", "PRIVATE_CANARY_SOURCE"],
};

function fixture() {
  const generation = (id: string, rows: number, active: boolean) => ({
    generationId: id,
    createdAt: now,
    active,
    formatVersion: 2 as const,
    rowCount: rows,
    tableCount: 3,
    migrationCount: 1,
    migrationCutoff: "20261004000100",
    storageAssetCount: 0,
  });
  const baseline = {
    ...generation("active-generation", 10003, true),
    verification: "checksums_verified" as const,
    dataSha256: hash,
    migrationHistorySha256: hash,
    sanitizationPolicySha256: hash,
    storageAssetCount: 0,
    storageBytes: 0,
    generations: [
      generation("active-generation", 10003, true),
      generation("retained-generation", 3, false),
    ],
  };
  const snapshot: ProjectSnapshot = {
    workspaceName: "Native report fixture",
    workspaceRoot: "/private/native-report",
    availability: "ready",
    version: "1.0.2",
    inspectedAt: now,
    baseline,
    reviewTargets: [
      {
        name: "primary",
        provider: "postgresql",
        configurationSha256: null,
        baseline,
      },
    ],
    candidates: { count: 0, digest: hash, files: [], targets: [] },
    readiness: {
      state: "READY",
      passed: 1,
      failed: 0,
      checks: [
        {
          id: "configuration",
          label: "ready",
          status: "pass",
          detail: "PRIVATE_CANARY_SOURCE",
        },
      ],
    },
    runtime: {
      state: "running",
      targets: [
        {
          name: "primary",
          runtimeTarget: "postgresql",
          state: "running",
          reason: null,
          verifiedRuntimeAvailable: true,
          baselineGenerationId: baseline.generationId,
          candidateSha256: hash,
          endpoint: null,
        },
      ],
    },
  };
  return buildVerificationReport(snapshot, new Date(now), {
    extensionVersion: "0.1.23",
    comparison: { leftId: expected.leftId, rightId: expected.rightId },
  });
}

describe("native comparison/export artifact evidence", () => {
  it("verifies actual production JSON and Markdown while keeping UI acknowledgement outside the result", () => {
    const report = fixture();
    const result = verifyComparisonExport(
      renderVerificationReportJson(report),
      renderVerificationReportMarkdown(report),
      expected,
      owners,
    );
    expect(result).toMatchObject({
      factCount: 14,
      states: ["different", "equal", "unavailable"],
      coreVersion: "1.0.2",
      extensionVersion: "0.1.23",
      manualChecksRemainExplicit: true,
    });
    expect(result).not.toHaveProperty("rendered");
    expect(result).not.toHaveProperty("dialogObserved");
  });
  it("allows independently timed native saves without inventing a new inspection", () => {
    const report = fixture();
    expect(() =>
      verifyComparisonExport(
        renderVerificationReportJson(report),
        renderVerificationReportMarkdown({
          ...report,
          generatedAt: "2026-10-22T14:00:02.000Z",
        }),
        expected,
        owners,
      ),
    ).not.toThrow();
  });
  it.each([
    "version",
    "baseline",
    "candidate",
    "pair",
    "state",
    "row-count",
    "private-path",
    "extra-property",
    "outside-time",
    "manual-checks",
  ])("refuses altered %s export evidence", (kind) => {
    const report = JSON.parse(JSON.stringify(fixture()));
    if (kind === "version") report.versions.extension = "0.1.22";
    if (kind === "baseline") report.baseline!.dataSha256 = "b".repeat(64);
    if (kind === "candidate") report.candidates!.digest = "b".repeat(64);
    if (kind === "pair") report.comparison!.rightId = report.comparison!.leftId;
    if (kind === "state") report.comparison!.facts[0]!.state = "different";
    if (kind === "row-count") report.subjects[0]!.rowCount = 42;
    if (kind === "private-path") report.project = "/private/native-report";
    if (kind === "extra-property")
      Object.assign(report, { privateData: "PRIVATE_CANARY_SOURCE" });
    if (kind === "outside-time")
      report.generatedAt = "2026-10-22T14:00:04.000Z";
    if (kind === "manual-checks") report.checks.manual = [];
    expect(() =>
      verifyComparisonExport(
        JSON.stringify(report),
        undefined,
        expected,
        owners,
      ),
    ).toThrow();
  });
  it("refuses arbitrary or mismatched Markdown, missing facts and oversized JSON", () => {
    const report = fixture();
    expect(() =>
      verifyComparisonExport(
        JSON.stringify(report),
        "PRIVATE_CANARY_SOURCE",
        expected,
        owners,
      ),
    ).toThrow();
    expect(() =>
      verifyComparisonExport(
        JSON.stringify(report),
        renderVerificationReportMarkdown({
          ...report,
          project: "Another project",
        }),
        expected,
        owners,
      ),
    ).toThrow();
    report.comparison!.facts.pop();
    expect(() =>
      verifyComparisonExport(
        JSON.stringify(report),
        undefined,
        expected,
        owners,
      ),
    ).toThrow();
    expect(() =>
      verifyComparisonExport(
        " ".repeat(256 * 1024 + 1),
        undefined,
        expected,
        owners,
      ),
    ).toThrow();
  });
});
