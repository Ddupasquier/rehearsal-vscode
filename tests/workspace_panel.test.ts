import { afterEach, describe, expect, it, vi } from "vitest";
import { constants as filesystemConstants } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

interface CapturedReview {
  readonly title: string;
  readonly description: string;
  readonly workspaceName: string;
  readonly workspaceKey?: string;
  readonly path?: string;
  readonly detail: string;
  readonly format: "diff" | "text";
  readonly changedFields?: readonly string[];
  readonly canApply: () => void;
  readonly onApply: () => Promise<void | boolean>;
  readonly onReturn?: () => void;
  readonly failureMessage?: (error: unknown) => string | undefined;
}

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
  const readMigration = vi.fn();
  const resolvePackage = vi.fn();
  const temporary = vi.fn(
    async () => "/private/manual-round/.rehearsal-config-review-owned",
  );
  const write = vi.fn(async () => {});
  const unlink = vi.fn(async () => {});
  const rmdir = vi.fn(async () => {});
  const replace = vi.fn();
  const openFile = vi.fn();
  const canonical = vi.fn(async (path: string) => path);
  const fileStat = vi.fn(async (path: string) => ({
    dev: 1,
    ino: 501,
    isFile: () => path.endsWith(".mjs"),
    isDirectory: () => !path.endsWith(".mjs"),
    isSymbolicLink: (): boolean => false,
  }));
  const folderListeners = new Set<() => void>();
  const reviewApproval = vi.fn();
  const reviewOptions: CapturedReview[] = [];
  const releaseReviewWorkspace = vi.fn();
  const disposeReviews = vi.fn();
  const review = vi.fn(async (options: CapturedReview) => {
    reviewOptions.push(options);
    options.canApply();
    const approval = await reviewApproval(options);
    if (approval !== "Apply Changes" && approval !== true) return false;
    options.canApply();
    return (await options.onApply()) !== false;
  });
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
      viewColumn: 1,
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
    readMigration,
    resolvePackage,
    temporary,
    write,
    unlink,
    rmdir,
    replace,
    openFile,
    canonical,
    fileStat,
    reviewApproval,
    reviewOptions,
    review,
    releaseReviewWorkspace,
    disposeReviews,
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
vi.mock("../src/process_adapter.js", async (original) => ({
  ...(await original<typeof import("../src/process_adapter.js")>()),
  runRehearsalJson: editor.read,
  resolveWorkspaceRehearsal: editor.resolvePackage,
}));
vi.mock("../src/migration_failure_source.js", async (original) => ({
  ...(await original<typeof import("../src/migration_failure_source.js")>()),
  readExactMigrationSource: editor.readMigration,
}));
vi.mock("../src/migration_source.js", async (original) => ({
  ...(await original<typeof import("../src/migration_source.js")>()),
  readExactMigrationInput: editor.readMigration,
}));
vi.mock("../src/review_panel.js", () => ({
  RehearsalReviewPanels: class {
    review = editor.review;
    releaseWorkspace = editor.releaseReviewWorkspace;
    dispose = editor.disposeReviews;
  },
}));
vi.mock("node:fs/promises", async (original) => ({
  ...(await original<typeof import("node:fs/promises")>()),
  mkdtemp: editor.temporary,
  writeFile: editor.write,
  unlink: editor.unlink,
  rmdir: editor.rmdir,
  realpath: editor.canonical,
  lstat: editor.fileStat,
  open: editor.openFile,
}));

