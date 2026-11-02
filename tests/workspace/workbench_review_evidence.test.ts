import { describe, expect, it } from "vitest";
import {
  verifyWorkbenchReviewEvidence,
  verifyWorkbenchReviewSamples,
} from "../../scripts/native/verify-workbench-review.js";

const digest = (character: string) => character.repeat(64);
const refusalNames = [
  "stale-candidate-set",
  "remote-host",
  "url-credentials",
  "invalid-scheme",
  "out-of-range-port",
  "primary-own-db",
  "primary-dependent-db",
  "dependent-primary-db",
  "profile-dependent-db",
];

function fixture() {
  const migrationSample = (counts: number[], changed = false) => {
    const targets = counts.map((count, targetIndex) => {
      const name = targetIndex ? "publication" : "primary";
      return {
        name,
        provider: "postgresql",
        baselineGenerationId: `baseline-${name}`,
        candidateSha256: digest(targetIndex ? (changed ? "e" : "d") : "c"),
        entries: Array.from({ length: count + 1 }, (_, index) => {
          const version = `20261001000${index}00`;
          const migrationName = index ? `add_probe_${index}` : "create_probe";
          return {
            id: `${name}:${version}`,
            target: name,
            version,
            timestamp: version,
            name: migrationName,
            filename: `${version}_${migrationName}.sql`,
            sha256: digest(changed && targetIndex && index ? "e" : "b"),
            order: index,
            status: index ? "candidate" : "represented_by_baseline",
            required: index !== 0,
            dependsOn: index ? [`${name}:20261001000${index - 1}00`] : [],
            warnings: index ? ["sql_safety_not_inferred"] : [],
            selectionReason:
              "Review the complete ordered suffix; filenames do not establish SQL safety.",
          };
        }),
      };
    });
    const plan = {
      schemaVersion: 1,
      selection: "complete-ordered-suffix",
      candidateSha256: digest(changed ? "f" : counts.length > 1 ? "a" : "c"),
      candidateCount: counts.reduce((sum, count) => sum + count, 0),
      targets,
      safety: {
        executesSql: false,
        startsEngine: false,
        readsSqlBodiesForSafety: false,
      },
    };
    const candidateTargets = targets.map((target) => ({
      name: target.name,
      baselineGenerationId: target.baselineGenerationId,
      candidateSha256: target.candidateSha256,
      candidateCount: target.entries.length - 1,
      candidates: target.entries
        .filter(({ required }) => required)
        .map(({ version, name, filename, sha256, status }) => ({
          version,
          name,
          filename,
          sha256,
          status,
        })),
    }));
    return {
      plan,
      candidates: {
        baselineGenerationId: targets[0]!.baselineGenerationId,
        candidateSha256: plan.candidateSha256,
        candidateCount: plan.candidateCount,
        targets: candidateTargets,
        candidates: candidateTargets.flatMap((target) =>
          target.candidates.map((entry) => ({ ...entry, target: target.name })),
        ),
      },
    };
  };
  const configuration = (dependent: boolean) => ({
    schemaVersion: 1,
    path: dependent
      ? "publication/rehearsal.config.mjs"
      : "rehearsal.config.mjs",
    sourceSha256: digest(dependent ? "b" : "a"),
    profiles: [],
    fields: [
      {
        path: "runtime.applicationUrl",
        kind: "local-url",
        value: "http://127.0.0.1:58323",
      },
      {
        path: "application.readiness.url",
        kind: "local-url",
        value: dependent ? null : "http://127.0.0.1:58323/health",
      },
      {
        path: "application.proofCommand",
        kind: "command",
        value: "PRIVATE_WORKBENCH_CANARY",
      },
    ].map((field) => ({
      ...field,
      provenance: "validated-active-configuration",
      confidence: "certain",
      reviewRequired: true,
    })),
    patchContract: {
      schemaVersion: 1,
      input: "project-local-json-file",
      maximumBytes: 65536,
      writesConfiguration: false,
      executesProposedCommands: false,
      concurrentChanges: "refuse",
      dependentTargetReview: "explicit-topologyConfigPath",
    },
    pathResolution: "Project root",
    manualFields: "Manual review required",
  });
  const primaryConfiguration = configuration(false),
    dependentConfiguration = configuration(true);
  return {
    schemaVersion: 1,
    status: "passed",
    checks: [
      "zero, one and several exact migration plans",
      "multiple targets and stale exact digest refusal",
      "reviewed loopback endpoint matrix and distinct health route",
      "unsafe endpoints and cross-target service collisions refuse",
      "reviewed inputs, baseline generations and private values preserved",
    ].map((name) => ({ name, status: "passed" })),
    preservation: {
      reviewedFilesUnchanged: true,
      originalGenerationFilesPreserved: true,
    },
    refusals: refusalNames.map((scenario) => ({
      scenario,
      exitCode: scenario === "stale-candidate-set" ? 6 : 2,
      category:
        scenario === "stale-candidate-set"
          ? "migration_candidate_failure"
          : "configuration_invalid",
      code:
        scenario === "stale-candidate-set"
          ? "CANDIDATE_CONFIRMATION_REQUIRED"
          : "CONFIGURATION_INVALID",
    })),
    samples: {
      migrations: {
        zero: migrationSample([0]),
        one: migrationSample([1]),
        several: migrationSample([3]),
        multiTarget: migrationSample([3, 1]),
        changed: migrationSample([3, 1], true),
      },
      endpoints: {
        primaryConfiguration,
        dependentConfiguration,
        accepted: [
          [
            "localhost-path",
            "http://localhost:5175/app/callback",
            primaryConfiguration,
          ],
          [
            "ipv4-path",
            "http://127.0.0.1:5176/app/callback",
            primaryConfiguration,
          ],
          [
            "ipv6-https-path",
            "https://[::1]:5177/app/callback",
            primaryConfiguration,
          ],
          [
            "dependent-explicit-topology",
            "http://localhost:5178/publication/callback",
            dependentConfiguration,
          ],
        ].map(([name, proposed, raw]) => {
          const metadata = raw as ReturnType<typeof configuration>;
          return {
            name,
            review: {
              schemaVersion: 1,
              path: metadata.path,
              sourceSha256: metadata.sourceSha256,
              writesConfiguration: false,
              executesProposedCommands: false,
              validation: "complete-config-passed",
              topologyValidation: "complete-configured-topology-passed",
              topologyTargets: ["primary", "publication"],
              changes: [
                {
                  path: "runtime.applicationUrl",
                  previous: "http://127.0.0.1:58323",
                  proposed,
                },
              ],
            },
          };
        }),
      },
    },
  };
}

