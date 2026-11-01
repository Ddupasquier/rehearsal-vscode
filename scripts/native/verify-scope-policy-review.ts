/** Consume saved installed scope/policy evidence; never launch a CLI or write a project. */
import assert from "node:assert/strict";
import {
  parseConfigurationMetadata,
  validateConfigurationFieldValue,
} from "../../src/configuration/configuration_contract.js";
import type { ExplainData } from "../../src/contracts.js";
import {
  parseBaselineInspectionData,
  parseBaselineScopeReview,
  parseReviewTargets,
} from "../../src/review/review_contract.js";
import { renderBaselineScopeReview } from "../../src/review/review_view.js";
import {
  readOperationActivityReport,
  verifyOperationActivityEvidence,
} from "./verify-operation-activity.js";

const failure = () =>
  new Error(
    "Scope/policy evidence was missing, unsafe, mismatched or inconclusive; no project action was performed.",
  );
function requireEvidence(value: unknown): asserts value {
  if (!value) throw failure();
}
const object = (value: unknown): Record<string, unknown> => {
  requireEvidence(value && typeof value === "object" && !Array.isArray(value));
  requireEvidence(
    Object.getPrototypeOf(value) === Object.prototype ||
      Object.getPrototypeOf(value) === null,
  );
  return value as Record<string, unknown>;
};
type ArtifactIdentity = { version: string; sha256: string };
const publishedRc7 = (value: ArtifactIdentity) => {
  const artifact = object(value);
  requireEvidence(
    Object.hasOwn(artifact, "version") &&
      Object.hasOwn(artifact, "sha256") &&
      typeof artifact.version === "string" &&
      artifact.version.length <= 64 &&
      artifact.version.trim() === artifact.version &&
      /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/u.test(
        artifact.version,
      ) &&
      typeof artifact.sha256 === "string" &&
      /^[a-f0-9]{64}$/u.test(artifact.sha256),
  );
  return (
    artifact.version === "0.1.0-rc.7" &&
    artifact.sha256 ===
      "e2bf8d40456ebf7b8b1b2526e5d774f45f8d53ee25358cd62f5f8b65bf5c556b"
  );
};
const checkNames = [
  "local-file provider scope and Storage aggregates",
  "bounded larger baseline and retained immutable generation",
  "public resource policy proposals remain non-writing",
  "invalid stale foreign and manual-only policy proposals refuse",
  "protected cleanup empty input and policy drift preserve baseline",
  "read-only repeat and reviewed source preservation",
];
const invalidPolicies = [
  ["idle-below-minimum", "lifecycle.openIdleTimeoutSeconds", 29],
  ["retention-zero", "cleanup.retainBaselineGenerations", 0],
  ["disk-over-percent", "containerRuntime.diskWarningPercent", 101],
  ["environment-count-over-bound", "resources.retainedEnvironmentCount", 1001],
  ["quota-zero", "resources.maximumBytes", 0],
  ["automatic-delete-schedule", "resources.cleanupSchedule", "daily-delete"],
  ["manual-runtime-identity", "runtime.projectId", "other-project"],
  ["manual-source-scope", "preparation.sourcePolicy", "other.json"],
  ["prototype-path", "__proto__.polluted", true],
  ["constructor-prototype-path", "constructor.prototype.polluted", true],
] as const;
// Corrected tuples; only exact immutable rc.7 bytes inherit the legacy exceptions.
const refusalOutcomes = [
  ["idle-below-minimum", 2, "configuration_invalid"],
  ["retention-zero", 2, "configuration_invalid"],
  ["disk-over-percent", 2, "configuration_invalid"],
  ["environment-count-over-bound", 2, "configuration_invalid"],
  ["quota-zero", 2, "configuration_invalid"],
  ["automatic-delete-schedule", 2, "configuration_invalid"],
  ["manual-runtime-identity", 2, "configuration_invalid"],
  ["manual-source-scope", 2, "configuration_invalid"],
  ["prototype-path", 2, "configuration_invalid"],
  ["constructor-prototype-path", 2, "configuration_invalid"],
  ["stale-source", 2, "configuration_invalid"],
  ["foreign-source-fingerprint", 2, "configuration_invalid"],
  ["protected-cleanup-preview", 2, "configuration_invalid"],
  ["protected-cleanup-write", 2, "configuration_invalid"],
  ["empty-baseline-input", 4, "baseline_invalid"],
  ["stale-policy", 5, "baseline_checksum_mismatch"],
] as const;
const expectedChanges = [
  [
    "bounded-resource-policies",
    [
      ["lifecycle.open", "stop-on-application-exit"],
      ["lifecycle.openIdleTimeoutSeconds", 30],
      ["cleanup.retainBaselineGenerations", 1],
      ["containerRuntime.diskWarningPercent", 1],
      ["containerRuntime.minimumFreeBytes", 1],
      ["resources.staleAfterSeconds", 1],
      ["resources.retainedEnvironmentCount", 1000],
      ["resources.maximumBytes", 1],
      ["resources.cleanupSchedule", "weekly-preview"],
      ["runtime.protected", true],
    ],
  ],
  [
    "disabled-explicit-policies",
    [
      ["lifecycle.openIdleTimeoutSeconds", null],
      ["resources.staleAfterSeconds", null],
      ["resources.maximumBytes", null],
      ["resources.cleanupSchedule", "manual"],
    ],
  ],
] as const;

