import { afterEach, describe, expect, it, vi } from "vitest";
import { tmpdir } from "node:os";
import { join } from "node:path";

const editor = vi.hoisted(() => {
  const uri = (path: string) => ({
    scheme: "file",
    authority: "",
    query: "",
    fragment: "",
    fsPath: path,
    path,
    toString: () => `file://${path}`,
  });
  const folder = {
    name: "Independent fixture",
    uri: uri("/private/manual-round"),
  };
  const panels: ReturnType<typeof createPanel>[] = [];
  const read = vi.fn();
  const resolvePackage = vi.fn();
  const temporary = vi.fn(
    async () => "/private/manual-round/.rehearsal-config-review-owned",
  );
  const write = vi.fn(async () => {});
  const unlink = vi.fn(async () => {});
  const rmdir = vi.fn(async () => {});
  const replace = vi.fn();
  const canonical = vi.fn(async (path: string) => path);
  const fileStat = vi.fn(async (path: string) => ({
    dev: 1,
    ino: 501,
    isFile: () => path.endsWith(".mjs"),
    isDirectory: () => !path.endsWith(".mjs"),
    isSymbolicLink: (): boolean => false,
  }));
  const folderListeners = new Set<() => void>();
  const contentProviders: {
    readonly scheme: string;
    readonly provider: {
      provideTextDocumentContent(value: ReturnType<typeof uri>): string;
      onDidChange(listener: (value: ReturnType<typeof uri>) => void): {
        dispose(): unknown;
      };
    };
    readonly dispose: ReturnType<typeof vi.fn>;
  }[] = [];
  function createPanel() {
    let html = "";
    let disposed = false;
    let visible = true;
    const disposeListeners = new Set<() => void>();
    const viewStateListeners = new Set<() => void>();
    const messageListeners = new Set<(message: unknown) => void>();
    const assignments: string[] = [];
    const postMessage = vi.fn(async (_message: unknown) => true);
    return {
      assignments,
      title: "",
      get visible() {
        return visible;
      },
      iconPath: undefined as unknown,
      reveal: vi.fn(),
      dispose: vi.fn(() => {
        if (disposed) return;
        disposed = true;
        for (const listener of [...disposeListeners]) listener();
      }),
      onDidDispose: (listener: () => void) => {
        disposeListeners.add(listener);
        return { dispose: () => disposeListeners.delete(listener) };
      },
      onDidChangeViewState: (listener: () => void) => {
        viewStateListeners.add(listener);
        return { dispose: () => viewStateListeners.delete(listener) };
      },
      changeVisibility: (value: boolean) => {
        visible = value;
        for (const listener of viewStateListeners) listener();
      },
      receive: (message: unknown) => {
        for (const listener of messageListeners) listener(message);
      },
      webview: {
        cspSource: "vscode-webview-resource:",
        get html() {
          return html;
        },
        set html(value: string) {
          html = value;
          assignments.push(value);
        },
        postMessage,
        asWebviewUri: (value: ReturnType<typeof uri>) => value,
        onDidReceiveMessage: (listener: (message: unknown) => void) => {
          messageListeners.add(listener);
          return { dispose: () => messageListeners.delete(listener) };
        },
      },
    };
  }
  return {
    uri,
    folder,
    panels,
    read,
    resolvePackage,
    temporary,
    write,
    unlink,
    rmdir,
    replace,
    canonical,
    fileStat,
    contentProviders,
    notifyFolderChange: () => {
      for (const listener of folderListeners) listener();
    },
    module: {
      EventEmitter: class<Value> {
        private readonly listeners = new Set<(value: Value) => void>();
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
      },
      WorkspaceEdit: class {
        replace = replace;
      },
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
        workspaceFolders: [folder],
        isTrusted: true,
        fs: {
          writeFile: vi.fn(
            async (_uri: ReturnType<typeof uri>, _bytes: Uint8Array) => {},
          ),
        },
        openTextDocument: vi.fn(),
        applyEdit: vi.fn(),
        onDidChangeWorkspaceFolders: (listener: () => void) => {
          folderListeners.add(listener);
          return { dispose: () => folderListeners.delete(listener) };
        },
        registerTextDocumentContentProvider: vi.fn(
          (
            scheme: string,
            provider: (typeof contentProviders)[number]["provider"],
          ) => {
            const dispose = vi.fn();
            contentProviders.push({ scheme, provider, dispose });
            return { dispose };
          },
        ),
      },
      window: {
        createWebviewPanel: vi.fn(() => {
          const panel = createPanel();
          panels.push(panel);
          return panel;
        }),
        showInformationMessage: vi.fn(),
        showWarningMessage: vi.fn(),
        showErrorMessage: vi.fn(),
        showTextDocument: vi.fn(),
        showSaveDialog: vi.fn(),
      },
      env: { openExternal: vi.fn() },
    },
  };
});

vi.mock("vscode", () => editor.module);
vi.mock("../src/process_adapter.js", () => ({
  runRehearsalJson: editor.read,
  resolveWorkspaceRehearsal: editor.resolvePackage,
}));
vi.mock("node:fs/promises", async (original) => ({
  ...(await original<typeof import("node:fs/promises")>()),
  mkdtemp: editor.temporary,
  writeFile: editor.write,
  unlink: editor.unlink,
  rmdir: editor.rmdir,
  realpath: editor.canonical,
  lstat: editor.fileStat,
}));

import { RehearsalWorkspacePanels } from "../src/workspace_panel.js";
import { parseActivityData } from "../src/contracts.js";
import type { ProjectSnapshot } from "../src/project_snapshot.js";
import { configurationFingerprint } from "../src/configuration_editor.js";
import { parseConfigurationMetadata } from "../src/configuration_contract.js";
import { ConfigurationReviewDocuments } from "../src/configuration_review_documents.js";

class Events<Value> {
  readonly listeners = new Set<(value: Value) => void>();
  readonly event = (listener: (value: Value) => void) => {
    this.listeners.add(listener);
    return { dispose: () => this.listeners.delete(listener) };
  };
  fire(value: Value) {
    for (const listener of this.listeners) listener(value);
  }
}

const key = editor.folder.uri.toString();
const ready = (): ProjectSnapshot => ({
  workspaceName: editor.folder.name,
  workspaceRoot: editor.folder.uri.fsPath,
  availability: "ready",
  version: "0.1.0-rc.4",
  activity: { schemaVersion: 1, state: "idle", operation: null },
  readiness: { state: "READY", passed: 3, failed: 0, checks: [] },
});
const busy = (seconds = 1, operationId = "a".repeat(64)): ProjectSnapshot => ({
  workspaceName: editor.folder.name,
  workspaceRoot: editor.folder.uri.fsPath,
  availability: "operation_active",
  version: "0.1.0-rc.4",
  activity: parseActivityData({
    schemaVersion: 1,
    state: "busy",
    operation: {
      kind: "run",
      startedAt: "2026-10-15T12:00:00.000Z",
      rehearsalVersion: "0.1.0-rc.4",
      progress: {
        schemaVersion: 1,
        operationId,
        state: "running",
        startedAt: "2026-10-15T12:00:00.000Z",
        updatedAt: new Date(
          Date.parse("2026-10-15T12:00:00.000Z") + seconds * 1000,
        ).toISOString(),
        elapsedMilliseconds: seconds * 1000,
        currentStage: {
          id: 1,
          phase: "runtime-lifecycle",
          target: "primary",
          state: "running",
          startedAt: "2026-10-15T12:00:00.000Z",
          endedAt: null,
          durationMilliseconds: seconds * 1000,
        },
        completedStages: [],
        events: [
          {
            sequence: 1,
            code: "operation.started",
            phase: null,
            target: null,
            at: "2026-10-15T12:00:00.000Z",
          },
        ],
        truncated: { stages: false, events: false },
      },
    },
    recent: [],
  }),
});

