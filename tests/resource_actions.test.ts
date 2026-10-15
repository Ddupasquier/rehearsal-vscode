import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";
import type { ProjectSnapshot } from "../src/project_snapshot.js";
const mocks = vi.hoisted(() => ({
  trusted: true,
  confirm: vi.fn(),
  error: vi.fn(),
  read: vi.fn(),
  execute: vi.fn(),
  terminal: vi.fn(),
  refresh: vi.fn(),
  publish: vi.fn(),
  warn: vi.fn(),
  closeListener: undefined as ((terminal: unknown) => void) | undefined,
  endListener: undefined as
    ((event: { terminal: unknown; exitCode?: number }) => void) | undefined,
  folderListener: undefined as
    ((event: { removed: readonly unknown[] }) => void) | undefined,
}));
vi.mock("vscode", () => ({
  workspace: {
    onDidChangeWorkspaceFolders: (listener: typeof mocks.folderListener) => {
      mocks.folderListener = listener;
      return { dispose() {} };
    },
    get isTrusted() {
      return mocks.trusted;
    },
    workspaceFolders: [
      {
        name: "fixture",
        uri: { fsPath: "/workspace", toString: () => "file:///workspace" },
      },
    ],
  },
  window: {
    onDidCloseTerminal: (listener: typeof mocks.closeListener) => {
      mocks.closeListener = listener;
      return { dispose() {} };
    },
    onDidEndTerminalShellExecution: (listener: typeof mocks.endListener) => {
      mocks.endListener = listener;
      return { dispose() {} };
    },
    showWarningMessage: mocks.confirm,
    showInformationMessage: mocks.confirm,
    showErrorMessage: mocks.error,
    createTerminal: mocks.terminal,
    withProgress: async (_options: unknown, task: Function) =>
      task({}, { onCancellationRequested: () => ({ dispose() {} }) }),
  },
  EventEmitter: class {
    event = () => ({ dispose() {} });
    fire() {}
    dispose() {}
  },
  ThemeIcon: class {},
  ProgressLocation: { Notification: 1 },
}));
vi.mock("../src/process_adapter.js", () => ({ runRehearsalJson: mocks.read }));
import { RehearsalWorkspaceActions } from "../src/workspace_actions.js";
const id = `sha256:${"a".repeat(64)}`;
const image = {
  id,
  service: "postgres",
  tags: ["public.ecr.aws/supabase/postgres:old"],
  digests: [],
  createdAt: "2026-09-01T00:00:00Z",
  bytes: 100,
  state: "candidate" as const,
  reason: "Unused",
  references: [],
};
const snapshot: ProjectSnapshot = {
  workspaceName: "fixture",
  workspaceRoot: "/workspace",
  availability: "ready",
  version: "0.1.0-rc.4",
  configPath: "rehearsal.config.mjs",
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
    inspectedAt: "2026-10-13T00:00:00Z",
    engine: { state: "running", context: null, disk: null, resources: [] },
    environments: [
      {
        target: "primary",
        displayName: "My sandbox",
        protected: false,
        projectId: "immutable",
        provider: "postgresql",
        configPath: "/workspace/rehearsal.config.mjs",
        state: "stopped",
        containerCount: 1,
        runningContainerCount: 0,
        volumeCount: 1,
        diskUsageBytes: 100,
        cpuPercent: null,
        memoryUsageBytes: null,
        memoryLimitBytes: null,
        createdAt: null,
        lastActivityAt: null,
        retention: "persistent",
        cleanupEligibility: "preview-required",
        restartPolicies: ["no"],
      },
    ],
    stale: { stoppedCount: 1, digest: "b".repeat(64), targets: ["primary"] },
    catalog: {
      schemaVersion: 1,
      images: [image],
      volumes: [],
      otherContainers: [],
    },
  },
};
const preview = {
  mode: "preview",
  plan: {
    digest: "c".repeat(64),
    imagesOnly: true,
    runtime: { included: false },
    baselines: { removed: [] },
    images: { candidates: [image] },
  },
};
let current = snapshot;
const runners: RehearsalWorkspaceActions[] = [];
const actions = () => {
  const storage = new Map<string, unknown>();
  const runner = new RehearsalWorkspaceActions(
    {
      snapshotFor: () => current,
      refreshWorkspace: mocks.refresh,
      publishOperationActivity: mocks.publish,
    } as never,
    { info: vi.fn(), warn: mocks.warn } as never,
    {
      get: (key: string) => storage.get(key),
      update: async (key: string, value: unknown) => {
        storage.set(key, value);
      },
    } as never,
  );
  runners.push(runner);
  return runner;
};
afterEach(() => {
  for (const runner of runners.splice(0)) runner.dispose();
  vi.useRealTimers();
});
beforeEach(() => {
  vi.clearAllMocks();
  mocks.trusted = true;
  current = snapshot;
  mocks.closeListener = undefined;
  mocks.endListener = undefined;
  mocks.folderListener = undefined;
  mocks.confirm.mockImplementation(async (_title, _options, label) => label);
  mocks.terminal.mockReturnValue({
    show: vi.fn(),
    shellIntegration: { executeCommand: mocks.execute },
    dispose: vi.fn(),
  });
  mocks.read.mockImplementation(async ({ command }) => ({
    result: {
      data:
        command[0] === "activity"
          ? { schemaVersion: 1, state: "idle", operation: null }
          : preview,
    },
    exitCode: 0,
  }));
});
describe("reviewed resource actions", () => {
  it("previews exact selected images and runs only the digest-bound image-only command", async () => {
    await actions().cleanupImages("file:///workspace", [id]);
    expect(mocks.read).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceRoot: "/workspace",
        command: ["cleanup", "--images-only", `--image-id=${id}`],
      }),
    );
    expect(mocks.confirm).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        modal: true,
        detail: expect.stringContaining("Data volumes: 0"),
      }),
      "Remove Selected Images",
    );
    expect(mocks.execute).toHaveBeenCalledWith("npx", [
      "--no-install",
      "rehearsal",
      "cleanup",
      "--images-only",
      `--image-id=${id}`,
      "--write",
      `--confirm-cleanup=${"c".repeat(64)}`,
      "--config=rehearsal.config.mjs",
    ]);
  });
  it("does not execute after cancellation or a contradictory core preview", async () => {
    mocks.confirm.mockResolvedValueOnce(undefined);
    await actions().cleanupImages("file:///workspace", [id]);
    expect(mocks.execute).not.toHaveBeenCalled();
    mocks.read.mockResolvedValueOnce({
      result: {
        data: {
          ...preview,
          plan: { ...preview.plan, baselines: { removed: ["baseline"] } },
        },
      },
      exitCode: 0,
    });
    await actions().cleanupImages("file:///workspace", [id]);
    expect(mocks.error).toHaveBeenCalled();
    expect(mocks.execute).not.toHaveBeenCalled();
  });
  it("refuses untrusted workspaces, unknown image identities, duplicates and injected options", async () => {
    const runner = actions();
    mocks.trusted = false;
    await runner.cleanupImages("file:///workspace", [id]);
    mocks.trusted = true;
    for (const ids of [[id, id], [`sha256:${"d".repeat(64)}`], ["--force"], []])
      await runner.cleanupImages("file:///workspace", ids);
    expect(mocks.read).not.toHaveBeenCalled();
    expect(mocks.execute).not.toHaveBeenCalled();
  });
  it("binds a runtime action to a configured target and refuses unknown targets", async () => {
    const runner = actions();
    await runner.runWorkspace("file:///workspace", "startRuntime", "foreign");
    expect(mocks.execute).not.toHaveBeenCalled();
    await runner.runWorkspace("file:///workspace", "startRuntime", "primary");
    expect(mocks.execute).toHaveBeenCalledWith(
      "npx",
      expect.arrayContaining(["start", "--target=primary"]),
    );
  });
  it("refuses a protected environment discard without creating a terminal", async () => {
    current = {
      ...snapshot,
      resources: {
        ...snapshot.resources!,
        environments: snapshot.resources!.environments.map((e) => ({
          ...e,
          protected: true,
        })),
      },
    };
    await actions().runWorkspace(
      "file:///workspace",
      "discardRuntime",
      "primary",
    );
    expect(mocks.terminal).not.toHaveBeenCalled();
  });

  it("rechecks trust after approval before launching an owned terminal", async () => {
    mocks.confirm.mockImplementation(async (_title, _options, label) => {
      mocks.trusted = false;
      return label;
    });
    await actions().runWorkspace(
      "file:///workspace",
      "startRuntime",
      "primary",
    );
    expect(mocks.terminal).not.toHaveBeenCalled();
    expect(mocks.execute).not.toHaveBeenCalled();
    expect(mocks.read).not.toHaveBeenCalled();
  });

  it("publishes active terminal progress and performs one full refresh after observed idle", async () => {
    vi.useFakeTimers();
    let reads = 0;
    const busy = {
      schemaVersion: 1,
      state: "busy",
      operation: {
        kind: "start",
        startedAt: "2026-10-13T12:00:00Z",
        rehearsalVersion: "0.1.0-rc.4",
      },
    };
    mocks.read.mockImplementation(async () => ({
      result: {
        data:
          ++reads === 1
            ? busy
            : { schemaVersion: 1, state: "idle", operation: null },
      },
      exitCode: 0,
    }));
    const runner = actions();
    await runner.runWorkspace("file:///workspace", "startRuntime", "primary");
    await vi.advanceTimersByTimeAsync(2000);
    expect(mocks.publish).toHaveBeenCalledWith("file:///workspace", busy);
    expect(mocks.refresh).toHaveBeenCalledOnce();
    const terminal = mocks.terminal.mock.results[0]!.value;
    mocks.endListener?.({ terminal, exitCode: 0 });
    await vi.advanceTimersByTimeAsync(0);
    mocks.closeListener?.(terminal);
    await vi.advanceTimersByTimeAsync(300_000);
    expect(mocks.refresh).toHaveBeenCalledOnce();
    expect(mocks.read).toHaveBeenCalledTimes(2);
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each(["trust", "removed", "dispose"])(
    "aborts only owned activity reads after %s without cancelling the terminal",
    async (event) => {
      vi.useFakeTimers();
      let signal: AbortSignal | undefined;
      mocks.read.mockImplementation(async (options) => {
        signal = options.signal;
        return new Promise(() => {});
      });
      const runner = actions();
      await runner.runWorkspace("file:///workspace", "startRuntime", "primary");
      await vi.advanceTimersByTimeAsync(0);
      if (event === "trust") mocks.trusted = false;
      else if (event === "removed")
        mocks.folderListener?.({
          removed: [{ uri: { toString: () => "file:///workspace" } }],
        });
      else runner.dispose();
      await vi.advanceTimersByTimeAsync(1000);
      expect(signal?.aborted).toBe(true);
      expect(
        mocks.terminal.mock.results[0]!.value.dispose,
      ).not.toHaveBeenCalled();
      expect(mocks.refresh).not.toHaveBeenCalled();
      expect(vi.getTimerCount()).toBe(0);
    },
  );
});
