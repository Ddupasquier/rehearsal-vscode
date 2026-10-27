import { describe, expect, it } from "vitest";
import {
  assertMatchingMigrationCandidates,
  parseMigrationReviewPlan,
  matchingNativeMigrationHistory,
} from "../src/migration_review.js";
const plan = () => ({
  schemaVersion: 1,
  candidateSha256: "a".repeat(64),
  candidateCount: 2,
  selection: "complete-ordered-suffix",
  safety: {
    readsSqlBodiesForSafety: false,
    executesSql: false,
    startsEngine: false,
  },
  targets: [
    {
      name: "primary",
      provider: "postgresql",
      baselineGenerationId: "baseline-1",
      candidateSha256: "b".repeat(64),
      entries: ["20260101000000", "20260101000001"].map((version, index) => ({
        id: `primary:${version}`,
        target: "primary",
        version,
        timestamp: version,
        name: "change",
        filename: `${version}_change.sql`,
        sha256: "c".repeat(64),
        order: index,
        status: "candidate",
        required: true,
        dependsOn: index ? ["primary:20260101000000"] : [],
        warnings: ["sql_safety_not_inferred"],
        selectionReason: "Every candidate is required.",
      })),
    },
  ],
});
describe("migration review public contract", () => {
  const candidateEvidence = (raw = plan()) => {
    const normalized = parseMigrationReviewPlan(raw);
    const targets = normalized.targets.map((target) => ({
      name: target.name,
      configPath: "rehearsal.config.mjs",
      baselineGenerationId: target.baselineGenerationId,
      candidateSha256: target.candidateSha256,
      candidateCount: target.entries.filter(
        (entry) => entry.status === "candidate",
      ).length,
      candidates: target.entries
        .filter((entry) => entry.status === "candidate")
        .map(({ version, name, filename, sha256, status }) => ({
          version,
          name,
          filename,
          sha256,
          status,
        })),
    }));
    return {
      baselineGenerationId: targets[0]!.baselineGenerationId,
      candidateSha256: normalized.candidateSha256,
      candidateCount: normalized.candidateCount,
      candidates: targets.flatMap((target) =>
        target.candidates.map((entry) => ({ ...entry, target: target.name })),
      ),
      targets,
    };
  };
  it("binds structured and legacy filename-only evidence to the same complete plan", () => {
    const parsed = parseMigrationReviewPlan(plan());
    const value = candidateEvidence();
    expect(() =>
      assertMatchingMigrationCandidates(parsed, value),
    ).not.toThrow();
    expect(() =>
      assertMatchingMigrationCandidates(parsed, {
        ...value,
        candidates: value.candidates.map((entry) => entry.filename),
        targets: value.targets.map((target) => ({
          ...target,
          candidates: target.candidates.map((entry) => entry.filename),
        })),
      }),
    ).not.toThrow();
  });
  it("refuses count/digest/target/baseline/file contradictions between concurrent public views", () => {
    for (const change of [
      (value: ReturnType<typeof candidateEvidence>) => {
        value.candidateCount++;
      },
      (value: ReturnType<typeof candidateEvidence>) => {
        value.candidateSha256 = "f".repeat(64);
      },
      (value: ReturnType<typeof candidateEvidence>) => {
        value.baselineGenerationId = "foreign";
      },
      (value: ReturnType<typeof candidateEvidence>) => {
        value.targets[0]!.name = "foreign";
      },
      (value: ReturnType<typeof candidateEvidence>) => {
        value.targets[0]!.baselineGenerationId = "foreign";
      },
      (value: ReturnType<typeof candidateEvidence>) => {
        value.targets[0]!.candidateCount++;
      },
      (value: ReturnType<typeof candidateEvidence>) => {
        value.targets[0]!.candidateSha256 = "f".repeat(64);
      },
      (value: ReturnType<typeof candidateEvidence>) => {
        value.targets[0]!.candidates[0]!.sha256 = "f".repeat(64);
      },
      (value: ReturnType<typeof candidateEvidence>) => {
        value.targets[0]!.candidates.reverse();
      },
      (value: ReturnType<typeof candidateEvidence>) => {
        value.candidates[0]!.target = "foreign";
      },
      (value: ReturnType<typeof candidateEvidence>) => {
        value.candidates[0]!.filename = "20260101000000_foreign.sql";
      },
      (value: ReturnType<typeof candidateEvidence>) => {
        value.candidates[0]!.version = "20260101000009";
      },
      (value: ReturnType<typeof candidateEvidence>) => {
        value.candidates.pop();
      },
      (value: ReturnType<typeof candidateEvidence>) => {
        value.targets.push(value.targets[0]!);
      },
    ]) {
      const evidence = candidateEvidence();
      change(evidence);
      expect(() =>
        assertMatchingMigrationCandidates(
          parseMigrationReviewPlan(plan()),
          evidence,
        ),
      ).toThrow();
    }
  });
  it("binds multiple ordered targets even when their migration filenames are identical", () => {
    const raw = plan();
    const second = structuredClone(raw.targets[0]!);
    second.name = "publication";
    second.baselineGenerationId = "publication-baseline";
    second.candidateSha256 = "d".repeat(64);
    for (const [index, entry] of second.entries.entries()) {
      entry.id = `${second.name}:${entry.version}`;
      entry.target = second.name;
      entry.dependsOn = index ? [second.entries[index - 1]!.id] : [];
    }
    raw.targets.push(second);
    raw.candidateCount = 4;
    const parsed = parseMigrationReviewPlan(raw);
    expect(() =>
      assertMatchingMigrationCandidates(parsed, candidateEvidence(raw)),
    ).not.toThrow();
    const reversed = candidateEvidence(raw);
    reversed.targets.reverse();
    expect(() => assertMatchingMigrationCandidates(parsed, reversed)).toThrow();
    const wrongAggregate = candidateEvidence(raw);
    wrongAggregate.candidates[2]!.target = "primary";
    expect(() =>
      assertMatchingMigrationCandidates(parsed, wrongAggregate),
    ).toThrow();
    const unboundAggregate = candidateEvidence(raw);
    const { target: _target, ...unboundEntry } =
      unboundAggregate.candidates[2]!;
    expect(() =>
      assertMatchingMigrationCandidates(parsed, {
        ...unboundAggregate,
        candidates: unboundAggregate.candidates.map((entry, index) =>
          index === 2 ? unboundEntry : entry,
        ),
      }),
    ).toThrow();
  });
  const statuses = (values: readonly string[]) => {
    const value = plan();
    value.targets[0]!.entries = values.map((status, index) => {
      const version = `2026010100${String(index).padStart(4, "0")}`;
      return {
        ...value.targets[0]!.entries[0]!,
        id: `primary:${version}`,
        version,
        timestamp: version,
        filename: `${version}_change.sql`,
        order: index,
        status,
        required: status === "candidate",
        dependsOn: index
          ? [`primary:2026010100${String(index - 1).padStart(4, "0")}`]
          : [],
        warnings: status === "candidate" ? ["sql_safety_not_inferred"] : [],
      };
    });
    value.candidateCount = values.filter(
      (status) => status === "candidate",
    ).length;
    return value;
  };
  it.each([
    [],
    ["candidate"],
    ["applied_to_current_runtime"],
    ["represented_by_baseline"],
    ["represented_by_baseline", "candidate", "candidate"],
    [
      "represented_by_baseline",
      "applied_to_current_runtime",
      "applied_to_current_runtime",
    ],
  ])(
    "accepts a historical prefix followed by one exact suffix %j",
    (...sequence) => {
      expect(parseMigrationReviewPlan(statuses(sequence))).toBeDefined();
    },
  );
  it.each([
    ["candidate", "represented_by_baseline"],
    ["applied_to_current_runtime", "represented_by_baseline"],
    ["candidate", "applied_to_current_runtime"],
    ["applied_to_current_runtime", "candidate"],
    ["represented_by_baseline", "candidate", "applied_to_current_runtime"],
  ])("refuses contradictory prefix/suffix history %j", (...sequence) => {
    expect(() => parseMigrationReviewPlan(statuses(sequence))).toThrow();
  });
  it.each([
    [],
    ["represented_by_baseline"],
    ["represented_by_baseline", "applied_to_current_runtime"],
  ])(
    "matches complete empty candidate evidence for history %j",
    (...sequence) => {
      const raw = statuses(sequence);
      expect(() =>
        assertMatchingMigrationCandidates(
          parseMigrationReviewPlan(raw),
          candidateEvidence(raw),
        ),
      ).not.toThrow();
    },
  );
  it("accepts chronological target-bound history and exact digest", () => {
    expect(parseMigrationReviewPlan(plan()).candidateCount).toBe(2);
  });
  it("refuses reordered dependencies, unsafe detection, wrong counts, duplicate targets and malformed digests", () => {
    const controls = [plan(), plan(), plan(), plan(), plan()];
    controls[0]!.targets[0]!.entries[1]!.dependsOn = ["foreign:20260101000000"];
    controls[1]!.safety.executesSql = true;
    controls[2]!.candidateCount = 1;
    controls[3]!.targets.push(controls[3]!.targets[0]!);
    controls[4]!.candidateSha256 = "not-a-digest";
    for (const value of controls)
      expect(() => parseMigrationReviewPlan(value)).toThrow();
  });
});

