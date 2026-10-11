import { describe, expect, it } from "vitest";
import {
  buildVerificationReport,
  renderVerificationReportJson,
  renderVerificationReportMarkdown,
} from "../src/verification_report.js";
import type { ProjectSnapshot } from "../src/project_snapshot.js";

describe("verification reports", () => {
  it("exports aggregate project evidence without workspace paths", () => {
    const snapshot: ProjectSnapshot = {
      workspaceName: "sample",
      workspaceRoot: "/private/sample",
      availability: "ready",
      version: "0.1.0-rc.4",
      readiness: {
        state: "READY",
        passed: 1,
        failed: 0,
        checks: [
          {
            id: "configuration",
            label: "Configuration validated",
            status: "pass",
            detail: "ready",
          },
        ],
      },
      candidates: {
        count: 0,
        digest: "a".repeat(64),
        files: [],
        targets: [],
      },
    };
    const report = buildVerificationReport(
      snapshot,
      new Date("2026-10-11T20:00:00Z"),
    );
    const json = renderVerificationReportJson(report);
    const markdown = renderVerificationReportMarkdown(report);
    expect(json).not.toContain("/private/sample");
    expect(markdown).toContain("Candidate migrations: 0");
    expect(markdown).toContain("Configuration validated");
    expect(markdown).toContain("## Manual checks");
    expect(markdown).toContain("does not include credentials");
  });
});
