/** Assert exact-artifact native export observations; never infer UI actions. */
const assert = require("node:assert/strict");

const reportKeys = [
  "schemaVersion",
  "generatedAt",
  "inspectedAt",
  "project",
  "versions",
  "rehearsalVersion",
  "availability",
  "readiness",
  "baseline",
  "candidates",
  "runtime",
  "lifecycle",
  "authentication",
  "subjects",
  "comparison",
  "checks",
  "limitations",
];
const iso = /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/u;

function verifyComparisonExport(jsonText, markdownText, expected, owners) {
  assert.equal(typeof jsonText, "string");
  assert.ok(Buffer.byteLength(jsonText, "utf8") <= 256 * 1024);
  assert.equal(typeof owners.compareEnvironmentEvidence, "function");
  assert.equal(typeof owners.renderVerificationReportMarkdown, "function");
  const report = JSON.parse(jsonText);
  assert.deepEqual(Object.keys(report).sort(), [...reportKeys].sort());
  assert.equal(report.schemaVersion, 1);
  assert.equal(report.versions.core, expected.coreVersion);
  assert.equal(report.rehearsalVersion, expected.coreVersion);
  assert.equal(report.versions.extension, expected.extensionVersion);
  assert.ok(iso.test(report.generatedAt));
  assert.ok(iso.test(report.inspectedAt));
  assert.ok(Date.parse(report.generatedAt) >= expected.startedAt);
  assert.ok(Date.parse(report.generatedAt) <= expected.finishedAt);
  assert.equal(report.baseline.generationId, expected.baselineGeneration);
  assert.equal(report.baseline.dataSha256, expected.baselineDataSha256);
  assert.equal(report.baseline.rowCount, 10003);
  assert.equal(report.baseline.tableCount, 3);
  assert.equal(report.candidates.count, 0);
  assert.equal(report.candidates.digest, expected.candidateDigest);
  assert.ok(Array.isArray(report.subjects));
  assert.equal(report.subjects.length, 3);
  const left = report.subjects.find((item) => item.id === expected.leftId);
  const right = report.subjects.find((item) => item.id === expected.rightId);
  assert.ok(left && right && left.id !== right.id);
  assert.equal(left.kind, "target");
  assert.equal(right.kind, "baseline");
  assert.equal(left.provider, "postgresql");
  assert.equal(right.provider, "postgresql");
  assert.equal(left.rowCount, 10003);
  assert.equal(right.rowCount, 3);
  assert.deepEqual(
    report.comparison,
    owners.compareEnvironmentEvidence(left, right),
  );
  assert.equal(report.comparison.facts.length, 14);
  const states = new Set(report.comparison.facts.map((fact) => fact.state));
  for (const state of ["equal", "different", "unavailable"])
    assert.ok(states.has(state));
  assert.equal(states.has("incompatible"), false);
  assert.ok(report.checks.completed.length > 0);
  assert.ok(report.checks.manual.length > 0);
  assert.ok(report.limitations.some((line) => line.includes("unsigned")));
  for (const privateValue of expected.withheld) {
    assert.equal(typeof privateValue, "string");
    assert.ok(privateValue.length >= 8);
    assert.equal(jsonText.includes(privateValue), false);
    if (markdownText !== undefined)
      assert.equal(markdownText.includes(privateValue), false);
  }
  if (markdownText !== undefined) {
    assert.equal(typeof markdownText, "string");
    assert.ok(Buffer.byteLength(markdownText, "utf8") <= 256 * 1024);
    const generated = markdownText.match(
      /^- Generated: (\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z)$/mu,
    )?.[1];
    assert.ok(generated && iso.test(generated));
    assert.ok(Date.parse(generated) >= expected.startedAt);
    assert.ok(Date.parse(generated) <= expected.finishedAt);
    assert.equal(
      markdownText,
      owners.renderVerificationReportMarkdown({
        ...report,
        generatedAt: generated,
      }),
    );
  }
  return {
    factCount: report.comparison.facts.length,
    states: [...states].sort(),
    coreVersion: report.versions.core,
    extensionVersion: report.versions.extension,
    baselineGeneration: report.baseline.generationId,
    candidateDigest: report.candidates.digest,
    manualChecksRemainExplicit: report.checks.manual.length > 0,
    limitationsRemainExplicit: true,
  };
}

module.exports = { verifyComparisonExport };
