import { describe, expect, it } from "vitest";
import { verifyEditorReviewEvidence } from "../scripts/verify-editor-review.js";

const sha256 = "a".repeat(64);
const version = "0.1.0-rc.7";
const time = "2026-10-16T00:00:00.000Z";
const oldGeneration = "20261015T000000Z-aaaaaaaaaaaa";
const newGeneration = "20261016T000000Z-bbbbbbbbbbbb";

function fixture() {
  const receipt = (failed: boolean) => ({
    kind: failed ? "run" : "baseline create",
    rehearsalVersion: version,
    progress: {
      schemaVersion: 1,
      operationId: (failed ? "d" : "e").repeat(64),
      state: failed ? "failed" : "completed",
      startedAt: time,
      updatedAt: time,
      elapsedMilliseconds: 0,
      currentStage: null,
      completedStages: [],
      events: [
        {
          sequence: 1,
          code: "operation.started",
          phase: null,
          target: null,
          at: time,
        },
        {
          sequence: 2,
          code: failed ? "operation.failed" : "operation.completed",
          phase: null,
          target: null,
          at: time,
        },
      ],
      truncated: { stages: false, events: false },
    },
  });
  const idle = (recent: ReturnType<typeof receipt>[] = []) => ({
    schemaVersion: 1,
    state: "idle",
    operation: null,
    recent,
  });
  const sample = (nested: boolean) => {
    const sourceSha256 = (nested ? "b" : "c").repeat(64);
    const generation = (active: boolean) => ({
      generationId: active ? newGeneration : oldGeneration,
      createdAt: time,
      active,
      formatVersion: 1,
      rowCount: active ? 2 : 1,
      tableCount: 1,
      migrationCount: 1,
      migrationCutoff: "20261001000000",
      storageAssetCount: 0,
    });
    return {
      configuration: {
        schemaVersion: 1,
        path: nested
          ? "infrastructure/rehearsal/rehearsal.config.mjs"
          : "rehearsal.config.mjs",
        sourceSha256,
        fields: [
          {
            path: "application.proofCommand",
            kind: "command",
            value: "PRIVATE_EXPORT_CANARY",
            provenance: "validated-active-configuration",
            confidence: "certain",
            reviewRequired: true,
          },
        ],
        profiles: [],
        pathResolution: "Project-local paths remain rooted in the project.",
        manualFields: "Security decisions require manual review.",
        patchContract: {
          schemaVersion: 1,
          input: "project-local-json-file",
          maximumBytes: 65536,
          writesConfiguration: false,
          executesProposedCommands: false,
          concurrentChanges: "refuse",
        },
      },
      baseline: {
        generationId: newGeneration,
        createdAt: time,
        formatVersion: 1,
        migrationCutoff: "20261001000000",
        rowCount: 2,
        tableCount: 1,
        migrationCount: 1,
        verification: "checksums_verified",
        migrationHistorySha256: "f".repeat(64),
        sourceSchemaSha256: null,
        generations: nested
          ? [generation(true)]
          : [generation(false), generation(true)],
      },
      proposalReview: {
        sourceSha256,
        validation: "complete-config-passed",
        writesConfiguration: false,
        executesProposedCommands: false,
      },
    };
  };
  return {
    schemaVersion: 1,
    status: "passed",
    artifact: { name: "@rehearsal-db/core", version, sha256 },
    cleanup: "removed",
    safeActivitySamples: {
      freshIdle: idle(),
      completed: idle([receipt(false)]),
      failed: idle([receipt(false), receipt(true)]),
      siblingIdle: idle(),
    },
    editorReview: {
      schemaVersion: 1,
      status: "passed",
      checks: [{ name: "configuration preserved", status: "passed" }],
      samples: { root: sample(false), nested: sample(true) },
      refusals: [
        {
          scenario: "stale-root",
          exitCode: 2,
          category: "configuration_failure",
          code: "REHEARSAL_CONFIGURATION_FAILURE",
        },
        {
          scenario: "invalid-proposal",
          exitCode: 2,
          category: "configuration_failure",
          code: "REHEARSAL_CONFIGURATION_FAILURE",
        },
      ],
      preservation: {
        rootSourceSha256: "c".repeat(64),
        nestedSourceSha256: "b".repeat(64),
        originalGenerationFilesPreserved: true,
        reviewedFilesUnchanged: true,
      },
    },
  };
}

