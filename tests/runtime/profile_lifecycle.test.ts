import { afterEach, describe, expect, it, vi } from "vitest";
import { configurationFingerprint } from "../../src/configuration/configuration_editor.js";
import { parseConfigurationMetadata } from "../../src/configuration/configuration_contract.js";
import { preferenceStorageKey } from "../../src/workspace/workspace_preferences.js";
import type { ProjectSnapshot } from "../../src/workspace/project_snapshot.js";

interface ProfileReview {
  readonly workspaceKey: string;
  readonly format: "diff" | "text";
  readonly detail: string;
  readonly changedFields?: readonly string[];
  readonly canApply: () => void;
  readonly onApply: () => Promise<void | boolean>;
}

const host = vi.hoisted(() => {
  const uri = (value: string) => ({
    fsPath: value,
    path: value,
    toString: () => (value.includes(":") ? value : `file://${value}`),
  });
  class Events<Value> {
    readonly listeners = new Set<(value: Value) => void>();
    readonly event = (listener: (value: Value) => void) => {
      this.listeners.add(listener);
      return { dispose: () => this.listeners.delete(listener) };
    };
    fire(value: Value) {
      for (const listener of this.listeners) listener(value);
    }
    dispose() {
      this.listeners.clear();
    }
  }
  class Edit {
    readonly replacements: { uri: ReturnType<typeof uri>; text: string }[] = [];
    replace(
      documentUri: ReturnType<typeof uri>,
      _range: unknown,
      text: string,
    ) {
      this.replacements.push({ uri: documentUri, text });
    }
  }
  const panels: ReturnType<typeof panel>[] = [];
  function panel() {
    const messages = new Events<unknown>();
    const disposal = new Events<void>();
    return {
      title: "",
      iconPath: undefined as unknown,
      visible: true,
      reveal: vi.fn(),
      dispose: () => disposal.fire(),
      onDidDispose: disposal.event,
      onDidChangeViewState: new Events<void>().event,
      receive: (message: unknown) => messages.fire(message),
      webview: {
        html: "",
        cspSource: "vscode-webview:",
        asWebviewUri: (value: ReturnType<typeof uri>) => value,
        postMessage: vi.fn(async () => true),
        onDidReceiveMessage: messages.event,
      },
    };
  }
  const reviewApproval = vi.fn();
  const reviewOptions: ProfileReview[] = [];
  const review = vi.fn(async (options: ProfileReview) => {
    reviewOptions.push(options);
    options.canApply();
    if (!(await reviewApproval(options))) return false;
    options.canApply();
    return (await options.onApply()) !== false;
  });
  const filesystem = {
    realpath: vi.fn(async (value: string) => value),
    lstat: vi.fn(async (value: string) => ({
      dev: 1,
      ino: 501,
      isFile: () => value.endsWith(".mjs"),
      isDirectory: () => !value.endsWith(".mjs"),
      isSymbolicLink: () => false,
    })),
    mkdtemp: vi.fn(async (prefix: string) => `${prefix}owned`),
    writeFile: vi.fn(
      async (_path: string, _content: string, _options: unknown) => {},
    ),
    unlink: vi.fn(async (_path: string) => {}),
    rmdir: vi.fn(async (_path: string) => {}),
    open: vi.fn(),
  };
  return {
    uri,
    Events,
    Edit,
    panels,
    review,
    reviewApproval,
    reviewOptions,
    filesystem,
    cli: vi.fn(),
    resolve: vi.fn(),
    vscode: {
      EventEmitter: Events,
      WorkspaceEdit: Edit,
      Position: class {
        constructor(
          readonly line: number,
          readonly character: number,
        ) {}
      },
      Range: class {
        constructor(
          readonly start: unknown,
          readonly end: unknown,
        ) {}
      },
      ViewColumn: { Active: 1 },
      Uri: {
        file: uri,
        parse: uri,
        joinPath: (base: ReturnType<typeof uri>, ...parts: string[]) =>
          uri([base.fsPath, ...parts].join("/")),
      },
      workspace: {
        isTrusted: true,
        workspaceFolders: [] as { name: string; uri: ReturnType<typeof uri> }[],
        onDidChangeWorkspaceFolders: new Events<void>().event,
        openTextDocument: vi.fn(),
        applyEdit: vi.fn(),
      },
      window: {
        createWebviewPanel: vi.fn(() => {
          const value = panel();
          panels.push(value);
          return value;
        }),
        showInformationMessage: vi.fn(),
        showWarningMessage: vi.fn(),
        showErrorMessage: vi.fn(),
        showTextDocument: vi.fn(),
      },
    },
  };
});

