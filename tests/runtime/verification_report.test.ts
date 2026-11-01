import { describe, expect, it } from "vitest";
import {
  buildVerificationReport,
  renderVerificationReportJson,
  renderVerificationReportMarkdown,
  verificationReportFilename,
} from "../../src/runtime/verification_report.js";
import type { ProjectSnapshot } from "../../src/workspace/project_snapshot.js";

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

  const largeSnapshot = (
    checks: number,
    targets: number,
    generations: number,
  ): ProjectSnapshot => ({
    workspaceName: "Large reviewed project",
    workspaceRoot: "/private/report-boundary",
    availability: "ready",
    version: "0.1.0-rc.5",
    inspectedAt: "2026-10-15T12:00:00.000Z",
    readiness: {
      state: "READY",
      passed: checks,
      failed: 0,
      checks: Array.from({ length: checks }, (_, index) => ({
        id: `check-${index}`,
        label: `private-row-canary-${index}@example.invalid`,
        status: "pass" as const,
        detail: "/private/report-boundary/credential-canary",
      })),
    },
    runtime: {
      state: "stopped",
      targets: Array.from({ length: targets }, (_, index) => ({
        name: `target-${index}`,
        runtimeTarget: "postgresql" as const,
        state: "stopped" as const,
        reason: "runtime_not_running" as const,
        verifiedRuntimeAvailable: false,
        baselineGenerationId: "generation-0",
        candidateSha256: "a".repeat(64),
        endpoint: null,
      })),
    },
    baseline: {
      generationId: "generation-0",
      createdAt: "2026-10-15T12:00:00.000Z",
      verification: "checksums_verified",
      formatVersion: 2,
      rowCount: 1_000_000,
      tableCount: 100,
      migrationCount: 50_000,
      generations: Array.from({ length: generations }, (_, index) => ({
        generationId: `generation-${index}`,
        createdAt: null,
        active: index === 0,
        formatVersion: 2 as const,
        rowCount: 1_000_000,
        tableCount: 100,
        migrationCount: 50_000,
        migrationCutoff: "20261015000000",
        storageAssetCount: 100,
      })),
    },
    candidates: {
      count: 50_000,
      digest: "b".repeat(64),
      files: Array.from(
        { length: 2048 },
        (_, index) => `/private/raw-migration-canary-${index}.sql`,
      ),
      targets: [],
    },
  });

  it("retains exact boundary details and large-plan aggregates without exporting migration text or private detail", () => {
    const report = buildVerificationReport(
      largeSnapshot(1000, 32, 1000),
      new Date("2026-10-15T12:01:00.000Z"),
    );
    expect(report.readiness?.checks).toHaveLength(1000);
    expect(report.checks.completed).toHaveLength(1000);
    expect(report.readiness?.checks.at(-1)?.id).toBe("check-999");
    expect(report.runtime?.targets).toHaveLength(32);
    expect(report.subjects).toHaveLength(1032);
    expect(report.subjects.at(-1)?.id).toBe("baseline:generation-999");
    expect(report.candidates).toEqual({
      count: 50_000,
      digest: "b".repeat(64),
    });
    expect(report.limitations.join("\n")).not.toContain("omitted");
    const content =
      renderVerificationReportJson(report) +
      renderVerificationReportMarkdown(report);
    expect(content).not.toMatch(
      /private-row-canary|credential-canary|raw-migration-canary|\/private/u,
    );
    expect(content).toContain("unsigned");
    expect(content).toContain("50,000");
    expect(Buffer.byteLength(content)).toBeLessThan(1_500_000);
  });

  it("bounds over-limit evidence, discloses omitted details and keeps JSON and Markdown deterministic", () => {
    const snapshot = largeSnapshot(1001, 33, 1001);
    const options = {
      extensionVersion: "0.1.3",
      comparison: {
        leftId: "target:target-0",
        rightId: "baseline:generation-0",
      },
    };
    const now = new Date("2026-10-15T12:01:00.000Z");
    const first = buildVerificationReport(snapshot, now, options);
    const second = buildVerificationReport(snapshot, now, options);
    expect(first.readiness?.checks).toHaveLength(1000);
    expect(first.readiness?.passed).toBe(1001);
    expect(first.runtime?.targets).toHaveLength(32);
    expect(first.subjects).toHaveLength(1032);
    expect(first.subjects.some(({ id }) => id === "target:target-32")).toBe(
      false,
    );
    expect(
      first.subjects.some(({ id }) => id === "baseline:generation-1000"),
    ).toBe(false);
    expect(first.limitations).toContain(
      "Readiness detail is limited to the first 1,000 checks; 1 additional check omitted.",
    );
    expect(first.limitations).toContain(
      "Runtime and comparison detail is limited to the first 32 targets; 1 additional target omitted.",
    );
    expect(first.limitations).toContain(
      "Baseline comparison detail is limited to the first 1,000 generations; 1 additional generation omitted.",
    );
    expect(first.comparison?.facts).toHaveLength(14);
    expect(
      first.comparison?.facts.find(
        ({ key }) => key === "migrationHistorySha256",
      )?.state,
    ).toBe("unavailable");
    expect(renderVerificationReportJson(first)).toBe(
      renderVerificationReportJson(second),
    );
    expect(renderVerificationReportMarkdown(first)).toBe(
      renderVerificationReportMarkdown(second),
    );
    const content =
      renderVerificationReportJson(first) +
      renderVerificationReportMarkdown(first);
    expect(content).not.toMatch(
      /check-1000|target-32|generation-1000|private-row-canary|credential-canary|raw-migration-canary|\/private/u,
    );
    expect(content).toContain("1 additional check omitted");
    expect(Buffer.byteLength(content)).toBeLessThan(1_500_000);
  });
});
