import { describe, expect, it } from "vitest";
import {
  comparisonSubjects,
  compareEnvironmentEvidence,
  type ComparisonSubject,
} from "../src/environment_comparison.js";
import type { ProjectSnapshot } from "../src/project_snapshot.js";

const subject = (
  overrides: Partial<ComparisonSubject> = {},
): ComparisonSubject => ({
  id: "target:primary",
  label: "primary",
  kind: "target",
  provider: "supabase",
  formatVersion: 2,
  baselineGenerationId: "20261013T120000Z-aaaaaaaaaaaa",
  migrationCutoff: "20261001000000",
  migrationHistorySha256: "a".repeat(64),
  sourceSchemaSha256: "e".repeat(64),
  candidateSha256: "b".repeat(64),
  policySha256: "c".repeat(64),
  configurationSha256: "d".repeat(64),
  runtimeState: "stopped",
  rowCount: 1_000_000,
  tableCount: 100,
  storageAssetCount: 7,
  storageBytes: 123456,
  ...overrides,
});
describe("reviewed environment comparison", () => {
  it("compares exact hashes and counts deterministically", () => {
    const result = compareEnvironmentEvidence(
      subject(),
      subject({ id: "target:other" }),
    );
    expect(result.facts.every((fact) => fact.state === "equal")).toBe(true);
    expect(
      compareEnvironmentEvidence(subject(), subject({ id: "target:other" })),
    ).toEqual(result);
    expect(result.limitations[0]).toContain("do not prove equal rows");
  });
  it("marks missing evidence unavailable, including missing equal-looking metadata", () => {
    const result = compareEnvironmentEvidence(
      subject({ migrationHistorySha256: null, storageBytes: null }),
      subject({ migrationHistorySha256: null }),
    );
    expect(
      result.facts.find((fact) => fact.key === "migrationHistorySha256")?.state,
    ).toBe("unavailable");
    expect(
      result.facts.find((fact) => fact.key === "storageBytes")?.state,
    ).toBe("unavailable");
  });
  it("compares schema receipts instead of inventing equality from identical row counts", () => {
    const changed = compareEnvironmentEvidence(
      subject(),
      subject({ sourceSchemaSha256: "f".repeat(64) }),
    );
    expect(
      changed.facts.find((fact) => fact.key === "sourceSchemaSha256")?.state,
    ).toBe("different");
    expect(changed.facts.find((fact) => fact.key === "rowCount")?.state).toBe(
      "equal",
    );
    const absent = compareEnvironmentEvidence(
      subject({ sourceSchemaSha256: null }),
      subject({ sourceSchemaSha256: null }),
    );
    expect(
      absent.facts.find((fact) => fact.key === "sourceSchemaSha256")?.state,
    ).toBe("unavailable");
    expect(
      changed.limitations.some((limit) =>
        limit.includes("not the complete current runtime DDL"),
      ),
    ).toBe(true);
  });
  it("shows different facts and incompatible providers/legacy formats", () => {
    expect(
      compareEnvironmentEvidence(
        subject(),
        subject({ rowCount: 0 }),
      ).facts.find((fact) => fact.key === "rowCount")?.state,
    ).toBe("different");
    const provider = compareEnvironmentEvidence(
      subject(),
      subject({ provider: "postgresql" }),
    );
    expect(provider.compatible).toBe(false);
    expect(provider.facts.find((fact) => fact.key === "rowCount")?.state).toBe(
      "incompatible",
    );
    expect(
      compareEnvironmentEvidence(subject(), subject({ formatVersion: 1 }))
        .compatible,
    ).toBe(false);
  });
  it("builds target/baseline subjects without endpoint/row exposure and preserves unknown retained hashes", () => {
    const snapshot: ProjectSnapshot = {
      workspaceName: "sample",
      workspaceRoot: "/private/sample",
      availability: "ready",
      runtime: {
        state: "running",
        targets: [
          {
            name: "primary",
            state: "running",
            reason: null,
            runtimeTarget: "supabase",
            verifiedRuntimeAvailable: true,
            endpoint: { kind: "http", url: "http://localhost:58321" },
            baselineGenerationId: "generation-1",
            candidateSha256: "a".repeat(64),
          },
        ],
      },
      baseline: {
        generationId: "generation-1",
        createdAt: "2026-10-13T12:00:00Z",
        verification: "checksums_verified",
        rowCount: 5,
        tableCount: 1,
        migrationCount: 1,
        generations: [
          {
            generationId: "generation-1",
            createdAt: null,
            active: true,
            formatVersion: 2,
            rowCount: 5,
            tableCount: 1,
            migrationCount: 1,
            migrationCutoff: "20261001000000",
            storageAssetCount: 0,
          },
        ],
      },
    };
    const subjects = comparisonSubjects(snapshot);
    expect(subjects).toHaveLength(2);
    expect(subjects[1]?.migrationHistorySha256).toBeNull();
    expect(JSON.stringify(subjects)).not.toMatch(/private|localhost/u);
  });
});
