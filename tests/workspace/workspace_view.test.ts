import { describe, expect, it } from "vitest";
import { Script } from "node:vm";
import type { ProjectSnapshot } from "../../src/workspace/project_snapshot.js";
import {
  renderWorkspaceDocument,
  WORKSPACE_PAGES,
  type WorkspacePage,
} from "../../src/workspace/workspace_view.js";
import {
  WORKSPACE_ACTION_IDS,
  type WorkspaceActionId,
} from "../../src/workspace/action_catalog.js";
import { DEFAULT_WORKSPACE_PREFERENCES } from "../../src/workspace/workspace_preferences.js";
import {
  migrationReviewIdentity,
  MIGRATION_REVIEW_PERSISTENCE_LIMIT,
} from "../../src/workspace/workspace_view_state.js";
import { changedConfigurationFormValues } from "../../src/configuration/configuration_form.js";
import { migrationReviewCheckboxId } from "../../src/migrations/migration_view.js";
import {
  applyConfigurationProposal,
  parseConfigurationProposal,
} from "../../src/configuration/configuration_editor.js";

/** DOM doubles exercise packaged controller state, not browser layout or assistive tech. */
class ViewControl {
  readonly listeners = new Map<
    string,
    ((event: { currentTarget: ViewControl; preventDefault(): void }) => void)[]
  >();
  readonly options = [
    { value: "all" },
    { value: "primary" },
    { value: "publication" },
  ];
  readonly classList = { toggle: () => {}, contains: () => false };
  value = "all";
  checked = false;
  disabled = false;
  hidden = false;
  readonly children: ViewControl[] = [];
  private ownText = "";
  get textContent(): string {
    return (
      this.ownText + this.children.map((child) => child.textContent).join("")
    );
  }
  set textContent(value: string) {
    this.ownText = value;
    this.children.length = 0;
  }
  id = "";
  owner: ViewControl | null = null;
  fields: Record<string, string> = {};
  defaults: Record<string, string> = {};
  navigationMember = false;
  heading: ViewControl | null = null;
  readonly focusCalls: ({ preventScroll?: boolean } | undefined)[] = [];
  constructor(readonly dataset: Record<string, string> = {}) {}
  addEventListener(
    name: string,
    listener: (event: {
      currentTarget: ViewControl;
      preventDefault(): void;
    }) => void,
  ) {
    this.listeners.set(name, [...(this.listeners.get(name) ?? []), listener]);
  }
  change(value?: string) {
    if (value !== undefined) this.value = value;
    this.fire("change");
  }
  click() {
    this.fire("click");
  }
  input(name: string, value: string) {
    this.fields[name] = value;
    this.fire("input");
  }
  reset() {
    this.fire("reset");
    this.fields = { ...this.defaults };
  }
  submit() {
    this.fire("submit");
  }
  private fire(name: string) {
    this.listeners
      .get(name)
      ?.forEach((listener) =>
        listener({ currentTarget: this, preventDefault() {} }),
      );
  }
  closest(selector: string) {
    if (selector === "[data-open-migration-insight]")
      return this.dataset.openMigrationInsight ? this : null;
    if (selector === "[data-open-migration-failure]")
      return this.dataset.openMigrationFailure ? this : null;
    if (selector === "[data-rehearsal-page]")
      return this.dataset.rehearsalPage ? this : null;
    if (selector === "#workspace-navigation")
      return this.navigationMember ? this : null;
    return selector === "[data-resource-row]" ? this.owner : null;
  }
  append(child?: ViewControl) {
    if (child) this.children.push(child);
  }
  replaceChildren(...children: ViewControl[]) {
    this.ownText = "";
    this.children.splice(0, this.children.length, ...children);
  }
  setAttribute() {}
  querySelector(selector: string) {
    return selector === "h1" ? this.heading : null;
  }
  focus(options?: { preventScroll?: boolean }) {
    this.focusCalls.push(options);
  }
}

