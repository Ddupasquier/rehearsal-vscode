/** Consume independent installed metadata; never launch a CLI or write a project. */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { parseConfigurationMetadata } from "../../src/configuration/configuration_contract.js";
import {
  comparisonSubjects,
  compareEnvironmentEvidence,
} from "../../src/runtime/environment_comparison.js";
import type { ProjectSnapshot } from "../../src/workspace/project_snapshot.js";
import { parseBaselineInspectionData } from "../../src/review/review_contract.js";
import {
  buildVerificationReport,
  renderVerificationReportJson,
  renderVerificationReportMarkdown,
} from "../../src/runtime/verification_report.js";
import {
  readOperationActivityReport,
  verifyOperationActivityEvidence,
} from "./verify-operation-activity.js";

const object = (value: unknown): Record<string, unknown> => {
  assert.ok(
    value !== null && typeof value === "object" && !Array.isArray(value),
  );
  return value as Record<string, unknown>;
};

export function verifyEditorReviewEvidence(
  value: unknown,
  expectedSha256: string,
  extensionVersion: string,
) {
  const activity = verifyOperationActivityEvidence(value, expectedSha256);
  assert.match(extensionVersion, /^\d+\.\d+\.\d+(?:-[A-Za-z0-9.-]+)?$/u);
  const section = object(object(value).editorReview);
  assert.equal(section.schemaVersion, 1);
  assert.equal(section.status, "passed");
  assert.ok(Array.isArray(section.checks) && section.checks.length > 0);
  for (const check of section.checks)
    assert.equal(object(check).status, "passed");
  const preserved = object(section.preservation);
  assert.equal(preserved.originalGenerationFilesPreserved, true);
  assert.equal(preserved.reviewedFilesUnchanged, true);
  assert.ok(Array.isArray(section.refusals) && section.refusals.length <= 8);
  const refusals = new Set<string>();
  for (const raw of section.refusals) {
    const refusal = object(raw);
    assert.equal(typeof refusal.scenario, "string");
    assert.ok(Number.isSafeInteger(refusal.exitCode));
    assert.ok(Number(refusal.exitCode) > 0 && Number(refusal.exitCode) <= 255);
    assert.equal(typeof refusal.category, "string");
    assert.equal(typeof refusal.code, "string");
    assert.match(String(refusal.category), /^[a-z_]{1,100}$/u);
    assert.match(String(refusal.code), /^[A-Z0-9_]{1,100}$/u);
    refusals.add(String(refusal.scenario));
  }
  assert.ok(refusals.has("stale-root") && refusals.has("invalid-proposal"));

  const samples = object(section.samples);
  const snapshots = ["root", "nested"].map((kind): ProjectSnapshot => {
    const sample = object(samples[kind]);
    const metadata = parseConfigurationMetadata(sample.configuration);
    assert.equal(
      metadata.path,
      kind === "root"
        ? "rehearsal.config.mjs"
        : "infrastructure/rehearsal/rehearsal.config.mjs",
    );
    assert.equal(metadata.sourceSha256, preserved[`${kind}SourceSha256`]);
    const review = object(sample.proposalReview);
    assert.equal(review.sourceSha256, metadata.sourceSha256);
    assert.equal(review.validation, "complete-config-passed");
    assert.equal(review.writesConfiguration, false);
    assert.equal(review.executesProposedCommands, false);
    const {
      review: _scope,
      shape: _shape,
      ...baseline
    } = parseBaselineInspectionData(sample.baseline);
    return {
      workspaceName: `Independent ${kind} review`,
      workspaceRoot: "/private/never-exported",
      availability: "not_ready",
      version: String(activity.version),
      configurationMetadata: metadata,
      configPath: metadata.path,
      // Baseline evidence does not fabricate doctor readiness or a runtime state.
      baseline,
    };
  });
  const root = snapshots[0]!;
  assert.ok(root.baseline!.generations!.length >= 2);
  const subjects = comparisonSubjects(root);
  const active = subjects.find(
    ({ baselineGenerationId }) =>
      baselineGenerationId === root.baseline!.generationId,
  );
  assert.ok(active);
  const retained = subjects.find(({ id }) => id !== active.id);
  assert.ok(retained);
  const comparison = compareEnvironmentEvidence(active, retained);
  const fact = (key: string) =>
    comparison.facts.find((entry) => entry.key === key)!;
  assert.equal(fact("rowCount").state, "different");
  assert.equal(fact("migrationCutoff").state, "equal");
  for (const key of [
    "provider",
    "runtimeState",
    "configurationSha256",
    "sourceSchemaSha256",
  ])
    assert.equal(fact(key).state, "unavailable");
  const now = new Date("2026-10-16T00:00:00.000Z");
  const options = {
    extensionVersion,
    comparison: { leftId: active.id, rightId: retained.id },
  };
  const report = buildVerificationReport(root, now, options);
  assert.deepEqual(report.comparison, comparison);
  assert.equal(report.readiness, null);
  assert.equal(report.runtime, null);
  assert.deepEqual(report.checks.completed, []);
  const json = renderVerificationReportJson(report);
  const markdown = renderVerificationReportMarkdown(report);
  assert.equal(
    json,
    renderVerificationReportJson(buildVerificationReport(root, now, options)),
  );
  assert.equal(
    markdown,
    renderVerificationReportMarkdown(
      buildVerificationReport(root, now, options),
    ),
  );
  assert.doesNotMatch(
    json + markdown,
    /\/private\/never-exported|SYNTHETIC_ACTIVITY_ROW_NOT_TELEMETRY|unused-command|unused-proof|PRIVATE_EXPORT_CANARY/u,
  );
  assert.equal(report.versions.core, activity.version);
  assert.equal(report.versions.extension, extensionVersion);
  return {
    status: "passed",
    artifactSha256: expectedSha256,
    versions: report.versions,
    configurationPathsAccepted: 2,
    retainedBaselinesCompared: 2,
    configurationRefusals: section.refusals.length,
    deterministicReports: ["json", "markdown"],
    limitations: [
      "Actual installed public baseline and configuration metadata, not a running or freshly verified database.",
      "Baseline format and migration-boundary equality do not prove runtime schema or row equality.",
      "Editor parsing, comparison and report generation only; native dialogs, writing, keyboard, focus and assistive technology require separate checks.",
    ],
  };
}

async function main(): Promise<void> {
  const [path, sha256, ...extra] = process.argv.slice(2);
  assert.ok(path && sha256 && extra.length === 0);
  const manifest = object(
    JSON.parse(
      await readFile(resolve(__dirname, "../../package.json"), "utf8"),
    ),
  );
  assert.equal(typeof manifest.version, "string");
  console.log(
    JSON.stringify(
      verifyEditorReviewEvidence(
        await readOperationActivityReport(path),
        sha256,
        String(manifest.version),
      ),
      null,
      2,
    ),
  );
}

if (require.main === module)
  void main().catch(() => {
    console.error(
      "Editor review evidence was missing, unsafe, mismatched or inconclusive; no project action was performed.",
    );
    process.exitCode = 1;
  });
