import { createHash } from "node:crypto";
import { mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  insightsPreviewSnapshot,
  parseNativeInsightsFixture,
  readNativeInsightsFixture,
} from "../../scripts/native/native-insights-fixture.js";
import {
  insightPlan,
  insightReport,
} from "../migrations/migration_insights_fixture.js";

const fixture = (
  text = "\ufeff/* 😀 */ ALTER TABLE public.synthetic_probe ALTER COLUMN title SET NOT NULL;\r\n",
) => {
  const sha256 = createHash("sha256").update(text).digest("hex");
  const original = insightPlan(),
    report = insightReport("1.2.0-test.1");
  const plan = {
    ...original,
    targets: original.targets.map((target) => ({
      ...target,
      entries: target.entries.map((entry) => ({ ...entry, sha256 })),
    })),
  };
  report.targets[0]!.entries[0]!.sha256 = sha256;
  return {
    schemaVersion: 1,
    kind: "migration-insights-native-fixture",
    coreVersion: "1.2.0-test.1",
    coreArtifactSha256: "b".repeat(64),
    plan: {
      ...plan,
      safety: {
        readsSqlBodiesForSafety: false,
        executesSql: false,
        startsEngine: false,
      },
    },
    insights: report,
    files: [
      {
        path: report.targets[0]!.entries[0]!.workspaceRelativePath,
        sha256,
        base64: Buffer.from(text).toString("base64"),
      },
    ],
  };
};
describe("private native Insights handoff", () => {
  it("projects only validated metadata into the visual preview, including unavailable fallback", () => {
    const parsed = parseNativeInsightsFixture(fixture());
    const snapshot = insightsPreviewSnapshot(parsed);
    expect(snapshot.candidates?.count).toBe(parsed.plan.candidateCount);
    expect(snapshot.candidates?.targets[0]?.count).toBe(1);
    expect(snapshot.migrationReview).toBe(parsed.plan);
    expect(snapshot.migrationInsights).toEqual({
      state: "available",
      report: parsed.report,
    });
    const serialized = JSON.stringify(snapshot);
    expect(serialized).not.toContain("ALTER TABLE");
    expect(serialized).not.toContain("synthetic_probe");
    expect(serialized).not.toContain("base64");
    expect(insightsPreviewSnapshot(parsed, true).migrationInsights).toEqual({
      state: "unavailable",
    });
  });
  it("reads only bounded regular private fixtures and refuses malformed files and links", async () => {
    const directory = await mkdtemp(join(tmpdir(), "insights-preview-"));
    try {
      const file = join(directory, "fixture.json");
      await writeFile(file, JSON.stringify(fixture()));
      expect((await readNativeInsightsFixture(file)).coreVersion).toBe(
        "1.2.0-test.1",
      );
      const link = join(directory, "link.json");
      await symlink(file, link);
      await expect(readNativeInsightsFixture(link)).rejects.toThrow(
        "private input withheld",
      );
      await expect(
        readNativeInsightsFixture(join(directory, "missing.json")),
      ).rejects.toThrow("private input withheld");
      await writeFile(file, "PRIVATE_CANARY");
      await expect(readNativeInsightsFixture(file)).rejects.toThrow(
        "private input withheld",
      );
      await writeFile(file, " ".repeat(256 * 1024 + 1));
      await expect(readNativeInsightsFixture(file)).rejects.toThrow(
        "private input withheld",
      );
      await expect(readNativeInsightsFixture(directory)).rejects.toThrow(
        "private input withheld",
      );
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
  it("retains exact raw UTF-8 BOM/EOL bytes and independently parses the plan/report", () => {
    const input = fixture(),
      parsed = parseNativeInsightsFixture(input);
    expect(parsed.coreArtifactSha256).toBe(input.coreArtifactSha256);
    expect(parsed.report.candidateSha256).toBe(parsed.plan.candidateSha256);
    expect(
      parsed.files[0]!.bytes.equals(
        Buffer.from(input.files[0]!.base64, "base64"),
      ),
    ).toBe(true);
    expect(parsed.files[0]!.bytes.subarray(0, 3).toString("hex")).toBe(
      "efbbbf",
    );
  });
  it.each([
    (value: ReturnType<typeof fixture>) => {
      value.files[0]!.path = "../../PRIVATE_CANARY.sql";
    },
    (value: ReturnType<typeof fixture>) => {
      value.files.push(value.files[0]!);
    },
    (value: ReturnType<typeof fixture>) => {
      value.files[0]!.base64 += "\n";
    },
    (value: ReturnType<typeof fixture>) => {
      value.files[0]!.sha256 = "c".repeat(64);
    },
    (value: ReturnType<typeof fixture>) => {
      value.insights.candidateSha256 = "c".repeat(64);
    },
    (value: ReturnType<typeof fixture>) => {
      value.coreVersion = "1.2.0-changed";
    },
    (value: ReturnType<typeof fixture>) => {
      value.coreArtifactSha256 = "unproven";
    },
    (value: ReturnType<typeof fixture>) => {
      value.files = [];
    },
  ])(
    "refuses changed identity, bytes or unsupported metadata without echoing input",
    (alter) => {
      const input = fixture();
      alter(input);
      expect(() => parseNativeInsightsFixture(input)).toThrow(
        "Native Insights fixture is invalid; private input withheld.",
      );
      try {
        parseNativeInsightsFixture(input);
      } catch (error) {
        expect(String(error)).not.toContain("PRIVATE_CANARY");
      }
    },
  );
  it("refuses extra SQL and invalid UTF-8 even if its digest is supplied", () => {
    const input = fixture();
    expect(() =>
      parseNativeInsightsFixture({ ...input, sql: "PRIVATE_CANARY" }),
    ).toThrow("private input withheld");
    const bytes = Buffer.from([0xff, 0xfe]);
    input.files[0]!.base64 = bytes.toString("base64");
    input.files[0]!.sha256 = createHash("sha256").update(bytes).digest("hex");
    expect(() => parseNativeInsightsFixture(input)).toThrow(
      "private input withheld",
    );
  });
});