const owners: RehearsalWorkspacePanels[] = [];
const reviewOwners: ConfigurationReviewDocuments[] = [];
const ownedDirectories: string[] = [];
const harness = (initial = ready(), selectedKey = key) => {
  let current = initial;
  const snapshots = new Events<{
    workspaceKey: string;
    snapshot: ProjectSnapshot;
  }>();
  const inspections = new Events<{ workspaceKey: string }>();
  const activity = new Events<string>();
  const actions = {
    onDidRecordActivity: activity.event,
    registerWorkspace: vi.fn(() => "opaque-workspace-token"),
    releaseWorkspace: vi.fn(),
    activityFor: vi.fn(() => []),
  };
  const projects = {
    onDidUpdateSnapshot: snapshots.event,
    onDidChangeInspection: inspections.event,
    snapshotFor: (workspaceKey: string) =>
      workspaceKey === selectedKey ? current : undefined,
    inspectionStateFor: () => "idle",
    refreshWorkspace: vi.fn(async () => {}),
  };
  const owner = new RehearsalWorkspacePanels(
    editor.uri("/private/extension") as never,
    projects as never,
    actions as never,
    { get: vi.fn(), update: vi.fn(async () => {}) } as never,
    "0.1.2",
  );
  owners.push(owner);
  return {
    owner,
    actions,
    snapshots,
    inspections,
    activity,
    projects,
    update: (snapshot: ProjectSnapshot) => {
      current = snapshot;
      snapshots.fire({ workspaceKey: selectedKey, snapshot });
    },
  };
};

afterEach(async () => {
  for (const owner of owners.splice(0)) owner.dispose();
  for (const owner of reviewOwners.splice(0)) owner.dispose();
  editor.panels.splice(0);
  editor.contentProviders.splice(0);
  editor.module.workspace.isTrusted = true;
  editor.module.workspace.workspaceFolders = [editor.folder];
  editor.module.workspace.openTextDocument.mockReset();
  editor.module.workspace.applyEdit.mockReset();
  editor.module.window.showWarningMessage.mockReset();
  editor.module.window.showTextDocument.mockReset();
  editor.module.window.showSaveDialog.mockReset();
  editor.module.workspace.fs.writeFile.mockReset().mockResolvedValue(undefined);
  editor.read.mockReset();
  editor.resolvePackage.mockReset();
  editor.canonical.mockReset().mockImplementation(async (path: string) => path);
  editor.fileStat.mockReset().mockImplementation(async (path: string) => ({
    dev: 1,
    ino: 501,
    isFile: () => path.endsWith(".mjs"),
    isDirectory: () => !path.endsWith(".mjs"),
    isSymbolicLink: (): boolean => false,
  }));
  vi.clearAllMocks();
  const fs =
    await vi.importActual<typeof import("node:fs/promises")>(
      "node:fs/promises",
    );
  for (const directory of ownedDirectories.splice(0))
    await fs.rm(directory, { recursive: true, force: true });
});

