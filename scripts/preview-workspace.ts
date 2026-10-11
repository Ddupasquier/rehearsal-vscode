import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { ProjectDiscoveryData } from "../src/contracts.js";
import type { ProjectSnapshot } from "../src/project_snapshot.js";
import {
  WORKSPACE_ACTION_IDS,
  type WorkspaceActionId,
} from "../src/action_catalog.js";
import {
  renderWorkspaceDocument,
  WORKSPACE_PAGES,
  type WorkspacePage,
} from "../src/workspace_view.js";

const repositoryRoot = resolve(__dirname, "..");
const host = "127.0.0.1";
const requestedPort = Number.parseInt(
  process.argv.find((argument) => argument.startsWith("--port="))?.slice(7) ??
    "4178",
  10,
);

if (
  !Number.isSafeInteger(requestedPort) ||
  requestedPort < 1 ||
  requestedPort > 65_535
) {
  throw new Error("Preview port must be an integer between 1 and 65535.");
}

const profile: ProjectDiscoveryData = {
  schemaVersion: 1 as const,
  project: { name: "rehearsal-test-lab", packageManifest: "present" as const },
  detected: [
    {
      category: "detected" as const,
      id: "package.manager",
      label: "Package manager",
      value: "npm",
      evidence: [
        {
          kind: "file" as const,
          source: "package-lock.json",
          detail: "npm lockfile is present.",
        },
      ],
    },
    {
      category: "detected" as const,
      id: "database.provider",
      label: "Database target",
      value: "PostgreSQL",
      evidence: [
        {
          kind: "file" as const,
          source: "docker-compose.yml",
          detail: "A local PostgreSQL service is declared.",
        },
      ],
    },
  ],
  suggested: [
    {
      category: "suggested" as const,
      id: "application.startCommand",
      label: "Application start command",
      value: "npm run dev",
      confidence: "high" as const,
      configPath: "application.startCommand",
      review: "Review the command before use.",
      evidence: [
        {
          kind: "manifest" as const,
          source: "package.json",
          detail: "The dev script starts the project application.",
        },
      ],
    },
  ],
  decisions: [
    {
      category: "decision" as const,
      id: "privacy.productionData",
      label: "Production data scope",
      value: "Requires review",
      question: "Which production-shaped rows may be copied?",
      reason: "Permission cannot be inferred.",
      evidence: [],
    },
  ],
  configuration: {
    state: "present_unvalidated" as const,
    activePath: "rehearsal.config.mjs",
    discoveredPaths: ["rehearsal.config.mjs"],
    fields: [
      {
        path: "application.startCommand",
        status: "suggested" as const,
        value: "npm run dev",
        sourceItemIds: ["application.startCommand"],
      },
      {
        path: "application.url",
        status: "present_unvalidated" as const,
        value: "http://localhost:5175",
        sourceItemIds: [],
      },
    ],
  },
  safety: {
    projectCodeExecuted: false,
    environmentFilesRead: false,
    databaseContacted: false,
    containerEngineStarted: false,
  },
};

const readySnapshot: ProjectSnapshot = {
  workspaceName: "Rehearsal Test Lab",
  workspaceRoot: "/preview-only",
  availability: "ready",
  version: "0.1.0-rc.4",
  packageLocation: "node_modules/@rehearsal-db/core",
  configPath: "rehearsal.config.mjs",
  activity: { schemaVersion: 1, state: "idle", operation: null },
  readiness: {
    state: "READY",
    passed: 4,
    failed: 0,
    checks: [
      {
        id: "node",
        label: "Node.js 24",
        status: "pass",
        detail: "Supported runtime detected.",
      },
      {
        id: "config",
        label: "Rehearsal configuration",
        status: "pass",
        detail: "Project configuration is present.",
      },
      {
        id: "baseline",
        label: "Verified baseline",
        status: "pass",
        detail: "Immutable baseline checksums are valid.",
      },
      {
        id: "docker",
        label: "Container engine",
        status: "pass",
        detail: "Docker remains stopped until an operation needs it.",
      },
    ],
  },
  baseline: {
    generationId: "preview-baseline",
    createdAt: "2026-10-11T00:00:00.000Z",
    tableCount: 8,
    rowCount: 10_003,
    migrationCount: 4,
    verification: "checksums_verified",
    generations: [
      {
        generationId: "20261011T000000Z-aaaaaaaaaaaa",
        createdAt: "2026-10-11T00:00:00Z",
        active: true,
        formatVersion: 2,
        rowCount: 10_003,
        tableCount: 8,
        migrationCount: 4,
        migrationCutoff: "20261010000100",
        storageAssetCount: 3,
      },
      {
        generationId: "20261010T000000Z-bbbbbbbbbbbb",
        createdAt: "2026-10-10T00:00:00Z",
        active: false,
        formatVersion: 2,
        rowCount: 9_987,
        tableCount: 8,
        migrationCount: 3,
        migrationCutoff: "20261009000100",
        storageAssetCount: 2,
      },
    ],
  },
  candidates: {
    count: 1,
    digest: "a".repeat(64),
    files: [
      {
        version: "20261011000100",
        name: "add_safe_index",
        filename: "20261011000100_add_safe_index.sql",
        sha256: "a".repeat(64),
        target: "primary",
      },
    ],
    targets: [
      { name: "primary", configPath: "supabase/config.toml", count: 1 },
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
    projectId: "rehearsal-test-lab",
    ports: { database: 58642 },
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
      startCommand: "npm run dev",
      proofCommand: "npm run test",
      readinessUrl: "http://localhost:5175",
    },
    cleanup: { retainBaselineGenerations: 2 },
  },
  discovery: { source: "core", profile },
};

