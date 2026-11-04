import { describe, expect, it } from "vitest";
import {
  shellCommand,
  workspaceActionPlan,
  WORKSPACE_ACTION_IDS,
} from "../../../src/workspace/actions/action_catalog.js";
import type { ProjectSnapshot } from "../../../src/workspace/inspection/project_snapshot.js";
import { sqliteCapabilities } from "../../runtime/reports/database_capabilities_fixture.js";

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
  it("never offers a process or mutation on an unsupported native Windows host", () => {
    const unsupported = snapshot({
      availability: "error",
      error: {
        code: "platform_unsupported",
        message: "Use WSL 2.",
        suggestions: [],
      },
    });
    expect(
      WORKSPACE_ACTION_IDS.filter((id) => workspaceActionPlan(unsupported, id)),
    ).toEqual(["refresh", "documentation", "showOutput", "checkUpdates"]);
  });
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

  it("never promises to open an application without observed readiness configuration", () => {
    expect(workspaceActionPlan(snapshot(), "openSandbox")).toBeNull();
    const configuration = {
      runtime: {
        applicationUrl: "http://localhost:5175",
        serviceProfile: "application" as const,
      },
      application: {
        startCommand: "npm run dev",
        proofCommand: "npm test",
        readinessUrl: "http://localhost:5175",
      },
      lifecycle: {
        run: "stop-after-run" as const,
        open: "stop-on-application-exit" as const,
      },
      cleanup: { retainBaselineGenerations: 2 },
    };
    expect(
      workspaceActionPlan(snapshot({ configuration }), "openSandbox")
        ?.arguments,
    ).toContain("open");
    expect(
      workspaceActionPlan(
        snapshot({
          configuration: {
            ...configuration,
            application: { ...configuration.application, readinessUrl: null },
          },
        }),
        "openSandbox",
      ),
    ).toBeNull();
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
  it("uses PowerShell invocation and literal quoting rather than POSIX command text", () => {
    expect(
      shellCommand(
        [
          "C:\\Program Files\\Node\\npx.cmd",
          "--config=folder/it's-safe.mjs",
          "$(unsafe); & %PATH% !",
        ],
        "powershell",
      ),
    ).toBe(
      "& 'C:\\Program Files\\Node\\npx.cmd' '--config=folder/it''s-safe.mjs' '$(unsafe); & %PATH% !'",
    );
  });

  it("states discard data loss and qualified engine retention before destructive approval", () => {
    const plan = workspaceActionPlan(snapshot(), "discardRuntime");
    expect(plan?.arguments).toEqual([
      "npx",
      "--no-install",
      "rehearsal",
      "discard",
      "--config=infrastructure/rehearsal/rehearsal.config.mjs",
    ]);
    expect(plan?.confirmation).toMatchObject({
      title: "Discard this disposable runtime?",
      confirmLabel: "Discard Runtime",
      destructive: true,
    });
    expect(plan?.confirmation?.detail).toContain(
      "deletes this project's disposable database and Storage volumes, including all current sandbox edits",
    );
    expect(plan?.confirmation?.detail).toContain(
      "The immutable baseline remains available to recreate the sandbox",
    );
    expect(plan?.confirmation?.detail).toContain(
      "Other projects' containers and volumes are preserved",
    );
    expect(plan?.confirmation?.detail).toContain(
      "The shared engine is preserved unless your explicitly enabled owner-only Colima policy verifies that Rehearsal started that exact idle engine boot and no containers are running",
    );
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

describe("SQLite workspace actions", () => {
  const sqlite = (): ProjectSnapshot =>
    snapshot({
      databaseCapabilities: sqliteCapabilities(),
      runtime: {
        state: "stopped",
        targets: [
          {
            name: "primary",
            state: "stopped",
            reason: "runtime_not_running",
            runtimeTarget: "sqlite",
            verifiedRuntimeAvailable: true,
            endpoint: null,
          },
        ],
      },
    });

  it("uses owned-file lifecycle wording without promising to stop other applications", () => {
    expect(
      workspaceActionPlan(sqlite(), "startRuntime")?.confirmation?.detail,
    ).toContain("owned SQLite file");
    expect(
      workspaceActionPlan(sqlite(), "stopRuntime")?.confirmation?.detail,
    ).toContain("does not stop other applications");
    const discard = workspaceActionPlan(sqlite(), "discardRuntime")!;
    expect(discard.confirmation?.detail).toContain("owned sidecars");
    expect(discard.confirmation?.detail).not.toContain("Storage volumes");
    expect(discard.confirmation?.destructive).toBe(true);
    expect(workspaceActionPlan(sqlite(), "runRehearsal")?.arguments).toContain(
      `--confirm-candidates=${"a".repeat(64)}`,
    );
  });

  it("does not offer SQLite Auth, container cleanup or VM actions", () => {
    for (const id of [
      "identityConnect",
      "cleanupPreview",
      "shutdownVm",
    ] as const)
      expect(workspaceActionPlan(sqlite(), id)).toBeNull();
  });

  it("refuses mutation with missing, unavailable or unqualified per-target capability evidence", () => {
    const noCapability = sqlite();
    const { databaseCapabilities: _report, ...missing } = noCapability;
    expect(workspaceActionPlan(missing, "runRehearsal")).toBeNull();
    expect(
      workspaceActionPlan(
        {
          ...sqlite(),
          databaseCapabilities: {
            ...sqliteCapabilities(),
            availability: "unknown",
          },
        },
        "reset",
      ),
    ).toBeNull();
    const report = sqliteCapabilities();
    expect(
      workspaceActionPlan(
        {
          ...sqlite(),
          databaseCapabilities: {
            ...report,
            capabilities: {
              ...report.capabilities,
              migrations: {
                state: "unknown",
                reason: "qualification_missing",
                scope: "sqlite-v1",
              },
            },
          },
        },
        "runRehearsal",
      ),
    ).toBeNull();
  });
});
