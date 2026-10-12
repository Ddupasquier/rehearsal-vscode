import { describe, expect, it } from "vitest";
import type { ProjectSnapshot } from "../src/project_snapshot.js";
import { renderWorkspaceDocument } from "../src/workspace_view.js";
import {
  WORKSPACE_ACTION_IDS,
  type WorkspaceActionId,
} from "../src/action_catalog.js";

const assets = {
  resourceSource: "vscode-webview-resource:",
  stylesheetUri: "vscode-resource://styles/workspace.css",
  logoUri: "vscode-resource://media/rehearsal.png",
  actionUris: Object.fromEntries(
    WORKSPACE_ACTION_IDS.map((action) => [
      action,
      `command:rehearsal.workspaceAction?${action}`,
    ]),
  ) as Record<WorkspaceActionId, string>,
  scriptNonce: "test-navigation-nonce",
};

const readySnapshot = (): ProjectSnapshot => ({
  workspaceName: "Example project",
  workspaceRoot: "/private/rehearsal-test-project",
  availability: "ready",
  version: "0.1.0-rc.4",
  packageLocation: "node_modules/@rehearsal-db/core",
  configPath: "rehearsal.config.mjs",
  activity: { schemaVersion: 1, state: "idle", operation: null },
  readiness: {
    state: "READY",
    passed: 15,
    failed: 0,
    checks: [],
  },
  baseline: {
    generationId: "baseline-1",
    createdAt: "2026-10-10T00:00:00.000Z",
    tableCount: 8,
    rowCount: 10_003,
    migrationCount: 4,
    verification: "checksums_verified",
    generations: [
      {
        generationId: "20261010T000000Z-aaaaaaaaaaaa",
        createdAt: "2026-10-10T00:00:00Z",
        active: true,
        formatVersion: 2,
        rowCount: 10_003,
        tableCount: 8,
        migrationCount: 4,
        migrationCutoff: "20261009000100",
        storageAssetCount: 3,
      },
      {
        generationId: "20261009T000000Z-bbbbbbbbbbbb",
        createdAt: "2026-10-09T00:00:00Z",
        active: false,
        formatVersion: 2,
        rowCount: 9_990,
        tableCount: 8,
        migrationCount: 3,
        migrationCutoff: "20261008000100",
        storageAssetCount: 2,
      },
    ],
  },
  candidates: {
    count: 1,
    digest: "a".repeat(64),
    files: [
      {
        version: "20261010000100",
        name: "add_safe_index",
        filename: "20261010000100_add_safe_index.sql",
        sha256: "b".repeat(64),
        target: "primary",
      },
    ],
    targets: [
      {
        name: "primary",
        configPath: "supabase/config.toml",
        count: 1,
      },
    ],
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
  environment: {
    target: "postgresql",
    projectId: "example-project-rehearsal",
    ports: { database: 58322 },
    authenticationProviders: ["google"],
    authenticationCallback: "http://127.0.0.1:58321/auth/v1/callback",
    hostedAccess: "disabled",
    outboundNetwork: "deny",
  },
  lifecycle: {
    run: "keep-until-stop",
    open: "keep-until-stop",
    dataOnStop: "preserved",
  },
  configuration: {
    application: {
      startCommand: "npm run dev:rehearsal",
      proofCommand: "npm run proof:rehearsal",
      readinessUrl: "http://localhost:5175/health",
    },
    cleanup: { retainBaselineGenerations: 4 },
  },
  discovery: {
    source: "core",
    profile: {
      schemaVersion: 1,
      project: { name: "example-project", packageManifest: "present" },
      detected: [
        {
          category: "detected",
          id: "package.manager",
          label: "Package manager",
          value: "npm",
          evidence: [
            {
              kind: "file",
              source: "package-lock.json",
              detail: "npm lockfile is present.",
            },
          ],
        },
      ],
      suggested: [
        {
          category: "suggested",
          id: "application.startCommand",
          label: "Application start command",
          value: "npm run dev",
          confidence: "high",
          configPath: "application.startCommand",
          review: "Review the command before use.",
          evidence: [],
        },
      ],
      decisions: [
        {
          category: "decision",
          id: "privacy.productionData",
          label: "Production data scope",
          value: "Requires review",
          question: "Which production-shaped rows may be copied?",
          reason: "Permission cannot be inferred.",
          evidence: [],
        },
      ],
      configuration: {
        state: "present_unvalidated",
        activePath: "rehearsal.config.mjs",
        discoveredPaths: ["rehearsal.config.mjs"],
        fields: [
          {
            path: "application.startCommand",
            status: "suggested",
            value: "npm run dev",
            sourceItemIds: ["application.startCommand"],
          },
        ],
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

describe("Rehearsal workspace document", () => {
  it("renders a branded project workbench with safe guided actions", () => {
    const html = renderWorkspaceDocument(readySnapshot(), assets);

    expect(html).toContain("Database change studio");
    expect(html).toContain("Know what your database change will do.");
    expect(html).toContain("Ready to rehearse");
    expect(html).toContain("10,003");
    expect(html).toContain("20261010000100_add_safe_index.sql");
    expect(html).toContain('aria-label="Rehearsal workspace"');
    expect(html).toContain('id="compact-navigation-trigger"');
    expect(html).toContain('aria-controls="workspace-navigation"');
    expect(html).toContain('aria-expanded="false"');
    expect(html).toContain('id="workspace-navigation"');
    expect(html).toContain("Choose Rehearsal page. Current page: Overview");
    expect(html).toContain(
      '<h1 tabindex="-1">Know what your database change will do.</h1>',
    );
    expect(html).toContain('window.matchMedia("(max-width: 1050px)")');
    expect(html).toContain('event.key !== "Escape"');
    expect(html).toContain("compactNavigationTrigger?.focus()");
    expect(html).toContain('selectedSection?.querySelector("h1")?.focus()');
    expect(html).toContain('data-rehearsal-page="overview"');
    expect(html).toContain('data-rehearsal-page="setup"');
    expect(html).toContain('data-rehearsal-page="migrations"');
    expect(html).toContain('data-rehearsal-page="runtime"');
    expect(html).toContain('data-rehearsal-page="data-auth"');
    expect(html).toContain('data-rehearsal-page="configuration"');
    expect(html).toContain('data-rehearsal-page="activity"');
    expect(html).toContain('aria-current="page"');
    expect(html).toContain("Your project, understood");
    expect(html).toContain("Package manager");
    expect(html).toContain("Application start command");
    expect(html).toContain("Production data scope");
    expect(html).toContain("No changes have been made.");
    expect(html).toContain("Safe by design.");
    expect(html).toContain("Run rehearsal");
    expect(html).toContain("Open sandbox");
    expect(html).toContain("Preview cleanup");
    expect(html).toContain("Find migrations");
    expect(html).toContain("Open a local address");
    expect(html).toContain("Retained verified baselines");
    expect(html).toContain("Reusable local provider setup");
    expect(html).toContain("Review exact configuration diff");
    expect(html).toContain("saved & validated");
    expect(html).toContain("npm run dev:rehearsal");
    expect(html).toContain('value="4"');
    expect(html).toContain("Export Markdown");
    expect(html).toContain("Compare retained baseline evidence");
    expect(html).toContain("Reset saved editor state");
    expect(html).toContain('type: "resetLocalState"');
    expect(html).toContain("command:rehearsal.workspaceAction?runRehearsal");
    expect(html).toContain('<script nonce="test-navigation-nonce">');
    expect(html).toContain("vscode?.postMessage");
    expect(html).toContain("default-src 'none'");
    expect(html).toContain("script-src 'nonce-test-navigation-nonce'");
    expect(html).not.toContain("/private/rehearsal-test-project");
  });

  it("renders exactly one extension-selected destination", () => {
    const html = renderWorkspaceDocument(readySnapshot(), assets, "runtime");

    expect(html).toContain(
      'class="nav-item nav-item--runtime nav-item--active"',
    );
    expect(html).toContain(
      'id="runtime" class="workspace-page workspace-page--active"',
    );
    expect(html).toContain('id="overview" class="workspace-page" hidden');
    expect(html).toContain('id="setup" class="workspace-page" hidden');
    expect(html).toContain("Choose Rehearsal page. Current page: Environments");
  });

  it("creates an unprepared sandbox instead of offering an open action that must fail", () => {
    const current = readySnapshot();
    const html = renderWorkspaceDocument(
      {
        ...current,
        candidates: {
          ...current.candidates!,
          count: 0,
          files: [],
        },
        runtime: {
          state: "stopped",
          targets: current.runtime!.targets.map((target) => ({
            ...target,
            verifiedRuntimeAvailable: false,
          })),
        },
      },
      assets,
    );

    expect(html).toContain("Ready to create a sandbox");
    expect(html).toContain("Create sandbox");
    expect(html).not.toContain(">Open sandbox<");
  });

  it("escapes project-controlled text before placing it in the webview", () => {
    const snapshot = readySnapshot();
    const html = renderWorkspaceDocument(
      {
        ...snapshot,
        workspaceName: '<img src=x onerror="alert(1)">',
        candidates: {
          ...snapshot.candidates!,
          files: ["<script>unsafe()</script>.sql"],
        },
        discovery: {
          ...snapshot.discovery!,
          profile: {
            ...snapshot.discovery!.profile,
            detected: [
              {
                ...snapshot.discovery!.profile.detected[0]!,
                label: "<script>profileUnsafe()</script>",
                evidence: [
                  {
                    kind: "file",
                    source: 'package.json"><img src=x>',
                    detail: "unsafe detail",
                  },
                ],
              },
            ],
          },
        },
      },
      assets,
    );

    expect(html).not.toContain("<script>unsafe()</script>");
    expect(html).not.toContain("<img src=x");
    expect(html).toContain("&lt;script&gt;unsafe()&lt;/script&gt;.sql");
    expect(html).toContain("&lt;img src=x onerror=&quot;alert(1)&quot;&gt;");
    expect(html).not.toContain("<script>profileUnsafe()</script>");
    expect(html).toContain("&lt;script&gt;profileUnsafe()&lt;/script&gt;");
  });

  it("keeps package-missing and restricted workspaces actionable without automatic mutation", () => {
    const missing = renderWorkspaceDocument(
      {
        workspaceName: "Source checkout",
        workspaceRoot: "/workspace",
        availability: "package_missing",
      },
      assets,
    );
    const untrusted = renderWorkspaceDocument(
      {
        workspaceName: "Restricted project",
        workspaceRoot: "/workspace",
        availability: "untrusted",
      },
      assets,
    );

    expect(missing).toContain("Rehearsal is not installed");
    expect(missing).toContain("Install Rehearsal");
    expect(untrusted).toContain("Workspace Trust required");
    expect(untrusted).toContain("Trust this folder before Rehearsal inspects");
  });

  it("renders an update button instead of inspecting an incompatible package", () => {
    const html = renderWorkspaceDocument(
      {
        workspaceName: "BlendCalc",
        workspaceRoot: "/workspace",
        availability: "package_outdated",
        version: "0.1.0-rc.2",
        compatibility: {
          state: "outdated",
          installedVersion: "0.1.0-rc.2",
          minimumVersion: "0.1.0-rc.4",
        },
      },
      assets,
    );

    expect(html).toContain("Rehearsal update required");
    expect(html).toContain("Update Rehearsal");
    expect(html).toContain("0.1.0-rc.2");
    expect(html).toContain("0.1.0-rc.4");
    expect(html).toContain("command:rehearsal.workspaceAction?updatePackage");
  });

  it("keeps raw CLI failures out of the product surface", () => {
    const html = renderWorkspaceDocument(
      {
        workspaceName: "Broken project",
        workspaceRoot: "/workspace",
        availability: "error",
        error: {
          code: "unsupported_command",
          message: "RAW CLI HELP THAT MUST NOT FLOOD THE WORKSPACE",
          suggestions: [],
        },
      },
      assets,
    );

    expect(html).toContain("Retry the inspection");
    expect(html).toContain("Open diagnostics");
    expect(html).not.toContain("RAW CLI HELP THAT MUST NOT FLOOD");
  });
});