describe("explicit verification-report export", () => {
  it.each(["trust", "folder", "panel", "replaced"] as const)(
    "refuses a stale export message after the %s boundary changes before the dialog",
    async (change) => {
      const fixture = harness();
      await fixture.owner.open(key);
      const panel = editor.panels[0]!;
      if (change === "trust") editor.module.workspace.isTrusted = false;
      else if (change === "folder")
        editor.module.workspace.workspaceFolders = [];
      else {
        panel.dispose();
        if (change === "replaced") await fixture.owner.open(key);
      }
      panel.receive({ type: "exportReport", format: "json" });
      await new Promise<void>((resolve) => setImmediate(resolve));
      expect(editor.module.window.showSaveDialog).not.toHaveBeenCalled();
      expect(editor.module.workspace.fs.writeFile).not.toHaveBeenCalled();
    },
  );

  it.each([
    "trust",
    "folder",
    "folder-replaced",
    "panel",
    "owner",
    "replaced",
    "snapshot",
  ] as const)(
    "refuses writing after the %s boundary changes while the save dialog is open",
    async (change) => {
      const fixture = harness();
      let choose:
        ((destination: ReturnType<typeof editor.uri>) => void) | undefined;
      editor.module.window.showSaveDialog.mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            choose = resolve;
          }),
      );
      await fixture.owner.open(key);
      const panel = editor.panels[0]!;
      panel.receive({ type: "exportReport", format: "json" });
      await vi.waitFor(() => expect(choose).toBeTypeOf("function"));
      if (change === "trust") editor.module.workspace.isTrusted = false;
      else if (change === "folder")
        editor.module.workspace.workspaceFolders = [];
      else if (change === "folder-replaced")
        editor.module.workspace.workspaceFolders = [
          { ...editor.folder, uri: editor.uri(editor.folder.uri.fsPath) },
        ];
      else if (change === "owner") fixture.owner.dispose();
      else if (change === "snapshot")
        fixture.update({ ...ready(), version: "0.1.0-rc.7" });
      else {
        panel.dispose();
        if (change === "replaced") await fixture.owner.open(key);
      }
      choose!(editor.uri("/chosen/report.json"));
      await new Promise<void>((resolve) => setImmediate(resolve));
      expect(editor.module.workspace.fs.writeFile).not.toHaveBeenCalled();
      expect(
        editor.module.window.showInformationMessage,
      ).not.toHaveBeenCalled();
    },
  );

  it.each(["remote", "authority", "query", "fragment", "relative"] as const)(
    "refuses a %s save destination without writing or exposing it",
    async (kind) => {
      const fixture = harness();
      const destination = {
        ...editor.uri("/chosen/private-destination-canary.json"),
        ...(kind === "remote" ? { scheme: "vscode-remote" } : {}),
        ...(kind === "authority" ? { authority: "private-host-canary" } : {}),
        ...(kind === "query" ? { query: "private-query-canary" } : {}),
        ...(kind === "fragment" ? { fragment: "private-fragment-canary" } : {}),
        ...(kind === "relative"
          ? { fsPath: "private-relative-canary.json" }
          : {}),
      };
      editor.module.window.showSaveDialog.mockResolvedValue(destination);
      await fixture.owner.open(key);
      editor.panels[0]!.receive({ type: "exportReport", format: "json" });
      await new Promise<void>((resolve) => setImmediate(resolve));
      expect(editor.module.workspace.fs.writeFile).not.toHaveBeenCalled();
      expect(editor.module.window.showErrorMessage).toHaveBeenCalledOnce();
      expect(
        JSON.stringify(editor.module.window.showErrorMessage.mock.calls),
      ).not.toContain("canary");
    },
  );

  it.each(["dialog", "write"] as const)(
    "handles %s failure with bounded recovery guidance and no raw private error",
    async (failure) => {
      const fixture = harness();
      const error = new Error(
        "PRIVATE_CANARY /private/destination postgres://private-host",
      );
      editor.module.window.showSaveDialog.mockResolvedValue(
        editor.uri("/chosen/report.json"),
      );
      if (failure === "dialog")
        editor.module.window.showSaveDialog.mockRejectedValueOnce(error);
      else editor.module.workspace.fs.writeFile.mockRejectedValueOnce(error);
      await fixture.owner.open(key);
      editor.panels[0]!.receive({ type: "exportReport", format: "markdown" });
      await vi.waitFor(() =>
        expect(editor.module.window.showErrorMessage).toHaveBeenCalledOnce(),
      );
      const output = JSON.stringify(
        editor.module.window.showErrorMessage.mock.calls,
      );
      expect(output).not.toMatch(/PRIVATE_CANARY|\/private|postgres:/u);
      expect(output.length).toBeLessThan(300);
      expect(
        editor.module.window.showInformationMessage,
      ).not.toHaveBeenCalled();
      expect(editor.module.workspace.fs.writeFile).toHaveBeenCalledTimes(
        failure === "write" ? 1 : 0,
      );
    },
  );

  it("coalesces duplicate pending exports and permits a deliberate later export", async () => {
    const fixture = harness();
    let cancel: ((value: undefined) => void) | undefined;
    editor.module.window.showSaveDialog.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          cancel = resolve;
        }),
    );
    await fixture.owner.open(key);
    const panel = editor.panels[0]!;
    panel.receive({ type: "exportReport", format: "json" });
    panel.receive({ type: "exportReport", format: "markdown" });
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(editor.module.window.showSaveDialog).toHaveBeenCalledOnce();
    cancel!(undefined);
    await new Promise<void>((resolve) => setImmediate(resolve));
    editor.module.window.showSaveDialog.mockResolvedValue(
      editor.uri("/chosen/report.json"),
    );
    panel.receive({ type: "exportReport", format: "json" });
    await vi.waitFor(() =>
      expect(editor.module.workspace.fs.writeFile).toHaveBeenCalledOnce(),
    );
    expect(editor.module.window.showSaveDialog).toHaveBeenCalledTimes(2);
  });

  it.each(["json", "markdown"] as const)(
    "does not write or announce an export when the %s save dialog is cancelled",
    async (format) => {
      const fixture = harness();
      editor.module.window.showSaveDialog.mockResolvedValue(undefined);
      await fixture.owner.open(key);
      const panel = editor.panels[0]!;

      panel.receive({ type: "exportReport", format });
      await vi.waitFor(() =>
        expect(editor.module.window.showSaveDialog).toHaveBeenCalledOnce(),
      );
      await new Promise<void>((resolve) => setImmediate(resolve));

      expect(editor.module.workspace.fs.writeFile).not.toHaveBeenCalled();
      expect(editor.write).not.toHaveBeenCalled();
      expect(
        editor.module.window.showInformationMessage,
      ).not.toHaveBeenCalled();
      expect(editor.module.window.showErrorMessage).not.toHaveBeenCalled();
      expect(editor.read).not.toHaveBeenCalled();
    },
  );

  it.each(["json", "markdown"] as const)(
    "writes the %s report only to its explicitly selected destination",
    async (format) => {
      const fixture = harness({
        ...ready(),
        workspaceName: "../private-path",
        packageLocation: "/private/package-location",
        applicationUrl: "http://localhost:5175/private-app-path",
      });
      const destination = editor.uri("/chosen/report-output");
      editor.module.window.showSaveDialog.mockResolvedValue(destination);
      await fixture.owner.open(key);

      editor.panels[0]!.receive({ type: "exportReport", format });
      await vi.waitFor(() =>
        expect(editor.module.workspace.fs.writeFile).toHaveBeenCalledOnce(),
      );
      const [selected, bytes] =
        editor.module.workspace.fs.writeFile.mock.calls[0]!;
      expect(selected).toBe(destination);
      const content = new TextDecoder().decode(bytes);
      expect(content).not.toMatch(
        /\/private|private-app-path|package-location/u,
      );
      if (format === "json") {
        const report = JSON.parse(content);
        expect(report.schemaVersion).toBe(1);
        expect(report.versions.extension).toBe("0.1.2");
      } else {
        expect(content).toContain("# Rehearsal verification report");
      }
      expect(content).toContain("unsigned");
      expect(editor.write).not.toHaveBeenCalled();
      expect(editor.read).not.toHaveBeenCalled();
    },
  );

  it("does not ask for a destination or write for an unsupported export format", async () => {
    const fixture = harness();
    await fixture.owner.open(key);
    editor.panels[0]!.receive({ type: "exportReport", format: "shell" });
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(editor.module.window.showSaveDialog).not.toHaveBeenCalled();
    expect(editor.module.workspace.fs.writeFile).not.toHaveBeenCalled();
  });
});

const reviewHarness = (
  modern = false,
  root = editor.folder.uri.fsPath,
  configPath = "rehearsal.config.mjs",
) => {
  const source =
    'export default { runtime: { applicationUrl: "http://localhost:5175" } };\n';
  const snapshot: ProjectSnapshot = {
    ...ready(),
    workspaceRoot: root,
    configPath,
  };
  const workspaceKey = editor.uri(root).toString();
  const fixture = harness(snapshot, workspaceKey);
  const document = {
    uri: editor.uri(join(root, configPath)),
    isDirty: false,
    isClosed: false,
    text: source,
    lineCount: 1,
    lineAt: () => ({ range: { end: { line: 0, character: source.length } } }),
    getText() {
      return this.text;
    },
    save: vi.fn(async () => {
      document.isDirty = false;
      return true;
    }),
  };
  const idle = {
    result: { data: { schemaVersion: 1, state: "idle", operation: null } },
  };
  const metadata = {
    schemaVersion: 1,
    path: snapshot.configPath,
    sourceSha256: configurationFingerprint(source),
    fields: [
      {
        path: "runtime.applicationUrl",
        kind: "local-url",
        value: "http://localhost:5175",
        provenance: "validated-active-configuration",
        confidence: "certain",
        reviewRequired: true,
      },
    ],
    profiles: [],
    patchContract: {
      schemaVersion: 1,
      input: "project-local-json-file",
      maximumBytes: 65536,
      writesConfiguration: false,
      executesProposedCommands: false,
      concurrentChanges: "refuse",
    },
    pathResolution: "Project-local paths.",
    manualFields: "Privacy and provider changes are manual.",
  };
  const validation = {
    result: {
      data: {
        sourceSha256: configurationFingerprint(source),
        validation: "complete-config-passed",
        writesConfiguration: false,
        executesProposedCommands: false,
      },
    },
  };
  editor.module.workspace.openTextDocument.mockImplementation(
    async (request) =>
      request?.toString().includes("rehearsal-configuration-review:")
        ? {
            uri: request,
            isUntitled: false,
            isDirty: false,
            languageId: "diff",
            getText: () =>
              editor.contentProviders
                .at(-1)!
                .provider.provideTextDocumentContent(request),
          }
        : document,
  );
  editor.module.window.showTextDocument.mockResolvedValue(undefined);
  editor.module.window.showWarningMessage.mockResolvedValue("Apply Changes");
  editor.resolvePackage.mockResolvedValue({
    configurationReviewSchema: modern ? 1 : null,
  });
  editor.read.mockImplementation(
    async ({ command }: { command: readonly string[] }) =>
      command[0] === "activity"
        ? idle
        : command[1] === "review"
          ? validation
          : { result: { data: metadata } },
  );
  editor.module.workspace.applyEdit.mockImplementation(async () => {
    const text = editor.replace.mock.calls.at(-1)?.[2];
    if (typeof text !== "string")
      throw new Error("Missing reviewed replacement.");
    document.text = text;
    document.isDirty = true;
    return true;
  });
  return {
    ...fixture,
    snapshot,
    document,
    idle,
    validation,
    metadata,
    workspaceKey,
    review: () =>
      (
        fixture.owner as unknown as {
          handleMessage(
            panel: unknown,
            workspaceKey: string,
            raw: unknown,
          ): Promise<void>;
        }
      ).handleMessage(editor.panels[0], workspaceKey, {
        type: "reviewConfiguration",
        values: { applicationUrl: "http://localhost:5176" },
      }),
  };
};