/** Production parsing/rendering of a fixed synthetic evidence section, not a runtime check. */
export function verifyScopePolicyReviewSamples(
  value: unknown,
  artifact: ArtifactIdentity,
) {
  try {
    const legacy = publishedRc7(artifact);
    const encoded = JSON.stringify(value);
    requireEvidence(
      typeof encoded === "string" && Buffer.byteLength(encoded) <= 128 * 1024,
    );
    requireEvidence(
      !/SYNTHETIC_SCOPE_|hidden-object-name|source-not-readable\.json|postgres(?:ql)?:\/\/|sb_secret_|Bearer |"objectPath"|"recipe"|"rows"|\/Users\/|\/Volumes\/|\/private\//u.test(
        encoded,
      ),
    );
    const section = object(value);
    requireEvidence(section.schemaVersion === 1 && section.status === "passed");
    assert.deepEqual(section.infrastructure, {
      mode: "deny-and-audit",
      toolCalls: 0,
    });
    requireEvidence(
      Array.isArray(section.checks) &&
        section.checks.length === checkNames.length,
    );
    const checks = section.checks.map((raw) => {
      const check = object(raw);
      requireEvidence(
        check.status === "passed" && typeof check.name === "string",
      );
      return check.name;
    });
    assert.deepEqual(checks, checkNames);
    const preservation = object(section.preservation);
    requireEvidence(
      preservation.reviewedFilesUnchanged === true &&
        preservation.baselineFilesUnchanged === true,
    );
    requireEvidence(
      Array.isArray(preservation.sourceFingerprints) &&
        preservation.sourceFingerprints.length === 2,
    );
    const fingerprints = new Map(
      preservation.sourceFingerprints.map((raw) => {
        const item = object(raw);
        requireEvidence(
          typeof item.sha256 === "string" &&
            /^[a-f0-9]{64}$/u.test(item.sha256),
        );
        return [item.provider, item.sha256] as const;
      }),
    );
    assert.deepEqual([...fingerprints.keys()], ["postgresql", "supabase"]);
    requireEvidence(
      fingerprints.get("postgresql") !== fingerprints.get("supabase"),
    );
    requireEvidence(
      Array.isArray(section.refusals) &&
        section.refusals.length === refusalOutcomes.length,
    );
    for (const [index, raw] of section.refusals.entries()) {
      const refusal = object(raw),
        [name, correctedExit, correctedCategory] = refusalOutcomes[index]!;
      const historicalInternal =
        legacy &&
        [
          "manual-runtime-identity",
          "manual-source-scope",
          "prototype-path",
          "constructor-prototype-path",
        ].includes(name);
      const [exitCode, category]: readonly [number, string] =
        legacy && name === "retention-zero"
          ? [4, "baseline_invalid"]
          : historicalInternal
            ? [10, "internal_failure"]
            : [correctedExit, correctedCategory];
      assert.deepEqual(refusal, {
        scenario: name,
        exitCode,
        category,
        code: category.toUpperCase(),
      });
    }
    const samples = object(section.samples);
    assert.deepEqual(
      Object.keys(samples).sort(),
      ["postgresql", "postgresqlLarge", "resourcePolicies", "supabase"].sort(),
    );
    const baselines = new Map<
      string,
      ReturnType<typeof parseBaselineInspectionData>
    >();
    for (const [name, provider, publicRows, appRows, generations] of [
      ["postgresql", "postgresql", 2, 1, 1],
      ["postgresqlLarge", "postgresql", 2048, 3, 2],
      ["supabase", "supabase", 2, 1, 1],
    ] as const) {
      const rows = publicRows + appRows;
      const sample = object(samples[name]),
        explainSample = object(sample.explain);
      const environment = object(explainSample.environment);
      requireEvidence(
        environment.target === provider &&
          environment.kind === `isolated_local_${provider}`,
      );
      const baseline = parseBaselineInspectionData(sample.baseline, provider);
      const review = parseBaselineScopeReview(baseline.review);
      assert.deepEqual(
        parseBaselineScopeReview(explainSample.baselineReview),
        review,
      );
      requireEvidence(
        baseline.rowCount === rows &&
          baseline.tableCount === 3 &&
          baseline.migrationCount === 1,
      );
      requireEvidence(
        baseline.sourceSchemaSha256 === null &&
          baseline.generations?.length === generations,
      );
      const explain: ExplainData = {
        config: {
          schemaVersion: 1,
          path: "rehearsal.config.mjs",
          project: "Installed scope evidence",
        },
        environment: { target: provider, applicationUrl: "" },
        baseline,
        baselineReview: explainSample.baselineReview,
      };
      const [target] = parseReviewTargets(explain);
      requireEvidence(
        target?.provider === provider &&
          target.baseline?.generationId === baseline.generationId,
      );
      requireEvidence(
        target.baseline.sourceSchemaSha256 === null &&
          target.baseline.rowCount === rows,
      );
      requireEvidence(
        review.tables.length === 4 &&
          review.tables.filter(({ included }) => included).length === 3,
      );
      assert.deepEqual(
        review.tables.map(({ schema, name, included, rowCount }) => [
          schema,
          name,
          included,
          rowCount,
        ]),
        [
          ["public", "widgets", true, publicRows],
          ["app", "widgets", true, appRows],
          ["public", "empty_table", true, 0],
          ["private", "excluded", false, 0],
        ],
      );
      assert.deepEqual(review.decisions, {
        sourcePermission: "configured-not-contacted",
        identityHandling: "no-association-policy",
        replacement: "separate-core-confirmation",
      });
      requireEvidence(
        review.relationships.declaredCount === 1 &&
          review.relationships.excludedReferenceCount === 1,
      );
      requireEvidence(
        review.storage.assetCount === (provider === "supabase" ? 1 : 0),
      );
      const markup = renderBaselineScopeReview({
        workspaceName: "Installed scope review",
        workspaceRoot: "/private/never-rendered",
        availability: "not_ready",
        baseline: { ...baseline, review, shape: null },
      });
      for (const text of [
        "public.widgets",
        "app.widgets",
        "public.empty_table",
        "private.excluded",
        "3 included tables",
        "1 excluded tables",
        "3 schemas",
        "0 baseline rows",
        "references point to excluded tables",
        "did not contact or authorize a source",
        "No copied-account association policy",
        "separate core confirmation",
      ])
        requireEvidence(markup.includes(text));
      requireEvidence(
        markup.includes(provider) &&
          markup.includes(`${review.storage.bytes} bytes`),
      );
      requireEvidence(!markup.includes("/private/never-rendered"));
      if (provider === "supabase")
        requireEvidence(
          markup.includes("scope-assets") && review.storage.bytes > 0,
        );
      baselines.set(name, baseline);
    }
    const original = baselines.get("postgresql")!,
      larger = baselines.get("postgresqlLarge")!;
    requireEvidence(
      original.generationId !== larger.generationId &&
        larger.generations?.some(
          (item) =>
            item.generationId === original.generationId &&
            !item.active &&
            item.rowCount === original.rowCount,
        ),
    );
    const resourcePolicies = object(samples.resourcePolicies);
    const metadata = parseConfigurationMetadata(resourcePolicies.configuration);
    requireEvidence(
      metadata.path === "rehearsal.config.mjs" &&
        metadata.sourceSha256 === fingerprints.get("postgresql"),
    );
    requireEvidence(
      Array.isArray(resourcePolicies.proposalReviews) &&
        resourcePolicies.proposalReviews.length === 2,
    );
    const fields = new Map(metadata.fields.map((field) => [field.path, field]));
    for (const [index, [name, changes]] of expectedChanges.entries()) {
      const sample = object(resourcePolicies.proposalReviews[index]),
        review = object(sample.review);
      requireEvidence(
        sample.name === name &&
          review.schemaVersion === 1 &&
          review.path === metadata.path &&
          review.sourceSha256 === metadata.sourceSha256,
      );
      requireEvidence(
        review.validation === "complete-config-passed" &&
          review.writesConfiguration === false &&
          review.executesProposedCommands === false,
      );
      requireEvidence(
        Array.isArray(review.changes) &&
          review.changes.length === changes.length,
      );
      for (const [changeIndex, [path, expected]] of changes.entries()) {
        const change = object(review.changes[changeIndex]),
          field = fields.get(path);
        requireEvidence(field && change.path === path);
        assert.deepEqual(change.previous, field.value);
        assert.deepEqual(
          validateConfigurationFieldValue(path, field.kind, change.proposed),
          expected,
        );
      }
    }
    for (const [, path, value] of invalidPolicies)
      assert.throws(() =>
        validateConfigurationFieldValue(
          path,
          fields.get(path)?.kind ?? "text",
          value,
        ),
      );
    return {
      status: "passed",
      baselineSamplesAccepted: 3,
      providersReviewed: ["postgresql", "supabase"],
      resourceProposalReviewsAccepted: 2,
      refusalsAccepted: refusalOutcomes.length,
      limitations: [
        "Saved exact-installed public metadata and read-only proposals; no source, SQL, running database, Storage service or provider login is verified here.",
        "The 2,051-row sample proves bounded aggregate review, not large-database performance or restore fidelity. Missing source-schema evidence remains unavailable.",
        "Protected cleanup refusal is not successful resource deletion or VM shutdown. Persistent baseline/source-file preservation is reported separately by Lab.",
        legacy
          ? "Only the exact published rc.7 version and artifact checksum retain observed taxonomy defects: zero retention is baseline_invalid; manual-only and prototype paths are internal_failure. This is characterization, not endorsement."
          : "All rejected configuration proposals require configuration_invalid / CONFIGURATION_INVALID / exit 2; another artifact cannot inherit rc.7's diagnostic defects from its version alone.",
        "Sixteen exact refusal controls are required. Historical fourteen-control reports do not establish the added prototype-path or complete proposal-sequence preservation coverage.",
        "Production editor parsing, field validation and HTML generation only; native save, keyboard, visual and screen-reader acceptance remain separate.",
      ],
    };
  } catch {
    throw failure();
  }
}

export function verifyScopePolicyReviewEvidence(
  value: unknown,
  expectedSha256: string,
) {
  try {
    const activity = verifyOperationActivityEvidence(value, expectedSha256);
    return {
      ...verifyScopePolicyReviewSamples(object(value).scopePolicyReview, {
        version: String(activity.version),
        sha256: activity.artifactSha256,
      }),
      artifactSha256: expectedSha256,
      version: activity.version,
    };
  } catch {
    throw failure();
  }
}

async function main(): Promise<void> {
  const [path, sha256, ...extra] = process.argv.slice(2);
  requireEvidence(path && sha256 && extra.length === 0);
  console.log(
    JSON.stringify(
      verifyScopePolicyReviewEvidence(
        await readOperationActivityReport(path),
        sha256,
      ),
      null,
      2,
    ),
  );
}
if (require.main === module)
  void main().catch(() => {
    console.error(failure().message);
    process.exitCode = 1;
  });
