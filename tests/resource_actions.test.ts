import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";
import type { ProjectSnapshot } from "../src/project_snapshot.js";
import { activityStorageKey } from "../src/workspace_activity.js";
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
    | ((event: {
        terminal: unknown;
        execution: unknown;
        exitCode?: number;
      }) => void)
    | undefined,
  folderListener: undefined as
    ((event: { removed: readonly unknown[] }) => void) | undefined,
  integrationListener: undefined as
    | ((event: { terminal: unknown; shellIntegration: unknown }) => void)
    | undefined,
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
    onDidChangeTerminalShellIntegration: (
      listener: typeof mocks.integrationListener,
    ) => {
      mocks.integrationListener = listener;
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
const actions = (storage = new Map<string, unknown>()) => {
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
  mocks.integrationListener = undefined;
  mocks.execute.mockReturnValue({});
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
    mocks.endListener?.({
      terminal,
      execution: mocks.execute.mock.results[0]!.value,
      exitCode: 0,
    });
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

  it.each(["close", "shell"])(
    "preserves an unknown %s exit as an unverified receipt across reload",
    async (event) => {
      vi.useFakeTimers();
      const storage = new Map<string, unknown>();
      const runner = actions(storage);
      await runner.runWorkspace("file:///workspace", "startRuntime", "primary");
      const terminal = mocks.terminal.mock.results[0]!.value;
      const id = runner.activityFor("file:///workspace")[0]!.id;
      if (event === "close") mocks.closeListener?.(terminal);
      else
        mocks.endListener?.({
          terminal,
          execution: mocks.execute.mock.results[0]!.value,
        });
      await vi.advanceTimersByTimeAsync(0);
      expect(runner.activityFor("file:///workspace")).toMatchObject([
        { id, outcome: "unverified", finishedAt: null, exitCode: null },
      ]);
      runner.dispose();
      expect(actions(storage).activityFor("file:///workspace")).toMatchObject([
        { id, outcome: "unverified", finishedAt: null, exitCode: null },
      ]);
      expect(vi.getTimerCount()).toBe(0);
    },
  );

  it("retains a pre-fix stored unknown-exit receipt across owner recreation without granting ownership", async () => {
    const legacy = {
      id: "previous-writer-unknown",
      label: "Run rehearsal",
      startedAt: "2026-10-13T12:00:00Z",
      finishedAt: "2026-10-13T12:01:00Z",
      outcome: "unverified",
      exitCode: null,
    };
    const storage = new Map<string, unknown>([
      [activityStorageKey("file:///workspace"), [legacy]],
    ]);
    const runner = actions(storage);
    expect(runner.activityFor("file:///workspace")).toEqual([
      { ...legacy, finishedAt: null },
    ]);
    runner.dispose();
    const reloaded = actions(storage);
    expect(reloaded.activityFor("file:///workspace")).toEqual([
      { ...legacy, finishedAt: null },
    ]);
    await reloaded.runWorkspace("file:///workspace", "cancelOwnedOperation");
    expect(mocks.terminal).not.toHaveBeenCalled();
    expect(mocks.read).not.toHaveBeenCalled();
    expect(mocks.confirm).toHaveBeenCalledWith(
      "No editor-started Rehearsal operation is running for this project.",
    );
  });

  it("binds a shell integration that becomes available during startup to its exact execution", async () => {
    vi.useFakeTimers();
    const terminal = { show: vi.fn(), sendText: vi.fn(), dispose: vi.fn() };
    mocks.terminal.mockReturnValue(terminal);
    const runner = actions();
    const launch = runner.runWorkspace(
      "file:///workspace",
      "startRuntime",
      "primary",
    );
    await vi.advanceTimersByTimeAsync(0);
    mocks.integrationListener?.({
      terminal,
      shellIntegration: { executeCommand: mocks.execute },
    });
    await launch;
    expect(mocks.execute).toHaveBeenCalledOnce();
    expect(terminal.sendText).not.toHaveBeenCalled();
    mocks.endListener?.({ terminal, execution: {}, exitCode: 0 });
    expect(runner.activityFor("file:///workspace")[0]?.outcome).toBe("running");
    mocks.endListener?.({
      terminal,
      execution: mocks.execute.mock.results[0]!.value,
      exitCode: 9,
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(runner.activityFor("file:///workspace")[0]).toMatchObject({
      outcome: "failed",
      exitCode: 9,
    });
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each([0, 9, 130])(
    "records only the exact owned execution's known exit %i",
    async (exitCode) => {
      vi.useFakeTimers();
      const runner = actions();
      await runner.runWorkspace("file:///workspace", "startRuntime", "primary");
      const terminal = mocks.terminal.mock.results[0]!.value;
      const execution = mocks.execute.mock.results[0]!.value;
      mocks.endListener?.({ terminal, execution: {}, exitCode: 0 });
      await vi.advanceTimersByTimeAsync(0);
      expect(runner.activityFor("file:///workspace")).toMatchObject([
        { outcome: "running", exitCode: null, finishedAt: null },
      ]);
      expect(mocks.refresh).not.toHaveBeenCalled();
      mocks.endListener?.({ terminal, execution, exitCode });
      await vi.advanceTimersByTimeAsync(0);
      expect(runner.activityFor("file:///workspace")).toMatchObject([
        {
          outcome:
            exitCode === 0
              ? "completed"
              : exitCode === 130
                ? "cancelled"
                : "failed",
          exitCode,
          finishedAt: expect.any(String),
        },
      ]);
      mocks.endListener?.({ terminal, execution, exitCode: 4 });
      mocks.closeListener?.(terminal);
      await vi.advanceTimersByTimeAsync(0);
      expect(runner.activityFor("file:///workspace")[0]?.exitCode).toBe(
        exitCode,
      );
      expect(mocks.refresh).toHaveBeenCalledOnce();
      expect(vi.getTimerCount()).toBe(0);
    },
  );

  it("keeps sendText fallback unverified rather than borrowing a late shell execution", async () => {
    vi.useFakeTimers();
    const terminal = { show: vi.fn(), sendText: vi.fn(), dispose: vi.fn() };
    mocks.terminal.mockReturnValue(terminal);
    const runner = actions();
    const launch = runner.runWorkspace(
      "file:///workspace",
      "startRuntime",
      "primary",
    );
    await vi.advanceTimersByTimeAsync(1500);
    await launch;
    expect(terminal.sendText).toHaveBeenCalledOnce();
    mocks.endListener?.({ terminal, execution: {}, exitCode: 0 });
    await vi.advanceTimersByTimeAsync(0);
    expect(runner.activityFor("file:///workspace")[0]?.outcome).toBe("running");
    mocks.closeListener?.(terminal);
    await vi.advanceTimersByTimeAsync(0);
    expect(runner.activityFor("file:///workspace")).toMatchObject([
      { outcome: "unverified", exitCode: null, finishedAt: null },
    ]);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("never cancels a discovered operation without a live editor-owned terminal", async () => {
    current = {
      ...snapshot,
      activity: {
        schemaVersion: 1,
        state: "busy",
        operation: {
          kind: "run",
          startedAt: "2026-10-13T12:00:00Z",
          rehearsalVersion: "0.1.0-rc.7",
        },
      },
    };
    await actions().runWorkspace("file:///workspace", "cancelOwnedOperation");
    expect(mocks.terminal).not.toHaveBeenCalled();
    expect(mocks.execute).not.toHaveBeenCalled();
    expect(mocks.read).not.toHaveBeenCalled();
    expect(mocks.confirm).toHaveBeenCalledWith(
      "No editor-started Rehearsal operation is running for this project.",
    );
  });

  it("does not recover cancellation ownership from a previous session's running receipt", async () => {
    vi.useFakeTimers();
    const storage = new Map<string, unknown>();
    const previous = actions(storage);
    await previous.runWorkspace("file:///workspace", "startRuntime", "primary");
    const terminal = mocks.terminal.mock.results[0]!.value;
    previous.dispose();
    const reloaded = actions(storage);
    expect(reloaded.activityFor("file:///workspace")).toMatchObject([
      { outcome: "unverified", finishedAt: null, exitCode: null },
    ]);
    await reloaded.runWorkspace("file:///workspace", "cancelOwnedOperation");
    expect(terminal.dispose).not.toHaveBeenCalled();
    expect(mocks.confirm).toHaveBeenLastCalledWith(
      "No editor-started Rehearsal operation is running for this project.",
    );
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each(["completed", "trust", "disposed"])(
    "rechecks %s ownership after cancellation approval",
    async (change) => {
      vi.useFakeTimers();
      const runner = actions();
      await runner.runWorkspace("file:///workspace", "startRuntime", "primary");
      const terminal = mocks.terminal.mock.results[0]!.value;
      const execution = mocks.execute.mock.results[0]!.value;
      let approve: ((value: string) => void) | undefined;
      mocks.confirm.mockImplementation(
        () =>
          new Promise<string>((resolve) => {
            approve = resolve;
          }),
      );
      const pending = runner.runWorkspace(
        "file:///workspace",
        "cancelOwnedOperation",
      );
      if (change === "completed")
        mocks.endListener?.({ terminal, execution, exitCode: 0 });
      else if (change === "trust") mocks.trusted = false;
      else runner.dispose();
      approve?.("Cancel Operation");
      await vi.advanceTimersByTimeAsync(1000);
      await pending;
      expect(terminal.dispose).not.toHaveBeenCalled();
      if (change === "completed")
        expect(runner.activityFor("file:///workspace")[0]?.outcome).toBe(
          "completed",
        );
      expect(vi.getTimerCount()).toBe(0);
    },
  );

  it("coalesces repeated cancellation across the approval modal and verifies actual idle", async () => {
    vi.useFakeTimers();
    const runner = actions();
    await runner.runWorkspace("file:///workspace", "startRuntime", "primary");
    const terminal = mocks.terminal.mock.results[0]!.value;
    let approve: ((value: string) => void) | undefined;
    mocks.confirm.mockImplementation(
      () =>
        new Promise<string>((resolve) => {
          approve = resolve;
        }),
    );
    terminal.dispose.mockImplementation(() => mocks.closeListener?.(terminal));
    const first = runner.runWorkspace(
      "file:///workspace",
      "cancelOwnedOperation",
    );
    const second = runner.runWorkspace(
      "file:///workspace",
      "cancelOwnedOperation",
    );
    expect(
      mocks.confirm.mock.calls.filter(
        ([title]) =>
          title === "Cancel the Rehearsal operation started by this extension?",
      ),
    ).toHaveLength(1);
    approve?.("Cancel Operation");
    await vi.advanceTimersByTimeAsync(0);
    await Promise.all([first, second]);
    expect(terminal.dispose).toHaveBeenCalledOnce();
    expect(runner.activityFor("file:///workspace")[0]?.outcome).toBe(
      "unverified",
    );
    expect(mocks.warn).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("keeps timed-out cancellation unverified, aborts its owned read and guides recovery", async () => {
    vi.useFakeTimers();
    const runner = actions();
    await runner.runWorkspace("file:///workspace", "startRuntime", "primary");
    const terminal = mocks.terminal.mock.results[0]!.value;
    terminal.dispose.mockImplementation(() => mocks.closeListener?.(terminal));
    const signals: AbortSignal[] = [];
    mocks.read.mockImplementation(async ({ signal }) => {
      signals.push(signal);
      return new Promise(() => {});
    });
    const pending = runner.runWorkspace(
      "file:///workspace",
      "cancelOwnedOperation",
    );
    await vi.advanceTimersByTimeAsync(30_000);
    await pending;
    expect(terminal.dispose).toHaveBeenCalledOnce();
    expect(signals).toHaveLength(1);
    expect(signals[0]?.aborted).toBe(true);
    expect(runner.activityFor("file:///workspace")[0]?.outcome).toBe(
      "unverified",
    );
    expect(mocks.confirm).toHaveBeenCalledWith(
      expect.stringContaining("Cleanup outcome is not yet verified"),
    );
    expect(mocks.refresh).toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("aborts cancellation's unresolved activity read after trust revocation and refreshes without success", async () => {
    vi.useFakeTimers();
    const runner = actions();
    await runner.runWorkspace("file:///workspace", "startRuntime", "primary");
    const terminal = mocks.terminal.mock.results[0]!.value;
    terminal.dispose.mockImplementation(() => mocks.closeListener?.(terminal));
    const signals: AbortSignal[] = [];
    mocks.read.mockImplementation(async ({ signal }) => {
      signals.push(signal);
      return new Promise(() => {});
    });
    const pending = runner.runWorkspace(
      "file:///workspace",
      "cancelOwnedOperation",
    );
    await vi.advanceTimersByTimeAsync(0);
    expect(signals).toHaveLength(1);
    mocks.trusted = false;
    await vi.advanceTimersByTimeAsync(500);
    expect(signals[0]?.aborted).toBe(true);
    await pending;
    await vi.advanceTimersByTimeAsync(30_000);
    expect(signals).toHaveLength(1);
    expect(terminal.dispose).toHaveBeenCalledOnce();
    expect(runner.activityFor("file:///workspace")[0]?.outcome).toBe(
      "unverified",
    );
    expect(mocks.refresh).toHaveBeenCalled();
    expect(mocks.confirm).toHaveBeenCalledWith(
      expect.stringContaining("Cleanup outcome is not yet verified"),
    );
    expect(vi.getTimerCount()).toBe(0);
  });
});