const filesystemReview = async (configPath = "rehearsal.config.mjs") => {
  const fs =
    await vi.importActual<typeof import("node:fs/promises")>(
      "node:fs/promises",
    );
  const directory = await fs.realpath(
    await fs.mkdtemp(join(tmpdir(), "rehearsal-panel-boundary-")),
  );
  ownedDirectories.push(directory);
  const root = join(directory, "workspace");
  const outside = join(directory, "outside");
  await fs.mkdir(root);
  await fs.mkdir(outside);
  const source =
    'export default { runtime: { applicationUrl: "http://localhost:5175" } };\n';
  const external = join(outside, "rehearsal.config.mjs");
  await fs.writeFile(external, source);
  editor.canonical.mockImplementation((path: string) => fs.realpath(path));
  editor.fileStat.mockImplementation((path: string) => fs.lstat(path));
  editor.module.workspace.workspaceFolders = [
    { name: "Independent fixture", uri: editor.uri(root) },
  ];
  const fixture = reviewHarness(false, root, configPath);
  return {
    ...fixture,
    fs,
    root,
    outside,
    external,
    source,
    path: join(root, configPath),
  };
};

describe("read-only configuration review documents", () => {
  const documents = (
    allowed: (workspaceKey: string) => boolean = () => true,
  ) => {
    const owner = new ConfigurationReviewDocuments(allowed);
    reviewOwners.push(owner);
    return owner;
  };

  it("uses opaque custom URIs and retains at most sixteen independent reviews", () => {
    const owner = documents();
    const changed = vi.fn();
    owner.onDidChange(changed);
    const uris = Array.from({ length: 17 }, (_, index) =>
      owner.create("private-workspace-key", `Reviewed proposal ${index}`),
    );
    expect(new Set(uris.map((uri) => uri.toString())).size).toBe(17);
    for (const uri of uris) {
      expect(uri.toString()).toMatch(
        /rehearsal-configuration-review:\/[a-f0-9]{32}\/configuration-review\.diff$/u,
      );
      expect(uri.toString()).not.toContain("private-workspace-key");
    }
    expect(owner.provideTextDocumentContent(uris[0]!)).toContain("expired");
    expect(owner.provideTextDocumentContent(uris[1]!)).toBe(
      "Reviewed proposal 1",
    );
    expect(changed).toHaveBeenCalledWith(uris[0]);
    expect(
      owner.provideTextDocumentContent(editor.uri("unregistered") as never),
    ).toContain("expired");
    expect(editor.write).not.toHaveBeenCalled();
  });

  it("bounds individual UTF-8 bytes and retained bytes without clearing unrelated small reviews", () => {
    const owner = documents();
    expect(() => owner.create(key, "é".repeat(1024 * 1024 + 1))).toThrow(
      "too large",
    );
    const first = owner.create("first", "a".repeat(2 * 1024 * 1024));
    for (let index = 0; index < 4; index++)
      owner.create(`remaining-${index}`, "b".repeat(2 * 1024 * 1024));
    expect(owner.provideTextDocumentContent(first)).toContain("expired");
    const small = owner.create("small", "Small independent review");
    expect(owner.provideTextDocumentContent(small)).toBe(
      "Small independent review",
    );
  });

  it("isolates project removal, rejects revoked trust and disposes its registered provider", () => {
    let trusted = true;
    const owner = documents(() => trusted);
    const first = owner.create("first", "First review");
    const second = owner.create("second", "Second review");
    const changed = vi.fn();
    owner.onDidChange(changed);
    owner.releaseWorkspace("first");
    expect(changed).toHaveBeenCalledWith(first);
    expect(owner.provideTextDocumentContent(first)).toContain("expired");
    expect(owner.provideTextDocumentContent(second)).toBe("Second review");
    trusted = false;
    expect(owner.provideTextDocumentContent(second)).toContain("expired");
    expect(() => owner.create("second", "Refused")).toThrow("trusted");
    owner.dispose();
    expect(changed).toHaveBeenCalledWith(second);
    expect(editor.contentProviders.at(-1)!.dispose).toHaveBeenCalledOnce();
    trusted = true;
    expect(() => owner.create("second", "Disposed")).toThrow("trusted");
    expect(owner.provideTextDocumentContent(second)).toContain("expired");
  });

  it("opens a read-only diff without an editable untitled document or file write", async () => {
    const fixture = reviewHarness();
    editor.module.window.showWarningMessage.mockResolvedValue(undefined);
    await fixture.owner.open(key);
    await fixture.review();
    const review = editor.module.window.showTextDocument.mock.calls[0]![0];
    expect(review.isUntitled).toBe(false);
    expect(review.isDirty).toBe(false);
    expect(review.languageId).toBe("diff");
    expect(review.getText()).toContain("http://localhost:5176");
    for (const [request] of editor.module.workspace.openTextDocument.mock.calls)
      expect(request).not.toHaveProperty("content");
    expect(editor.write).not.toHaveBeenCalled();
    expect(fixture.document.save).not.toHaveBeenCalled();
  });

  it.each(["trust", "folder", "panel"] as const)(
    "expires visible review content after its %s boundary is removed",
    async (change) => {
      const fixture = reviewHarness();
      editor.module.window.showWarningMessage.mockResolvedValue(undefined);
      await fixture.owner.open(key);
      await fixture.review();
      const review = editor.module.window.showTextDocument.mock.calls[0]![0];
      const provider = editor.contentProviders.at(-1)!.provider;
      const changed = vi.fn();
      provider.onDidChange(changed);
      expect(review.getText()).toContain("http://localhost:5176");
      if (change === "trust") {
        editor.module.workspace.isTrusted = false;
        fixture.update(fixture.snapshot);
      } else if (change === "folder") {
        editor.module.workspace.workspaceFolders = [];
        editor.notifyFolderChange();
      } else editor.panels[0]!.dispose();
      expect(changed).toHaveBeenCalledWith(review.uri);
      expect(provider.provideTextDocumentContent(review.uri)).toContain(
        "expired",
      );
      expect(editor.write).not.toHaveBeenCalled();
    },
  );
});

