import { describe, expect, it } from "vitest";
import { parseMigrationReviewPlan } from "../src/migration_review.js";
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
