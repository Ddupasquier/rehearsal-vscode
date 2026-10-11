import { describe, expect, it } from "vitest";
import {
  overviewItemAccessibilityLabel,
  overviewItems,
} from "../src/tree_model.js";

describe("tree model", () => {
  it("keeps screen-reader labels concise while retaining visible descriptions", () => {
    expect(
      overviewItemAccessibilityLabel({
        label: "Ready for rehearsal",
        description: "15 passed · 0 failed",
      }),
    ).toBe("Ready for rehearsal, 15 passed · 0 failed");
    expect(
      overviewItemAccessibilityLabel({ label: "Rehearsal documentation" }),
    ).toBe("Rehearsal documentation");
  });

  it("explains that a source or unrelated folder is not a consumer project", () => {
    const items = overviewItems({
      workspaceName: "rehearsal-vscode",
      workspaceRoot: "/workspace",
      availability: "package_missing",
      error: {
        code: "package_missing",
        message: "The workspace-local Rehearsal package could not be resolved.",
        suggestions: [],
      },
    });

    expect(items[0]).toMatchObject({
      id: "package",
      label: "No Rehearsal project found",
      description: "Open your app's folder",
      extensionAction: "installPackage",
    });
    expect(items[0]?.tooltip).toContain(
      "This folder does not have @rehearsal-db/core installed.",
    );
    expect(overviewItemAccessibilityLabel(items[0]!)).toBe(
      "No Rehearsal project found, Open your app's folder",
    );
  });

  it("uses plain-language read-only project state and CLI equivalents", () => {
    const items = overviewItems({
      workspaceName: "fixture",
      workspaceRoot: "/workspace",
      availability: "ready",
      version: "0.1.0-rc.1",
      packageLocation: "node_modules/@rehearsal-db/core",
      activity: { schemaVersion: 1, state: "idle", operation: null },
      configPath: "rehearsal.config.mjs",
      readiness: {
        state: "READY",
        passed: 15,
        failed: 0,
        checks: [
          {
            id: "configuration",
            label: "Configuration",
            status: "pass",
            detail: "Active configuration loaded",
            remediation: "No action needed.",
          },
        ],
      },
      baseline: {
        generationId: "baseline-1",
        createdAt: "2026-10-09T00:00:00Z",
        tableCount: 4,
        rowCount: 12,
        migrationCount: 2,
        verification: "checksums_verified",
      },
      candidates: {
        count: 1,
        digest: "a".repeat(64),
        files: ["20261009000100_add_index.sql"],
        targets: [],
      },
      runtime: {
        state: "stopped",
        targets: [
          {
            name: "primary",
            state: "stopped",
            reason: "runtime_not_running",
            runtimeTarget: "postgresql",
            verifiedRuntimeAvailable: true,
            endpoint: null,
          },
        ],
      },
      applicationUrl: "http://localhost:5175",
    });
    expect(items.map(({ label }) => label)).toEqual([
      "Installed package",
      "Package location",
      "No Rehearsal operation in progress",
      "Ready for rehearsal",
      "Active configuration",
      "Verified baseline",
      "1 candidate migration",
      "0 configured targets",
      "1 disposable runtime target",
      "Sandbox application",
      "Rehearsal documentation",
    ]);
    expect(items.find(({ id }) => id === "runtime")?.description).toBe(
      "stopped",
    );
    expect(items.every((item) => !item.tooltip.includes("data.output"))).toBe(
      true,
    );
    expect(items.find(({ id }) => id === "candidates")?.tooltip).toContain(
      "a".repeat(64),
    );
    expect(items.find(({ id }) => id === "readiness")?.tooltip).toContain(
      "Next: No action needed.",
    );
  });

  it("offers a direct update action for an incompatible project package", () => {
    const items = overviewItems({
      workspaceName: "legacy",
      workspaceRoot: "/workspace",
      availability: "package_outdated",
      version: "0.1.0-rc.2",
      compatibility: {
        state: "outdated",
        installedVersion: "0.1.0-rc.2",
        minimumVersion: "0.1.0-rc.4",
      },
    });

    expect(items[0]).toMatchObject({
      label: "Update Rehearsal",
      description: "0.1.0-rc.2 → 0.1.0-rc.4+",
      extensionAction: "updatePackage",
    });
  });

  it("does not surface stale project details during an active operation", () => {
    const items = overviewItems({
      workspaceName: "fixture",
      workspaceRoot: "/workspace",
      availability: "operation_active",
      version: "0.1.0-rc.4",
      activity: {
        schemaVersion: 1,
        state: "busy",
        operation: {
          kind: "run",
          startedAt: "2026-10-10T00:00:00.000Z",
          rehearsalVersion: "0.1.0-rc.4",
        },
      },
      baseline: {
        generationId: "must-not-surface",
        createdAt: "2026-10-09T00:00:00Z",
        tableCount: 4,
        rowCount: 12,
        migrationCount: 2,
        verification: "checksums_verified",
      },
    });

    expect(items.map(({ id }) => id)).toEqual([
      "version",
      "activity",
      "documentation",
    ]);
    expect(items.find(({ id }) => id === "activity")?.tooltip).toContain(
      "run · started 2026-10-10T00:00:00.000Z",
    );
    expect(JSON.stringify(items)).not.toContain("must-not-surface");
  });
});
