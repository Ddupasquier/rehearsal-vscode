import { describe, expect, it } from "vitest";
import {
  buildVerificationReport,
  renderVerificationReportJson,
  renderVerificationReportMarkdown,
  verificationReportFilename,
} from "../src/verification_report.js";
import type { ProjectSnapshot } from "../src/project_snapshot.js";

describe("verification reports", () => {
  it("uses a bounded filename leaf instead of treating a workspace label as a path", () => {
    expect(verificationReportFilename("My app", "json")).toBe(
      "My-app-rehearsal-report.json",
    );
    expect(
      verificationReportFilename("../../outside\\target", "markdown"),
    ).toBe("outside-target-rehearsal-report.md");
    expect(verificationReportFilename("", "json")).toBe(
      "project-rehearsal-report.json",
    );
    expect(verificationReportFilename("x".repeat(500), "json").length).toBe(
      102,
    );
    for (const label of [
      "../secret",
      "../.env/private",
      "/root",
      "a:b\\c",
      "project\u0000name",
    ])
      expect(verificationReportFilename(label, "json")).not.toMatch(
        /[\\/\u0000:]/u,
      );
  });
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
  it("redacts arbitrary check details, commands, URLs, private rows and extra properties", () => {
    const snapshot = {
      workspaceName: "sample",
      workspaceRoot: "/private/owner/sample",
      availability: "ready",
      version: "0.1.0-rc.4",
      readiness: {
        state: "READY",
        passed: 1,
        failed: 0,
        checks: [
          {
            id: "configuration",
            status: "pass",
            label: "private-row-email@example.com",
            detail: "https://production.example?token=private-secret",
            remediation: "/private/owner/key",
          },
        ],
      },
      configuration: {
        application: {
          startCommand: "TOKEN=private-secret npm start",
          proofCommand: "echo private-row",
          readinessUrl: "https://production.example",
        },
        cleanup: { retainBaselineGenerations: 2 },
      },
      environment: {
        target: "supabase",
        ports: {},
        authenticationProviders: [],
        authenticationCallback: "https://production.example",
        hostedAccess: "disabled",
        outboundNetwork: "deny",
        privateRows: [{ email: "private-row-email@example.com" }],
      },
      error: {
        code: "private-secret",
        message: "private-secret",
        suggestions: ["private-secret"],
      },
    } as unknown as ProjectSnapshot;
    const report = buildVerificationReport(
      snapshot,
      new Date("2026-10-13T12:00:00Z"),
      { extensionVersion: "0.1.2" },
    );
    const json = renderVerificationReportJson(report),
      markdown = renderVerificationReportMarkdown(report);
    expect(json + markdown).not.toMatch(
      /private-secret|production\.example|email@example|\/private|TOKEN=/u,
    );
    expect(report.versions).toEqual({ core: "0.1.0-rc.4", extension: "0.1.2" });
    expect(markdown).toContain(
      "not proof that a rehearsal or browser test passed",
    );
  });
  it("keeps absent evidence unavailable and fixed timestamps deterministic", () => {
    const snapshot: ProjectSnapshot = {
      workspaceName: "sample",
      workspaceRoot: "/private",
      availability: "error",
    };
    const first = buildVerificationReport(
      snapshot,
      new Date("2026-10-13T12:00:00Z"),
    );
    expect(first.baseline).toBeNull();
    expect(first.runtime).toBeNull();
    expect(first.checks.completed).toEqual([]);
    expect(first.versions.extension).toBeNull();
    expect(
      renderVerificationReportJson(
        buildVerificationReport(snapshot, new Date("2026-10-13T12:00:00Z")),
      ),
    ).toBe(renderVerificationReportJson(first));
    expect(renderVerificationReportMarkdown(first)).toContain(
      "Baseline rows: Unavailable",
    );
  });
});