type Fixture = ReturnType<typeof fixture>;
const refused = (change: (value: Fixture) => void) => {
  const value = fixture();
  change(value);
  expect(() => verifyWorkbenchReviewSamples(value)).toThrow(
    "Workbench evidence was missing, unsafe, mismatched or inconclusive",
  );
};

describe("installed migration/endpoint workbench evidence consumer", () => {
  it("uses production plan, filter, markup, state and endpoint owners without leaking samples", () => {
    const value = fixture(),
      before = JSON.stringify(value);
    const result = verifyWorkbenchReviewSamples(value);
    expect(result).toMatchObject({
      status: "passed",
      migrationSamplesAccepted: 5,
      candidateCounts: {
        zero: 0,
        one: 1,
        several: 3,
        multiTarget: 4,
        changed: 4,
      },
      sortModesAccepted: 4,
      configurationPathsAccepted: 2,
      endpointReviewsAccepted: 4,
      refusalsAccepted: 9,
      staleReviewReset: true,
    });
    expect(JSON.stringify(value)).toBe(before);
    expect(JSON.stringify(result)).not.toContain("PRIVATE_WORKBENCH_CANARY");
    expect(JSON.stringify(result)).not.toContain("58323");
    expect(result.limitations.join(" ")).toContain("no SQL, live database");
    expect(result.limitations.join(" ")).toContain("no Google");
  });
  it("refuses malformed, oversized or incompletely preserved sections", () => {
    for (const input of [
      undefined,
      null,
      [],
      {},
      "PRIVATE_WORKBENCH_CANARY",
      { padding: "x".repeat(128 * 1024) },
    ])
      expect(() => verifyWorkbenchReviewSamples(input)).toThrow();
    for (const change of [
      (value: Fixture) => {
        value.schemaVersion = 2;
      },
      (value: Fixture) => {
        value.status = "failed";
      },
      (value: Fixture) => {
        value.checks.pop();
      },
      (value: Fixture) => {
        value.checks[0]!.status = "failed";
      },
      (value: Fixture) => {
        value.checks[0]!.name = value.checks[1]!.name;
      },
      (value: Fixture) => {
        value.preservation.reviewedFilesUnchanged = false;
      },
      (value: Fixture) => {
        value.preservation.originalGenerationFilesPreserved = false;
      },
    ])
      refused(change);
  });
  it("refuses wrong counts, unsafe plans and cross-target candidate contradictions", () => {
    for (const change of [
      (value: Fixture) => {
        value.samples.migrations.one.plan.candidateCount = 0;
      },
      (value: Fixture) => {
        value.samples.migrations.several.plan.safety.executesSql = true;
      },
      (value: Fixture) => {
        value.samples.migrations.one.candidates.candidateSha256 = digest("f");
      },
      (value: Fixture) => {
        value.samples.migrations.multiTarget.candidates.candidates[3]!.target =
          "primary";
      },
      (value: Fixture) => {
        value.samples.migrations.multiTarget.candidates.targets.reverse();
      },
      (value: Fixture) => {
        value.samples.migrations.multiTarget.plan.targets[1]!.entries[1]!.dependsOn =
          [];
      },
      (value: Fixture) => {
        value.samples.migrations.multiTarget.plan.targets[1]!.entries[1]!.filename =
          "PRIVATE_WORKBENCH_CANARY";
      },
    ])
      refused(change);
  });
  it("requires real aggregate drift isolated to the dependent target", () => {
    for (const change of [
      (value: Fixture) => {
        value.samples.migrations.changed = structuredClone(
          value.samples.migrations.multiTarget,
        );
      },
      (value: Fixture) => {
        value.samples.migrations.changed.plan.targets[0]!.baselineGenerationId =
          "different-primary";
        value.samples.migrations.changed.candidates.targets[0]!.baselineGenerationId =
          "different-primary";
        value.samples.migrations.changed.candidates.baselineGenerationId =
          "different-primary";
      },
      (value: Fixture) => {
        value.samples.migrations.changed.plan.targets[1]!.baselineGenerationId =
          "different-dependent";
        value.samples.migrations.changed.candidates.targets[1]!.baselineGenerationId =
          "different-dependent";
      },
    ])
      refused(change);
  });
  it("requires all exact failed controls, including stale-set exit 6 and topology exit 2", () => {
    for (const change of [
      (value: Fixture) => {
        value.refusals.pop();
      },
      (value: Fixture) => {
        value.refusals[0]!.exitCode = 2;
      },
      (value: Fixture) => {
        value.refusals[5]!.exitCode = 6;
      },
      (value: Fixture) => {
        value.refusals[0]!.code = "CONFIGURATION_INVALID";
      },
      (value: Fixture) => {
        value.refusals[1]!.scenario = value.refusals[2]!.scenario;
      },
      (value: Fixture) => {
        value.refusals[8]!.category = "PRIVATE_WORKBENCH_CANARY";
      },
    ])
      refused(change);
  });
  it("binds reviewed endpoint paths, hashes, fields and complete topology", () => {
    for (const change of [
      (value: Fixture) => {
        value.samples.endpoints.primaryConfiguration.path =
          "../foreign.config.mjs";
      },
      (value: Fixture) => {
        value.samples.endpoints.dependentConfiguration.sourceSha256 =
          digest("f");
      },
      (value: Fixture) => {
        value.samples.endpoints.primaryConfiguration.patchContract.executesProposedCommands = true;
      },
      (value: Fixture) => {
        value.samples.endpoints.accepted.pop();
      },
      (value: Fixture) => {
        value.samples.endpoints.accepted[0]!.review.writesConfiguration = true;
      },
      (value: Fixture) => {
        value.samples.endpoints.accepted[0]!.review.executesProposedCommands = true;
      },
      (value: Fixture) => {
        value.samples.endpoints.accepted[3]!.review.topologyValidation =
          "partial";
      },
      (value: Fixture) => {
        value.samples.endpoints.accepted[3]!.review.topologyTargets = [
          "publication",
        ];
      },
      (value: Fixture) => {
        value.samples.endpoints.accepted[0]!.review.changes[0]!.path =
          "application.readiness.url";
      },
      (value: Fixture) => {
        value.samples.endpoints.accepted[0]!.review.changes[0]!.previous =
          "http://localhost:6000";
      },
    ])
      refused(change);
  });
  it("refuses unsafe or contradictory endpoint metadata without exporting private errors", () => {
    for (const url of [
      "https://PRIVATE_WORKBENCH_CANARY.example:5175",
      "http://PRIVATE_WORKBENCH_CANARY@localhost:5175",
      "http://localhost:80",
      "http://localhost:5175/?PRIVATE_WORKBENCH_CANARY=1",
      "http://localhost:5175/#",
      "http://localhost:5175/\u007f",
    ]) {
      const value = fixture();
      value.samples.endpoints.primaryConfiguration.fields[0]!.value = url;
      try {
        verifyWorkbenchReviewSamples(value);
        throw new Error("Expected refusal");
      } catch (error) {
        expect(String(error)).toBe(
          "Error: Workbench evidence was missing, unsafe, mismatched or inconclusive; no project action was performed.",
        );
        expect(String(error)).not.toContain("PRIVATE_WORKBENCH_CANARY");
      }
    }
  });
  it("does not accept workbench samples in place of exact-artifact activity and cleanup evidence", () => {
    expect(() =>
      verifyWorkbenchReviewEvidence(
        { workbenchReview: fixture() },
        digest("a"),
      ),
    ).toThrow("Workbench evidence was missing");
  });
});