const exerciseViewScript = (
  html: string,
  savedView: object = {},
  imageDisabled = false,
  formValues?: {
    readonly simple: Record<string, string>;
    readonly other?: Record<string, string>;
  },
  additionalReviewIds: readonly string[] = [],
  comparisonControls = false,
) => {
  const migrationRows = ["primary", "publication"].map(
    (target, index) =>
      new ViewControl({
        target,
        name: target + "_migration",
        status: "candidate",
        version: "20261010000100",
        order: String(index),
      }),
  );
  const reviewControls = [
    ...migrationRows.map(
      (row) =>
        new ViewControl({
          migrationReview: row.dataset.target + ":20261010000100",
        }),
    ),
    ...additionalReviewIds.map(
      (migrationReview) => new ViewControl({ migrationReview }),
    ),
  ];
  const resourceRows = [
    new ViewControl({
      viewTarget: "primary",
      kind: "environment",
      name: "primary",
      state: "stopped",
      ownership: "project",
    }),
    new ViewControl({
      viewTarget: "publication",
      kind: "volume",
      name: "publication",
      state: "attached",
      ownership: "project",
    }),
    new ViewControl({
      viewTarget: "",
      kind: "image",
      name: "postgres",
      state: "candidate",
      ownership: "shared",
    }),
  ];
  const imageControl = new ViewControl({
    imageId: `sha256:${"c".repeat(64)}`,
    imageBytes: "1024",
  });
  imageControl.disabled = imageDisabled;
  imageControl.owner = resourceRows[2]!;
  let imageAttached = true;
  const runtimeRows = migrationRows.map(
    (row) => new ViewControl({ displayTarget: row.dataset.target! }),
  );
  const ids = new Map<string, ViewControl>();
  for (const control of reviewControls) {
    control.id = migrationReviewCheckboxId(control.dataset.migrationReview!);
    ids.set("#" + control.id, control);
  }
  [
    "migration-list",
    "migration-search",
    "migration-target",
    "migration-status",
    "migration-sort",
    "migration-visible-count",
    "migration-reviewed-count",
    "environment-target",
    "workspace-profile",
    "workspace-scope-summary",
    "resource-search",
    "resource-kind",
    "resource-state",
    "resource-ownership",
    "resource-sort",
    "resource-visible-count",
    "image-selection-summary",
    "review-image-cleanup",
    "select-eligible-images",
    "clear-image-selection",
  ].forEach((id) => ids.set("#" + id, new ViewControl()));
  for (const id of ["application-url", "active-application-url"]) {
    const field = new RegExp(`<input id="${id}"[^>]*value="([^"]*)"`).exec(
      html,
    );
    if (!field) continue;
    const control = new ViewControl();
    control.id = id;
    control.value = field[1]!;
    ids.set("#" + id, control);
  }
  for (const id of ["open-custom-application", "open-active-application"]) {
    if (html.includes(`id="${id}"`)) ids.set("#" + id, new ViewControl());
  }
  const sessionNodes = Object.fromEntries(
    ["label", "detail", "guidance"].map((kind) => [
      kind,
      [
        ...html.matchAll(
          new RegExp(`<[^>]+ data-sandbox-session-${kind}[^>]*>([^<]*)<`, "gu"),
        ),
      ].map((match) => {
        const node = new ViewControl();
        node.textContent = match[1]!;
        return node;
      }),
    ]),
  ) as Record<"label" | "detail" | "guidance", ViewControl[]>;
  ids.get("#migration-search")!.value = "";
  ids.get("#resource-search")!.value = "";
  ids.get("#workspace-profile")!.value = "full";
  ids.get("#resource-sort")!.value = "name";
  ids.get("#migration-sort")!.value = "order";
  if (comparisonControls) {
    for (const id of ["compare-left", "compare-right"]) {
      const field = new RegExp(
        `<select id="${id}"([^>]*)>([\\s\\S]*?)</select>`,
      ).exec(html);
      if (!field) throw new Error("Missing comparison control.");
      const options = [
        ...field[2]!.matchAll(/<option value="([^"]*)"( selected)?>/gu),
      ];
      const control = new ViewControl();
      control.disabled = field[1]!.includes("disabled");
      control.value =
        (options.find((option) => option[2]) ?? options[0])?.[1] ?? "";
      ids.set("#" + id, control);
    }
    ids.set("#comparison-result", new ViewControl());
  }
  if (formValues) {
    const form = new ViewControl();
    form.fields = { ...formValues.simple };
    form.defaults = { ...formValues.simple };
    ids.set("#configuration-controls", form);
    if (formValues.other) {
      const other = new ViewControl();
      other.fields = { ...formValues.other };
      other.defaults = { ...formValues.other };
      ids.set("#core-configuration-controls", other);
    }
  }
  let state: Record<string, unknown> = {
    unrelatedHostState: "preserved",
    view: savedView,
  };
  const messages: unknown[] = [];
  const initialPage =
    /id="([a-z-]+)" class="workspace-page workspace-page--active"/u.exec(
      html,
    )?.[1];
  const pages = new Map(
    WORKSPACE_PAGES.map((page) => {
      const section = new ViewControl();
      section.id = page;
      section.hidden = page !== initialPage;
      section.heading = new ViewControl();
      return [page, section] as const;
    }),
  );
  const navigation = WORKSPACE_PAGES.map((page) => {
    const control = new ViewControl({ rehearsalPage: page });
    control.navigationMember = true;
    return control;
  });
  const documentListeners = new Map<
    string,
    ((event: { target: ViewControl }) => void)[]
  >();
  const windowMessages: ((event: { data: unknown }) => void)[] = [];
  let activeElement: ViewControl | null = null;
  const scrolls: { top: number; left?: number; behavior?: string }[] = [];
  const scrolling = {
    scrollTop: 0,
    scrollLeft: 0,
    scrollTo(position: { top: number; left?: number; behavior?: string }) {
      this.scrollTop = position.top;
      this.scrollLeft = position.left ?? this.scrollLeft;
      scrolls.push(position);
    },
  };
  const all = (selector: string) => {
    for (const kind of ["label", "detail", "guidance"] as const)
      if (selector === `[data-sandbox-session-${kind}]`)
        return sessionNodes[kind];
    if (selector === ".workspace-page") return [...pages.values()];
    if (selector === "[data-rehearsal-page]") return navigation;
    if (
      selector ===
      "#configuration-controls,#core-configuration-controls,#named-profile-controls,.resource-environment-form"
    )
      return [
        ids.get("#configuration-controls"),
        ids.get("#core-configuration-controls"),
      ].filter((value) => value !== undefined);
    if (selector === "[data-migration-row]") return migrationRows;
    if (selector === "[data-migration-review]") return reviewControls;
    if (selector === "[data-migration-review]:checked")
      return reviewControls.filter((control) => control.checked);
    if (selector === "[data-resource-row]") return resourceRows;
    if (selector === "[data-image-id]")
      return imageAttached ? [imageControl] : [];
    if (selector === "[data-display-target]") return runtimeRows;
    if (selector === "#workspace-scope-summary,[data-scope-summary]")
      return [ids.get("#workspace-scope-summary")!];
    return [];
  };
  const script = /<script nonce="[^"]+">([\s\S]*?)<\/script>/u.exec(html)?.[1];
  if (!script) throw new Error("Missing packaged webview controller.");
  new Script(script).runInNewContext(
    {
      acquireVsCodeApi: () => ({
        getState: () => state,
        setState: (value: Record<string, unknown>) => {
          state = value;
        },
        postMessage: (message: unknown) => messages.push(message),
      }),
      HTMLElement: ViewControl,
      Element: ViewControl,
      URL,
      TextEncoder,
      queueMicrotask,
      FormData: class {
        constructor(private readonly form: ViewControl) {}
        entries() {
          return Object.entries(this.form.fields)[Symbol.iterator]();
        }
      },
      document: {
        get activeElement() {
          return activeElement;
        },
        querySelector: (selector: string) => ids.get(selector) ?? null,
        querySelectorAll: all,
        addEventListener: (
          name: string,
          listener: (event: { target: ViewControl }) => void,
        ) => {
          documentListeners.set(name, [
            ...(documentListeners.get(name) ?? []),
            listener,
          ]);
        },
        getElementById: (id: string) => ids.get("#" + id) ?? null,
        createElement: () => new ViewControl(),
        scrollingElement: scrolling,
      },
      window: {
        matchMedia: () => ({ matches: false, addEventListener: () => {} }),
        addEventListener: (
          name: string,
          listener: (event: { data: unknown }) => void,
        ) => {
          if (name === "message") windowMessages.push(listener);
        },
      },
    },
    { timeout: 1000 },
  );
  return {
    ids,
    migrationRows,
    resourceRows,
    runtimeRows,
    reviewControls,
    imageControl,
    detachImage: () => {
      imageAttached = false;
      resourceRows[2]!.hidden = true;
    },
    rememberView: () => {
      for (const listener of documentListeners.get("change") ?? [])
        listener({ target: imageControl });
    },
    messages,
    sessionNodes,
    receive: (data: unknown) =>
      windowMessages.forEach((listener) => listener({ data })),
    focus: (control: ViewControl) => {
      activeElement = control;
      control.focus();
    },
    activeElement: () => activeElement,
    pages,
    scrolling,
    scrolls,
    navigate: (page: WorkspacePage, sidebar = true) => {
      const control = sidebar
        ? navigation.find((item) => item.dataset.rehearsalPage === page)!
        : new ViewControl({ rehearsalPage: page });
      for (const listener of documentListeners.get("click") ?? [])
        listener({ target: control });
    },
    openMigrationFailure: (operationId: string) => {
      const control = new ViewControl({ openMigrationFailure: operationId });
      for (const listener of documentListeners.get("click") ?? [])
        listener({ target: control });
    },
    openMigrationInsight: (findingId: string) => {
      const control = new ViewControl({ openMigrationInsight: findingId });
      for (const listener of documentListeners.get("click") ?? [])
        listener({ target: control });
    },
    state: () => state,
  };
};

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

