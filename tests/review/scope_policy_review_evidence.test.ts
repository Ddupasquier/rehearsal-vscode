import { describe, expect, it } from "vitest";
import {
  verifyScopePolicyReviewEvidence,
  verifyScopePolicyReviewSamples as verifySamples,
} from "../../scripts/native/verify-scope-policy-review.js";

const digest = (character: string) => character.repeat(64);
const publishedRc7 = {
  version: "0.1.0-rc.7",
  sha256: "e2bf8d40456ebf7b8b1b2526e5d774f45f8d53ee25358cd62f5f8b65bf5c556b",
};
const verifyScopePolicyReviewSamples = (
  value: unknown,
  artifact = publishedRc7,
) => verifySamples(value, artifact);
function fixture(artifact = publishedRc7) {
  const legacy =
    artifact.version === publishedRc7.version &&
    artifact.sha256 === publishedRc7.sha256;
  const baseline = (provider: "postgresql" | "supabase", large = false) => {
    const publicRows = large ? 2048 : 2,
      appRows = large ? 3 : 1;
    const generation = (active: boolean) => ({
      generationId: `${provider}-${active && large ? "second" : "first"}`,
      createdAt: "2026-10-16T00:00:00.000Z",
      active,
      formatVersion: 2,
      rowCount: active ? publicRows + appRows : 3,
      tableCount: 3,
      migrationCount: 1,
      migrationCutoff: "20261001000000",
      storageAssetCount: provider === "supabase" ? 1 : 0,
    });
    const table = (
      schema: string,
      name: string,
      rows: number,
      included: boolean,
      keep: number,
      replace: number,
      exclude = 0,
      relationships = 0,
    ) => ({
      schema,
      name,
      included,
      rowCount: rows,
      columnCount: keep + replace + exclude,
      relationshipCount: relationships,
      identityColumnCount: 0,
      transformations: {
        KEEP: keep,
        PSEUDONYMIZE: 0,
        REPLACE: replace,
        EXCLUDE: exclude,
        DERIVE: 0,
      },
    });
    const review = {
      schemaVersion: 1,
      provider,
      policy: { version: 1, state: "baseline-bound", sha256: digest("b") },
      tables: [
        table("public", "widgets", publicRows, true, 2, 1, 0, 1),
        table("app", "widgets", appRows, true, 1, 1),
        table("public", "empty_table", 0, true, 1, 0),
        table("private", "excluded", 0, false, 0, 0, 1),
      ],
      relationships: {
        declaredCount: 1,
        excludedReferenceCount: 1,
        verification: "declared-not-runtime-verified",
      },
      storage: {
        assetCount: provider === "supabase" ? 1 : 0,
        bytes: provider === "supabase" ? 34 : 0,
        buckets:
          provider === "supabase"
            ? [{ name: "scope-assets", assetCount: 1, bytes: 34 }]
            : [],
      },
      decisions: {
        sourcePermission: "configured-not-contacted",
        identityHandling: "no-association-policy",
        replacement: "separate-core-confirmation",
      },
      privacy: {
        rowValuesIncluded: false,
        credentialsIncluded: false,
        sourceContacted: false,
      },
    };
    return {
      baseline: {
        formatVersion: 2,
        generationId: generation(true).generationId,
        createdAt: "2026-10-16T00:00:00.000Z",
        migrationCutoff: "20261001000000",
        migrationHistorySha256: digest("c"),
        sourceSchemaSha256: null,
        sanitizationPolicySha256: digest("b"),
        dataSha256: digest(large ? "e" : "d"),
        tableCount: 3,
        rowCount: publicRows + appRows,
        migrationCount: 1,
        verification: "checksums_verified",
        review,
        generations: [...(large ? [generation(false)] : []), generation(true)],
      },
      explain: {
        environment: { target: provider, kind: `isolated_local_${provider}` },
        baselineReview: structuredClone(review),
      },
    };
  };
  const fields = [
    ["lifecycle.open", "open-persistence", "keep-until-stop"],
    ["lifecycle.openIdleTimeoutSeconds", "nullable-integer", null],
    ["cleanup.retainBaselineGenerations", "integer", 2],
    ["containerRuntime.diskWarningPercent", "integer", 80],
    ["containerRuntime.minimumFreeBytes", "integer", 2147483648],
    ["resources.staleAfterSeconds", "nullable-integer", null],
    ["resources.retainedEnvironmentCount", "integer", 2],
    ["resources.maximumBytes", "nullable-integer", null],
    ["resources.cleanupSchedule", "review-schedule", "manual"],
    ["runtime.protected", "boolean", true],
  ].map(([path, kind, value]) => ({
    path: String(path),
    kind: String(kind),
    value,
    provenance: "validated-active-configuration",
    confidence: "certain",
    reviewRequired: true,
  }));
  const configuration = {
    schemaVersion: 1,
    path: "rehearsal.config.mjs",
    sourceSha256: digest("a"),
    fields,
    profiles: [],
    pathResolution: "Project root",
    manualFields: "Manual review required",
    patchContract: {
      schemaVersion: 1,
      input: "project-local-json-file",
      maximumBytes: 65536,
      writesConfiguration: false,
      executesProposedCommands: false,
      concurrentChanges: "refuse",
    },
  };
  const proposed = [
    [
      "bounded-resource-policies",
      [
        "stop-on-application-exit",
        30,
        1,
        1,
        1,
        1,
        1000,
        1,
        "weekly-preview",
        true,
      ],
    ],
    ["disabled-explicit-policies", [null, null, null, "manual"]],
  ] as const;
  const refusalNames = [
    "idle-below-minimum",
    "retention-zero",
    "disk-over-percent",
    "environment-count-over-bound",
    "quota-zero",
    "automatic-delete-schedule",
    "manual-runtime-identity",
    "manual-source-scope",
    "prototype-path",
    "constructor-prototype-path",
    "stale-source",
    "foreign-source-fingerprint",
    "protected-cleanup-preview",
    "protected-cleanup-write",
    "empty-baseline-input",
    "stale-policy",
  ];
  return {
    schemaVersion: 1,
    status: "passed",
    infrastructure: { mode: "deny-and-audit", toolCalls: 0 },
    checks: [
      "local-file provider scope and Storage aggregates",
      "bounded larger baseline and retained immutable generation",
      "public resource policy proposals remain non-writing",
      "invalid stale foreign and manual-only policy proposals refuse",
      "protected cleanup empty input and policy drift preserve baseline",
      "read-only repeat and reviewed source preservation",
    ].map((name) => ({ name, status: "passed" })),
    preservation: {
      reviewedFilesUnchanged: true,
      baselineFilesUnchanged: true,
      sourceFingerprints: [
        { provider: "postgresql", sha256: digest("a") },
        { provider: "supabase", sha256: digest("f") },
      ],
    },
    refusals: refusalNames.map((scenario) => {
      const category =
        scenario === "empty-baseline-input" ||
        (legacy && scenario === "retention-zero")
          ? "baseline_invalid"
          : scenario === "stale-policy"
            ? "baseline_checksum_mismatch"
            : legacy &&
                [
                  "manual-runtime-identity",
                  "manual-source-scope",
                  "prototype-path",
                  "constructor-prototype-path",
                ].includes(scenario)
              ? "internal_failure"
              : "configuration_invalid";
      return {
        scenario,
        category,
        code: category.toUpperCase(),
        exitCode:
          scenario === "empty-baseline-input" ||
          (legacy && scenario === "retention-zero")
            ? 4
            : scenario === "stale-policy"
              ? 5
              : legacy &&
                  [
                    "manual-runtime-identity",
                    "manual-source-scope",
                    "prototype-path",
                    "constructor-prototype-path",
                  ].includes(scenario)
                ? 10
                : 2,
      };
    }),
    samples: {
      postgresql: baseline("postgresql"),
      postgresqlLarge: baseline("postgresql", true),
      supabase: baseline("supabase"),
      resourcePolicies: {
        configuration,
        proposalReviews: proposed.map(([name, values], index) => ({
          name,
          review: {
            schemaVersion: 1,
            path: configuration.path,
            sourceSha256: configuration.sourceSha256,
            validation: "complete-config-passed",
            writesConfiguration: false,
            executesProposedCommands: false,
            changes: (index === 0
              ? fields
              : [fields[1]!, fields[5]!, fields[7]!, fields[8]!]
            ).map((field, i) => ({
              path: field.path,
              previous: field.value,
              proposed: values[i],
            })),
          },
        })),
      },
    },
    limitations: [
      "No services or source access.",
      "Bounded aggregate fixture.",
      "Read-only proposals.",
      "No native UI acceptance.",
    ],
  };
}