describe("configuration review filesystem boundary", () => {
  it.each(["file", "ancestor"] as const)(
    "refuses an existing %s symbolic-link redirect before opening the configuration",
    async (kind) => {
      const fixture = await filesystemReview(
        kind === "ancestor"
          ? "infrastructure/rehearsal.config.mjs"
          : "rehearsal.config.mjs",
      );
      await fixture.fs.symlink(
        kind === "ancestor" ? fixture.outside : fixture.external,
        kind === "ancestor"
          ? join(fixture.root, "infrastructure")
          : fixture.path,
      );
      await fixture.owner.open(fixture.workspaceKey);
      await fixture.review();
      expect(editor.module.workspace.openTextDocument).not.toHaveBeenCalled();
      expect(editor.read).not.toHaveBeenCalled();
      expect(editor.module.workspace.applyEdit).not.toHaveBeenCalled();
      expect(fixture.document.save).not.toHaveBeenCalled();
      expect(editor.module.window.showErrorMessage).toHaveBeenCalledWith(
        expect.stringContaining("symbolic-link redirects"),
      );
      expect(await fixture.fs.readFile(fixture.external, "utf8")).toBe(
        fixture.source,
      );
    },
  );

  it.each(["symbolic-link", "regular-file"] as const)(
    "refuses a same-content %s replacement while approval is pending",
    async (replacement) => {
      const fixture = await filesystemReview();
      await fixture.fs.writeFile(fixture.path, fixture.source);
      await fixture.owner.open(fixture.workspaceKey);
      let approve: ((value: string) => void) | undefined;
      editor.module.window.showWarningMessage.mockImplementationOnce(
        () =>
          new Promise((done) => {
            approve = done;
          }),
      );
      const reviewing = fixture.review();
      await vi.waitFor(() => expect(approve).toBeTypeOf("function"));
      const retained = join(fixture.root, "retained-original.mjs");
      await fixture.fs.rename(fixture.path, retained);
      if (replacement === "symbolic-link")
        await fixture.fs.symlink(fixture.external, fixture.path);
      else await fixture.fs.writeFile(fixture.path, fixture.source);
      approve!("Apply Changes");
      await reviewing;
      expect(editor.module.workspace.applyEdit).not.toHaveBeenCalled();
      expect(fixture.document.save).not.toHaveBeenCalled();
      expect(editor.module.window.showErrorMessage).toHaveBeenCalled();
      expect(await fixture.fs.readFile(retained, "utf8")).toBe(fixture.source);
      expect(await fixture.fs.readFile(fixture.external, "utf8")).toBe(
        fixture.source,
      );
    },
  );

  it("does not save after a filesystem redirect replaces the file during the editor apply", async () => {
    const fixture = await filesystemReview();
    await fixture.fs.writeFile(fixture.path, fixture.source);
    await fixture.owner.open(fixture.workspaceKey);
    const apply = editor.module.workspace.applyEdit.getMockImplementation()!;
    editor.module.workspace.applyEdit.mockImplementationOnce(async () => {
      await apply();
      await fixture.fs.rename(
        fixture.path,
        join(fixture.root, "retained-original.mjs"),
      );
      await fixture.fs.symlink(fixture.external, fixture.path);
      return true;
    });
    await fixture.review();
    expect(editor.module.workspace.applyEdit).toHaveBeenCalledOnce();
    expect(fixture.document.isDirty).toBe(true);
    expect(fixture.document.save).not.toHaveBeenCalled();
    expect(fixture.projects.refreshWorkspace).not.toHaveBeenCalled();
    expect(await fixture.fs.readFile(fixture.external, "utf8")).toBe(
      fixture.source,
    );
  });

  it("saves a regular nested configuration without rejecting unrelated package links", async () => {
    const fixture = await filesystemReview(
      "infrastructure/rehearsal.config.mjs",
    );
    await fixture.fs.mkdir(join(fixture.root, "infrastructure"));
    await fixture.fs.writeFile(fixture.path, fixture.source);
    await fixture.fs.symlink(
      fixture.outside,
      join(fixture.root, "node_modules"),
    );
    fixture.document.save.mockImplementation(async () => {
      await fixture.fs.writeFile(
        fixture.document.uri.fsPath,
        fixture.document.text,
      );
      fixture.document.isDirty = false;
      return true;
    });
    await fixture.owner.open(fixture.workspaceKey);
    await fixture.review();
    expect(fixture.document.save).toHaveBeenCalledOnce();
    expect(editor.module.window.showErrorMessage).not.toHaveBeenCalled();
    expect(await fixture.fs.readFile(fixture.path, "utf8")).toContain(
      "http://localhost:5176",
    );
    expect(await fixture.fs.readFile(fixture.external, "utf8")).toBe(
      fixture.source,
    );
  });
});