describe("installed configuration/comparison evidence consumer", () => {
  it("uses production parsing and deterministic privacy-safe report generation without inventing runtime proof", () => {
    const result = verifyEditorReviewEvidence(fixture(), sha256, "0.1.5");
    expect(result).toMatchObject({
      status: "passed",
      configurationPathsAccepted: 2,
      retainedBaselinesCompared: 2,
      configurationRefusals: 2,
      deterministicReports: ["json", "markdown"],
      versions: { core: version, extension: "0.1.5" },
    });
    expect(JSON.stringify(result)).not.toContain("PRIVATE_EXPORT_CANARY");
  });
  it("refuses mismatched, failed, dirty or incomplete upstream evidence", () => {
    for (const change of [
      (v: ReturnType<typeof fixture>) => {
        v.status = "failed";
      },
      (v: ReturnType<typeof fixture>) => {
        v.cleanup = "pending";
      },
      (v: ReturnType<typeof fixture>) => {
        v.editorReview.schemaVersion = 2;
      },
      (v: ReturnType<typeof fixture>) => {
        v.editorReview.status = "failed";
      },
      (v: ReturnType<typeof fixture>) => {
        v.editorReview.checks[0]!.status = "failed";
      },
      (v: ReturnType<typeof fixture>) => {
        v.editorReview.preservation.reviewedFilesUnchanged = false;
      },
      (v: ReturnType<typeof fixture>) => {
        v.editorReview.preservation.originalGenerationFilesPreserved = false;
      },
    ]) {
      const value = fixture();
      change(value);
      expect(() =>
        verifyEditorReviewEvidence(value, sha256, "0.1.5"),
      ).toThrow();
    }
    expect(() =>
      verifyEditorReviewEvidence(fixture(), "b".repeat(64), "0.1.5"),
    ).toThrow();
  });
  it("refuses wrong active paths, fingerprints, unsafe metadata and executing proposals", () => {
    for (const kind of ["root", "nested"] as const) {
      for (const change of [
        (s: ReturnType<typeof fixture>["editorReview"]["samples"]["root"]) => {
          s.configuration.path = "../foreign.config.mjs";
        },
        (s: ReturnType<typeof fixture>["editorReview"]["samples"]["root"]) => {
          s.configuration.sourceSha256 = "a".repeat(64);
        },
        (s: ReturnType<typeof fixture>["editorReview"]["samples"]["root"]) => {
          s.configuration.patchContract.executesProposedCommands = true;
        },
        (s: ReturnType<typeof fixture>["editorReview"]["samples"]["root"]) => {
          s.proposalReview.writesConfiguration = true;
        },
        (s: ReturnType<typeof fixture>["editorReview"]["samples"]["root"]) => {
          s.proposalReview.executesProposedCommands = true;
        },
        (s: ReturnType<typeof fixture>["editorReview"]["samples"]["root"]) => {
          s.proposalReview.validation = "partial";
        },
      ]) {
        const value = fixture();
        change(value.editorReview.samples[kind]);
        expect(() =>
          verifyEditorReviewEvidence(value, sha256, "0.1.5"),
        ).toThrow();
      }
    }
  });
  it("requires real failed refusal outcomes, not success or missing negative controls", () => {
    for (const change of [
      (v: ReturnType<typeof fixture>) => {
        v.editorReview.refusals = [];
      },
      (v: ReturnType<typeof fixture>) => {
        v.editorReview.refusals[0]!.exitCode = 0;
      },
      (v: ReturnType<typeof fixture>) => {
        v.editorReview.refusals[0]!.scenario = "invented";
      },
      (v: ReturnType<typeof fixture>) => {
        v.editorReview.refusals[0]!.category = "postgres://private";
      },
      (v: ReturnType<typeof fixture>) => {
        v.editorReview.refusals[0]!.code = "private error";
      },
    ]) {
      const value = fixture();
      change(value);
      expect(() =>
        verifyEditorReviewEvidence(value, sha256, "0.1.5"),
      ).toThrow();
    }
  });
  it("refuses unsupported or contradictory baseline generations instead of inferring equality", () => {
    for (const change of [
      (v: ReturnType<typeof fixture>) => {
        v.editorReview.samples.root.baseline.formatVersion = 7;
      },
      (v: ReturnType<typeof fixture>) => {
        v.editorReview.samples.root.baseline.generations.pop();
      },
      (v: ReturnType<typeof fixture>) => {
        v.editorReview.samples.root.baseline.generations[0]!.rowCount = 2;
      },
      (v: ReturnType<typeof fixture>) => {
        v.editorReview.samples.root.baseline.generations[0]!.migrationCutoff =
          "20261002000000";
      },
      (v: ReturnType<typeof fixture>) => {
        v.editorReview.samples.root.baseline.generations[0]!.active = true;
      },
    ]) {
      const value = fixture();
      change(value);
      expect(() =>
        verifyEditorReviewEvidence(value, sha256, "0.1.5"),
      ).toThrow();
    }
  });
});