function activityReport(artifact = publishedRc7) {
  const startedAt = "2026-10-16T00:00:00.000Z",
    updatedAt = "2026-10-16T00:00:01.000Z";
  const receipt = (failed: boolean) => ({
    kind: failed ? "run" : "baseline create",
    rehearsalVersion: artifact.version,
    progress: {
      schemaVersion: 1,
      operationId: digest(failed ? "b" : "c"),
      state: failed ? "failed" : "completed",
      startedAt,
      updatedAt,
      elapsedMilliseconds: 1000,
      currentStage: null,
      completedStages: [],
      events: [
        {
          sequence: 1,
          code: "operation.started",
          phase: null,
          target: null,
          at: startedAt,
        },
        {
          sequence: 2,
          code: failed ? "operation.failed" : "operation.completed",
          phase: null,
          target: null,
          at: updatedAt,
        },
      ],
      truncated: { stages: false, events: false },
    },
  });
  const idle = { schemaVersion: 1, state: "idle", operation: null, recent: [] },
    completed = receipt(false);
  return {
    schemaVersion: 1,
    status: "passed",
    cleanup: "removed",
    artifact: {
      name: "@rehearsal-db/core",
      ...artifact,
    },
    safeActivitySamples: {
      freshIdle: idle,
      completed: { ...idle, recent: [completed] },
      failed: { ...idle, recent: [completed, receipt(true)] },
      siblingIdle: idle,
    },
    scopePolicyReview: fixture(artifact),
  };
}
function changed(path: readonly (string | number)[], value: unknown) {
  const section = fixture();
  let current: unknown = section;
  for (const part of path.slice(0, -1))
    current = (current as Record<string, unknown>)[part];
  (current as Record<string, unknown>)[path.at(-1)!] = value;
  return section;
}