const { baseline: readyBaselineForPreview, ...readyWithoutBaseline } =
  readySnapshot;
void readyBaselineForPreview;

const snapshots: Readonly<Record<string, ProjectSnapshot>> = {
  "/": readySnapshot,
  "/outdated": {
    workspaceName: "BlendCalc",
    workspaceRoot: "/preview-only",
    availability: "package_outdated",
    version: "0.1.0-rc.2",
    compatibility: {
      state: "outdated",
      installedVersion: "0.1.0-rc.2",
      minimumVersion: "0.1.0-rc.4",
    },
    discovery: { source: "bootstrap", profile },
  },
  "/missing": {
    workspaceName: "New project",
    workspaceRoot: "/preview-only",
    availability: "package_missing",
    discovery: { source: "bootstrap", profile },
  },
  "/not-ready": {
    ...readyWithoutBaseline,
    availability: "not_ready",
    readiness: {
      state: "NOT READY",
      passed: 12,
      failed: 1,
      checks: [
        {
          id: "baseline",
          label: "Verified baseline",
          status: "fail",
          detail: "A safe local baseline has not been created yet.",
          remediation: "Open guided setup and review the baseline inputs.",
        },
      ],
    },
  },
  "/timeout": {
    workspaceName: "Large project",
    workspaceRoot: "/preview-only",
    availability: "error",
    version: "0.1.0-rc.4",
    error: {
      code: "timeout",
      message: "Project inspection timed out.",
      suggestions: [],
    },
    discovery: { source: "bootstrap", profile },
  },
};

const themeOverrides = (theme: string | null): string => {
  if (theme === "light") {
    return `
:root {
  --vscode-editor-background: #f7faf8;
  --vscode-editor-foreground: #17231e;
  --vscode-descriptionForeground: #607069;
  --vscode-panel-border: #ccd9d3;
  --vscode-widget-border: #ccd9d3;
  --vscode-sideBar-background: #eef5f1;
  --vscode-editorWidget-background: #ffffff;
  --vscode-textCodeBlock-background: #eef4f1;
  --vscode-button-background: #2baf7b;
  --vscode-button-foreground: #06130d;
  --vscode-button-hoverBackground: #239468;
  --vscode-button-secondaryBackground: #e1ebe6;
  --vscode-button-secondaryForeground: #17231e;
  --vscode-button-secondaryHoverBackground: #d3e3db;
  --vscode-focusBorder: #1476d4;
}`;
  }
  if (theme === "contrast") {
    return `
:root {
  --vscode-editor-background: #000000;
  --vscode-editor-foreground: #ffffff;
  --vscode-descriptionForeground: #ffffff;
  --vscode-panel-border: #ffffff;
  --vscode-widget-border: #ffffff;
  --vscode-sideBar-background: #000000;
  --vscode-editorWidget-background: #000000;
  --vscode-button-background: #55d6a5;
  --vscode-button-foreground: #000000;
  --vscode-focusBorder: #ffff00;
}`;
  }
  return "";
};

const server = createServer(async (request, response) => {
  const url = new URL(request.url ?? "/", `http://${host}:${requestedPort}`);
  if (url.pathname === "/workspace.css") {
    response.writeHead(200, { "Content-Type": "text/css; charset=utf-8" });
    const stylesheet = await readFile(
      resolve(repositoryRoot, "media/workspace.css"),
      "utf8",
    );
    response.end(
      `${stylesheet}\n${themeOverrides(url.searchParams.get("theme"))}`,
    );
    return;
  }
  if (url.pathname === "/rehearsal.png") {
    response.writeHead(200, { "Content-Type": "image/png" });
    response.end(
      await readFile(resolve(repositoryRoot, "media/rehearsal-readme.png")),
    );
    return;
  }
  const snapshot = snapshots[url.pathname];
  if (!snapshot) {
    response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    response.end("Unknown Rehearsal preview state.");
    return;
  }
  const origin = `http://${host}:${requestedPort}`;
  const requestedPage = url.searchParams.get("page");
  const activePage = WORKSPACE_PAGES.includes(requestedPage as WorkspacePage)
    ? (requestedPage as WorkspacePage)
    : "overview";
  const actionUris = Object.fromEntries(
    WORKSPACE_ACTION_IDS.map((action) => [action, `#preview-${action}`]),
  ) as Record<WorkspaceActionId, string>;
  const stylesheetUrl = new URL("/workspace.css", origin);
  const theme = url.searchParams.get("theme");
  if (theme) stylesheetUrl.searchParams.set("theme", theme);
  response.writeHead(200, {
    "Content-Type": "text/html; charset=utf-8",
    "Cache-Control": "no-store",
  });
  response.end(
    renderWorkspaceDocument(
      snapshot,
      {
        resourceSource: origin,
        stylesheetUri: stylesheetUrl.toString(),
        logoUri: `${origin}/rehearsal.png`,
        actionUris,
        scriptNonce: "preview-navigation-nonce",
      },
      activePage,
    ),
  );
});

server.listen(requestedPort, host, () => {
  console.log(`Rehearsal workspace preview: http://${host}:${requestedPort}`);
  console.log("States: /, /outdated, /missing, /not-ready, /timeout");
  console.log("Themes: add ?theme=light or ?theme=contrast");
  console.log("Press Ctrl+C to stop.");
});

const stop = (): void => {
  server.close(() => process.exit(0));
};
process.once("SIGINT", stop);
process.once("SIGTERM", stop);