describe("asynchronous configuration review authority", () => {
  it("ignores a queued review message from a disposed panel after its project panel is replaced", async () => {
    const fixture = reviewHarness(true);
    await fixture.owner.open(key);
    const previous = editor.panels[0]!;
    previous.dispose();
    await fixture.owner.open(key);
    expect(editor.panels[1]).not.toBe(previous);
    previous.receive({
      type: "reviewConfiguration",
      values: { applicationUrl: "http://localhost:5176" },
    });
    await new Promise<void>((done) => setImmediate(done));
    expect(editor.module.workspace.openTextDocument).not.toHaveBeenCalled();
    expect(editor.read).not.toHaveBeenCalled();
    expect(editor.resolvePackage).not.toHaveBeenCalled();
    expect(editor.module.window.showWarningMessage).not.toHaveBeenCalled();
    expect(editor.module.workspace.applyEdit).not.toHaveBeenCalled();
    expect(fixture.document.save).not.toHaveBeenCalled();
    expect(editor.write).not.toHaveBeenCalled();
  });

  it.each(["realpath", "lstat", "save", "cli"] as const)(
    "redacts an unexpected %s failure without exposing private error text",
    async (operation) => {
      const fixture = reviewHarness();
      await fixture.owner.open(key);
      const failure = new Error(
        "PRIVATE_CANARY /private/project/rehearsal.config.mjs postgres://private-host raw-provider-output",
      );
      if (operation === "realpath")
        editor.canonical.mockRejectedValueOnce(failure);
      else if (operation === "lstat")
        editor.fileStat.mockRejectedValueOnce(failure);
      else if (operation === "save")
        fixture.document.save.mockRejectedValueOnce(failure);
      else editor.read.mockRejectedValueOnce(failure);
      await fixture.review();
      expect(editor.module.window.showErrorMessage).toHaveBeenCalledOnce();
      const output = String(
        editor.module.window.showErrorMessage.mock.calls[0]![0],
      );
      expect(output).toContain("could not complete this configuration review");
      expect(output).not.toMatch(
        /PRIVATE_CANARY|\/private|postgres:|raw-provider-output/u,
      );
      expect(output.length).toBeLessThan(300);
      expect(fixture.projects.refreshWorkspace).not.toHaveBeenCalled();
      expect(
        editor.module.window.showInformationMessage,
      ).not.toHaveBeenCalled();
    },
  );

  it.each(["cancel", "failure", "success"] as const)(
    "refuses a duplicate review during approval and releases its guard after %s",
    async (outcome) => {
      const fixture = reviewHarness();
      await fixture.owner.open(key);
      let approve: ((value: string | undefined) => void) | undefined;
      editor.module.window.showWarningMessage.mockImplementationOnce(
        () =>
          new Promise((done) => {
            approve = done;
          }),
      );
      const first = fixture.review();
      await vi.waitFor(() => expect(approve).toBeTypeOf("function"));
      const reads = editor.read.mock.calls.length;
      await fixture.review();
      expect(editor.read).toHaveBeenCalledTimes(reads);
      expect(editor.module.window.showWarningMessage).toHaveBeenCalledOnce();
      expect(editor.module.window.showInformationMessage).toHaveBeenCalledWith(
        "Another configuration review is already in progress for this project. Finish or dismiss it before starting another.",
      );
      if (outcome === "failure")
        editor.module.workspace.applyEdit.mockResolvedValueOnce(false);
      approve!(outcome === "cancel" ? undefined : "Apply Changes");
      await first;
      const laterReads = editor.read.mock.calls.length;
      editor.module.window.showInformationMessage.mockClear();
      await fixture.review();
      expect(editor.read.mock.calls.length).toBeGreaterThan(laterReads);
      expect(
        editor.module.window.showInformationMessage,
      ).not.toHaveBeenCalledWith(
        expect.stringContaining("already in progress"),
      );
      expect(fixture.document.save).toHaveBeenCalledOnce();
    },
  );

  it.each(["apply", "save"] as const)(
    "keeps its duplicate-review guard until the asynchronous %s completes",
    async (phase) => {
      const fixture = reviewHarness();
      await fixture.owner.open(key);
      let release: (() => void) | undefined;
      const barrier = new Promise<void>((done) => {
        release = done;
      });
      const action =
        phase === "apply"
          ? editor.module.workspace.applyEdit
          : fixture.document.save;
      const original = action.getMockImplementation()!;
      action.mockImplementationOnce(async () => {
        await barrier;
        return await original();
      });
      const first = fixture.review();
      await vi.waitFor(() => expect(action).toHaveBeenCalledOnce());
      const reads = editor.read.mock.calls.length;
      await fixture.review();
      expect(editor.read).toHaveBeenCalledTimes(reads);
      expect(editor.module.window.showWarningMessage).toHaveBeenCalledOnce();
      release!();
      await first;
      expect(editor.module.workspace.applyEdit).toHaveBeenCalledOnce();
      expect(fixture.document.save).toHaveBeenCalledOnce();
      expect(editor.module.window.showErrorMessage).not.toHaveBeenCalled();
    },
  );

  it.each(["source", "dirty", "closed"] as const)(
    "refuses success without overwriting when the document becomes %s during save",
    async (change) => {
      const fixture = reviewHarness();
      await fixture.owner.open(key);
      let finishSave: (() => void) | undefined;
      fixture.document.save.mockImplementationOnce(async () => {
        await new Promise<void>((done) => {
          finishSave = done;
        });
        fixture.document.isDirty = change === "dirty";
        if (change === "closed") fixture.document.isClosed = true;
        if (change === "source")
          fixture.document.text += "// Concurrent manual change.\n";
        return true;
      });
      const reviewing = fixture.review();
      await vi.waitFor(() => expect(finishSave).toBeTypeOf("function"));
      finishSave!();
      await reviewing;
      expect(editor.module.workspace.applyEdit).toHaveBeenCalledOnce();
      expect(fixture.document.save).toHaveBeenCalledOnce();
      expect(fixture.projects.refreshWorkspace).not.toHaveBeenCalled();
      expect(
        editor.module.window.showInformationMessage,
      ).not.toHaveBeenCalled();
      expect(editor.module.window.showErrorMessage).toHaveBeenCalledWith(
        expect.stringContaining("changed while saving"),
      );
      if (change === "source")
        expect(fixture.document.text).toContain("// Concurrent manual change.");
      if (change === "dirty") expect(fixture.document.isDirty).toBe(true);
      if (change === "closed") expect(fixture.document.isClosed).toBe(true);
    },
  );

  it("applies an unchanged explicitly approved proposal and saves once", async () => {
    const fixture = reviewHarness(true);
    await fixture.owner.open(key);
    await fixture.review();
    expect(editor.module.workspace.applyEdit).toHaveBeenCalledOnce();
    expect(fixture.document.save).toHaveBeenCalledOnce();
    expect(fixture.document.text).toContain("http://localhost:5176");
    expect(fixture.projects.refreshWorkspace).toHaveBeenCalledWith(key);
    expect(editor.module.window.showErrorMessage).not.toHaveBeenCalled();
  });

  it("accepts only its exact reviewed source fingerprint when its own save refreshes metadata", async () => {
    const fixture = reviewHarness(true);
    fixture.update({
      ...fixture.snapshot,
      configurationMetadata: parseConfigurationMetadata(fixture.metadata),
    });
    await fixture.owner.open(key);
    fixture.document.save.mockImplementation(async () => {
      fixture.document.isDirty = false;
      fixture.update({
        ...fixture.snapshot,
        configurationMetadata: parseConfigurationMetadata({
          ...fixture.metadata,
          sourceSha256: configurationFingerprint(fixture.document.text),
          fields: fixture.metadata.fields.map((field) => ({
            ...field,
            value: "http://localhost:5176",
          })),
        }),
      });
      return true;
    });
    await fixture.review();
    expect(fixture.document.save).toHaveBeenCalledOnce();
    expect(fixture.projects.refreshWorkspace).toHaveBeenCalledWith(key);
    expect(editor.module.window.showErrorMessage).not.toHaveBeenCalled();
  });

  it("does not accept unrelated metadata changes as its own completed save", async () => {
    const fixture = reviewHarness(true);
    fixture.update({
      ...fixture.snapshot,
      configurationMetadata: parseConfigurationMetadata(fixture.metadata),
    });
    await fixture.owner.open(key);
    fixture.document.save.mockImplementation(async () => {
      fixture.document.isDirty = false;
      fixture.update({
        ...fixture.snapshot,
        configurationMetadata: parseConfigurationMetadata({
          ...fixture.metadata,
          sourceSha256: "e".repeat(64),
        }),
      });
      return true;
    });
    await fixture.review();
    expect(fixture.document.save).toHaveBeenCalledOnce();
    expect(fixture.projects.refreshWorkspace).not.toHaveBeenCalled();
    expect(editor.module.window.showErrorMessage).toHaveBeenCalled();
  });

  it("stops after an in-flight activity read if trust is revoked", async () => {
    const fixture = reviewHarness();
    await fixture.owner.open(key);
    let release: ((value: typeof fixture.idle) => void) | undefined;
    editor.read.mockImplementationOnce(
      () =>
        new Promise((done) => {
          release = done;
        }),
    );
    const reviewing = fixture.review();
    await vi.waitFor(() => expect(editor.read).toHaveBeenCalledOnce());
    editor.module.workspace.isTrusted = false;
    release!(fixture.idle);
    await reviewing;
    expect(editor.resolvePackage).not.toHaveBeenCalled();
    expect(editor.write).not.toHaveBeenCalled();
    expect(editor.module.workspace.applyEdit).not.toHaveBeenCalled();
    expect(fixture.document.save).not.toHaveBeenCalled();
  });

  it.each([
    "trust",
    "folder",
    "panel",
    "configuration",
    "busy",
    "source",
  ] as const)(
    "refuses approval after the reviewed %s boundary changes",
    async (change) => {
      const fixture = reviewHarness(true);
      await fixture.owner.open(key);
      let approve: ((value: string) => void) | undefined;
      editor.module.window.showWarningMessage.mockImplementationOnce(
        () =>
          new Promise((done) => {
            approve = done;
          }),
      );
      const reviewing = fixture.review();
      await vi.waitFor(() =>
        expect(editor.module.window.showWarningMessage).toHaveBeenCalledOnce(),
      );
      const reads = editor.read.mock.calls.length;
      if (change === "trust") editor.module.workspace.isTrusted = false;
      if (change === "folder") editor.module.workspace.workspaceFolders = [];
      if (change === "panel") editor.panels[0]!.dispose();
      if (change === "configuration")
        fixture.update({
          ...fixture.snapshot,
          configPath: "another.config.mjs",
        });
      if (change === "busy") fixture.update(busy());
      if (change === "source")
        fixture.document.text += "// Concurrent manual edit.\n";
      approve!("Apply Changes");
      await reviewing;
      expect(editor.read).toHaveBeenCalledTimes(reads);
      expect(editor.temporary).not.toHaveBeenCalled();
      expect(editor.write).not.toHaveBeenCalled();
      expect(editor.module.workspace.applyEdit).not.toHaveBeenCalled();
      expect(fixture.document.save).not.toHaveBeenCalled();
      expect(editor.module.window.showErrorMessage).toHaveBeenCalled();
    },
  );

  it("cleans its own proposal but does not apply after trust is lost during core validation", async () => {
    const fixture = reviewHarness(true);
    await fixture.owner.open(key);
    const read = editor.read.getMockImplementation()!;
    let validate: ((value: typeof fixture.validation) => void) | undefined;
    editor.read.mockImplementation((request) =>
      request.command[1] === "review"
        ? new Promise((done) => {
            validate = done;
          })
        : read(request),
    );
    const reviewing = fixture.review();
    await vi.waitFor(() => expect(validate).toBeTypeOf("function"));
    editor.module.workspace.isTrusted = false;
    validate!(fixture.validation);
    await reviewing;
    expect(editor.read).toHaveBeenCalledTimes(3);
    expect(editor.write).toHaveBeenCalledOnce();
    expect(editor.unlink).toHaveBeenCalledOnce();
    expect(editor.rmdir).toHaveBeenCalledOnce();
    expect(editor.module.workspace.applyEdit).not.toHaveBeenCalled();
    expect(fixture.document.save).not.toHaveBeenCalled();
  });

  it("does not save or refresh if authority is lost while applying the in-memory edit", async () => {
    const fixture = reviewHarness();
    await fixture.owner.open(key);
    const apply = editor.module.workspace.applyEdit.getMockImplementation()!;
    editor.module.workspace.applyEdit.mockImplementation(async (...args) => {
      const applied = await apply(...args);
      editor.module.workspace.isTrusted = false;
      return applied;
    });
    await fixture.review();
    expect(editor.module.workspace.applyEdit).toHaveBeenCalledOnce();
    expect(fixture.document.isDirty).toBe(true);
    expect(fixture.document.save).not.toHaveBeenCalled();
    expect(fixture.projects.refreshWorkspace).not.toHaveBeenCalled();
  });
});