vi.mock("vscode", () => host.vscode);
vi.mock("node:fs/promises", () => host.filesystem);
vi.mock("../../src/runtime/process_adapter.js", () => ({
  runRehearsalJson: host.cli,
  resolveWorkspaceRehearsal: host.resolve,
}));
vi.mock("../../src/review/review_panel.js", () => ({
  RehearsalReviewPanels: class {
    review = host.review;
    releaseWorkspace = vi.fn();
    dispose = vi.fn();
  },
}));

import { RehearsalWorkspacePanels } from "../../src/workspace/workspace_panel.js";

interface Profile {
  readonly name: string;
  readonly targets: readonly string[];
  readonly applicationUrl?: string | null;
}
interface Proposal {
  readonly sourceSha256: string;
  readonly changes: readonly {
    readonly path: string;
    readonly value: unknown;
  }[];
}

const owners: RehearsalWorkspacePanels[] = [];
const fixture = () => {
  const events = new host.Events<{
    workspaceKey: string;
    snapshot: ProjectSnapshot;
  }>();
  const scopes = [
    "/private/profile-project-a",
    "/private/profile-project-b",
  ].map((root) => {
    const folder = { name: "Duplicate friendly project", uri: host.uri(root) };
    const key = folder.uri.toString();
    const document = {
      uri: host.uri(`${root}/rehearsal.config.mjs`),
      text: 'export default { profiles: [], runtime: { applicationUrl: "http://localhost:5175" } };\n',
      isDirty: false,
      isClosed: false,
      lineCount: 1,
      getText() {
        return this.text;
      },
      lineAt() {
        return { range: { end: { line: 0, character: this.text.length } } };
      },
      save: vi.fn(async () => {
        diskText = document.text;
        document.isDirty = false;
        return true;
      }),
    };
    let diskText = document.text;
    return {
      root,
      folder,
      key,
      document,
      diskText: () => diskText,
      profiles: [] as Profile[],
      proposal: undefined as Proposal | undefined,
      refuse: false,
    };
  });
  host.vscode.workspace.workspaceFolders = scopes.map(({ folder }) => folder);
  host.filesystem.open.mockImplementation(async (path: string) => {
    const scope = scopes.find(({ document }) => document.uri.fsPath === path);
    if (!scope) throw new Error("Unexpected configuration read request.");
    return {
      stat: async () => ({
        dev: 1,
        ino: 501,
        size: Buffer.byteLength(scope.diskText()),
        isFile: () => true,
      }),
      read: async (
        buffer: Buffer,
        offset: number,
        length: number,
        position: number,
      ) => {
        const bytes = Buffer.from(scope.diskText()).subarray(
          position,
          position + length,
        );
        bytes.copy(buffer, offset);
        return { bytesRead: bytes.byteLength, buffer };
      },
      close: async () => {},
    };
  });
  const metadata = (scope: (typeof scopes)[number]) => ({
    schemaVersion: 1,
    path: "rehearsal.config.mjs",
    sourceSha256: configurationFingerprint(scope.document.text),
    fields: [
      {
        path: "profiles",
        kind: "profiles",
        value: scope.profiles.map((profile) => ({
          ...profile,
          applicationUrl: profile.applicationUrl ?? null,
        })),
        provenance: "validated-active-configuration",
        confidence: "certain",
        reviewRequired: true,
      },
    ],
    profiles: scope.profiles.map((profile) => ({
      ...profile,
      applicationUrl: profile.applicationUrl ?? null,
    })),
    patchContract: {
      schemaVersion: 1,
      input: "project-local-json-file",
      maximumBytes: 65536,
      writesConfiguration: false,
      executesProposedCommands: false,
      concurrentChanges: "refuse",
    },
    pathResolution: "Project-local paths.",
    manualFields: "Source and privacy decisions remain manual.",
  });
  const snapshots = new Map<string, ProjectSnapshot>(
    scopes.map((scope) => [
      scope.key,
      {
        workspaceName: scope.folder.name,
        workspaceRoot: scope.root,
        availability: "ready",
        version: "0.1.0-rc.5",
        configPath: "rehearsal.config.mjs",
        activity: { schemaVersion: 1, state: "idle", operation: null },
        configurationMetadata: parseConfigurationMetadata(metadata(scope)),
        runtime: {
          state: "stopped",
          targets: ["primary", "publication"].map((name) => ({
            name,
            runtimeTarget:
              name === "primary"
                ? ("postgresql" as const)
                : ("supabase" as const),
            state: "stopped" as const,
            reason: "runtime_not_running" as const,
            verifiedRuntimeAvailable: false,
            endpoint: null,
          })),
        },
      },
    ]),
  );
  const actions = {
    onDidRecordActivity: new host.Events<string>().event,
    registerWorkspace: vi.fn(
      (key: string) =>
        `opaque-${scopes.findIndex((scope) => scope.key === key)}`,
    ),
    releaseWorkspace: vi.fn(),
    activityFor: vi.fn(() => []),
    runWorkspace: vi.fn(),
    cleanupImages: vi.fn(),
    reviewStaleStop: vi.fn(),
  };
  const preferences = new Map<string, unknown>();
  const state = {
    get: vi.fn((key: string) => preferences.get(key)),
    update: vi.fn(async (key: string, value: unknown) => {
      preferences.set(key, value);
    }),
  };
  const projects = {
    onDidUpdateSnapshot: events.event,
    onDidChangeInspection: new host.Events<{ workspaceKey: string }>().event,
    snapshotFor: (key: string) => snapshots.get(key),
    inspectionStateFor: () => "idle",
    refreshWorkspace: vi.fn(async (key: string) => {
      const scope = scopes.find((scope) => scope.key === key)!;
      const snapshot = {
        ...snapshots.get(key)!,
        configurationMetadata: parseConfigurationMetadata(metadata(scope)),
      };
      snapshots.set(key, snapshot);
      events.fire({ workspaceKey: key, snapshot });
    }),
  };
  host.vscode.workspace.openTextDocument.mockImplementation(
    async (uri: ReturnType<typeof host.uri>) => {
      const document = scopes.find(
        (scope) => scope.document.uri.toString() === uri.toString(),
      )?.document;
      if (document) return document;
      throw new Error("Unexpected editable document request.");
    },
  );
  host.vscode.workspace.applyEdit.mockImplementation(
    async (edit: InstanceType<typeof host.Edit>) => {
      for (const replacement of edit.replacements) {
        const scope = scopes.find(
          (scope) =>
            scope.document.uri.toString() === replacement.uri.toString(),
        )!;
        scope.document.text = replacement.text;
        scope.document.isDirty = true;
        scope.profiles = scope.proposal?.changes.find(
          ({ path }) => path === "profiles",
        )?.value as Profile[];
      }
      return true;
    },
  );
  host.filesystem.writeFile.mockImplementation(async (path, content) => {
    const scope = scopes.find((scope) => path.startsWith(`${scope.root}/`))!;
    scope.proposal = JSON.parse(content) as Proposal;
  });
  host.resolve.mockResolvedValue({ configurationReviewSchema: 1 });
  host.cli.mockImplementation(
    async ({
      workspaceRoot,
      command,
    }: {
      workspaceRoot: string;
      command: readonly string[];
    }) => {
      const scope = scopes.find((scope) => scope.root === workspaceRoot)!;
      if (command[0] === "activity")
        return {
          result: {
            data: { schemaVersion: 1, state: "idle", operation: null },
          },
        };
      if (command[1] === "review") {
        if (scope.refuse)
          throw new Error(
            "PRIVATE_CORE_REFUSAL /private/profile-review raw-provider-error",
          );
        return {
          result: {
            data: {
              sourceSha256: configurationFingerprint(scope.document.text),
              validation: "complete-config-passed",
              writesConfiguration: false,
              executesProposedCommands: false,
            },
          },
        };
      }
      return { result: { data: metadata(scope) } };
    },
  );
  host.reviewApproval.mockResolvedValue(true);
  const owner = new RehearsalWorkspacePanels(
    host.uri("/private/extension") as never,
    projects as never,
    actions as never,
    state as never,
    "0.1.5",
  );
  owners.push(owner);
  return { owner, scopes, snapshots, projects, actions, preferences, state };
};