describe("explicit native Prisma migration review", () => {
  const native = () => ({
    ...plan(),
    targets: plan().targets.map((target) => ({
      ...target,
      migrationTool: {
        schemaVersion: 1,
        kind: "prisma",
        version: "7.10.1",
        provider: "postgresql",
        lockSha256: "d".repeat(64),
        toolchainSha256: "e".repeat(64),
      },
      entries: target.entries.map((entry) => ({
        ...entry,
        filename: `${entry.version}_${entry.name}/migration.sql`,
      })),
    })),
  });
  it("preserves exact native identities, order and dependencies only with explicit binding", () => {
    const parsed = parseMigrationReviewPlan(native());
    expect(
      (parsed.targets[0]!.migrationTool as { version?: string } | undefined)
        ?.version,
    ).toBe("7.10.1");
    expect(parsed.targets[0]!.entries.map((entry) => entry.filename)).toEqual([
      "20260101000000_change/migration.sql",
      "20260101000001_change/migration.sql",
    ]);
    expect(parsed.targets[0]!.entries[1]!.dependsOn).toEqual([
      "primary:20260101000000",
    ]);
    const missing = native();
    delete (missing.targets[0] as { migrationTool?: unknown }).migrationTool;
    expect(() => parseMigrationReviewPlan(missing)).toThrow();
  });
  it.each([
    { version: "7.10.2" },
    { provider: "supabase" },
    { kind: "sql" },
    { schemaVersion: 2 },
    { lockSha256: "bad" },
    { toolchainSha256: "f".repeat(63) },
    { extra: true },
  ])("refuses unknown or invalid binding %j", (patch) => {
    const raw = native();
    Object.assign(raw.targets[0]!.migrationTool, patch);
    expect(() => parseMigrationReviewPlan(raw)).toThrow();
  });
  it("rejects provider, slug, version, nesting and SQL-layout contradictions", () => {
    for (const filename of [
      "20260101000000_other/migration.sql",
      "20260101000001_change/migration.sql",
      "20260101000000_change/extra/migration.sql",
      "20260101000000_é/migration.sql",
      "20260101000000_change.sql",
      "../migration.sql",
    ]) {
      const raw = native();
      raw.targets[0]!.entries[0]!.filename = filename;
      expect(() => parseMigrationReviewPlan(raw)).toThrow();
    }
    const raw = native();
    raw.targets[0]!.provider = "supabase";
    expect(() => parseMigrationReviewPlan(raw)).toThrow();
  });
});

describe("native history versus current execution toolchain", () => {
  it("compares reviewed history while preserving independent producer bytes", () => {
    const binding = {
      schemaVersion: 1 as const,
      kind: "prisma" as const,
      version: "7.10.1" as const,
      provider: "postgresql" as const,
      lockSha256: "a".repeat(64),
      toolchainSha256: "b".repeat(64),
    };
    expect(
      matchingNativeMigrationHistory(binding, {
        ...binding,
        toolchainSha256: "c".repeat(64),
      }),
    ).toBe(true);
    expect(
      matchingNativeMigrationHistory(binding, {
        ...binding,
        lockSha256: "c".repeat(64),
      }),
    ).toBe(false);
    expect(matchingNativeMigrationHistory(undefined, binding)).toBe(false);
    expect(matchingNativeMigrationHistory(binding, undefined)).toBe(false);
    expect(matchingNativeMigrationHistory(undefined, undefined)).toBe(true);
  });
});
