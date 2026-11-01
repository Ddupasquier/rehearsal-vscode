import { describe, expect, it } from "vitest";
import {
  overviewItemAccessibilityLabel,
  overviewItems,
} from "../../src/workspace/tree_model.js";
import type { ProjectSnapshot } from "../../src/workspace/project_snapshot.js";

describe("tree model", () => {
  it("directs native Windows to WSL without offering a runtime action", () => {
    const items = overviewItems({
      workspaceName: "Windows project",
      workspaceRoot: "C:\\projects\\app",
      availability: "error",
      error: {
        code: "platform_unsupported",
        message: "Native Windows requires WSL 2.",
        suggestions: ["Open the project in its Linux home filesystem."],
      },
    });
    expect(items.find(({ id }) => id === "error")).toMatchObject({
      label: "Open this project in WSL 2",
      extensionAction: "documentation",
    });
    expect(items.every((item) => !item.cliCommand)).toBe(true);
  });
  it("labels a hands-on sandbox independently from a busy mutation without restoring stale facts", () => {
    const active: ProjectSnapshot = {
      workspaceName: "fixture",
      workspaceRoot: "/workspace",
      availability: "operation_active",
      activity: {
        schemaVersion: 1,
        state: "busy",
        operation: {
          kind: "open",
          startedAt: "2026-10-18T22:00:00.000Z",
          rehearsalVersion: "1.0.0",
          progress: {
            schemaVersion: 1,
            operationId: "a".repeat(64),
            state: "running",
            startedAt: "2026-10-18T22:00:00.000Z",
            updatedAt: "2026-10-18T22:01:00.000Z",
            elapsedMilliseconds: 60000,
            currentStage: {
              id: 1,
              phase: "interactive-session",
              target: "primary",
              state: "running",
              startedAt: "2026-10-18T22:00:00.000Z",
              endedAt: null,
              durationMilliseconds: 60000,
            },
            completedStages: [],
            events: [],
            truncated: { stages: false, events: false },
          },
        },
      },
    };
    const entry = overviewItems(active).find(({ id }) => id === "activity")!;
    expect(entry.label).toBe("Sandbox running");
    expect(entry.tooltip).toContain("does not pause the application");
    const withoutProgress: ProjectSnapshot = {
      ...active,
      activity: {
        ...active.activity!,
        operation: { ...active.activity!.operation!, progress: null },
      },
    };
    expect(
      overviewItems(withoutProgress).find(({ id }) => id === "activity")?.label,
    ).toBe("Sandbox session open");
    expect(
      overviewItems({
        ...active,
        availability: "operation_attention",
        activity: { ...active.activity!, state: "stale" },
      }).find(({ id }) => id === "activity")?.label,
    ).toBe("Previous Rehearsal operation needs review");
  });
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