describe("installed baseline scope/resource policy evidence consumer", () => {
  it.each([
    { ...publishedRc7, sha256: digest("a") },
    { ...publishedRc7, version: "0.1.0-rc.8" },
    { version: "0.1.0-rc.8", sha256: digest("b") },
  ])(
    "requires corrected configuration outcomes for every other exact artifact (%j)",
    (artifact) => {
      const input = fixture(artifact);
      expect(verifySamples(input, artifact)).toMatchObject({
        status: "passed",
        refusalsAccepted: 16,
      });
      for (const refusal of input.refusals.slice(0, 12))
        expect(refusal).toMatchObject({
          exitCode: 2,
          category: "configuration_invalid",
          code: "CONFIGURATION_INVALID",
        });
      expect(() => verifySamples(fixture(), artifact)).toThrow();
      expect(
        verifyScopePolicyReviewEvidence(
          activityReport(artifact),
          artifact.sha256,
        ),
      ).toMatchObject({
        version: artifact.version,
        artifactSha256: artifact.sha256,
        refusalsAccepted: 16,
      });
    },
  );
  it("rejects malformed or inherited artifact identity and evidence fields", () => {
    for (const artifact of [
      { ...publishedRc7, version: "" },
      { ...publishedRc7, version: "rc.7" },
      { ...publishedRc7, version: "0.1.0-rc.7\n" },
      { ...publishedRc7, sha256: "not-a-digest" },
      { ...publishedRc7, sha256: "A".repeat(64) },
      Object.create(publishedRc7),
    ])
      expect(() => verifySamples(fixture(), artifact)).toThrow();
    expect(() =>
      verifySamples(Object.create(fixture()), publishedRc7),
    ).toThrow();
    const input = fixture();
    input.refusals[0] = Object.create(input.refusals[0]!);
    expect(() => verifySamples(input, publishedRc7)).toThrow();
  });
  it("requires exactly sixteen controls; historical fourteen-control reports remain separately scoped", () => {
    const fourteen = fixture();
    fourteen.refusals.splice(8, 2);
    expect(fourteen.refusals).toHaveLength(14);
    expect(() => verifySamples(fourteen, publishedRc7)).toThrow();
    const seventeen = fixture();
    seventeen.refusals.push({ ...seventeen.refusals[0]! });
    expect(() => verifySamples(seventeen, publishedRc7)).toThrow();
  });
  it.each(Array.from({ length: 16 }, (_, index) => index))(
    "refuses wrong category or code independently for control %i",
    (index) => {
      for (const [field, value] of [
        ["category", "unexpected_category"],
        ["code", "UNKNOWN_DIAGNOSTIC"],
      ] as const) {
        const input = fixture();
        input.refusals[index]![field] = value;
        expect(() => verifySamples(input, publishedRc7)).toThrow();
      }
    },
  );
  it("retains the installed rc.7 baseline category for zero baseline retention", () => {
    const input = fixture();
    input.refusals[1] = {
      scenario: "retention-zero",
      exitCode: 4,
      category: "baseline_invalid",
      code: "BASELINE_INVALID",
    };
    expect(() => verifyScopePolicyReviewSamples(input)).not.toThrow();
  });
  it.each([
    "manual-runtime-identity",
    "manual-source-scope",
    "prototype-path",
    "constructor-prototype-path",
  ])(
    "retains observed internal-failure refusal for %s without inventing a corrected category",
    (scenario) => {
      const input = fixture();
      const refusal = input.refusals.find(
        (item) => item.scenario === scenario,
      )!;
      expect(refusal).toEqual({
        scenario,
        exitCode: 10,
        category: "internal_failure",
        code: "INTERNAL_FAILURE",
      });
      expect(() => verifyScopePolicyReviewSamples(input)).not.toThrow();
      Object.assign(refusal, {
        exitCode: 2,
        category: "configuration_invalid",
        code: "CONFIGURATION_INVALID",
      });
      expect(() => verifyScopePolicyReviewSamples(input)).toThrow();
    },
  );
  it.each(Array.from({ length: 16 }, (_, index) => index))(
    "refuses a wrong nonzero exit outcome for exact negative control %i",
    (index) => {
      const input = fixture();
      const refusal = input.refusals[index]!;
      refusal.exitCode = refusal.exitCode === 2 ? 4 : 2;
      expect(() => verifyScopePolicyReviewSamples(input)).toThrow();
    },
  );
  it("refuses mutually matching provider claims that contradict the configured target", () => {
    const input = fixture();
    input.samples.postgresql.baseline.review.provider = "supabase";
    input.samples.postgresql.explain.baselineReview.provider = "supabase";
    expect(() => verifyScopePolicyReviewSamples(input)).toThrow();
  });
  it("uses production provider/policy binding, aggregate rendering and resource field validation without mutating samples", () => {
    const input = fixture(),
      before = JSON.stringify(input);
    const result = verifyScopePolicyReviewSamples(input);
    expect(result).toMatchObject({
      status: "passed",
      baselineSamplesAccepted: 3,
      providersReviewed: ["postgresql", "supabase"],
      resourceProposalReviewsAccepted: 2,
      refusalsAccepted: 16,
    });
    expect(JSON.stringify(input)).toBe(before);
    expect(JSON.stringify(result)).not.toMatch(
      /scope-assets|scope-source|unused-scope|never-rendered|rehearsal\.config/iu,
    );
    expect(result.limitations.join(" ")).toContain(
      "no source, SQL, running database",
    );
    expect(result.limitations.join(" ")).toContain(
      "not successful resource deletion",
    );
    expect(result.limitations.join(" ")).toContain(
      "native save, keyboard, visual and screen-reader",
    );
  });
  it.each([
    [["schemaVersion"], 2],
    [["status"], "failed"],
    [["checks", 0, "status"], "failed"],
    [["checks", 0, "name"], "invented"],
    [["infrastructure", "mode"], "not-audited"],
    [["infrastructure", "toolCalls"], 1],
    [["preservation", "reviewedFilesUnchanged"], false],
    [["preservation", "baselineFilesUnchanged"], false],
    [["preservation", "sourceFingerprints", 0, "sha256"], digest("f")],
    [["samples", "postgresql", "baseline", "review"], undefined],
    [
      ["samples", "postgresql", "baseline", "sanitizationPolicySha256"],
      digest("f"),
    ],
    [["samples", "postgresql", "baseline", "review", "provider"], "supabase"],
    [["samples", "postgresql", "explain", "environment", "target"], "supabase"],
    [
      ["samples", "postgresql", "explain", "baselineReview", "provider"],
      "supabase",
    ],
    [
      [
        "samples",
        "supabase",
        "baseline",
        "review",
        "privacy",
        "rowValuesIncluded",
      ],
      true,
    ],
    [["samples", "supabase", "baseline", "review", "storage", "assetCount"], 0],
    [["samples", "postgresqlLarge", "baseline", "rowCount"], 2050],
    [
      [
        "samples",
        "postgresqlLarge",
        "baseline",
        "generations",
        0,
        "generationId",
      ],
      "foreign-generation",
    ],
    [
      ["samples", "resourcePolicies", "configuration", "sourceSha256"],
      digest("e"),
    ],
    [["samples", "resourcePolicies", "configuration"], undefined],
    [
      ["samples", "resourcePolicies", "configuration", "sourceSha256"],
      "malformed-fingerprint",
    ],
    [
      ["samples", "resourcePolicies", "configuration", "patchContract"],
      undefined,
    ],
    [
      [
        "samples",
        "resourcePolicies",
        "configuration",
        "patchContract",
        "maximumBytes",
      ],
      65537,
    ],
    [
      ["samples", "resourcePolicies", "configuration", "fields", 0, "kind"],
      "command",
    ],
    [
      ["samples", "resourcePolicies", "configuration", "path"],
      "../foreign.mjs",
    ],
    [
      [
        "samples",
        "resourcePolicies",
        "proposalReviews",
        0,
        "review",
        "writesConfiguration",
      ],
      true,
    ],
    [
      [
        "samples",
        "resourcePolicies",
        "proposalReviews",
        0,
        "review",
        "executesProposedCommands",
      ],
      true,
    ],
    [
      [
        "samples",
        "resourcePolicies",
        "proposalReviews",
        0,
        "review",
        "sourceSha256",
      ],
      digest("e"),
    ],
    [
      [
        "samples",
        "resourcePolicies",
        "proposalReviews",
        0,
        "review",
        "changes",
        1,
        "proposed",
      ],
      29,
    ],
    [
      [
        "samples",
        "resourcePolicies",
        "proposalReviews",
        0,
        "review",
        "changes",
        0,
        "previous",
      ],
      "stop-on-application-exit",
    ],
    [
      [
        "samples",
        "resourcePolicies",
        "proposalReviews",
        1,
        "review",
        "validation",
      ],
      "not-validated",
    ],
    [["refusals", 14, "exitCode"], 2],
    [["refusals", 15, "code"], "CONFIGURATION_INVALID"],
  ] as const)(
    "refuses missing, unsafe, stale or contradictory evidence at %j",
    (path, value) => {
      expect(() =>
        verifyScopePolicyReviewSamples(changed(path, value)),
      ).toThrow(
        "Scope/policy evidence was missing, unsafe, mismatched or inconclusive",
      );
    },
  );
  it("refuses malformed or oversized input and missing/duplicate exact checks or refusals", () => {
    for (const input of [
      undefined,
      null,
      [],
      {},
      { padding: "x".repeat(128 * 1024) },
    ])
      expect(() => verifyScopePolicyReviewSamples(input)).toThrow();
    for (const field of ["checks", "refusals"] as const) {
      const input = fixture();
      input[field].pop();
      expect(() => verifyScopePolicyReviewSamples(input)).toThrow();
    }
    const duplicate = fixture();
    duplicate.refusals[0] = duplicate.refusals[1]!;
    expect(() => verifyScopePolicyReviewSamples(duplicate)).toThrow();
  });
  it.each([
    "SYNTHETIC_SCOPE_ROW_NOT_TELEMETRY",
    "/Users/private/canary",
    "postgresql://private:password@private.example/database",
  ])("withholds private input and raw errors (%s)", (canary) => {
    const input = { ...fixture(), rawError: canary };
    try {
      verifyScopePolicyReviewSamples(input);
      throw new Error("Expected refusal");
    } catch (error) {
      expect(String(error)).toBe(
        "Error: Scope/policy evidence was missing, unsafe, mismatched or inconclusive; no project action was performed.",
      );
    }
  });
  it("requires matching whole-report artifact/history/cleanup before scope evidence is accepted", () => {
    expect(
      verifyScopePolicyReviewEvidence(activityReport(), publishedRc7.sha256),
    ).toMatchObject({
      status: "passed",
      artifactSha256: publishedRc7.sha256,
      version: "0.1.0-rc.7",
    });
    for (const input of [
      { scopePolicyReview: fixture() },
      { ...activityReport(), cleanup: "retained-for-diagnosis" },
      { ...activityReport(), status: "failed" },
      { ...activityReport(), safeActivitySamples: {} },
    ])
      expect(() =>
        verifyScopePolicyReviewEvidence(input, publishedRc7.sha256),
      ).toThrow();
    expect(() =>
      verifyScopePolicyReviewEvidence(activityReport(), digest("f")),
    ).toThrow();
  });
});