describe("live workspace progress presentation", () => {
  it("enters busy once, patches repeated progress, then renders actual completion once", async () => {
    const fixture = harness();
    await fixture.owner.open(key);
    const panel = editor.panels[0]!;
    expect(panel.assignments).toHaveLength(1);
    fixture.update(busy());
    expect(panel.assignments).toHaveLength(2);
    const busyDocument = panel.webview.html;
    panel.receive({ type: "navigate", page: "activity" });
    for (const seconds of [2, 3, 4]) fixture.update(busy(seconds));
    expect(panel.assignments).toHaveLength(2);
    expect(panel.webview.html).toBe(busyDocument);
    expect(panel.webview.postMessage).toHaveBeenCalledTimes(3);
    for (const [message] of panel.webview.postMessage.mock.calls)
      expect(message).toMatchObject({
        type: "operationProgressUpdated",
        html: expect.stringContaining("Current operation"),
      });
    fixture.inspections.fire({ workspaceKey: key });
    fixture.activity.fire(key);
    expect(panel.assignments).toHaveLength(2);
    expect(panel.webview.postMessage).toHaveBeenCalledTimes(5);
    fixture.update(ready());
    expect(panel.assignments).toHaveLength(3);
    expect(panel.webview.html).toContain(
      'id="activity" class="workspace-page workspace-page--active"',
    );
    expect(panel.webview.html).toContain("3/3");
  });

  it("removes stale editable controls on the first unsafe busy transition", async () => {
    const fixture = harness();
    await fixture.owner.open(key);
    const panel = editor.panels[0]!;
    panel.receive({ type: "editing", editing: true });
    fixture.update(ready());
    expect(panel.assignments).toHaveLength(1);
    expect(panel.webview.postMessage).toHaveBeenCalledWith({
      type: "inspectionUpdated",
      loading: false,
    });
    fixture.update(busy());
    expect(panel.assignments).toHaveLength(2);
    expect(panel.webview.html).toContain("Rehearsal in progress");
    fixture.update(busy(2));
    expect(panel.assignments).toHaveLength(2);
    expect(panel.webview.postMessage).toHaveBeenLastCalledWith(
      expect.objectContaining({ type: "operationProgressUpdated" }),
    );
  });

  it("recreates a discarded hidden document on reveal, then resumes patches", async () => {
    const fixture = harness(busy());
    await fixture.owner.open(key);
    const panel = editor.panels[0]!;
    panel.changeVisibility(false);
    fixture.update(busy(2));
    expect(panel.assignments).toHaveLength(1);
    expect(panel.webview.postMessage).not.toHaveBeenCalled();
    panel.changeVisibility(true);
    expect(panel.assignments).toHaveLength(2);
    fixture.update(busy(3));
    expect(panel.assignments).toHaveLength(2);
    expect(panel.webview.postMessage).toHaveBeenCalledTimes(1);
  });

  it("replaces live evidence with static trust guidance when workspace trust is lost", async () => {
    const fixture = harness(busy());
    await fixture.owner.open(key);
    const panel = editor.panels[0]!;
    panel.receive({ type: "editing", editing: true });
    editor.module.workspace.isTrusted = false;
    fixture.update({
      workspaceName: editor.folder.name,
      workspaceRoot: editor.folder.uri.fsPath,
      availability: "untrusted",
    });
    expect(panel.assignments).toHaveLength(2);
    expect(panel.webview.html).toContain("Review Workspace Trust");
    expect(panel.webview.html).not.toContain(
      "Rehearsal owns an active project operation.",
    );
    expect(panel.webview.postMessage).not.toHaveBeenCalled();
  });

  it.each(["ready", "busy"] as const)(
    "does not render cached %s project evidence after trust is lost",
    async (state) => {
      const cached: ProjectSnapshot =
        state === "busy"
          ? busy()
          : {
              ...ready(),
              baseline: {
                generationId: "prior-trusted-generation-canary",
                createdAt: "2026-10-15T12:00:00.000Z",
                tableCount: 7,
                rowCount: 77777,
                migrationCount: 2,
                verification: "checksums_verified",
              },
              applicationUrl:
                "http://localhost:55999/trusted-application-canary",
            };
      const fixture = harness(cached);
      await fixture.owner.open(key);
      const panel = editor.panels[0]!;
      if (state === "ready") expect(panel.webview.html).toContain("77,777");
      else
        expect(panel.webview.html).toContain(
          "Rehearsal owns an active project operation.",
        );
      panel.receive({ type: "editing", editing: true });
      editor.module.workspace.isTrusted = false;
      // A delayed provider event may still carry the last trusted snapshot.
      fixture.update(cached);
      expect(panel.assignments).toHaveLength(2);
      expect(panel.webview.html).toContain("Review Workspace Trust");
      for (const previousEvidence of [
        "prior-trusted-generation-canary",
        "77,777",
        "trusted-application-canary",
        "Rehearsal owns an active project operation.",
        "2026-10-15T12:00:00.000Z",
      ])
        expect(panel.webview.html).not.toContain(previousEvidence);
      expect(panel.webview.postMessage).not.toHaveBeenCalled();
    },
  );

  it.each(["false", "rejection"])(
    "recovers once when the latest progress delivery returns %s",
    async (failure) => {
      const fixture = harness(busy());
      await fixture.owner.open(key);
      const panel = editor.panels[0]!;
      if (failure === "false")
        panel.webview.postMessage.mockResolvedValueOnce(false);
      else
        panel.webview.postMessage.mockRejectedValueOnce(
          new Error("Owned webview delivery failed"),
        );
      fixture.update(busy(2));
      await Promise.resolve();
      await Promise.resolve();
      expect(panel.assignments).toHaveLength(2);
      expect(panel.webview.postMessage).toHaveBeenCalledTimes(1);
      fixture.update(busy(3));
      expect(panel.assignments).toHaveLength(2);
      expect(panel.webview.postMessage).toHaveBeenCalledTimes(2);
    },
  );

  it("does not let an older delivery failure replace newer progress or completion", async () => {
    const fixture = harness(busy());
    await fixture.owner.open(key);
    const panel = editor.panels[0]!;
    let finishFirst: ((value: boolean) => void) | undefined;
    panel.webview.postMessage.mockImplementationOnce(
      () =>
        new Promise<boolean>((done) => {
          finishFirst = done;
        }),
    );
    fixture.update(busy(2));
    fixture.update(busy(3));
    finishFirst!(false);
    await Promise.resolve();
    await Promise.resolve();
    expect(panel.assignments).toHaveLength(1);
    let finishSecond: ((value: boolean) => void) | undefined;
    panel.webview.postMessage.mockImplementationOnce(
      () =>
        new Promise<boolean>((done) => {
          finishSecond = done;
        }),
    );
    fixture.update(busy(4));
    fixture.update(ready());
    const completedDocument = panel.webview.html;
    finishSecond!(false);
    await Promise.resolve();
    await Promise.resolve();
    expect(panel.assignments).toHaveLength(2);
    expect(panel.webview.html).toBe(completedDocument);
  });

  it("rerenders a newly identified operation instead of patching old live evidence", async () => {
    const fixture = harness(busy());
    await fixture.owner.open(key);
    const panel = editor.panels[0]!;
    fixture.update(busy(2, "b".repeat(64)));
    expect(panel.assignments).toHaveLength(2);
    expect(panel.webview.postMessage).not.toHaveBeenCalled();
    fixture.update(busy(3, "b".repeat(64)));
    expect(panel.assignments).toHaveLength(2);
    expect(panel.webview.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ type: "operationProgressUpdated" }),
    );
  });

  it.each(["stale", "invalid", "unavailable"] as const)(
    "leaves live patch mode when evidence becomes %s",
    async (state) => {
      const fixture = harness(busy());
      await fixture.owner.open(key);
      const panel = editor.panels[0]!;
      const prior = busy();
      fixture.update(
        state === "unavailable"
          ? {
              workspaceName: editor.folder.name,
              workspaceRoot: editor.folder.uri.fsPath,
              availability: "error",
              error: {
                code: "activity_monitor_unavailable",
                message: "Refresh to inspect actual state.",
                suggestions: ["Refresh the project."],
              },
            }
          : {
              ...prior,
              availability: "operation_attention",
              activity:
                state === "stale"
                  ? { ...prior.activity!, state: "stale" }
                  : { schemaVersion: 1, state: "invalid", operation: null },
            },
      );
      expect(panel.assignments).toHaveLength(2);
      expect(panel.webview.postMessage).not.toHaveBeenCalled();
      fixture.update(busy(3));
      expect(panel.assignments).toHaveLength(3);
    },
  );

  it("shows missing phase evidence without resurrecting a prior progress identity", async () => {
    const fixture = harness(busy());
    await fixture.owner.open(key);
    const panel = editor.panels[0]!;
    const prior = busy();
    const unavailable: ProjectSnapshot = {
      ...prior,
      activity: parseActivityData({
        schemaVersion: 1,
        state: "busy",
        operation: {
          kind: "run",
          startedAt: "2026-10-15T12:00:00.000Z",
          rehearsalVersion: "0.1.0-rc.4",
          progress: null,
        },
        recent: [],
      }),
    };
    fixture.update(unavailable);
    expect(panel.assignments).toHaveLength(2);
    expect(panel.webview.html).toContain("Phase evidence is unavailable");
    fixture.update(unavailable);
    expect(panel.assignments).toHaveLength(2);
    expect(panel.webview.postMessage).toHaveBeenCalledWith({
      type: "operationProgressUpdated",
      html: expect.stringContaining("Phase evidence is unavailable"),
    });
  });

  it("does not publish malformed public progress or update a disposed panel", async () => {
    const fixture = harness(busy());
    await fixture.owner.open(key);
    const panel = editor.panels[0]!;
    expect(() => busy(2, "malformed-operation-identity")).toThrow();
    expect(panel.assignments).toHaveLength(1);
    panel.dispose();
    fixture.update(busy(3));
    fixture.inspections.fire({ workspaceKey: key });
    fixture.activity.fire(key);
    expect(panel.assignments).toHaveLength(1);
    expect(panel.webview.postMessage).not.toHaveBeenCalled();
    expect(fixture.actions.releaseWorkspace).toHaveBeenCalledWith(
      "opaque-workspace-token",
    );
    fixture.owner.dispose();
    expect(fixture.snapshots.listeners.size).toBe(0);
    expect(fixture.inspections.listeners.size).toBe(0);
    expect(fixture.activity.listeners.size).toBe(0);
  });
});