import { RehearsalWorkspacePanels } from "../src/workspace_panel.js";
import { parseActivityData } from "../src/contracts.js";
import type { ProjectSnapshot } from "../src/project_snapshot.js";
import type { EngineShutdownUiState } from "../src/engine_lifecycle_view.js";
import { engineSnapshot } from "./engine_lifecycle_fixture.js";
import { configurationFingerprint } from "../src/configuration_editor.js";
import { parseConfigurationMetadata } from "../src/configuration_contract.js";
import { RehearsalCliError } from "../src/process_adapter.js";
import { insightPlan, insightReport } from "./migration_insights_fixture.js";
import {
  migrationInsightIndex,
  parseMigrationInsights,
} from "../src/migration_insights.js";

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
const ownedDirectories: string[] = [];
const harness = (
  initial = ready(),
  selectedKey = key,
  mayStartWork: () => boolean = () => true,
) => {
  let current = initial;
  const snapshots = new Events<{
    workspaceKey: string;
    snapshot: ProjectSnapshot;
  }>();
  const inspections = new Events<{ workspaceKey: string }>();
  const activity = new Events<string>();
  const returns = new Events<string>();
  const actions = {
    onDidRecordActivity: activity.event,
    registerWorkspace: vi.fn(() => "opaque-workspace-token"),
    releaseWorkspace: vi.fn(),
    activityFor: vi.fn(() => []),
    engineShutdownStateFor: vi.fn(
      () => undefined as EngineShutdownUiState | undefined,
    ),
    reviewVmShutdown: vi.fn(async () => {}),
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
    {
      review: editor.review,
      releaseWorkspace: editor.releaseReviewWorkspace,
      dispose: editor.disposeReviews,
      onDidRequestReturn: returns.event,
    } as never,
    mayStartWork,
  );
  owners.push(owner);
  return {
    owner,
    actions,
    returns,
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
  editor.panels.splice(0);
  editor.reviewOptions.splice(0);
  editor.reviewApproval.mockReset();
  editor.module.workspace.isTrusted = true;
  editor.module.workspace.workspaceFolders = [editor.folder];
  editor.module.workspace.openTextDocument.mockReset();
  editor.module.workspace.applyEdit.mockReset();
  editor.module.window.showWarningMessage.mockReset();
  editor.module.window.showTextDocument.mockReset();
  editor.module.window.showSaveDialog.mockReset();
  editor.module.workspace.fs.writeFile.mockReset().mockResolvedValue(undefined);
  editor.read.mockReset();
  editor.readMigration.mockReset();
  editor.resolvePackage.mockReset();
  editor.openFile.mockReset();
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

const migrationFailureFixture = (text = "select ';';\nSELEC 1;\n") => {
  const operationId = "d".repeat(64);
  const path = `${editor.folder.uri.fsPath}/database/migrations/20261020000100_broken.sql`;
  const source = {
    schemaVersion: 1,
    kind: "candidate",
    filename: "20261020000100_broken.sql",
    sha256: configurationFingerprint(text),
    workspaceRelativePath: "database/migrations/20261020000100_broken.sql",
    line: null,
    column: null,
    evidence: "owned_execution_input",
  };
  const progress = busy().activity!.operation!.progress!;
  const snapshot: ProjectSnapshot = {
    ...ready(),
    activity: parseActivityData({
      schemaVersion: 1,
      state: "idle",
      operation: null,
      recent: [
        {
          kind: "migrate",
          rehearsalVersion: "1.0.2",
          progress: {
            ...progress,
            operationId,
            state: "failed",
            currentStage: null,
            completedStages: [],
            events: [
              {
                sequence: 1,
                code: "operation.failed",
                phase: null,
                target: null,
                at: progress.updatedAt,
              },
            ],
          },
        },
      ],
      recentFailures: [
        {
          operationId,
          diagnostic: {
            schemaVersion: 1,
            provider: "postgresql",
            classification: "syntax",
            sqlState: "42601",
            evidence: "provider_sqlstate",
            summary: "The database reported a SQL syntax error.",
            suggestions: [
              "Review the candidate SQL for missing keywords, punctuation or malformed statements; then review the new exact plan before retrying.",
              "No automatic SQL change or retry was performed. The failure itself does not prove rollback or cleanup; inspect runtime status before retrying.",
            ],
            source,
          },
        },
      ],
    }),
  };
  const fixture = harness(snapshot);
  const checked = { path, text, identity: "same-canonical-file" };
  const document = {
    uri: editor.uri(path),
    isDirty: false,
    getText: () => text,
  };
  editor.readMigration.mockResolvedValue(checked);
  editor.module.workspace.openTextDocument.mockResolvedValue(document);
  const send = async (
    message: unknown = { type: "openMigrationFailure", operationId },
  ) => {
    const panel = editor.panels.at(-1)!;
    await (
      fixture.owner as unknown as {
        handleMessage(
          panel: unknown,
          workspaceKey: string,
          message: unknown,
        ): Promise<void>;
      }
    ).handleMessage(panel, key, message);
  };
  return { ...fixture, snapshot, source, document, checked, send, operationId };
};

describe("exact static finding navigation", () => {
  const setup = (
    name = "add_index",
    text = "-- λ\r\nALTER TABLE example ALTER COLUMN title SET NOT NULL;\r\n",
    modelText = text,
    line = 2,
    column = 20,
  ) => {
    const planned = insightPlan(),
      raw = insightReport();
    raw.targets[0]!.entries[0]!.sha256 = configurationFingerprint(text);
    raw.targets[0]!.entries[0]!.filename = `20261009000100_${name}.sql`;
    raw.targets[0]!.entries[0]!.workspaceRelativePath = `database/migrations/20261009000100_${name}.sql`;
    const plan = {
      ...planned,
      targets: planned.targets.map((target) => ({
        ...target,
        entries: target.entries.map((entry) => ({
          ...entry,
          name,
          filename: `20261009000100_${name}.sql`,
          sha256: configurationFingerprint(text),
        })),
      })),
    };
    raw.targets[0]!.entries[0]!.findings[0]!.line = line;
    raw.targets[0]!.entries[0]!.findings[0]!.column = column;
    const report = parseMigrationInsights(raw, plan, raw.inspectorVersion),
      findingId = [...migrationInsightIndex(report).keys()][0]!;
    const snapshot: ProjectSnapshot = {
      ...ready(),
      migrationReview: plan,
      migrationInsights: { state: "available", report },
    };
    const fixture = harness(snapshot),
      path = `${editor.folder.uri.fsPath}/${raw.targets[0]!.entries[0]!.workspaceRelativePath}`;
    const checked = { path, text, identity: "same-static-input" },
      document = {
        uri: editor.uri(path),
        isDirty: false,
        getText: () => modelText,
        lineCount: modelText.split(/\r\n|\r|\n/gu).length,
        lineAt: (line: number) => ({
          text: modelText.split(/\r\n|\r|\n/gu)[line]!,
        }),
      };
    editor.readMigration.mockResolvedValue(checked);
    editor.module.workspace.openTextDocument.mockResolvedValue(document);
    const send = async (
      message: unknown = { type: "openMigrationInsight", findingId },
    ) =>
      (
        fixture.owner as unknown as {
          handleMessage(
            panel: unknown,
            key: string,
            message: unknown,
          ): Promise<void>;
        }
      ).handleMessage(editor.panels.at(-1)!, key, message);
    return { ...fixture, snapshot, report, findingId, checked, document, send };
  };
  it.each(["insight", "failure"] as const)(
    "bounds repeated %s and cross-kind source clicks to one in-flight operation",
    async (firstKind) => {
      const failure = migrationFailureFixture(),
        fixture = setup();
      fixture.update({
        ...fixture.snapshot,
        activity: failure.snapshot.activity!,
      });
      const checked =
        firstKind === "insight" ? fixture.checked : failure.checked;
      const document =
        firstKind === "insight" ? fixture.document : failure.document;
      editor.module.workspace.openTextDocument.mockResolvedValue(document);
      let release!: () => void,
        active = 0,
        maximum = 0,
        calls = 0;
      const wait = new Promise<void>((resolve) => {
        release = resolve;
      });
      editor.readMigration.mockImplementation(async () => {
        active++;
        maximum = Math.max(maximum, active);
        try {
          if (++calls === 1) await wait;
          else await Promise.resolve();
          return checked;
        } finally {
          active--;
        }
      });
      const insight = {
          type: "openMigrationInsight",
          findingId: fixture.findingId,
        },
        failed = {
          type: "openMigrationFailure",
          operationId: failure.operationId,
        };
      await fixture.owner.open(key);
      const pending = fixture.send(firstKind === "insight" ? insight : failed);
      expect(editor.readMigration).toHaveBeenCalledTimes(1);
      await Promise.all(
        Array.from({ length: 12 }, (_, index) =>
          fixture.send(index % 2 ? insight : failed),
        ),
      );
      expect(editor.readMigration).toHaveBeenCalledTimes(1);
      expect(editor.module.workspace.openTextDocument).not.toHaveBeenCalled();
      release();
      await pending;
      expect(maximum).toBe(1);
      expect(active).toBe(0);
      expect(editor.readMigration).toHaveBeenCalledTimes(2);
      expect(editor.module.window.showTextDocument).toHaveBeenCalledTimes(1);
      await fixture.send(firstKind === "insight" ? insight : failed);
      expect(editor.readMigration).toHaveBeenCalledTimes(4);
      expect(maximum).toBe(1);
    },
  );
  it("keeps the same single slot while the native document API is pending", async () => {
    const fixture = setup();
    await fixture.owner.open(key);
    let release!: () => void;
    editor.module.workspace.openTextDocument.mockImplementationOnce(
      async () => {
        await new Promise<void>((resolve) => {
          release = resolve;
        });
        return fixture.document;
      },
    );
    const pending = fixture.send();
    await vi.waitFor(() =>
      expect(editor.module.workspace.openTextDocument).toHaveBeenCalledTimes(1),
    );
    await fixture.send();
    expect(editor.readMigration).toHaveBeenCalledTimes(1);
    expect(editor.module.workspace.openTextDocument).toHaveBeenCalledTimes(1);
    release();
    await pending;
    expect(editor.readMigration).toHaveBeenCalledTimes(2);
    expect(editor.module.window.showTextDocument).toHaveBeenCalledTimes(1);
  });
  it("releases source navigation after a refusal without queuing or retrying rejected work", async () => {
    const fixture = setup();
    await fixture.owner.open(key);
    editor.readMigration.mockRejectedValueOnce(new Error("unavailable"));
    await fixture.send();
    expect(editor.module.window.showTextDocument).not.toHaveBeenCalled();
    await fixture.send();
    expect(editor.readMigration).toHaveBeenCalledTimes(3);
    expect(editor.module.window.showTextDocument).toHaveBeenCalledTimes(1);
  });
  it("releases the in-flight source guard on disposal and refuses further work or stale opening", async () => {
    const fixture = setup();
    await fixture.owner.open(key);
    let release!: () => void;
    editor.readMigration.mockImplementationOnce(async () => {
      await new Promise<void>((resolve) => {
        release = resolve;
      });
      return fixture.checked;
    });
    const pending = fixture.send();
    expect(
      (fixture.owner as unknown as { sourceNavigationPending: boolean })
        .sourceNavigationPending,
    ).toBe(true);
    fixture.owner.dispose();
    expect(
      (fixture.owner as unknown as { sourceNavigationPending: boolean })
        .sourceNavigationPending,
    ).toBe(false);
    await fixture.send();
    expect(editor.readMigration).toHaveBeenCalledTimes(1);
    release();
    await pending;
    expect(editor.module.workspace.openTextDocument).not.toHaveBeenCalled();
    expect(editor.module.window.showTextDocument).not.toHaveBeenCalled();
  });
  it.each(["add_index", "DropWidgets", "约束"])(
    "opens unchanged %s at the bounded exact UTF-16 finding position without execution or edits",
    async (name) => {
      const fixture = setup(name);
      await fixture.owner.open(key);
      await fixture.send();
      expect(editor.readMigration).toHaveBeenCalledTimes(2);
      expect(editor.module.window.showTextDocument).toHaveBeenCalledWith(
        fixture.document,
        {
          preview: true,
          selection: {
            start: { line: 1, character: 19 },
            end: { line: 1, character: 19 },
          },
        },
      );
      expect(editor.read).not.toHaveBeenCalled();
      expect(editor.write).not.toHaveBeenCalled();
      expect(editor.module.workspace.applyEdit).not.toHaveBeenCalled();
    },
  );
  it.each([
    [
      "BOM",
      "\ufeffALTER TABLE example ALTER COLUMN title SET NOT NULL;\r\n",
      "ALTER TABLE example ALTER COLUMN title SET NOT NULL;\n",
      1,
      1,
    ],
    [
      "mixed EOL",
      "-- a\r\nALTER TABLE example ALTER COLUMN title SET NOT NULL;\n-- end\r",
      "-- a\nALTER TABLE example ALTER COLUMN title SET NOT NULL;\n-- end\n",
      2,
      20,
    ],
    [
      "bare CR",
      "-- a\rALTER TABLE example ALTER COLUMN title SET NOT NULL;\r",
      "-- a\nALTER TABLE example ALTER COLUMN title SET NOT NULL;\n",
      2,
      20,
    ],
    [
      "double BOM with one retained in model",
      "\ufeff\ufeffALTER TABLE example ALTER COLUMN title SET NOT NULL;",
      "\ufeffALTER TABLE example ALTER COLUMN title SET NOT NULL;",
      1,
      2,
    ],
  ] as const)(
    "accepts only the explicit %s model projection without subtracting scanner columns",
    async (_label, raw, model, line, column) => {
      const fixture = setup("add_index", raw, model, line, column);
      await fixture.owner.open(key);
      await fixture.send();
      expect(editor.readMigration).toHaveBeenCalledTimes(2);
      expect(editor.module.window.showTextDocument).toHaveBeenCalledWith(
        fixture.document,
        {
          preview: true,
          selection: {
            start: { line: line - 1, character: column - 1 },
            end: { line: line - 1, character: column - 1 },
          },
        },
      );
      expect(editor.module.workspace.applyEdit).not.toHaveBeenCalled();
    },
  );
  it("refuses a native model that removed an extra leading BOM instead of guessing an offset", async () => {
    const fixture = setup(
      "add_index",
      "\ufeff\ufeffALTER TABLE example ALTER COLUMN title SET NOT NULL;",
      "ALTER TABLE example ALTER COLUMN title SET NOT NULL;",
      1,
      2,
    );
    await fixture.owner.open(key);
    await fixture.send();
    expect(editor.module.window.showTextDocument).not.toHaveBeenCalled();
  });
  it("still refuses dirty documents whose BOM/EOL projection otherwise matches", async () => {
    const fixture = setup(
      "add_index",
      "\ufeffALTER TABLE example ALTER COLUMN title SET NOT NULL;\r\n",
      "ALTER TABLE example ALTER COLUMN title SET NOT NULL;\n",
      1,
      1,
    );
    fixture.document.isDirty = true;
    await fixture.owner.open(key);
    await fixture.send();
    expect(editor.module.window.showTextDocument).not.toHaveBeenCalled();
  });
  it.each(["trust", "workspace", "panel", "snapshot", "busy"])(
    "refuses %s drift during the asynchronous file read",
    async (change) => {
      const fixture = setup();
      await fixture.owner.open(key);
      editor.readMigration.mockImplementationOnce(async () => {
        if (change === "trust") editor.module.workspace.isTrusted = false;
        if (change === "workspace")
          editor.module.workspace.workspaceFolders = [];
        if (change === "panel") fixture.owner.dispose();
        if (change === "snapshot") fixture.update({ ...fixture.snapshot });
        if (change === "busy") fixture.update(busy());
        return fixture.checked;
      });
      await fixture.send();
      expect(editor.module.workspace.openTextDocument).not.toHaveBeenCalled();
      expect(editor.module.window.showTextDocument).not.toHaveBeenCalled();
    },
  );
  it.each([
    "dirty",
    "text",
    "disk",
    "identity",
    "line",
    "column",
    "unbound",
    "path",
  ])(
    "refuses %s without editing, clamping or leaking provider text",
    async (change) => {
      const fixture = setup();
      await fixture.owner.open(key);
      if (change === "dirty") fixture.document.isDirty = true;
      if (change === "text") fixture.document.getText = () => "changed";
      if (change === "disk")
        editor.readMigration.mockRejectedValue(
          new Error("PRIVATE_SOURCE_OUTPUT"),
        );
      if (change === "identity")
        editor.readMigration
          .mockResolvedValueOnce(fixture.checked)
          .mockResolvedValueOnce({
            ...fixture.checked,
            identity: "replacement",
          });
      if (change === "line") fixture.document.lineCount = 1;
      if (change === "column")
        fixture.document.lineAt = () => ({ text: "short" });
      await fixture.send(
        change === "unbound"
          ? { type: "openMigrationInsight", findingId: "e".repeat(64) }
          : change === "path"
            ? {
                type: "openMigrationInsight",
                findingId: fixture.findingId,
                path: "/private/secret.sql",
              }
            : undefined,
      );
      expect(editor.module.window.showTextDocument).not.toHaveBeenCalled();
      expect(editor.module.workspace.applyEdit).not.toHaveBeenCalled();
      expect(editor.read).not.toHaveBeenCalled();
      expect(
        JSON.stringify(editor.module.window.showWarningMessage.mock.calls),
      ).not.toContain("PRIVATE_SOURCE_OUTPUT");
    },
  );
});

describe("exact migration input navigation", () => {
  it.each([
    [
      "\ufeffselect ';';\r\nSELEC 1;\n-- tail\r",
      "select ';';\nSELEC 1;\n-- tail\n",
    ],
    ["\ufeff\ufeffSELEC 1;\r", "\ufeffSELEC 1;\n"],
  ])(
    "uses the same explicit model projection without changing failure provenance or inventing a position",
    async (raw, model) => {
      const fixture = migrationFailureFixture(raw);
      fixture.document.getText = () => model;
      await fixture.owner.open(key);
      await fixture.send();
      expect(editor.readMigration).toHaveBeenCalledTimes(2);
      expect(editor.module.window.showTextDocument).toHaveBeenCalledWith(
        fixture.document,
        { preview: true },
      );
      expect(fixture.source).toMatchObject({
        evidence: "owned_execution_input",
        line: null,
        column: null,
      });
    },
  );
  it("opens only the unchanged recorded file without editing it or running any command", async () => {
    const fixture = migrationFailureFixture();
    await fixture.owner.open(key);
    await fixture.send();
    expect(editor.readMigration).toHaveBeenCalledTimes(2);
    expect(editor.module.window.showTextDocument).toHaveBeenCalledWith(
      fixture.document,
      { preview: true },
    );
    expect(editor.read).not.toHaveBeenCalled();
    expect(editor.module.workspace.applyEdit).not.toHaveBeenCalled();
    expect(editor.write).not.toHaveBeenCalled();
  });
  it.each(["trust", "workspace", "panel", "receipt", "source"] as const)(
    "refuses when %s changes during the file read",
    async (change) => {
      const fixture = migrationFailureFixture();
      await fixture.owner.open(key);
      editor.readMigration.mockImplementationOnce(async () => {
        if (change === "trust") editor.module.workspace.isTrusted = false;
        if (change === "workspace")
          editor.module.workspace.workspaceFolders = [];
        if (change === "panel") fixture.owner.dispose();
        if (change === "receipt") fixture.update(ready());
        if (change === "source")
          fixture.update({
            ...fixture.snapshot,
            activity: parseActivityData({
              ...fixture.snapshot.activity,
              recentFailures: [
                {
                  operationId: fixture.operationId,
                  diagnostic: {
                    ...fixture.snapshot.activity!.recentFailures![0]!
                      .diagnostic,
                    source: { ...fixture.source, sha256: "f".repeat(64) },
                  },
                },
              ],
            }),
          });
        return fixture.checked;
      });
      await fixture.send();
      expect(editor.module.workspace.openTextDocument).not.toHaveBeenCalled();
      expect(editor.module.window.showTextDocument).not.toHaveBeenCalled();
    },
  );
  it.each([
    "dirty",
    "text",
    "identity",
    "disk",
    "unbound",
    "injected-path",
  ] as const)(
    "refuses %s without a stale fallback or SQL launch",
    async (change) => {
      const fixture = migrationFailureFixture();
      await fixture.owner.open(key);
      if (change === "dirty") fixture.document.isDirty = true;
      if (change === "text")
        fixture.document.getText = () => "later editor content";
      if (change === "identity")
        editor.readMigration
          .mockResolvedValueOnce(fixture.checked)
          .mockResolvedValueOnce({
            ...fixture.checked,
            identity: "replacement",
          });
      if (change === "disk")
        editor.readMigration.mockRejectedValue(
          new Error("PRIVATE_SOURCE_PATH"),
        );
      await fixture.send(
        change === "unbound"
          ? { type: "openMigrationFailure", operationId: "e".repeat(64) }
          : change === "injected-path"
            ? {
                type: "openMigrationFailure",
                operationId: fixture.operationId,
                path: "/private/secret.sql",
              }
            : undefined,
      );
      expect(editor.module.window.showTextDocument).not.toHaveBeenCalled();
      expect(editor.module.workspace.applyEdit).not.toHaveBeenCalled();
      expect(editor.read).not.toHaveBeenCalled();
      expect(
        JSON.stringify(editor.module.window.showWarningMessage.mock.calls),
      ).not.toContain("PRIVATE_SOURCE_PATH");
    },
  );
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
  mayStartWork: () => boolean = () => true,
) => {
  const source =
    'export default { runtime: { applicationUrl: "http://localhost:5175" } };\n';
  const snapshot: ProjectSnapshot = {
    ...ready(),
    workspaceRoot: root,
    configPath,
  };
  const workspaceKey = editor.uri(root).toString();
  const fixture = harness(snapshot, workspaceKey, mayStartWork);
  let diskText = source;
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
      diskText = document.text;
      document.isDirty = false;
      return true;
    }),
  };
  editor.openFile.mockImplementation(async () => ({
    stat: async () => ({
      dev: 1,
      ino: 501,
      size: Buffer.byteLength(diskText),
      isFile: () => true,
    }),
    read: async (
      buffer: Buffer,
      offset: number,
      length: number,
      position: number,
    ) => {
      const bytes = Buffer.from(diskText).subarray(position, position + length);
      bytes.copy(buffer, offset);
      return { bytesRead: bytes.byteLength, buffer };
    },
    close: async () => {},
  }));
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
        value: "http://localhost:5175" as unknown,
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
  editor.module.workspace.openTextDocument.mockResolvedValue(document);
  editor.module.window.showTextDocument.mockResolvedValue(undefined);
  editor.reviewApproval.mockResolvedValue("Apply Changes");
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
    persistDocument: () => {
      diskText = document.text;
      document.isDirty = false;
    },
    setDiskText: (value: string) => {
      diskText = value;
    },
    review: (values: unknown = { applicationUrl: "http://localhost:5176" }) =>
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
        values,
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
  editor.openFile.mockImplementation((path: string, flags: string | number) =>
    fs.open(path, flags),
  );
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

describe("in-product configuration reviews", () => {
  it("refuses an invalid policy before review/write and permits a corrected fresh review", async () => {
    const fixture = reviewHarness(true);
    fixture.metadata.fields.push({
      ...fixture.metadata.fields[0]!,
      path: "resources.retainedEnvironmentCount",
      kind: "integer",
      value: 2,
    });
    await fixture.owner.open(key);
    await fixture.review({
      fields: { "resources.retainedEnvironmentCount": "1001" },
    });
    expect(editor.module.window.showErrorMessage).toHaveBeenCalledWith(
      expect.stringContaining(
        "resources.retainedEnvironmentCount: Enter a whole number from 1 to 1000.",
      ),
    );
    expect(editor.review).not.toHaveBeenCalled();
    expect(editor.temporary).not.toHaveBeenCalled();
    expect(editor.module.workspace.applyEdit).not.toHaveBeenCalled();
    expect(fixture.document.save).not.toHaveBeenCalled();
    expect(
      editor.read.mock.calls.some(
        ([options]) => options.command.join(" ") === "configuration review",
      ),
    ).toBe(false);
    editor.reviewApproval.mockResolvedValueOnce(undefined);
    await fixture.review({
      fields: { "resources.retainedEnvironmentCount": "3" },
    });
    expect(editor.review).toHaveBeenCalledOnce();
    expect(fixture.document.save).not.toHaveBeenCalled();
  });
  it("keeps a concurrent source edit and offers explicit source-review recovery without exposing its bytes", async () => {
    const fixture = reviewHarness(true);
    fixture.update({
      ...fixture.snapshot,
      configurationMetadata: parseConfigurationMetadata(fixture.metadata),
    });
    await fixture.owner.open(key);
    let concurrent = "";
    editor.reviewApproval.mockImplementationOnce(async () => {
      concurrent = `${fixture.document.text}// PRIVATE_CANARY saved by another editor\n`;
      fixture.document.text = concurrent;
      fixture.persistDocument();
      fixture.metadata.sourceSha256 = configurationFingerprint(concurrent);
      fixture.update({
        ...fixture.snapshot,
        configurationMetadata: parseConfigurationMetadata(fixture.metadata),
      });
      return "Apply Changes";
    });
    await fixture.review();
    const error = await editor.review.mock.results[0]!.value.catch(
      (failure: unknown) => failure,
    );
    expect(editor.reviewOptions[0]!.failureMessage?.(error)).toContain(
      "current configuration or workspace",
    );
    expect(editor.module.window.showErrorMessage).toHaveBeenCalledWith(
      expect.stringContaining(
        "Close review, refresh Rehearsal, and review the current source",
      ),
    );
    expect(
      JSON.stringify(editor.module.window.showErrorMessage.mock.calls),
    ).not.toContain("PRIVATE_CANARY");
    expect(fixture.document.text).toBe(concurrent);
    expect(editor.module.workspace.applyEdit).not.toHaveBeenCalled();
    expect(fixture.document.save).not.toHaveBeenCalled();
  });
  it.each([
    ["configuration_invalid", "CONFIGURATION_INVALID", 2, true],
    ["configuration_invalid", "PRIVATE_CANARY", 2, false],
    ["internal_failure", "CONFIGURATION_INVALID", 2, false],
    ["configuration_invalid", "CONFIGURATION_INVALID", 10, false],
  ] as const)(
    "maps only allowlisted readonly validation failure %s/%s/%s to safe recovery",
    async (category, code, exit, expected) => {
      const fixture = reviewHarness(true);
      const originalRead = editor.read.getMockImplementation()!;
      editor.read.mockImplementation(async (options) => {
        if (options.command.slice(0, 2).join(" ") === "configuration review")
          throw new RehearsalCliError(
            {
              schemaVersion: 1,
              rehearsalVersion: "1.0.2",
              status: "error",
              error: {
                category,
                code,
                message:
                  "PRIVATE_CANARY /private/source postgres://credential@host raw-provider-output",
                suggestions: ["PRIVATE_CANARY"],
                diagnosticId: "synthetic",
              },
            },
            exit,
          );
        return originalRead(options);
      });
      await fixture.owner.open(key);
      await fixture.review();
      const output = JSON.stringify(
        editor.module.window.showErrorMessage.mock.calls,
      );
      expect(output.includes("Core refused this configuration proposal")).toBe(
        expected,
      );
      expect(output).not.toMatch(
        /PRIVATE_CANARY|postgres:|\/private|raw-provider-output/u,
      );
      expect(editor.module.workspace.applyEdit).not.toHaveBeenCalled();
      expect(fixture.document.save).not.toHaveBeenCalled();
      const error = await editor.review.mock.results[0]!.value.catch(
        (failure: unknown) => failure,
      );
      expect(Boolean(editor.reviewOptions[0]!.failureMessage?.(error))).toBe(
        expected,
      );
      expect(
        editor.reviewOptions[0]!.failureMessage?.(new Error("PRIVATE_CANARY")),
      ).toBeUndefined();
    },
  );
  it("refuses a new configuration review when extension coexistence is unsafe", async () => {
    const fixture = reviewHarness(
      false,
      editor.folder.uri.fsPath,
      "rehearsal.config.mjs",
      () => false,
    );
    await fixture.owner.open(key);
    await fixture.review();
    expect(editor.read).not.toHaveBeenCalled();
    expect(editor.review).not.toHaveBeenCalled();
    expect(editor.module.workspace.applyEdit).not.toHaveBeenCalled();
    expect(fixture.document.save).not.toHaveBeenCalled();
  });
  it("refuses a configuration write when extension coexistence changes during review", async () => {
    let allowed = true;
    const fixture = reviewHarness(
      true,
      editor.folder.uri.fsPath,
      "rehearsal.config.mjs",
      () => allowed,
    );
    await fixture.owner.open(key);
    editor.reviewApproval.mockImplementationOnce(async () => {
      allowed = false;
      return "Apply Changes";
    });
    await fixture.review();
    expect(editor.temporary).not.toHaveBeenCalled();
    expect(editor.write).not.toHaveBeenCalled();
    expect(editor.module.workspace.applyEdit).not.toHaveBeenCalled();
    expect(fixture.document.save).not.toHaveBeenCalled();
  });
  it("keeps a verified save successful when the subsequent project refresh rejects", async () => {
    const fixture = reviewHarness(true);
    fixture.projects.refreshWorkspace.mockRejectedValueOnce(
      new Error("private refresh diagnostic"),
    );
    await fixture.owner.open(key);
    await fixture.review();

    expect(await editor.review.mock.results[0]!.value).toBe(true);
    expect(fixture.document.save).toHaveBeenCalledOnce();
    expect(fixture.document.isDirty).toBe(false);
    expect(fixture.document.text).toContain("http://localhost:5176");
    expect(editor.module.workspace.applyEdit).toHaveBeenCalledOnce();
    expect(fixture.projects.refreshWorkspace).toHaveBeenCalledOnce();
    expect(editor.module.window.showErrorMessage).not.toHaveBeenCalled();
    expect(editor.module.window.showInformationMessage).toHaveBeenCalledWith(
      "Applied the reviewed Rehearsal configuration changes.",
    );
    expect(editor.module.window.showWarningMessage).toHaveBeenCalledWith(
      expect.stringContaining("Configuration changes were saved"),
    );
    expect(editor.module.window.showWarningMessage).toHaveBeenCalledWith(
      expect.stringContaining("do not apply the same proposal again"),
    );
    expect(
      JSON.stringify(editor.module.window.showWarningMessage.mock.calls),
    ).not.toContain("private refresh diagnostic");
  });

  it("invalidates pre-save form drafts on return even when inspection metadata remains stale", async () => {
    const fixture = reviewHarness(true);
    const staleMetadata = parseConfigurationMetadata(fixture.metadata);
    fixture.update({
      ...fixture.snapshot,
      configurationMetadata: staleMetadata,
    });
    await fixture.owner.open(key);
    const dashboard = editor.panels[0]!;
    const draftIdentity = () =>
      /const formDraftIdentity = "([a-f0-9]{64})";/u.exec(
        dashboard.webview.html,
      )?.[1];
    const before = draftIdentity();
    expect(before).toMatch(/^[a-f0-9]{64}$/u);
    dashboard.changeVisibility(false);
    const hiddenAssignments = dashboard.assignments.length;

    // The maintained refresh resolves without replacing its pre-save snapshot.
    await fixture.review();
    expect(await editor.review.mock.results[0]!.value).toBe(true);
    expect(fixture.document.save).toHaveBeenCalledOnce();
    expect(
      fixture.projects.snapshotFor(key)?.configurationMetadata?.sourceSha256,
    ).toBe(staleMetadata.sourceSha256);
    // Hidden webviews are deliberately not rerendered. The new revision must be
    // reflected when Return to project makes the dashboard visible again.
    expect(dashboard.assignments).toHaveLength(hiddenAssignments);
    expect(draftIdentity()).toBe(before);

    editor.reviewOptions[0]!.onReturn?.();
    dashboard.changeVisibility(true);
    expect(dashboard.reveal).toHaveBeenCalledWith(1, false);
    const afterReturn = draftIdentity();
    expect(afterReturn).toMatch(/^[a-f0-9]{64}$/u);
    expect(draftIdentity()).not.toBe(before);
    fixture.update(fixture.projects.snapshotFor(key)!);
    expect(draftIdentity()).toBe(afterReturn);
    expect(fixture.projects.refreshWorkspace).toHaveBeenCalledOnce();
    expect(editor.module.window.showErrorMessage).not.toHaveBeenCalled();
  });

  it("opens an in-product diff without an editable document, native modal or file write on cancel", async () => {
    const fixture = reviewHarness();
    editor.reviewApproval.mockResolvedValue(undefined);
    await fixture.owner.open(key);
    const dashboard = editor.panels[0]!;
    const html = dashboard.webview.html;
    const assignments = dashboard.assignments.length;
    await fixture.review();
    const review = editor.reviewOptions[0]!;
    expect(review.format).toBe("diff");
    expect(review.path).toBe("rehearsal.config.mjs");
    expect(review.detail).toContain("http://localhost:5176");
    expect(review.changedFields).toEqual(["runtime.applicationUrl"]);
    expect(editor.module.window.showTextDocument).not.toHaveBeenCalled();
    expect(editor.module.window.showWarningMessage).not.toHaveBeenCalled();
    expect(dashboard.webview.html).toBe(html);
    expect(dashboard.assignments).toHaveLength(assignments);
    for (const [request] of editor.module.workspace.openTextDocument.mock.calls)
      expect(request).not.toHaveProperty("content");
    expect(editor.write).not.toHaveBeenCalled();
    expect(editor.module.workspace.applyEdit).not.toHaveBeenCalled();
    expect(fixture.document.save).not.toHaveBeenCalled();
  });

  it.each(["trust", "folder", "panel"] as const)(
    "releases an in-product review after its %s boundary is removed",
    async (change) => {
      const fixture = reviewHarness();
      editor.reviewApproval.mockResolvedValue(undefined);
      await fixture.owner.open(key);
      await fixture.review();
      expect(editor.reviewOptions[0]!.detail).toContain(
        "http://localhost:5176",
      );
      if (change === "trust") {
        editor.module.workspace.isTrusted = false;
        fixture.update(fixture.snapshot);
      } else if (change === "folder") {
        editor.module.workspace.workspaceFolders = [];
        editor.notifyFolderChange();
      } else editor.panels[0]!.dispose();
      expect(editor.releaseReviewWorkspace).toHaveBeenCalledWith(key);
      expect(editor.write).not.toHaveBeenCalled();
      expect(editor.module.workspace.applyEdit).not.toHaveBeenCalled();
    },
  );

  it("keeps the dashboard draft guard after cancelling an in-product configuration review", async () => {
    const fixture = reviewHarness();
    editor.reviewApproval.mockResolvedValue(undefined);
    await fixture.owner.open(key);
    const panel = editor.panels[0]!;
    panel.receive({ type: "editing", editing: true });
    const assignments = panel.assignments.length;
    await fixture.review();
    fixture.update({
      ...fixture.snapshot,
      readiness: { state: "READY", passed: 4, failed: 0, checks: [] },
    });
    expect(panel.assignments).toHaveLength(assignments);
    expect(panel.webview.postMessage).toHaveBeenCalledWith({
      type: "inspectionUpdated",
      loading: false,
    });
    expect(editor.module.workspace.applyEdit).not.toHaveBeenCalled();
    expect(fixture.document.save).not.toHaveBeenCalled();
  });
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
      editor.reviewApproval.mockImplementationOnce(
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
    expect(editor.review).not.toHaveBeenCalled();
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
      editor.reviewApproval.mockImplementationOnce(
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
      expect(editor.reviewApproval).toHaveBeenCalledOnce();
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
      expect(editor.reviewApproval).toHaveBeenCalledOnce();
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
      fixture.persistDocument();
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

  it("confirms an exact save even when VS Code closes its hidden TextDocument", async () => {
    const fixture = reviewHarness(true);
    await fixture.owner.open(key);
    fixture.document.save.mockImplementation(async () => {
      fixture.persistDocument();
      fixture.document.isClosed = true;
      return true;
    });
    await fixture.review();
    expect(fixture.document.save).toHaveBeenCalledOnce();
    expect(editor.openFile).toHaveBeenCalledOnce();
    expect(fixture.projects.refreshWorkspace).toHaveBeenCalledWith(key);
    expect(editor.module.window.showErrorMessage).not.toHaveBeenCalled();
    expect(editor.module.window.showInformationMessage).toHaveBeenCalledWith(
      "Applied the reviewed Rehearsal configuration changes.",
    );
  });

  it.each([false, true])(
    "accepts only exact editor auto-save metadata after its approved edit (closed: %s)",
    async (closed) => {
      const fixture = reviewHarness(true);
      fixture.update({
        ...fixture.snapshot,
        configurationMetadata: parseConfigurationMetadata(fixture.metadata),
      });
      await fixture.owner.open(key);
      const apply = editor.module.workspace.applyEdit.getMockImplementation()!;
      editor.module.workspace.applyEdit.mockImplementationOnce(async () => {
        await apply();
        fixture.persistDocument();
        fixture.document.isClosed = closed;
        fixture.update({
          ...fixture.snapshot,
          configurationMetadata: parseConfigurationMetadata({
            ...fixture.metadata,
            sourceSha256: configurationFingerprint(fixture.document.text),
          }),
        });
        return true;
      });
      await fixture.review();
      expect(editor.openFile).toHaveBeenCalledOnce();
      expect(fixture.document.save).toHaveBeenCalledTimes(closed ? 0 : 1);
      expect(fixture.projects.refreshWorkspace).toHaveBeenCalledWith(key);
      expect(editor.module.window.showErrorMessage).not.toHaveBeenCalled();
    },
  );

  it.each(["stale", "formatted", "different"] as const)(
    "does not confirm a closed document when disk bytes are %s instead of the exact review",
    async (change) => {
      const fixture = reviewHarness(true);
      await fixture.owner.open(key);
      fixture.document.save.mockImplementation(async () => {
        if (change === "formatted")
          fixture.setDiskText(`${fixture.document.text}\n`);
        if (change === "different")
          fixture.setDiskText(fixture.document.text.replace("5176", "5177"));
        fixture.document.isDirty = false;
        fixture.document.isClosed = true;
        return true;
      });
      await fixture.review();
      expect(fixture.document.save).toHaveBeenCalledOnce();
      expect(fixture.projects.refreshWorkspace).not.toHaveBeenCalled();
      expect(
        editor.module.window.showInformationMessage,
      ).not.toHaveBeenCalled();
      expect(editor.module.window.showErrorMessage).toHaveBeenCalledWith(
        expect.stringContaining("changed while saving"),
      );
    },
  );

  it("refuses changed file identity after a successful save without reading the replacement", async () => {
    const fixture = reviewHarness(true);
    await fixture.owner.open(key);
    fixture.document.save.mockImplementation(async () => {
      fixture.persistDocument();
      editor.fileStat.mockImplementation(async (path: string) => ({
        dev: 1,
        ino: 999,
        isFile: () => path.endsWith(".mjs"),
        isDirectory: () => !path.endsWith(".mjs"),
        isSymbolicLink: () => false,
      }));
      return true;
    });
    await fixture.review();
    expect(editor.openFile).not.toHaveBeenCalled();
    expect(fixture.projects.refreshWorkspace).not.toHaveBeenCalled();
    expect(editor.module.window.showInformationMessage).not.toHaveBeenCalled();
    expect(editor.module.window.showErrorMessage).toHaveBeenCalledWith(
      expect.stringContaining("file identity changed"),
    );
  });

  it("refuses a different file opened after its reviewed path was checked", async () => {
    const fixture = reviewHarness(true);
    await fixture.owner.open(key);
    const opened = await editor.openFile();
    const read = vi.fn(opened.read);
    const close = vi.fn(opened.close);
    editor.openFile.mockResolvedValue({
      ...opened,
      stat: async () => ({
        dev: 1,
        ino: 999,
        size: Buffer.byteLength(fixture.document.text),
        isFile: () => true,
      }),
      read,
      close,
    });
    await fixture.review();
    expect(read).not.toHaveBeenCalled();
    expect(close).toHaveBeenCalledOnce();
    expect(fixture.projects.refreshWorkspace).not.toHaveBeenCalled();
    expect(editor.module.window.showErrorMessage).toHaveBeenCalledWith(
      expect.stringContaining("saved configuration could not be confirmed"),
    );
  });

  it("opens without following links or blocking on a replaced non-regular file", async () => {
    const fixture = reviewHarness(true);
    await fixture.owner.open(key);
    const opened = await editor.openFile();
    editor.openFile.mockClear();
    const read = vi.fn(opened.read);
    const close = vi.fn(opened.close);
    editor.openFile.mockResolvedValue({
      ...opened,
      stat: async () => ({ dev: 1, ino: 501, size: 0, isFile: () => false }),
      read,
      close,
    });
    await fixture.review();
    const flags = editor.openFile.mock.calls[0]![1] as number;
    expect(flags & filesystemConstants.O_NONBLOCK).toBe(
      filesystemConstants.O_NONBLOCK,
    );
    expect(flags & filesystemConstants.O_NOFOLLOW).toBe(
      filesystemConstants.O_NOFOLLOW,
    );
    expect(read).not.toHaveBeenCalled();
    expect(close).toHaveBeenCalledOnce();
    expect(fixture.projects.refreshWorkspace).not.toHaveBeenCalled();
    expect(editor.module.window.showErrorMessage).toHaveBeenCalled();
  });

  it("rechecks dirty editor changes and authority after reading saved bytes", async () => {
    const fixture = reviewHarness(true);
    await fixture.owner.open(key);
    const opened = await editor.openFile();
    editor.openFile.mockResolvedValue({
      ...opened,
      close: async () => {
        fixture.document.isDirty = true;
      },
    });
    await fixture.review();
    expect(fixture.projects.refreshWorkspace).not.toHaveBeenCalled();
    expect(editor.module.window.showInformationMessage).not.toHaveBeenCalled();
    expect(editor.module.window.showErrorMessage).toHaveBeenCalledWith(
      expect.stringContaining("changed while confirming the save"),
    );
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
      editor.reviewApproval.mockImplementationOnce(
        () =>
          new Promise((done) => {
            approve = done;
          }),
      );
      const reviewing = fixture.review();
      await vi.waitFor(() =>
        expect(editor.reviewApproval).toHaveBeenCalledOnce(),
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
  it("ignores late extension evidence after the panel owner is disposed", async () => {
    const fixture = harness();
    await fixture.owner.open(key);
    const panel = editor.panels[0]!;
    fixture.owner.dispose();
    fixture.owner.updateExtensionRelease(key, {
      status: "checked",
      latestVersion: "0.1.12",
      checkedAt: 1_800_000_000_000,
      channel: "preview",
    });
    expect(panel.webview.postMessage).not.toHaveBeenCalled();
    expect(
      (
        fixture.owner as unknown as {
          extensionReleases: Map<string, unknown>;
        }
      ).extensionReleases.size,
    ).toBe(0);
  });
  it("retires a checking or checked extension badge after workspace trust is lost", async () => {
    const fixture = harness();
    fixture.owner.updateExtensionRelease(key, {
      status: "checking",
      latestVersion: null,
      checkedAt: null,
      channel: "preview",
    });
    await fixture.owner.open(key);
    const panel = editor.panels[0]!;
    expect(panel.webview.html).toContain('data-state="checking"');
    editor.module.workspace.isTrusted = false;
    fixture.update(ready());
    expect(panel.webview.html).toContain('data-state="unknown"');
    expect(panel.webview.html).not.toContain('data-state="checking"');
    editor.module.workspace.isTrusted = true;
    fixture.update(ready());
    expect(panel.webview.html).toContain('data-state="unknown"');
  });
  it("patches extension release evidence without reloading a busy or edited dashboard", async () => {
    const fixture = harness(busy());
    await fixture.owner.open(key);
    const panel = editor.panels[0]!;
    expect(panel.webview.html).toContain("Extension 0.1.2");
    panel.receive({ type: "navigate", page: "activity" });
    panel.receive({ type: "editing", editing: true });
    fixture.owner.updateExtensionRelease(key, {
      status: "checked",
      latestVersion: "0.1.12",
      checkedAt: 1_800_000_000_000,
      channel: "preview",
    });
    expect(panel.assignments).toHaveLength(1);
    expect(panel.webview.postMessage).toHaveBeenLastCalledWith(
      expect.objectContaining({
        type: "extensionReleaseUpdated",
        text: "Extension 0.1.2 → 0.1.12",
        state: "available",
      }),
    );
    fixture.update(busy(2));
    expect(panel.assignments).toHaveLength(1);
    expect(panel.webview.postMessage).toHaveBeenLastCalledWith(
      expect.objectContaining({ type: "operationProgressUpdated" }),
    );
  });
  it("retains checked versions for a later opening and refresh without borrowing another project", async () => {
    const fixture = harness();
    fixture.owner.updateExtensionRelease(key, {
      status: "checked",
      latestVersion: "0.1.12",
      checkedAt: 1_800_000_000_000,
      channel: "preview",
    });
    fixture.owner.updateExtensionRelease("file:///other-project", {
      status: "checked",
      latestVersion: "9.9.9",
      checkedAt: 1_800_000_000_000,
      channel: "preview",
    });
    await fixture.owner.open(key);
    const panel = editor.panels[0]!;
    expect(panel.webview.html).toContain("Extension 0.1.2 → 0.1.12");
    expect(panel.webview.html).not.toContain("9.9.9");
    fixture.update(ready());
    expect(panel.webview.html).toContain("Extension 0.1.2 → 0.1.12");
    editor.module.workspace.isTrusted = false;
    const deliveries = panel.webview.postMessage.mock.calls.length;
    fixture.owner.updateExtensionRelease(key, {
      status: "checked",
      latestVersion: "9.9.9",
      checkedAt: 1_800_000_000_000,
      channel: "preview",
    });
    expect(panel.webview.postMessage).toHaveBeenCalledTimes(deliveries);
  });
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

  it("patches an opening sandbox into interactive and cleanup guidance without replacing its document", async () => {
    const open = (
      seconds: number,
      phase: "application-start" | "interactive-session" | "cleanup",
    ): ProjectSnapshot => {
      const value = busy(seconds);
      return {
        ...value,
        activity: {
          ...value.activity!,
          operation: {
            ...value.activity!.operation!,
            kind: "open",
            progress: {
              ...value.activity!.operation!.progress!,
              currentStage: {
                ...value.activity!.operation!.progress!.currentStage!,
                phase,
              },
            },
          },
        },
      };
    };
    const fixture = harness(open(1, "application-start"));
    await fixture.owner.open(key);
    const panel = editor.panels[0]!;
    panel.receive({ type: "navigate", page: "runtime" });
    for (const [seconds, phase, state] of [
      [2, "interactive-session", "interactive"],
      [3, "interactive-session", "interactive"],
      [4, "cleanup", "closing"],
    ] as const) {
      fixture.update(open(seconds, phase));
      expect(panel.assignments).toHaveLength(1);
      expect(panel.webview.postMessage).toHaveBeenLastCalledWith(
        expect.objectContaining({
          type: "operationProgressUpdated",
          sandboxSessionState: state,
        }),
      );
    }
  });

  it("opens an explicit loopback address during a sandbox session without a CLI or terminal", async () => {
    const fixture = harness(busy());
    await fixture.owner.open(key);
    const panel = editor.panels[0]!;
    panel.receive({ type: "openApplication", url: "http://127.0.0.1:43340/" });
    await vi.waitFor(() =>
      expect(editor.module.env.openExternal).toHaveBeenCalledTimes(1),
    );
    expect(
      editor.module.env.openExternal.mock.calls[0]?.[0]?.toString(),
    ).toContain("127.0.0.1:43340");
    expect(editor.read).not.toHaveBeenCalled();
    expect(fixture.projects.refreshWorkspace).not.toHaveBeenCalled();
  });

  it("refuses unsafe local-address requests and requests after trust or workspace loss", async () => {
    const fixture = harness(busy());
    await fixture.owner.open(key);
    const panel = editor.panels[0]!;
    for (const url of [
      "https://example.com:43340/",
      "http://user:secret@127.0.0.1:43340/",
      "http://localhost:43340/?token=x",
      "http://127.0.0.1:80/",
    ])
      panel.receive({ type: "openApplication", url });
    editor.module.workspace.isTrusted = false;
    panel.receive({ type: "openApplication", url: "http://127.0.0.1:43340/" });
    editor.module.workspace.isTrusted = true;
    editor.module.workspace.workspaceFolders = [];
    panel.receive({ type: "openApplication", url: "http://127.0.0.1:43340/" });
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(editor.module.env.openExternal).not.toHaveBeenCalled();
    expect(editor.read).not.toHaveBeenCalled();
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
    expect(panel.webview.html).toContain("Rehearsal command running");
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
      sandboxSessionState: null,
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

describe("VM state with preserved configuration drafts", () => {
  it("patches VM state and disables its control without replacing the dirty dashboard", async () => {
    const fixture = harness({
      ...ready(),
      engineLifecycle: engineSnapshot().engineLifecycle!,
    });
    await fixture.owner.open(key);
    const panel = editor.panels[0]!;
    panel.receive({ type: "editing", editing: true });
    fixture.actions.engineShutdownStateFor.mockReturnValue("running");
    fixture.activity.fire(key);
    expect(panel.assignments).toHaveLength(1);
    expect(panel.webview.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "engineShutdownUpdated",
        state: "running",
        canReview: false,
        selectedState: "running",
        profileState: "running",
      }),
    );
    expect(panel.webview.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ type: "inspectionUpdated" }),
    );
  });
  it("dispatches only the fixed VM review message through its current workspace owner", async () => {
    const fixture = harness();
    await fixture.owner.open(key);
    const panel = editor.panels[0]!;
    const send = (message: unknown) =>
      (
        fixture.owner as unknown as {
          handleMessage(
            panel: unknown,
            key: string,
            message: unknown,
          ): Promise<void>;
        }
      ).handleMessage(panel, key, message);
    await send({ type: "reviewVmShutdown" });
    expect(fixture.actions.reviewVmShutdown).toHaveBeenCalledWith(key);
    fixture.actions.reviewVmShutdown.mockClear();
    await send({ type: "reviewVmShutdown", command: "docker stop" });
    expect(fixture.actions.reviewVmShutdown).not.toHaveBeenCalled();
  });
});

describe("review dashboard return", () => {
  it("reveals the exact existing dashboard with focus without rewriting a dirty page", async () => {
    const fixture = harness();
    await fixture.owner.open(key);
    const panel = editor.panels[0]!;
    panel.receive({ type: "navigate", page: "configuration" });
    panel.receive({ type: "editing", editing: true });
    const assignments = panel.assignments.length;
    panel.viewColumn = 2;
    fixture.returns.fire(key);
    expect(editor.panels).toHaveLength(1);
    expect(panel.reveal).toHaveBeenCalledWith(2, false);
    expect(panel.assignments).toHaveLength(assignments);
    fixture.owner.dispose();
    panel.reveal.mockClear();
    fixture.returns.fire(key);
    expect(panel.reveal).not.toHaveBeenCalled();
  });
});

describe("reviewed Drizzle source controller", () => {
  const setupDrizzle = () => {
    const nativeIdentity = {
        kind: "drizzle" as const,
        idx: 0,
        when: 1700000000000,
        tag: "0000_change",
      },
      sha = "a".repeat(64);
    const plan = insightPlan(),
      target = plan.targets[0]!,
      entry = {
        ...target.entries[0]!,
        nativeIdentity,
        id: "primary:drizzle:0:1700000000000:0000_change",
        name: "0000_change",
        filename: "0000_change.sql",
        sha256: sha,
      };
    const { version: _v, timestamp: _t, ...nativeEntry } = entry;
    const migrationTool = {
      schemaVersion: 1 as const,
      kind: "drizzle" as const,
      kitVersion: "0.31.11" as const,
      ormVersion: "0.45.4" as const,
      driver: "pg" as const,
      driverVersion: "8.23.1" as const,
      journalVersion: "7" as const,
      dialect: "postgresql" as const,
      journalSha256: sha,
      toolchainSha256: sha,
      ledger: {
        schema: "drizzle" as const,
        table: "__drizzle_migrations" as const,
      },
    };
    const migrationReview = {
      ...plan,
      targets: [
        {
          ...target,
          migrationTool,
          baselineHistorySha256: sha,
          baselinePrefixVerification: "exact-native-semantic-prefix" as const,
          entries: [nativeEntry],
        },
      ],
    };
    const snapshot = { ...ready(), version: "2.2.0", migrationReview },
      fixture = harness(snapshot),
      text = "DROP TABLE retired;",
      path = `${snapshot.workspaceRoot}/drizzle/0000_change.sql`;
    const document = {
      uri: editor.uri(path),
      isDirty: false,
      isClosed: false,
      getText: () => text,
    };
    editor.resolvePackage.mockResolvedValue({
      drizzleMigrationsSchema: 1,
      version: "2.2.0",
    });
    editor.read.mockImplementation(
      async ({ expectedCommand }: { expectedCommand: string }) => ({
        result: {
          status: "success",
          rehearsalVersion: "2.2.0",
          data:
            expectedCommand === "activity"
              ? { schemaVersion: 1, state: "idle", operation: null }
              : {
                  schemaVersion: 2,
                  evidence: "reviewed_source_input",
                  target: "primary",
                  candidateSha256: plan.candidateSha256,
                  nativeIdentity,
                  filename: entry.filename,
                  sha256: sha,
                  workspaceRelativePath: "drizzle/0000_change.sql",
                  line: null,
                  column: null,
                },
        },
      }),
    );
    editor.readMigration.mockResolvedValue({
      path,
      text,
      identity: "stable-file",
    });
    editor.module.workspace.openTextDocument.mockResolvedValue(document);
    return { ...fixture, snapshot, document, migrationReview, nativeEntry };
  };
  it("uses genuine public source selection then exact clean file checks, without applying SQL", async () => {
    const fixture = setupDrizzle();
    await fixture.owner.open(key);
    const { migrationSourceReviewId } =
      await import("../src/migration_source_review.js");
    await (
      fixture.owner as unknown as {
        handleMessage: (p: unknown, k: string, m: unknown) => Promise<void>;
      }
    ).handleMessage(editor.panels[0], key, {
      type: "openReviewedMigration",
      sourceId: migrationSourceReviewId(
        fixture.migrationReview,
        fixture.nativeEntry,
      ),
    });
    expect(
      editor.read.mock.calls.map(([request]) => request.expectedCommand),
    ).toEqual(["activity", "inspect source"]);
    expect(editor.readMigration).toHaveBeenCalledTimes(2);
    expect(editor.module.window.showTextDocument).toHaveBeenCalledWith(
      fixture.document,
      {
        preview: true,
        selection: {
          start: { line: 0, character: 0 },
          end: { line: 0, character: 0 },
        },
      },
    );
    expect(editor.module.workspace.applyEdit).not.toHaveBeenCalled();
    expect(editor.write).not.toHaveBeenCalled();
  });
  it.each(["older-core", "dirty", "trust", "stale-snapshot", "unsafe-uri"])(
    "refuses %s before opening source",
    async (reason) => {
      const fixture = setupDrizzle();
      await fixture.owner.open(key);
      if (reason === "older-core")
        editor.resolvePackage.mockResolvedValue({
          drizzleMigrationsSchema: null,
          version: "2.2.0",
        });
      if (reason === "dirty") fixture.document.isDirty = true;
      if (reason === "trust") editor.module.workspace.isTrusted = false;
      if (reason === "unsafe-uri") fixture.document.uri.authority = "remote";
      if (reason === "stale-snapshot")
        editor.readMigration.mockImplementationOnce(async () => {
          fixture.update({ ...fixture.snapshot });
          return {
            path: fixture.document.uri.fsPath,
            text: fixture.document.getText(),
            identity: "stable-file",
          };
        });
      const { migrationSourceReviewId } =
        await import("../src/migration_source_review.js");
      await (
        fixture.owner as unknown as {
          handleMessage: (p: unknown, k: string, m: unknown) => Promise<void>;
        }
      ).handleMessage(editor.panels[0], key, {
        type: "openReviewedMigration",
        sourceId: migrationSourceReviewId(
          fixture.migrationReview,
          fixture.nativeEntry,
        ),
      });
      expect(editor.module.window.showTextDocument).not.toHaveBeenCalled();
      expect(editor.write).not.toHaveBeenCalled();
    },
  );
});
