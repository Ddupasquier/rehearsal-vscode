import { describe, expect, it } from "vitest";
import { shellCommand, workspaceActionPlan } from "../src/action_catalog.js";
import type { ProjectSnapshot } from "../src/project_snapshot.js";

const snapshot = (
  overrides: Partial<ProjectSnapshot> = {},
): ProjectSnapshot => ({
  workspaceName: "fixture",
  workspaceRoot: "/workspace",
  availability: "ready",
  version: "0.1.0-rc.4",
  configPath: "infrastructure/rehearsal/rehearsal.config.mjs",
  candidates: {
    count: 1,
    digest: "a".repeat(64),
    files: ["20261011000000_add_index.sql"],
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
  ...overrides,
});

describe("workspace action catalog", () => {
  it("binds mutation actions to the exact reviewed candidate digest", () => {
    expect(workspaceActionPlan(snapshot(), "runRehearsal")?.arguments).toEqual([
      "npx",
      "--no-install",
      "rehearsal",
      "run",
      `--confirm-candidates=${"a".repeat(64)}`,
      "--config=infrastructure/rehearsal/rehearsal.config.mjs",
    ]);
  });

  it("creates a verified runtime when no candidate migrations are waiting", () => {
    const empty = snapshot({
      candidates: { count: 0, digest: "b".repeat(64), files: [], targets: [] },
      runtime: {
        state: "stopped",
        targets: [
          {
            name: "primary",
            state: "stopped",
            reason: "runtime_not_running",
            runtimeTarget: "postgresql",
            verifiedRuntimeAvailable: false,
            endpoint: null,
          },
        ],
      },
    });
    expect(workspaceActionPlan(empty, "runRehearsal")?.arguments).toEqual([
      "npx",
      "--no-install",
      "rehearsal",
      "run",
      "--config=infrastructure/rehearsal/rehearsal.config.mjs",
    ]);
    expect(workspaceActionPlan(empty, "openSandbox")).toBeNull();
    expect(workspaceActionPlan(empty, "migrate")).toBeNull();
  });

  it("uses the detected package manager for install and update", () => {
    const outdated = snapshot({
      availability: "package_outdated",
      version: "0.1.0-rc.2",
      discovery: {
        source: "bootstrap",
        profile: {
          schemaVersion: 1,
          project: { name: "fixture", packageManifest: "present" },
          detected: [
            {
              category: "detected",
              id: "package.manager",
              label: "Package manager",
              value: "pnpm",
              evidence: [],
            },
          ],
          suggested: [],
          decisions: [],
          configuration: {
            state: "missing",
            activePath: null,
            discoveredPaths: [],
            fields: [],
          },
          safety: {
            projectCodeExecuted: false,
            environmentFilesRead: false,
            databaseContacted: false,
            containerEngineStarted: false,
          },
        },
      },
    });
    expect(workspaceActionPlan(outdated, "updatePackage")?.arguments).toEqual([
      "pnpm",
      "add",
      "--save-dev",
      "@rehearsal-db/core@latest",
    ]);
  });

  it("quotes every terminal argument without allowing shell interpolation", () => {
    expect(
      shellCommand(["npx", "--config=folder/it's-safe.mjs", "$(unsafe)"]),
    ).toBe(`'npx' '--config=folder/it'"'"'s-safe.mjs' '$(unsafe)'`);
  });

  it("exposes cancellation as an owned editor action rather than a shell command", () => {
    expect(
      workspaceActionPlan(snapshot(), "cancelOwnedOperation"),
    ).toMatchObject({ kind: "cancel_owned_operation" });
    expect(
      workspaceActionPlan(snapshot(), "cancelOwnedOperation"),
    ).not.toHaveProperty("arguments");
  });
});
