import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { parseNativeInsightsFixture } from "../scripts/native-insights-fixture.js";
import { insightPlan, insightReport } from "./migration_insights_fixture.js";

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