afterEach(() => {
  for (const owner of owners.splice(0)) owner.dispose();
  host.panels.splice(0);
  host.reviewOptions.splice(0);
  host.reviewApproval.mockReset();
  host.vscode.workspace.workspaceFolders = [];
  host.vscode.workspace.isTrusted = true;
  vi.clearAllMocks();
});

const submit = (panel: (typeof host.panels)[number], profiles: unknown) =>
  panel.receive({
    type: "reviewConfiguration",
    values: { fields: { profiles: JSON.stringify(profiles) } },
  });

describe("named profiles through the workspace host", () => {
  it("creates, reviews, explicitly approves, saves, refreshes and selects a project-local profile without running a target", async () => {
    const test = fixture();
    const scope = test.scopes[0]!;
    await test.owner.open(scope.key);
    const panel = host.panels[0]!;
    submit(panel, [
      {
        name: "Full QA",
        targets: ["publication"],
        applicationUrl: "http://localhost:5176",
      },
    ]);
    await vi.waitFor(() => expect(scope.document.save).toHaveBeenCalledOnce());
    await vi.waitFor(() =>
      expect(test.projects.refreshWorkspace).toHaveBeenCalledExactlyOnceWith(
        scope.key,
      ),
    );
    expect(host.review).toHaveBeenCalledOnce();
    const review = host.reviewOptions[0]!;
    expect(review.workspaceKey).toBe(scope.key);
    expect(review.format).toBe("diff");
    expect(review.detail).toContain('name: "Full QA"');
    expect(review.detail).toContain('targets: ["publication"]');
    expect(review.changedFields).toEqual(["profiles"]);
    expect(host.vscode.window.showTextDocument).not.toHaveBeenCalled();
    expect(host.vscode.window.showWarningMessage).not.toHaveBeenCalled();
    const coreReview = host.cli.mock.calls.findIndex(
      ([request]) => request.command[1] === "review",
    );
    expect(coreReview).toBeGreaterThanOrEqual(0);
    const order = [
      host.review.mock.invocationCallOrder[0]!,
      host.reviewApproval.mock.invocationCallOrder[0]!,
      host.cli.mock.invocationCallOrder[coreReview]!,
      host.vscode.workspace.applyEdit.mock.invocationCallOrder[0]!,
      scope.document.save.mock.invocationCallOrder[0]!,
      test.projects.refreshWorkspace.mock.invocationCallOrder[0]!,
    ];
    expect(
      order.every((value, index) => index === 0 || order[index - 1]! < value),
    ).toBe(true);
    expect(scope.document.text).toContain('name: "Full QA"');
    expect(scope.document.text).toContain(
      'applicationUrl: "http://localhost:5176"',
    );
    expect(scope.proposal?.changes.map(({ path }) => path)).toEqual([
      "profiles",
    ]);
    expect(host.filesystem.writeFile).toHaveBeenCalledWith(
      expect.stringContaining(`${scope.root}/.rehearsal-config-review-`),
      expect.any(String),
      { mode: 0o600, flag: "wx" },
    );
    expect(host.filesystem.unlink).toHaveBeenCalledOnce();
    expect(host.filesystem.rmdir).toHaveBeenCalledOnce();
    const callsBeforeSelection = host.cli.mock.calls.length;
    panel.receive({
      type: "preferences",
      preferences: {
        profile: "named:Full QA",
        selectedTarget: "publication",
        applicationUrl: "http://localhost:5176",
      },
    });
    await vi.waitFor(() => expect(test.state.update).toHaveBeenCalledOnce());
    await test.owner.open(scope.key);
    expect(test.preferences.get(preferenceStorageKey(scope.key))).toMatchObject(
      {
        profile: "named:Full QA",
        selectedTarget: "publication",
        applicationUrl: "http://localhost:5176",
      },
    );
    expect(panel.webview.html).toContain('value="named:Full QA" selected');
    expect(host.cli).toHaveBeenCalledTimes(callsBeforeSelection);
    expect(test.actions.runWorkspace).not.toHaveBeenCalled();
    expect(test.actions.reviewStaleStop).not.toHaveBeenCalled();
    expect(test.actions.cleanupImages).not.toHaveBeenCalled();
    expect(host.vscode.window.showErrorMessage).not.toHaveBeenCalled();
  });

  it("keeps identical project/profile labels isolated by workspace identity through saves and selection", async () => {
    const test = fixture();
    const [first, second] = test.scopes;
    await test.owner.open(first!.key);
    await test.owner.open(second!.key);
    const originalSecond = second!.document.text;
    submit(host.panels[0]!, [
      {
        name: "Full QA",
        targets: ["primary"],
        applicationUrl: "http://localhost:5175",
      },
    ]);
    await vi.waitFor(() => expect(first!.document.save).toHaveBeenCalledOnce());
    expect(second!.document.text).toBe(originalSecond);
    expect(second!.document.save).not.toHaveBeenCalled();
    submit(host.panels[1]!, [
      {
        name: "Full QA",
        targets: ["publication"],
        applicationUrl: "http://localhost:5176",
      },
    ]);
    await vi.waitFor(() =>
      expect(second!.document.save).toHaveBeenCalledOnce(),
    );
    host.panels[0]!.receive({
      type: "preferences",
      preferences: { profile: "named:Full QA", selectedTarget: "primary" },
    });
    host.panels[1]!.receive({
      type: "preferences",
      preferences: { profile: "named:Full QA", selectedTarget: "publication" },
    });
    await vi.waitFor(() => expect(test.state.update).toHaveBeenCalledTimes(2));
    expect(preferenceStorageKey(first!.key)).not.toBe(
      preferenceStorageKey(second!.key),
    );
    expect(
      test.preferences.get(preferenceStorageKey(first!.key)),
    ).toMatchObject({ selectedTarget: "primary" });
    expect(
      test.preferences.get(preferenceStorageKey(second!.key)),
    ).toMatchObject({ selectedTarget: "publication" });
    expect(first!.document.text).toContain('targets: ["primary"]');
    expect(first!.document.text).not.toContain('targets: ["publication"]');
    expect(second!.document.text).toContain('targets: ["publication"]');
    expect(
      test.projects.refreshWorkspace.mock.calls.map(([key]) => key),
    ).toEqual([first!.key, second!.key]);
    for (const [request] of host.cli.mock.calls) {
      expect([first!.root, second!.root]).toContain(request.workspaceRoot);
      expect(request.configPath).toBe("rehearsal.config.mjs");
      expect(["activity", "configuration"]).toContain(request.command[0]);
      if (request.command[1] === "review")
        expect(request.command[2]).toBe(
          "--proposal=.rehearsal-config-review-owned/proposal.json",
        );
    }
    expect(test.actions.runWorkspace).not.toHaveBeenCalled();
  });

  it("does not save a valid custom profile when its explicit review is cancelled", async () => {
    const test = fixture();
    const scope = test.scopes[0]!;
    host.reviewApproval.mockResolvedValue(false);
    await test.owner.open(scope.key);
    const before = scope.document.text;
    const dashboard = host.panels[0]!.webview.html;
    submit(host.panels[0]!, [{ name: "Feature branch", targets: ["primary"] }]);
    await vi.waitFor(() => expect(host.reviewApproval).toHaveBeenCalledOnce());
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(scope.document.text).toBe(before);
    expect(host.panels[0]!.webview.html).toBe(dashboard);
    expect(host.reviewOptions[0]!.detail).toContain("Feature branch");
    expect(scope.document.save).not.toHaveBeenCalled();
    expect(host.filesystem.writeFile).not.toHaveBeenCalled();
    expect(test.projects.refreshWorkspace).not.toHaveBeenCalled();
  });

  it("refuses malformed custom profile JSON before presenting approval or saving", async () => {
    const test = fixture();
    const scope = test.scopes[0]!;
    await test.owner.open(scope.key);
    host.panels[0]!.receive({
      type: "reviewConfiguration",
      values: { fields: { profiles: "not JSON" } },
    });
    await vi.waitFor(() =>
      expect(host.vscode.window.showErrorMessage).toHaveBeenCalledOnce(),
    );
    expect(host.review).not.toHaveBeenCalled();
    expect(scope.document.save).not.toHaveBeenCalled();
    expect(host.filesystem.writeFile).not.toHaveBeenCalled();
  });

  it.each([
    [
      [
        {
          name: "Remote",
          targets: ["primary"],
          applicationUrl: "https://production.invalid",
        },
      ],
      "editor",
    ],
    [[{ name: "Unknown target", targets: ["not-configured"] }], "core"],
    [
      [
        { name: "Duplicate", targets: ["primary"] },
        { name: "Duplicate", targets: ["publication"] },
      ],
      "editor",
    ],
  ] as const)(
    "refuses invalid custom profiles without saving (%j, %s boundary)",
    async (profiles, boundary) => {
      const test = fixture();
      const scope = test.scopes[0]!;
      scope.refuse = true;
      await test.owner.open(scope.key);
      const before = scope.document.text;
      submit(host.panels[0]!, profiles);
      await vi.waitFor(() =>
        expect(host.vscode.window.showErrorMessage).toHaveBeenCalledWith(
          boundary === "editor"
            ? "profiles: Use valid named profiles with configured targets and optional loopback URLs. Correct this field and review again. This proposal was not saved."
            : "Rehearsal could not complete this configuration review. Refresh the project, check trust and local file permissions, then review the current configuration and try again.",
        ),
      );
      expect(
        JSON.stringify(host.vscode.window.showErrorMessage.mock.calls),
      ).not.toMatch(/PRIVATE_CORE_REFUSAL|\/private|raw-provider-error/u);
      expect(scope.document.text).toBe(before);
      expect(scope.document.save).not.toHaveBeenCalled();
      expect(host.vscode.workspace.applyEdit).not.toHaveBeenCalled();
      expect(test.projects.refreshWorkspace).not.toHaveBeenCalled();
      expect(host.review).toHaveBeenCalledTimes(boundary === "core" ? 1 : 0);
      expect(host.filesystem.unlink).toHaveBeenCalledTimes(
        boundary === "core" ? 1 : 0,
      );
      expect(host.filesystem.rmdir).toHaveBeenCalledTimes(
        boundary === "core" ? 1 : 0,
      );
    },
  );

  it("persists a proven configured target with missing runtime inspection without starting services", async () => {
    const test = fixture();
    const scope = test.scopes[0]!;
    const { runtime: _runtime, ...snapshot } = test.snapshots.get(scope.key)!;
    test.snapshots.set(scope.key, {
      ...snapshot,
      candidates: {
        count: 0,
        digest: "a".repeat(64),
        files: [],
        targets: [
          {
            name: "publication",
            configPath: "publication.config.mjs",
            count: 0,
          },
        ],
      },
    });
    await test.owner.open(scope.key);
    host.panels[0]!.receive({
      type: "preferences",
      preferences: { selectedTarget: "publication" },
    });
    await vi.waitFor(() => expect(test.state.update).toHaveBeenCalledOnce());
    expect(test.preferences.get(preferenceStorageKey(scope.key))).toMatchObject(
      { selectedTarget: "publication" },
    );
    expect(host.cli).not.toHaveBeenCalled();
    expect(host.vscode.workspace.applyEdit).not.toHaveBeenCalled();
    expect(test.actions.runWorkspace).not.toHaveBeenCalled();
  });
});