const sandboxSnapshot = (
  phase:
    | "application-start"
    | "interactive-session"
    | "cleanup"
    | null = "interactive-session",
): ProjectSnapshot => ({
  workspaceName: "Active project",
  workspaceRoot: "/synthetic",
  availability: "operation_active",
  version: "1.0.0",
  activity: {
    schemaVersion: 1,
    state: "busy",
    operation: {
      kind: "open",
      startedAt: "2026-10-18T22:00:00.000Z",
      rehearsalVersion: "1.0.0",
      ...(phase
        ? {
            progress: {
              schemaVersion: 1,
              operationId: "a".repeat(64),
              state: "running",
              startedAt: "2026-10-18T22:00:00.000Z",
              updatedAt: "2026-10-18T22:00:01.000Z",
              elapsedMilliseconds: 1000,
              currentStage: {
                id: 1,
                phase,
                target: null,
                state: "running",
                startedAt: "2026-10-18T22:00:00.000Z",
                endedAt: null,
                durationMilliseconds: 1000,
              },
              completedStages: [],
              events: [],
              truncated: { stages: false, events: false },
            },
          }
        : {}),
    },
  },
});

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
  resources: {
    schemaVersion: 1,
    inspectedAt: "2026-10-12T00:00:00.000Z",
    engine: {
      state: "running",
      context: "colima",
      disk: {
        backend: "colima",
        totalBytes: 100 * 1024 ** 3,
        usedBytes: 80 * 1024 ** 3,
        availableBytes: 20 * 1024 ** 3,
        usedPercent: 80,
      },
      resources: [
        {
          type: "Images",
          totalCount: 10,
          activeCount: 2,
          size: "5GB",
          reclaimable: "3GB (60%)",
        },
      ],
    },
    environments: [
      {
        target: "primary",
        projectId: "example-project-rehearsal",
        provider: "postgresql",
        configPath: "/private/rehearsal-test-project/rehearsal.config.mjs",
        state: "stopped",
        containerCount: 1,
        runningContainerCount: 0,
        volumeCount: 1,
        diskUsageBytes: 1_500_000_000,
        cpuPercent: 2.5,
        memoryUsageBytes: 128 * 1024 ** 2,
        memoryLimitBytes: 2 * 1024 ** 3,
        createdAt: "2026-10-11T00:00:00Z",
        lastActivityAt: "2026-10-11T00:00:00Z",
        retention: "persistent",
        cleanupEligibility: "preview-required",
        restartPolicies: ["no"],
      },
    ],
    stale: {
      stoppedCount: 1,
      digest: "c".repeat(64),
      targets: ["primary"],
    },
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

describe("truthful command, proof and next-step presentation", () => {
  const databaseOnly = (): ProjectSnapshot => {
    const original = readySnapshot();
    return {
      ...original,
      candidates: { ...original.candidates!, count: 0, files: [] },
      runtime: {
        ...original.runtime!,
        state: "running",
        targets: original.runtime!.targets.map((target) => ({
          ...target,
          state: "running",
          reason: null,
        })),
      },
      configuration: {
        application: {
          startCommand: "node no-browser.cjs",
          proofCommand: "node tutorial-proof.cjs",
          readinessUrl: null,
        },
      },
    };
  };
  const recordedPass = (): ProjectSnapshot => {
    const current = databaseOnly();
    const progress =
      sandboxSnapshot("application-start").activity!.operation!.progress!;
    return {
      ...current,
      activity: {
        ...current.activity!,
        recent: [
          {
            kind: "run",
            rehearsalVersion: current.version!,
            progress: {
              ...progress,
              state: "completed",
              currentStage: null,
              completedStages: [
                {
                  ...progress.currentStage!,
                  phase: "application-proof",
                  target: "primary",
                  state: "completed",
                  endedAt: progress.updatedAt,
                },
              ],
              events: [],
            },
          },
        ],
      },
    };
  };
  it("does not call a running database an active rehearsal or proof success", () => {
    const html = renderWorkspaceDocument(databaseOnly(), assets);
    const overview = html.match(
      /<section id="overview"[\s\S]*?<\/section>/u,
    )![0];
    expect(overview).toContain("Database sandbox running");
    expect(overview).toContain("No Rehearsal command is active");
    expect(overview).toContain("No completed run evidence");
    expect(overview).toContain("CLI proof configured · not yet proven");
    expect(overview).not.toContain("Ready to rehearse");
    expect(overview).not.toContain("CLI proof passed");
    expect(overview).not.toContain(
      "<strong>Run</strong><small>running</small>",
    );
  });
  it("keeps the database-only tutorial on database verification instead of app-launch setup", () => {
    const html = renderWorkspaceDocument(databaseOnly(), assets);
    expect(html).toContain("configured for database-only testing");
    expect(html).toContain("Verify database");
    expect(html).toContain("CLI proof configured");
    expect(html).not.toContain("Configure application launch");
    expect(html).not.toContain("Configure application proof");
    expect(html).not.toContain(
      'href="command:rehearsal.workspaceAction?openSandbox"',
    );
    expect(html).toContain(
      "HTTP readiness endpoint are not required for the CLI proof",
    );
  });
  it("shows configured and recorded successful CLI proof independently of HTTP readiness", () => {
    const html = renderWorkspaceDocument(recordedPass(), assets);
    const overview = html.match(
      /<section id="overview"[\s\S]*?<\/section>/u,
    )![0];
    expect(overview).toContain("Last rehearsal completed");
    expect(overview).toContain("Last run completed");
    expect(overview).toContain("CLI proof passed (recorded)");
    expect(overview).toContain("No Rehearsal command is active");
    expect(overview).toContain(
      "not verification of changed configuration or migrations",
    );
    expect(overview).not.toContain("Configure application proof");
    expect(overview).not.toContain("Rehearsal command running");
    const changed = recordedPass();
    const changedHtml = renderWorkspaceDocument(
      {
        ...changed,
        candidates: { ...changed.candidates!, count: 1 },
        configuration: {
          application: {
            ...changed.configuration!.application,
            proofCommand: "node changed-proof.cjs",
          },
        },
      },
      assets,
    );
    expect(changedHtml).toContain("CLI proof passed (recorded)");
    expect(changedHtml).toContain(
      "not verification of changed configuration or migrations",
    );
    expect(changedHtml).toContain("Review your pending migration");
  });
  it("does not advertise recorded proof as current success during an unsafe activity state", () => {
    const current = recordedPass();
    const html = renderWorkspaceDocument(
      {
        ...current,
        availability: "operation_attention",
        activity: { ...current.activity!, state: "stale" },
      },
      assets,
    );
    expect(html).not.toContain("Last rehearsal completed");
    expect(html).not.toContain("CLI proof passed (recorded)");
    expect(html).toContain("Operation needs review");
  });
  it("delegates static finding navigation with only an opaque finding ID", () => {
    const view = exerciseViewScript(
        renderWorkspaceDocument(readySnapshot(), assets),
      ),
      findingId = "e".repeat(64);
    view.openMigrationInsight(findingId);
    expect(view.messages).toContainEqual({
      type: "openMigrationInsight",
      findingId,
    });
    expect(
      view.messages.filter(
        (message) =>
          (message as { type?: string }).type === "openMigrationInsight",
      ),
    ).toHaveLength(1);
  });
  it("delegates a newly inserted migration failure control using only its operation ID", () => {
    const view = exerciseViewScript(
      renderWorkspaceDocument(readySnapshot(), assets),
    );
    const operationId = "d".repeat(64);
    view.openMigrationFailure(operationId);
    expect(view.messages).toContainEqual({
      type: "openMigrationFailure",
      operationId,
    });
    expect(
      view.messages.filter(
        (message) =>
          (message as { type?: string }).type === "openMigrationFailure",
      ),
    ).toHaveLength(1);
  });
  it("uses the dedicated external-link reason without mislabeling other invalid packages", () => {
    const broken: ProjectSnapshot = {
      workspaceName: "Local checkout",
      workspaceRoot: "/private/not-displayed",
      availability: "error",
      error: {
        code: "package_link_external",
        message: "/private/raw-provider-message",
        suggestions: ["private-untrusted-suggestion"],
      },
    };
    const html = renderWorkspaceDocument(broken, assets);
    expect(html).toContain("Project package link needs repair");
    expect(html).toContain("Core not resolved");
    expect(html).not.toContain("Core not installed");
    expect(html).toContain("--install-links");
    expect(html).toContain("Refresh after installing");
    expect(html).not.toContain("/private/raw-provider-message");
    expect(html).not.toContain("private-untrusted-suggestion");
    const other = renderWorkspaceDocument(
      { ...broken, error: { ...broken.error!, code: "package_invalid" } },
      assets,
    );
    expect(other).not.toContain("Project package link needs repair");
    expect(other).not.toContain("--install-links");
  });
});

describe("not-ready configured target rendering", () => {
  it("shows public configured resources and profile target choices without a baseline or verified runtime", () => {
    const original = readySnapshot();
    const {
      runtime: _runtime,
      baseline: _baseline,
      candidates: _candidates,
      ...partial
    } = original;
    const snapshot: ProjectSnapshot = {
      ...partial,
      availability: "not_ready",
      configurationMetadata: {
        schemaVersion: 1,
        path: "rehearsal.config.mjs",
        sourceSha256: "a".repeat(64),
        fields: [],
        profiles: [],
        pathResolution: "Project root",
        manualFields: "Manual review",
      },
      resources: {
        ...original.resources!,
        environments: [
          {
            ...original.resources!.environments[0]!,
            state: "absent",
            containerCount: 0,
            runningContainerCount: 0,
            volumeCount: 0,
            cleanupEligibility: "not-present",
            classification: {
              schemaVersion: 1,
              role: "configured-environment",
              dataPersistence: "preserved-on-stop",
              presence: {
                state: "not-created",
                reason: "no-owned-resources-observed",
              },
              receipt: {
                state: "unknown",
                reason: "receipt-unavailable",
                scope: "format-and-provider-only",
              },
              review: {
                state: "disabled",
                reason: "cutoff-disabled",
                staleAfterSeconds: null,
                lastObservableActivityAt: null,
              },
            },
          },
        ],
      },
    };
    const html = renderWorkspaceDocument(snapshot, assets, "runtime");
    expect(html).toContain("verified receipt unavailable · not created");
    expect(html).toContain('data-display-target="primary"');
    expect(html).toContain('name="target" value="primary"');
    expect(html).toContain("Configured resources are visible");
    expect(html).not.toContain("No local runtime targets are available yet");
    expect(html).not.toContain("verified receipt available · created");
    expect(html).toContain('class="state-chip">1 target</span>');
  });
});

describe("explicit workspace navigation scroll", () => {
  it("starts each newly selected page at the top instead of carrying the previous page's lower position", () => {
    const view = exerciseViewScript(
      renderWorkspaceDocument(readySnapshot(), assets, "configuration"),
    );
    view.scrolling.scrollTop = 2400;
    view.navigate("activity");
    expect(view.scrolling.scrollTop).toBe(0);
    expect(view.pages.get("activity")!.hidden).toBe(false);
    expect(view.pages.get("configuration")!.hidden).toBe(true);
    view.scrolling.scrollTop = 950;
    view.navigate("overview");
    expect(view.scrolling.scrollTop).toBe(0);
    expect(view.pages.get("overview")!.hidden).toBe(false);
    expect(view.scrolls).toEqual([
      { top: 0, left: 0, behavior: "instant" },
      { top: 0, left: 0, behavior: "instant" },
    ]);
  });

  it("preserves restored scroll and does not jump when the current page is selected again", () => {
    const view = exerciseViewScript(
      renderWorkspaceDocument(readySnapshot(), assets, "configuration"),
      { scroll: 1800 },
    );
    expect(view.scrolling.scrollTop).toBe(1800);
    const initialCalls = view.scrolls.length;
    view.navigate("configuration");
    view.navigate("configuration", false);
    expect(view.scrolling.scrollTop).toBe(1800);
    expect(view.scrolls).toHaveLength(initialCalls);
    expect(view.pages.get("configuration")!.heading!.focusCalls).toEqual([]);
  });

  it("keeps contextual navigation's heading focus without letting focus scrolling hide the new page header", () => {
    const view = exerciseViewScript(
      renderWorkspaceDocument(readySnapshot(), assets, "configuration"),
    );
    view.scrolling.scrollTop = 2200;
    view.navigate("runtime", false);
    expect(view.pages.get("runtime")!.heading!.focusCalls).toEqual([
      { preventScroll: true },
    ]);
    expect(view.scrolling.scrollTop).toBe(0);
    expect(view.messages).toContainEqual({ type: "navigate", page: "runtime" });
  });
});

describe("simple configuration form changes", () => {
  const initial = () => ({
    applicationUrl: "http://localhost:5175",
    retainBaselineGenerations: "2",
    startCommand: "npm run dev",
    proofCommand: "npm test",
    runPersistence: "keep-until-stop",
    openPersistence: "keep-until-stop",
  });
  const formView = (other?: Record<string, string>) =>
    exerciseViewScript(
      renderWorkspaceDocument(readySnapshot(), assets, "configuration"),
      {},
      false,
      { simple: initial(), ...(other ? { other } : {}) },
    );
  const reviews = (messages: readonly unknown[]) =>
    messages.filter(
      (message) =>
        (message as { type?: unknown }).type === "reviewConfiguration",
    ) as { values: Record<string, string> }[];

  it("submits only 2→3 retention and does not inject untouched literal lifecycle defaults", () => {
    const view = formView();
    const form = view.ids.get("#configuration-controls")!;
    form.submit();
    expect(reviews(view.messages).at(-1)!.values).toEqual({});
    form.input("retainBaselineGenerations", "3");
    form.submit();
    const values = reviews(view.messages).at(-1)!.values;
    expect(values).toEqual({ retainBaselineGenerations: "3" });
    const edited = applyConfigurationProposal({
      source: "export default { cleanup: { retainBaselineGenerations: 2 } };\n",
      proposal: parseConfigurationProposal(values),
    });
    expect(edited.changedFields).toEqual(["cleanup.retainBaselineGenerations"]);
    expect(edited.source).toContain("retainBaselineGenerations: 3");
    expect(edited.source).not.toContain("lifecycle");
    expect(edited.source).not.toContain("profiles");
  });

  it("allows deliberate lifecycle changes but omits reverted and semantically unchanged values", () => {
    const view = formView();
    const form = view.ids.get("#configuration-controls")!;
    form.input("runPersistence", "stop-after-run");
    form.submit();
    expect(reviews(view.messages).at(-1)!.values).toEqual({
      runPersistence: "stop-after-run",
    });
    form.input("runPersistence", "keep-until-stop");
    form.input("applicationUrl", "http://localhost:5175/");
    form.input("retainBaselineGenerations", "02");
    form.submit();
    expect(reviews(view.messages).at(-1)!.values).toEqual({});
    expect(
      changedConfigurationFormValues(initial(), {
        ...initial(),
        applicationUrl: "not a valid URL",
      }),
    ).toEqual({ applicationUrl: "not a valid URL" });
  });

  it("releases the draft guard after native reset restores the initial form values", async () => {
    const view = formView();
    const form = view.ids.get("#configuration-controls")!;
    form.input("retainBaselineGenerations", "3");
    expect(view.messages.at(-1)).toEqual({ type: "editing", editing: true });
    form.reset();
    await Promise.resolve();
    expect(view.messages.at(-1)).toEqual({ type: "editing", editing: false });
    form.submit();
    expect(reviews(view.messages).at(-1)!.values).toEqual({});
  });

  it("keeps another configuration form's unsaved draft protected when only the simple form resets", async () => {
    const view = formView({ "resources.retainedEnvironmentCount": "2" });
    const form = view.ids.get("#configuration-controls")!;
    const other = view.ids.get("#core-configuration-controls")!;
    other.input("resources.retainedEnvironmentCount", "3");
    form.input("retainBaselineGenerations", "3");
    form.reset();
    await Promise.resolve();
    expect(view.messages.at(-1)).toEqual({ type: "editing", editing: true });
    other.reset();
    await Promise.resolve();
    expect(view.messages.at(-1)).toEqual({ type: "editing", editing: false });
  });
});

describe("comparison availability and recovery", () => {
  const view = (snapshot: ProjectSnapshot, loading = false) => {
    const html = renderWorkspaceDocument(
      snapshot,
      assets,
      "activity",
      DEFAULT_WORKSPACE_PREFERENCES,
      [],
      loading ? "loading" : "idle",
    );
    return {
      html,
      ...exerciseViewScript(html, {}, false, undefined, [], true),
    };
  };
  const result = (current: ReturnType<typeof view>) =>
    current.ids.get("#comparison-result")!;
  const baselineOnly = () => {
    const { runtime: _runtime, ...snapshot } = readySnapshot();
    return snapshot;
  };

  it("disables empty controls with recovery instead of a history-cap explanation or equal facts", () => {
    const { baseline: _baseline, ...snapshot } = baselineOnly();
    const current = view(snapshot);
    expect(current.ids.get("#compare-left")!.disabled).toBe(true);
    expect(current.ids.get("#compare-right")!.disabled).toBe(true);
    expect(result(current).textContent).toContain(
      "No reviewed environment or baseline evidence",
    );
    expect(result(current).textContent).not.toMatch(
      /first 32|: equal|larger histories/u,
    );
    expect(result(current).children).toEqual([]);
    expect(current.html).toContain(
      'aria-describedby="comparison-result" disabled',
    );
    expect(current.html).toContain("No comparison evidence available");
    expect(current.html).toContain("Review project setup");
    expect(current.html).toContain("Refresh comparison evidence");
  });

  it.each([
    ["loading", "Checking comparison evidence"],
    ["operation_active", "paused while a project operation is running"],
    ["operation_attention", "interrupted or unsafe operation"],
    ["untrusted", "Review Workspace Trust"],
    ["package_missing", "Install Rehearsal"],
    ["package_outdated", "Update the project's Rehearsal package"],
    ["error", "project check did not finish safely"],
  ] as const)(
    "does not turn retained details into comparison evidence during %s",
    (availability, guidance) => {
      const current = view({ ...readySnapshot(), availability });
      expect(current.ids.get("#compare-left")!.disabled).toBe(true);
      expect(current.ids.get("#compare-right")!.disabled).toBe(true);
      expect(result(current).textContent).toContain(guidance);
      expect(result(current).children).toEqual([]);
      current.ids
        .get("#compare-right")!
        .change(current.ids.get("#compare-left")!.value);
      expect(result(current).textContent).toContain(guidance);
      expect(result(current).textContent).not.toContain(": equal");
    },
  );

  it("pauses a ready comparison while its project inspection is loading", () => {
    const current = view(readySnapshot(), true);
    expect(current.ids.get("#compare-left")!.disabled).toBe(true);
    expect(result(current).textContent).toContain(
      "Wait for the project inspection to finish",
    );
    expect(result(current).children).toEqual([]);
  });

  it("distinguishes a valid single generation from missing evidence without comparing it to itself", () => {
    const snapshot = baselineOnly();
    const current = view({
      ...snapshot,
      baseline: {
        ...snapshot.baseline!,
        generations: snapshot.baseline!.generations!.slice(0, 1),
      },
    });
    expect(current.ids.get("#compare-left")!.disabled).toBe(true);
    expect(current.ids.get("#compare-right")!.disabled).toBe(true);
    expect(result(current).textContent).toContain(
      "Only one reviewed environment or baseline is available",
    );
    expect(result(current).textContent).toContain("two distinct entries");
    expect(result(current).textContent).not.toMatch(
      /No reviewed|first 32|: equal/u,
    );
    expect(current.html).toContain(
      snapshot.baseline!.generations![0]!.generationId,
    );
  });

  it("starts with distinct generations and retains different and unavailable facts", () => {
    const current = view(baselineOnly());
    expect(current.ids.get("#compare-left")!.disabled).toBe(false);
    expect(current.ids.get("#compare-right")!.disabled).toBe(false);
    expect(current.ids.get("#compare-left")!.value).not.toBe(
      current.ids.get("#compare-right")!.value,
    );
    expect(result(current).textContent).toContain(
      "Database rows: different — 10003 / 9990",
    );
    expect(result(current).textContent).toContain(
      "Reviewed source-column schema: unavailable",
    );
    expect(result(current).textContent).toContain(
      "Equal aggregate counts do not prove equal rows",
    );
  });

  it("keeps equal zero aggregates separate from unavailable evidence for distinct entries", () => {
    const snapshot = baselineOnly();
    const current = view({
      ...snapshot,
      baseline: {
        ...snapshot.baseline!,
        generations: snapshot.baseline!.generations!.map((generation) => ({
          ...generation,
          rowCount: 0,
        })),
      },
    });
    expect(result(current).textContent).toContain(
      "Database rows: equal — 0 / 0",
    );
    expect(result(current).textContent).toContain(
      "Reviewed source-column schema: unavailable",
    );
  });

  it("removes previous facts when the user selects the same entry twice", () => {
    const current = view(baselineOnly());
    expect(result(current).children.length).toBeGreaterThan(0);
    current.ids
      .get("#compare-right")!
      .change(current.ids.get("#compare-left")!.value);
    expect(result(current).textContent).toContain(
      "Choose two distinct environments or baselines",
    );
    expect(result(current).children).toEqual([]);
    expect(result(current).textContent).not.toContain(": equal");
  });

  it("reserves the live-pair cap explanation for a pair actually outside the bounded matrix", () => {
    const snapshot = baselineOnly();
    const template = snapshot.baseline!.generations![0]!;
    const current = view({
      ...snapshot,
      baseline: {
        ...snapshot.baseline!,
        generations: Array.from({ length: 33 }, (_, index) => ({
          ...template,
          generationId: `generation-${index}`,
        })),
      },
    });
    current.ids.get("#compare-right")!.change("baseline:generation-32");
    expect(result(current).textContent).toContain(
      "selected pair is outside the first 32",
    );
    expect(result(current).textContent).not.toContain("No reviewed");
    expect(result(current).children).toEqual([]);
  });
});

describe("workspace control state and truthful actions", () => {
  it.each([
    ["idle", "success", "No active operation"],
    ["busy", "active", "Operation in progress"],
    ["stale", "warning", "Review operation state"],
    ["invalid", "warning", "Review operation state"],
    [undefined, "muted", "Activity unavailable"],
  ] as const)("gives activity %s its truthful %s tone", (state, tone, note) => {
    const { activity: _activity, ...snapshot } = readySnapshot();
    const html = renderWorkspaceDocument(
      state
        ? {
            ...snapshot,
            activity: { schemaVersion: 1, state, operation: null },
          }
        : snapshot,
      assets,
      "activity",
    );
    expect(html).toContain(
      `<article class="metric metric--${tone}">\n    <div class="metric__top"><span>Activity</span>`,
    );
    expect(html).toContain(
      `<strong>${state ?? "Unavailable"}</strong>\n    <small>${note}</small>`,
    );
    if (tone !== "success") {
      expect(html).not.toContain(
        '<article class="metric metric--success">\n    <div class="metric__top"><span>Activity</span>',
      );
    }
  });
  it("retains a known operation kind in the activity subtitle", () => {
    const html = renderWorkspaceDocument(
      {
        ...readySnapshot(),
        activity: {
          schemaVersion: 1,
          state: "busy",
          operation: {
            kind: "run",
            startedAt: "2026-10-17T00:00:00.000Z",
            rehearsalVersion: "0.1.0-rc.8",
          },
        },
      },
      assets,
      "activity",
    );
    expect(html).toContain("<strong>busy</strong>\n    <small>run</small>");
  });
  it("renders exact version identifiers without capitalizing or clipping their value", () => {
    const html = renderWorkspaceDocument(readySnapshot(), assets, "activity");
    expect(html).toContain('class="metric metric--muted metric--identifier"');
    expect(html).toContain("<strong>0.1.0-rc.4</strong>");
  });
  it("marks candidate digests as verbatim identifiers rather than capitalized status text", () => {
    const html = renderWorkspaceDocument(readySnapshot(), assets, "activity");
    expect(html).toMatch(
      /<article class="metric metric--muted metric--identifier">\s*<div class="metric__top"><span>Candidate digest<\/span>[\s\S]*?<strong>aaaaaaaaaaaa<\/strong>/u,
    );
  });
  it("distinguishes custom, saved and suggested addresses and preserves the separate health URL", () => {
    const snapshot = readySnapshot();
    const saved = renderWorkspaceDocument(snapshot, assets, "configuration");
    expect(saved).toContain("Saved &amp; validated browser address");
    expect(saved).toContain("http://localhost:5175/health");
    expect(saved).toContain(
      "Does not change the readiness endpoint or provider callback",
    );
    expect(saved).toContain("Restore form values");
    expect(saved).not.toContain("Restore detected values");
    const custom = renderWorkspaceDocument(snapshot, assets, "configuration", {
      ...DEFAULT_WORKSPACE_PREFERENCES,
      applicationUrl: "http://[::1]:6000/app/callback",
    });
    expect(custom).toContain("Your custom browser address");
    expect(custom).toContain("http://[::1]:6000/app/callback");
    expect(custom).toContain("http://localhost:5175/health");
    const {
      applicationUrl: _address,
      configuration: _configuration,
      ...unconfigured
    } = snapshot;
    const suggested = renderWorkspaceDocument(
      unconfigured,
      assets,
      "configuration",
    );
    expect(suggested).toContain("Suggested example");
    expect(suggested).toContain("review the project script before saving");
    expect(suggested).not.toContain("Saved &amp; validated browser address");
  });
  it("offers database verification without treating unknown application evidence as missing proof configuration", () => {
    const original = readySnapshot();
    const snapshot = {
      ...original,
      candidates: { ...original.candidates!, count: 0, files: [] },
    };
    delete snapshot.configuration;
    const html = renderWorkspaceDocument(snapshot, assets);
    expect(html).not.toContain(
      'href="command:rehearsal.workspaceAction?openSandbox"',
    );
    expect(html).not.toContain("Configure application launch");
    expect(html).toContain("Verify database");
    expect(html).not.toContain("App connected");
    expect(html).toContain("Proof evidence unavailable");
    expect(html).not.toContain(
      'href="command:rehearsal.workspaceAction?identityConnect"',
    );
  });

  it("does not announce readiness or offer operations from missing readiness evidence", () => {
    const original = readySnapshot();
    const snapshot = { ...original };
    delete snapshot.readiness;
    const html = renderWorkspaceDocument(snapshot, assets);
    expect(html).toContain("Project readiness is not yet proven");
    expect(html).not.toContain(
      'href="command:rehearsal.workspaceAction?openSandbox"',
    );
    expect(html).not.toContain(
      'href="command:rehearsal.workspaceAction?runRehearsal"',
    );
  });

  it("starts review-only legacy checklists unchecked and never invents a version", () => {
    const original = readySnapshot();
    const html = renderWorkspaceDocument(
      {
        ...original,
        candidates: { ...original.candidates!, files: ["name-only.sql"] },
      },
      assets,
    );
    expect(html).toContain('data-migration-review="primary:0"');
    expect(html).toContain(`id="${migrationReviewCheckboxId("primary:0")}"`);
    expect(html).not.toMatch(/data-migration-review="[^"]+"[^>]+checked/u);
    expect(html).toContain("Version unavailable");
    expect(html).not.toContain('data-version="00000000000000"');
  });

  it("keeps legacy Name sorting independent of filename extensions and version prefixes", () => {
    const snapshot = readySnapshot();
    const html = renderWorkspaceDocument(
      {
        ...snapshot,
        candidates: {
          ...snapshot.candidates!,
          files: [
            "20261001000000_add_widget_index.sql",
            "20261002000000_add_widget.sql",
          ],
        },
      },
      assets,
    );
    expect(html).toContain('data-sort-name="add_widget_index"');
    expect(html).toContain('data-sort-name="add_widget"');
    expect(html).toContain('data-name="20261001000000_add_widget_index.sql"');
  });

  it("restores valid reviews, refreshes the counter and revalidates eligible image selection", () => {
    const snapshot = readySnapshot();
    const html = renderWorkspaceDocument(snapshot, assets);
    const controller = exerciseViewScript(html, {
      reviewIdentity: migrationReviewIdentity(snapshot),
      reviewed: ["primary:20261010000100", "missing"],
      images: [`sha256:${"c".repeat(64)}`, `sha256:${"d".repeat(64)}`],
    });
    expect(controller.reviewControls.map((control) => control.checked)).toEqual(
      [true, false],
    );
    expect(controller.ids.get("#migration-reviewed-count")!.textContent).toBe(
      "1 reviewed",
    );
    expect(controller.imageControl.checked).toBe(true);
    expect(controller.ids.get("#review-image-cleanup")!.disabled).toBe(false);
    expect(controller.state()).toMatchObject({
      unrelatedHostState: "preserved",
      view: {
        images: [`sha256:${"c".repeat(64)}`],
        reviewed: ["primary:20261010000100"],
      },
    });
    controller.ids.get("#clear-image-selection")!.click();
    expect(controller.state()).toMatchObject({ view: { images: [] } });
    expect(controller.ids.get("#review-image-cleanup")!.disabled).toBe(true);
  });

  it("restores keyboard focus to the target-scoped review control without granting review approval", () => {
    const snapshot = readySnapshot();
    const id = "primary:20261010000100";
    const html = renderWorkspaceDocument(snapshot, assets, "migrations");
    const saved = {
      focus: migrationReviewCheckboxId(id),
      reviewed: [id],
      reviewIdentity: migrationReviewIdentity(snapshot),
    };
    const restored = exerciseViewScript(html, saved);
    expect(restored.reviewControls[0]!.focusCalls).toEqual([
      { preventScroll: true },
    ]);
    expect(restored.reviewControls.map(({ checked }) => checked)).toEqual([
      true,
      false,
    ]);
    const stale = exerciseViewScript(html, {
      ...saved,
      reviewIdentity: "superseded-plan",
    });
    expect(stale.reviewControls.every(({ checked }) => !checked)).toBe(true);
    expect(snapshot.candidates).toEqual(readySnapshot().candidates);
  });

  it("discloses the review-memory cap without changing the complete plan or current review count", () => {
    const snapshot = readySnapshot();
    const html = renderWorkspaceDocument(snapshot, assets, "migrations");
    const extraIds = Array.from(
      { length: MIGRATION_REVIEW_PERSISTENCE_LIMIT },
      (_, index) => `primary:review-${index}`,
    );
    const controller = exerciseViewScript(html, {}, false, undefined, extraIds);
    for (const control of controller.reviewControls) control.checked = true;
    controller.reviewControls[0]!.change();
    controller.ids.get("#environment-target")!.change("all");
    expect(controller.ids.get("#migration-reviewed-count")!.textContent).toBe(
      "1002 reviewed · Only the first 1000 review checks are remembered after refresh.",
    );
    const saved = controller.state().view as {
      reviewed: string[];
      reviewIdentity: string;
    };
    expect(saved.reviewed).toHaveLength(MIGRATION_REVIEW_PERSISTENCE_LIMIT);
    expect(saved.reviewIdentity).toBe(migrationReviewIdentity(snapshot));
    expect(controller.reviewControls.every(({ checked }) => checked)).toBe(
      true,
    );
    const restored = exerciseViewScript(
      html,
      saved,
      false,
      undefined,
      extraIds,
    );
    expect(
      restored.reviewControls.filter(({ checked }) => checked),
    ).toHaveLength(MIGRATION_REVIEW_PERSISTENCE_LIMIT);
    expect(restored.ids.get("#migration-reviewed-count")!.textContent).toBe(
      "1000 reviewed",
    );
    expect(snapshot.candidates).toEqual(readySnapshot().candidates);
  });

  it("rejects stale review caches and applies named profile/target filters across all owned rows", () => {
    const original = readySnapshot();
    const snapshot: ProjectSnapshot = {
      ...original,
      runtime: {
        ...original.runtime!,
        targets: [
          ...original.runtime!.targets,
          { ...original.runtime!.targets[0]!, name: "publication" },
        ],
      },
      configurationMetadata: {
        schemaVersion: 1,
        path: "rehearsal.config.mjs",
        sourceSha256: "e".repeat(64),
        fields: [],
        profiles: [
          {
            name: "Publication",
            targets: ["publication"],
            applicationUrl: null,
          },
        ],
        pathResolution: "Project root",
        manualFields: "Manual review",
      },
    };
    const html = renderWorkspaceDocument(snapshot, assets, "runtime", {
      ...DEFAULT_WORKSPACE_PREFERENCES,
      profile: "named:Publication",
    });
    const controller = exerciseViewScript(html, {
      reviewIdentity: "old-digest-and-baseline",
      reviewed: ["primary:20261010000100"],
      images: [],
    });
    expect(controller.ids.get("#migration-reviewed-count")!.textContent).toBe(
      "0 reviewed",
    );
    expect(controller.migrationRows.map((row) => row.hidden)).toEqual([
      true,
      false,
    ]);
    expect(controller.runtimeRows.map((row) => row.hidden)).toEqual([
      true,
      false,
    ]);
    expect(controller.resourceRows.map((row) => row.hidden)).toEqual([
      true,
      false,
      false,
    ]);
    expect(
      controller.ids.get("#workspace-scope-summary")!.textContent,
    ).toContain("Display only");
    controller.ids.get("#workspace-profile")!.change("full");
    controller.ids.get("#environment-target")!.change("primary");
    expect(controller.migrationRows.map((row) => row.hidden)).toEqual([
      false,
      true,
    ]);
    expect(controller.runtimeRows.map((row) => row.hidden)).toEqual([
      false,
      true,
    ]);
    expect(controller.resourceRows.map((row) => row.hidden)).toEqual([
      false,
      true,
      false,
    ]);
    expect(controller.ids.get("#migration-target")!.value).toBe("primary");
    controller.ids.get("#workspace-profile")!.change("minimal");
    expect(controller.resourceRows.map((row) => row.hidden)).toEqual([
      false,
      true,
      true,
    ]);
    expect(
      controller.messages.every(
        (message) => (message as { type?: string }).type === "preferences",
      ),
    ).toBe(true);
    expect(html).toContain(
      "all migrations remain in the exact ordered candidate set",
    );
    expect(snapshot.candidates!.digest).toBe(original.candidates!.digest);
  });

  it("drops a saved image selection when current inspection protects that image", () => {
    const controller = exerciseViewScript(
      renderWorkspaceDocument(readySnapshot(), assets),
      { images: [`sha256:${"c".repeat(64)}`] },
      true,
    );
    expect(controller.imageControl.checked).toBe(false);
    expect(controller.ids.get("#review-image-cleanup")!.disabled).toBe(true);
    expect(controller.state()).toMatchObject({ view: { images: [] } });
  });

  it("persists cached image selections when pagination detaches their card", () => {
    const imageId = `sha256:${"c".repeat(64)}`;
    const controller = exerciseViewScript(
      renderWorkspaceDocument(readySnapshot(), assets, "runtime"),
      { images: [imageId], resourcePageSize: 10, resourcePages: { image: 2 } },
    );
    expect(controller.imageControl.checked).toBe(true);
    controller.detachImage();
    controller.rememberView();
    expect(controller.state()).toMatchObject({
      view: { images: [imageId], resourcePageSize: 10 },
    });
  });

  it("filters created, long-running-review and incompatible resource states through preferences only", () => {
    const controller = exerciseViewScript(
      renderWorkspaceDocument(readySnapshot(), assets, "runtime"),
    );
    controller.resourceRows[0]!.dataset.state =
      "running created review-due incompatible";
    controller.resourceRows[1]!.dataset.state = "stopped created";
    controller.resourceRows[1]!.dataset.viewTarget = "primary";
    controller.resourceRows[2]!.dataset.state = "candidate";
    for (const [state, hidden] of [
      ["created", [false, false, true]],
      ["review-due", [false, true, true]],
      ["incompatible", [false, true, true]],
      ["not-created", [true, true, true]],
    ] as const) {
      controller.ids.get("#resource-state")!.change(state);
      expect(controller.resourceRows.map((row) => row.hidden)).toEqual(hidden);
    }
    expect(
      controller.messages.every(
        (message) => (message as { type?: string }).type === "preferences",
      ),
    ).toBe(true);
  });
});

describe("Rehearsal workspace document", () => {
  it("offers actionable WSL guidance rather than retrying a native Windows process", () => {
    const html = renderWorkspaceDocument(
      {
        workspaceName: "Windows project",
        workspaceRoot: "C:\\projects\\app",
        availability: "error",
        error: {
          code: "platform_unsupported",
          message: "Native Windows requires a WSL 2 extension host.",
          suggestions: ["Open the project in its Linux home filesystem."],
        },
      },
      assets,
    );
    expect(html).toContain("Open this project in WSL 2");
    expect(html).toContain("Windows setup guide");
    expect(html).toContain("Linux home filesystem");
    expect(html).toContain("No inspection process was started");
    expect(html).toContain("Core not inspected");
    expect(html).not.toContain("Try again");
    expect(html).not.toContain("Run Doctor");
    expect(html).not.toContain("Create sandbox");
  });
  it("keeps installed extension and core versions separate in the top-right update control", () => {
    const html = renderWorkspaceDocument(readySnapshot(), {
      ...assets,
      extensionVersion: "0.1.11",
      extensionRelease: {
        status: "checked",
        latestVersion: "0.1.12",
        checkedAt: 1_800_000_000_000,
        channel: "preview",
      },
    });
    const header = html.match(
      /<header class="topbar">[\s\S]*?<\/header>/u,
    )?.[0];
    expect(header).toContain("Extension 0.1.11 → 0.1.12");
    expect(header).toContain('id="extension-version"');
    expect(header).toContain('data-state="available"');
    expect(header).toContain(assets.actionUris.checkUpdates);
    expect(header).toContain("Core ");
    expect(header).not.toContain("up to date");
  });
  it("always shows the loaded extension before any project inspection or release check", () => {
    const html = renderWorkspaceDocument(
      {
        workspaceName: "Fresh project",
        workspaceRoot: "/private/fresh",
        availability: "loading",
      },
      {
        ...assets,
        extensionVersion: "0.1.11",
      },
    );
    expect(html).toContain("Extension 0.1.11");
    expect(html).toContain("Update availability is unknown");
    expect(html).not.toContain("Extension 0.1.11 →");
  });
  it.each(WORKSPACE_PAGES)(
    "keeps the manual update action in the footer and version header on %s",
    (page) => {
      const html = renderWorkspaceDocument(readySnapshot(), assets, page);
      const action = 'href="command:rehearsal.workspaceAction?checkUpdates"';
      expect(html.split(action)).toHaveLength(3);
      expect(
        html.match(/<header class="topbar">[\s\S]*?<\/header>/u)?.[0],
      ).toContain(action);
      expect(
        html.match(/<footer class="product-footer">[\s\S]*?<\/footer>/u)?.[0],
      ).toContain(action);
    },
  );
  it("keeps cancellation above progress and receipts only for an editor-owned operation", () => {
    const active = renderWorkspaceDocument(
      readySnapshot(),
      assets,
      "activity",
      DEFAULT_WORKSPACE_PREFERENCES,
      [
        {
          id: "owned-open-operation",
          label: "Open sandbox",
          startedAt: "2026-10-15T12:00:00.000Z",
          finishedAt: null,
          outcome: "running",
          exitCode: null,
        },
      ],
    );
    const cancellation = active.indexOf(">Cancel editor-started operation</a>");
    expect(cancellation).toBeGreaterThan(0);
    expect(cancellation).toBeLessThan(
      active.indexOf('<div id="operation-progress"'),
    );
    expect(
      active.match(/>Cancel editor-started operation<\/a>/gu),
    ).toHaveLength(1);
    expect(
      renderWorkspaceDocument(readySnapshot(), assets, "activity"),
    ).not.toContain(">Cancel editor-started operation</a>");
  });
  it("explains that an open sandbox stays available instead of asking users to wait for exit", () => {
    const html = renderWorkspaceDocument(
      {
        workspaceName: "synthetic",
        workspaceRoot: "/synthetic",
        availability: "operation_active",
        activity: {
          schemaVersion: 1,
          state: "busy",
          operation: {
            kind: "open",
            startedAt: "2026-10-15T12:00:00.000Z",
            rehearsalVersion: "0.1.0-rc.4",
          },
        },
      },
      assets,
    );
    expect(html).toContain(
      "Your sandbox session stays open for hands-on testing.",
    );
    expect(html).toContain("Application readiness is not confirmed");
    expect(html).toContain("you do not need to wait for the session to end.");
    expect(html).toContain("View operation progress");
    expect(html).not.toContain("Let the active operation finish");
    expect(html).toContain("This does not pause your application.");
  });
  it.each([
    ["application-start", "Opening sandbox"],
    ["interactive-session", "Sandbox running"],
    ["cleanup", "Closing sandbox"],
    [null, "Sandbox session open"],
  ] as const)(
    "describes open session phase %s without inventing project facts",
    (phase, label) => {
      const html = renderWorkspaceDocument(sandboxSnapshot(phase), assets);
      const overview = html.match(
        /<section id="overview"[\s\S]*?<\/section>/u,
      )?.[0];
      expect(overview).toContain(label);
      expect(overview).toContain("Project inspection is on hold");
      expect(overview).toContain('id="active-application-url"');
      expect(overview).toContain('id="open-active-application"');
      expect(overview).not.toContain("Paused");
      if (phase !== "interactive-session")
        expect(overview).not.toContain("Sandbox running");
      for (const action of [
        "runRehearsal",
        "reset",
        "startRuntime",
        "openSandbox",
      ])
        expect(overview).not.toContain(
          `command:rehearsal.workspaceAction?${action}`,
        );
    },
  );
  it("does not label failed or stale interactive telemetry as a running sandbox", () => {
    const active = sandboxSnapshot();
    const operation = active.activity!.operation!;
    for (const state of ["failed", "cancelled", "completed"] as const) {
      const html = renderWorkspaceDocument(
        {
          ...active,
          activity: {
            ...active.activity!,
            operation: {
              ...operation,
              progress: { ...operation.progress!, state },
            },
          },
        },
        assets,
      );
      expect(
        html.match(/<section id="overview"[\s\S]*?<\/section>/u)?.[0],
      ).not.toContain("Sandbox running");
    }
    const stale = renderWorkspaceDocument(
      {
        ...active,
        availability: "operation_attention",
        activity: { ...active.activity!, state: "stale" },
      },
      assets,
    );
    const overview = stale.match(
      /<section id="overview"[\s\S]*?<\/section>/u,
    )?.[0];
    expect(overview).toContain("Operation needs review");
    expect(overview).not.toContain("Sandbox running");
    expect(overview).not.toContain('id="open-active-application"');
  });
  it.each([
    "",
    "https://example.com:43340/",
    "http://user:secret@localhost:43340/",
    "http://localhost:43340/?token=private",
  ])(
    "never preloads stale, unsafe or guessed addresses during an open session: %s",
    (applicationUrl) => {
      const html = renderWorkspaceDocument(
        {
          ...sandboxSnapshot(),
          configPath: "rehearsal.config.mjs",
          applicationUrl: "http://localhost:62222/",
        },
        assets,
        "overview",
        { ...DEFAULT_WORKSPACE_PREFERENCES, applicationUrl },
      );
      expect(html).toContain('id="active-application-url" type="url" value=""');
      expect(html).toContain('id="application-url" type="url" value=""');
      expect(html).not.toContain("http://localhost:62222/");
      expect(html).not.toContain("http://localhost:5175");
      if (applicationUrl) expect(html).not.toContain(applicationUrl);
    },
  );
  it("uses only the user's validated loopback preference in both active address inputs", () => {
    const address = "http://127.0.0.1:43340/app";
    const html = renderWorkspaceDocument(
      sandboxSnapshot(),
      assets,
      "overview",
      {
        ...DEFAULT_WORKSPACE_PREFERENCES,
        applicationUrl: address,
      },
    );
    expect(html).toContain(
      `id="active-application-url" type="url" value="${address}"`,
    );
    expect(html).toContain(
      `id="application-url" type="url" value="${address}"`,
    );
    const ids = [
      ...html.split("<script nonce=")[0]!.matchAll(/\sid="([^"]+)"/gu),
    ].map((match) => match[1]);
    expect(new Set(ids).size).toBe(ids.length);
  });
  it("persists and opens the explicitly typed active address without starting a project operation", () => {
    const view = exerciseViewScript(
      renderWorkspaceDocument(sandboxSnapshot(), assets),
    );
    const address = "http://localhost:43340/";
    const input = view.ids.get("#active-application-url")!;
    input.value = address;
    view.messages.splice(0);
    view.ids.get("#open-active-application")!.click();
    expect(view.messages).toContainEqual({
      type: "openApplication",
      url: address,
    });
    expect(view.messages).toContainEqual(
      expect.objectContaining({
        type: "preferences",
        preferences: expect.objectContaining({ applicationUrl: address }),
      }),
    );
    expect(view.ids.get("#application-url")?.value).toBe(address);
    expect(view.messages).toHaveLength(2);
    view.ids.get("#application-url")!.change("http://[::1]:43341/");
    expect(input.value).toBe("http://[::1]:43341/");
  });
  it("patches session presentation in place without replacing typed input, focus or navigation", () => {
    const view = exerciseViewScript(
      renderWorkspaceDocument(sandboxSnapshot("application-start"), assets),
    );
    const input = view.ids.get("#active-application-url")!;
    input.value = "http://localhost:43340/draft";
    view.navigate("runtime");
    view.focus(input);
    view.scrolling.scrollTop = 310;
    expect(view.sessionNodes.label.length).toBeGreaterThan(0);
    for (const [state, label] of [
      ["interactive", "Sandbox running"],
      ["closing", "Closing sandbox"],
      ["unknown", "Sandbox session open"],
    ]) {
      view.receive({
        type: "operationProgressUpdated",
        html: "<article><p>Progress</p></article>",
        sandboxSessionState: state,
      });
      expect(
        view.sessionNodes.label.every((node) => node.textContent === label),
      ).toBe(true);
      expect(view.ids.get("#active-application-url")).toBe(input);
      expect(input.value).toBe("http://localhost:43340/draft");
      expect(view.activeElement()).toBe(input);
      expect(view.pages.get("runtime")!.hidden).toBe(false);
      expect(view.scrolling.scrollTop).toBe(310);
    }
    view.receive({
      type: "operationProgressUpdated",
      html: "<article><p>Progress</p></article>",
      sandboxSessionState: "<unsafe>",
    });
    expect(
      view.sessionNodes.label.every(
        (node) => node.textContent === "Sandbox session open",
      ),
    ).toBe(true);
    expect(input.focusCalls).toHaveLength(1);
  });
  it.each(["open", "run", "reset"])(
    "marks project inspection on hold rather than pausing the application during %s",
    (kind) => {
      const html = renderWorkspaceDocument(
        {
          workspaceName: "Active project",
          workspaceRoot: "/synthetic",
          availability: "operation_active",
          version: "0.1.0-rc.9",
          activity: {
            schemaVersion: 1,
            state: "busy",
            operation: {
              kind,
              startedAt: "2026-10-18T03:00:00.000Z",
              rehearsalVersion: "0.1.0-rc.9",
            },
          },
        },
        assets,
      );
      const overview = html.match(
        /<section id="overview"[\s\S]*?<\/section>/u,
      )?.[0];
      expect(overview).toBeDefined();
      expect(overview?.match(/<strong>On hold<\/strong>/gu)).toHaveLength(3);
      expect(overview).not.toContain("Paused");
      expect(overview).toContain("Inspection on hold");
      expect(overview).toContain(
        "Baseline inspection resumes after the active operation",
      );
      expect(overview).toContain(
        "Database status is not inspected during the active operation",
      );
      expect(overview).toContain("View operation progress");
      expect(overview).not.toContain("Not verified");
      expect(overview).not.toContain("Create or verify a baseline");
      expect(overview).not.toContain("Run the project check to continue");
      expect(overview).not.toContain("Check progress");
      expect(overview).not.toContain("Needs review");
      expect(overview).not.toContain("Configure application proof");
      expect(overview).not.toContain(
        'href="command:rehearsal.workspaceAction?refresh"',
      );
      if (kind !== "open")
        expect(overview).toContain(
          "Wait for it to finish before a fresh project check.",
        );
    },
  );
  it("retains inspection loading guidance while rechecking an active-operation snapshot", () => {
    const html = renderWorkspaceDocument(
      {
        workspaceName: "Active project",
        workspaceRoot: "/synthetic",
        availability: "operation_active",
        activity: {
          schemaVersion: 1,
          state: "busy",
          operation: {
            kind: "open",
            startedAt: "2026-10-18T03:00:00.000Z",
            rehearsalVersion: "0.1.0-rc.9",
          },
        },
      },
      assets,
      "overview",
      undefined,
      [],
      "loading",
    );
    expect(html).toContain("Checking your project");
    expect(html).toContain("Inspection in progress");
    expect(html).toContain("Looking for a verified baseline");
    expect(html).not.toContain("<strong>Paused</strong>");
  });
  it("owns a stable progress region and routes live updates without whole-document replacement", () => {
    const html = renderWorkspaceDocument(readySnapshot(), assets, "activity");
    expect(html).toContain('<div id="operation-progress" tabindex="-1">');
    expect(html).toContain("const applyOperationProgressUpdate =");
    expect(html).toContain(
      "applyOperationProgressUpdate(document,{type:event.data.type,html:event.data.html})",
    );
    expect(html).not.toContain("document.documentElement.innerHTML");
    expect(html).not.toContain("location.reload");
  });
  it("guides a protected project to policy review instead of suggesting data replacement", () => {
    const current = readySnapshot();
    const html = renderWorkspaceDocument(
      {
        ...current,
        resources: {
          ...current.resources!,
          environments: current.resources!.environments.map((environment) => ({
            ...environment,
            protected: true,
          })),
        },
      },
      assets,
    );
    expect(html).toContain("Sandbox data is protected");
    expect(html).toContain("Review protected environments");
  });
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
    expect(html).toContain(
      "compactNavigationTrigger?.focus({preventScroll:true})",
    );
    expect(html).toContain(
      'selectedSection?.querySelector("h1")?.focus({preventScroll:true})',
    );
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
    expect(html).toContain("2.50% CPU");
    expect(html).toContain("0.1 GiB memory");
  });

  it("groups all local-resource actions together while keeping stop guidance outside the control row", () => {
    const html = renderWorkspaceDocument(
      {
        ...readySnapshot(),
        configurationMetadata: {
          schemaVersion: 1,
          path: "rehearsal.config.mjs",
          sourceSha256: "a".repeat(64),
          fields: [],
          profiles: [],
          pathResolution: "Project root",
          manualFields: "Manual review",
        },
      },
      assets,
      "runtime",
    );
    const resourceSurface = html
      .split('<article class="surface environment-resources">')[1]!
      .split('<article class="surface environment-versions">')[0]!;
    const groups = [
      ...resourceSurface.matchAll(
        /<div class="action-group">([\s\S]*?)<\/div>/gu,
      ),
    ].map((match) => match[1]!);
    const stopGroups = groups.filter((group) =>
      group.includes('id="review-stale-stop"'),
    );
    expect(stopGroups).toHaveLength(1);
    expect(stopGroups[0]).toContain("Refresh inventory");
    expect(stopGroups[0]).toContain("Preview safe cleanup");
    expect(stopGroups[0]).toContain("Review long-running environments");
    expect(stopGroups[0]!.match(/<(?:a|button)\b/gu)).toHaveLength(3);
    expect(stopGroups[0]).not.toContain("Uses your configured stale cutoff");
    expect(resourceSurface).toContain(
      '<p class="control-note">Uses your configured stale cutoff.',
    );

    const withoutMetadata = renderWorkspaceDocument(
      readySnapshot(),
      assets,
      "runtime",
    );
    expect(withoutMetadata).not.toContain('id="review-stale-stop"');
    expect(withoutMetadata).toContain("Refresh inventory");
    expect(withoutMetadata).toContain("Preview safe cleanup");
  });

  it("uses singular and plural retained-baseline counts in the Environments heading", () => {
    const current = readySnapshot();
    const single = renderWorkspaceDocument(
      {
        ...current,
        baseline: {
          ...current.baseline!,
          generations: current.baseline!.generations!.slice(0, 1),
        },
      },
      assets,
      "runtime",
    );
    const multiple = renderWorkspaceDocument(current, assets, "runtime");
    const versionsHeading = (html: string) =>
      html
        .split('<article class="surface environment-versions">')[1]!
        .split("</div>")[0]!;
    expect(versionsHeading(single)).toContain(
      '<span class="state-chip">1 version</span>',
    );
    expect(versionsHeading(single)).not.toContain("1 versions");
    expect(versionsHeading(multiple)).toContain(
      '<span class="state-chip">2 versions</span>',
    );
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

  it("shows accessible loading states instead of unavailable placeholders", () => {
    const html = renderWorkspaceDocument(
      {
        workspaceName: "Loading project",
        workspaceRoot: "/workspace",
        availability: "loading",
      },
      assets,
      "overview",
      undefined,
      [],
      "loading",
    );

    expect(html).toContain('aria-busy="true"');
    expect(html).toContain('class="inspection-banner"');
    expect(html).toContain('role="status" aria-live="polite"');
    expect(html).toContain("Checking your project");
    expect(html).toContain("Checking…");
    expect(html).toContain("Inspection in progress");
    expect(html).not.toContain("Targets unavailable");
  });

  it("turns an idle timeout into explicit recovery guidance", () => {
    const html = renderWorkspaceDocument(
      {
        workspaceName: "Slow project",
        workspaceRoot: "/workspace",
        availability: "error",
        version: "0.1.0-rc.4",
        activity: { schemaVersion: 1, state: "idle", operation: null },
        error: {
          code: "timeout",
          message: "The Rehearsal doctor check took longer than 90 seconds.",
          suggestions: [
            "Retry the read-only inspection.",
            "Increase Rehearsal: Inspection Timeout Seconds for this workspace if the project needs longer.",
          ],
        },
      },
      assets,
    );

    expect(html).toContain("Project check timed out");
    expect(html).toContain("No Rehearsal operation is running");
    expect(html).toContain("Not checked");
    expect(html).toContain("Adjust timeout");
    expect(html).toContain(
      "command:rehearsal.workspaceAction?inspectionSettings",
    );
    expect(html).toContain("Run Doctor");
  });
});
