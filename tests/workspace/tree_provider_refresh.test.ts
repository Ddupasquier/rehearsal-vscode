import { afterEach, describe, expect, it, vi } from "vitest";

const vscode = vi.hoisted(() => {
  const disposable = () => ({ dispose: vi.fn() });
  const folder = {
    name: "blendCalc",
    uri: {
      fsPath: "/workspace/blendCalc",
      toString: () => "file:///workspace/blendCalc",
    },
  };
  const configurationPaths = new Map<string, unknown>();
  const listeners: {
    folders?: () => void;
    configuration?: (event: {
      affectsConfiguration: (setting: string) => boolean;
    }) => void;
  } = {};
  const watchers: {
    base: unknown;
    pattern: string;
    change?: () => void;
    create?: () => void;
    delete?: () => void;
    dispose: ReturnType<typeof vi.fn>;
  }[] = [];

  class EventEmitter<Value> {
    readonly event = vi.fn(() => disposable());
    readonly fire = vi.fn((_value?: Value) => undefined);
    readonly dispose = vi.fn();
  }

  class TreeItem {
    constructor(
      readonly label: string,
      readonly collapsibleState: number,
    ) {}
  }

  class RelativePattern {
    constructor(
      readonly base: unknown,
      readonly pattern: string,
    ) {}
  }

  return {
    disposable,
    folder,
    configurationPaths,
    listeners,
    watchers,
    module: {
      EventEmitter,
      TreeItem,
      RelativePattern,
      TreeItemCollapsibleState: { None: 0, Expanded: 2 },
      ThemeIcon: class ThemeIcon {
        constructor(readonly id: string) {}
      },
      FileType: { File: 1, Directory: 2, SymbolicLink: 64 },
      workspace: {
        workspaceFolders: [folder],
        isTrusted: true,
        onDidChangeWorkspaceFolders: vi.fn((listener: () => void) => {
          listeners.folders = listener;
          return disposable();
        }),
        onDidGrantWorkspaceTrust: vi.fn(() => disposable()),
        onDidChangeConfiguration: vi.fn(
          (listener: NonNullable<typeof listeners.configuration>) => {
            listeners.configuration = listener;
            return disposable();
          },
        ),
        getConfiguration: vi.fn((_section: string, uri: typeof folder.uri) => ({
          get: (key: string, fallback: unknown) =>
            key === "configPath"
              ? (configurationPaths.get(uri.toString()) ?? fallback)
              : fallback,
        })),
        createFileSystemWatcher: vi.fn((pattern: RelativePattern) => {
          const watcher = {
            base: pattern.base,
            pattern: pattern.pattern,
            dispose: vi.fn(),
          } as (typeof watchers)[number];
          watchers.push(watcher);
          return {
            onDidChange: (listener: () => void) => {
              watcher.change = listener;
              return disposable();
            },
            onDidCreate: (listener: () => void) => {
              watcher.create = listener;
              return disposable();
            },
            onDidDelete: (listener: () => void) => {
              watcher.delete = listener;
              return disposable();
            },
            dispose: watcher.dispose,
          };
        }),
      },
      window: { showInformationMessage: vi.fn() },
      Uri: {
        joinPath: vi.fn(),
        parse: vi.fn(),
      },
    },
  };
});

vi.mock("vscode", () => vscode.module);

const inspections = vi.hoisted(() => ({
  bootstrap: vi.fn(),
  inspect: vi.fn(),
}));
vi.mock("../../src/workspace/bootstrap_discovery.js", () => ({
  bootstrapProjectDiscovery: inspections.bootstrap,
}));
vi.mock("../../src/workspace/project_snapshot.js", () => ({
  inspectProject: inspections.inspect,
}));

import { PROJECT_REFRESH_PATHS } from "../../src/workspace/workspace_refresh.js";
import { RehearsalTreeProvider } from "../../src/workspace/tree_provider.js";
import type { ProjectSnapshot } from "../../src/workspace/project_snapshot.js";

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  inspections.bootstrap.mockReset();
  inspections.inspect.mockReset();
  vscode.watchers.splice(0);
  vscode.configurationPaths.clear();
  delete vscode.listeners.folders;
  delete vscode.listeners.configuration;
  vscode.module.workspace.workspaceFolders = [vscode.folder];
  vscode.module.workspace.isTrusted = true;
});

const outputChannel = () => ({
  appendLine: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
});

const configurationChanged = () => {
  vscode.listeners.configuration?.({
    affectsConfiguration: (setting) => setting === "rehearsal.configPath",
  });
};

describe("RehearsalTreeProvider project watchers", () => {
  it.each([
    ["busy", "ready"],
    ["busy", "error"],
    ["stale", "ready"],
    ["stale", "error"],
    ["invalid", "ready"],
    ["invalid", "error"],
  ] as const)(
    "keeps newer %s activity when an older inspection finishes %s",
    async (state, oldAvailability) => {
      const provider = new RehearsalTreeProvider(outputChannel() as never);
      const key = vscode.folder.uri.toString();
      const initial: ProjectSnapshot = {
        workspaceName: "synthetic",
        workspaceRoot: vscode.folder.uri.fsPath,
        availability: "ready",
        readiness: { state: "READY", passed: 1, failed: 0, checks: [] },
        applicationUrl: "http://localhost:5175",
      };
      (
        provider as unknown as { snapshots: Map<string, ProjectSnapshot> }
      ).snapshots.set(key, initial);
      let finishInspection!: (snapshot: ProjectSnapshot) => void;
      let signal: AbortSignal | undefined;
      inspections.bootstrap.mockResolvedValue(undefined);
      inspections.inspect.mockImplementationOnce(
        (options: { signal: AbortSignal }) => {
          signal = options.signal;
          return new Promise<ProjectSnapshot>((resolve) => {
            finishInspection = resolve;
          });
        },
      );
      const refreshing = provider.refreshWorkspace(key);
      await Promise.resolve();
      expect(inspections.inspect).toHaveBeenCalledOnce();
      expect(provider.inspectionStateFor(key)).toBe("loading");
      provider.publishOperationActivity(key, {
        schemaVersion: 1,
        state,
        operation:
          state === "invalid"
            ? null
            : {
                kind: "open",
                startedAt: "2026-10-18T22:00:00Z",
                rehearsalVersion: "1.0.0",
              },
      });
      const observed = provider.snapshotFor(key);
      expect(signal?.aborted).toBe(true);
      expect(provider.inspectionStateFor(key)).toBe("idle");
      expect(observed).toMatchObject({
        availability:
          state === "busy" ? "operation_active" : "operation_attention",
        activity: { state },
      });
      expect(observed).not.toHaveProperty("readiness");
      expect(observed).not.toHaveProperty("applicationUrl");
      // A later explicit refresh is new evidence, not blocked by the old one.
      let finishCurrentInspection!: (snapshot: ProjectSnapshot) => void;
      inspections.inspect.mockImplementationOnce(
        () =>
          new Promise<ProjectSnapshot>((resolve) => {
            finishCurrentInspection = resolve;
          }),
      );
      const currentRefresh = provider.refreshWorkspace(key);
      await Promise.resolve();
      expect(provider.inspectionStateFor(key)).toBe("loading");
      finishInspection({ ...initial, availability: oldAvailability });
      expect(await refreshing).toBeUndefined();
      expect(provider.snapshotFor(key)).toBe(observed);
      expect(provider.inspectionStateFor(key)).toBe("loading");
      finishCurrentInspection(initial);
      expect(await currentRefresh).toBe(initial);
      expect(provider.snapshotFor(key)).toBe(initial);
      expect(provider.inspectionStateFor(key)).toBe("idle");
      provider.dispose();
    },
  );

  it("does not start an inspection when newer activity arrives during bootstrap", async () => {
    const provider = new RehearsalTreeProvider(outputChannel() as never);
    const key = vscode.folder.uri.toString();
    (
      provider as unknown as { snapshots: Map<string, ProjectSnapshot> }
    ).snapshots.set(key, {
      workspaceName: "synthetic",
      workspaceRoot: vscode.folder.uri.fsPath,
      availability: "ready",
    });
    let finishBootstrap!: () => void;
    inspections.bootstrap.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          finishBootstrap = resolve;
        }),
    );
    const refreshing = provider.refreshWorkspace(key);
    const busy = {
      schemaVersion: 1,
      state: "busy",
      operation: {
        kind: "open",
        startedAt: "2026-10-18T22:00:00Z",
        rehearsalVersion: "1.0.0",
      },
    };
    provider.publishOperationActivity(key, busy);
    const inspectionChanges = (
      provider as unknown as {
        inspectionChanges: { fire: ReturnType<typeof vi.fn> };
      }
    ).inspectionChanges.fire;
    expect(inspectionChanges.mock.calls).toEqual([
      [{ workspaceKey: key, state: "loading" }],
      [{ workspaceKey: key, state: "idle" }],
    ]);
    provider.publishOperationActivity(key, busy);
    expect(inspectionChanges).toHaveBeenCalledTimes(2);
    finishBootstrap();
    expect(await refreshing).toBeUndefined();
    expect(inspections.inspect).not.toHaveBeenCalled();
    expect(provider.snapshotFor(key)?.availability).toBe("operation_active");
    provider.dispose();
  });

  it("publishes only safe active state and drops inconsistent inspection details", () => {
    const provider = new RehearsalTreeProvider({
      appendLine: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    } as never);
    const key = vscode.folder.uri.toString();
    const snapshot: ProjectSnapshot = {
      workspaceName: "synthetic",
      workspaceRoot: vscode.folder.uri.fsPath,
      availability: "ready",
      readiness: { state: "READY", passed: 1, failed: 0, checks: [] },
      applicationUrl: "http://localhost:5175",
    };
    (
      provider as unknown as { snapshots: Map<string, ProjectSnapshot> }
    ).snapshots.set(key, snapshot);
    provider.publishOperationActivity(key, {
      schemaVersion: 1,
      state: "busy",
      operation: {
        kind: "run",
        startedAt: "2026-10-13T12:00:00Z",
        rehearsalVersion: "0.1.0-rc.4",
      },
    });
    expect(provider.snapshotFor(key)).toMatchObject({
      availability: "operation_active",
      activity: { state: "busy" },
    });
    expect(provider.snapshotFor(key)).not.toHaveProperty("readiness");
    expect(provider.snapshotFor(key)).not.toHaveProperty("applicationUrl");
    provider.publishOperationActivity(key, undefined, "timeout");
    expect(provider.snapshotFor(key)).toMatchObject({
      availability: "error",
      error: {
        code: "activity_monitor_timeout",
        message: expect.stringContaining("Refresh"),
      },
    });
    provider.dispose();
  });

  it("does not publish observed activity into an untrusted or unrelated workspace", () => {
    const provider = new RehearsalTreeProvider(
      {
        appendLine: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
      } as never,
      () => false,
    );
    const key = vscode.folder.uri.toString();
    const snapshot: ProjectSnapshot = {
      workspaceName: "synthetic",
      workspaceRoot: vscode.folder.uri.fsPath,
      availability: "untrusted",
    };
    (
      provider as unknown as { snapshots: Map<string, ProjectSnapshot> }
    ).snapshots.set(key, snapshot);
    provider.publishOperationActivity(key, {
      schemaVersion: 1,
      state: "invalid",
      operation: null,
    });
    provider.publishOperationActivity(
      "file:///different-project",
      undefined,
      "unavailable",
    );
    expect(provider.snapshotFor(key)).toBe(snapshot);
    expect(provider.snapshotFor("file:///different-project")).toBeUndefined();
    provider.dispose();
  });
  it("keeps an explicit dashboard action at the top of the Projects view", () => {
    const output = {
      appendLine: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    };
    const provider = new RehearsalTreeProvider(output as never);

    expect(provider.getChildren()[0]).toMatchObject({
      label: "Open Rehearsal dashboard",
      iconPath: { id: "dashboard" },
      command: {
        command: "rehearsal.openWorkspace",
        title: "Open Rehearsal Dashboard",
      },
    });
    provider.dispose();
  });

  it("refreshes a changed external package once without a window reload", async () => {
    vi.useFakeTimers();
    const output = {
      appendLine: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    };
    const provider = new RehearsalTreeProvider(output as never);
    const refresh = vi
      .spyOn(provider, "refreshWorkspace")
      .mockResolvedValue(undefined);

    expect(vscode.watchers.map(({ pattern }) => pattern)).toEqual(
      PROJECT_REFRESH_PATHS,
    );
    vscode.watchers
      .find(
        ({ pattern }) =>
          pattern === "node_modules/@rehearsal-db/core/package.json",
      )
      ?.change?.();
    vscode.watchers
      .find(({ pattern }) => pattern === "package-lock.json")
      ?.change?.();
    await vi.advanceTimersByTimeAsync(900);

    expect(refresh).toHaveBeenCalledOnce();
    expect(refresh).toHaveBeenCalledWith("file:///workspace/blendCalc");
    provider.dispose();
    expect(
      vscode.watchers.every(({ dispose }) => dispose.mock.calls.length === 1),
    ).toBe(true);
  });

  it.each(["change", "create", "delete"] as const)(
    "refreshes when the explicit configuration receives a %s event",
    async (event) => {
      vi.useFakeTimers();
      const key = vscode.folder.uri.toString();
      vscode.configurationPaths.set(key, "rehearsal.host.config.mjs");
      const provider = new RehearsalTreeProvider(outputChannel() as never);
      const refresh = vi
        .spyOn(provider, "refreshWorkspace")
        .mockResolvedValue(undefined);
      const watcher = vscode.watchers.find(
        ({ pattern }) => pattern === "rehearsal.host.config.mjs",
      );

      expect(watcher?.base).toBe(vscode.folder);
      expect(refresh).not.toHaveBeenCalled();
      watcher?.[event]?.();
      await vi.advanceTimersByTimeAsync(899);
      expect(refresh).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(1);
      expect(refresh).toHaveBeenCalledExactlyOnceWith(key);
      await vi.advanceTimersByTimeAsync(10_000);
      expect(refresh).toHaveBeenCalledOnce();
      provider.dispose();
    },
  );

  it("coalesces custom configuration and ordinary file writes without interpreting globs", async () => {
    vi.useFakeTimers();
    vscode.configurationPaths.set(
      vscode.folder.uri.toString(),
      "configs/[local]/{first,second}*?.mjs",
    );
    const provider = new RehearsalTreeProvider(outputChannel() as never);
    const refresh = vi
      .spyOn(provider, "refreshWorkspace")
      .mockResolvedValue(undefined);
    expect(vscode.watchers).toHaveLength(PROJECT_REFRESH_PATHS.length + 1);
    vscode.watchers
      .find(
        ({ pattern }) =>
          pattern === "configs/[[]local[]]/[{]first,second[}][*][?].mjs",
      )
      ?.change?.();
    await vi.advanceTimersByTimeAsync(600);
    vscode.watchers
      .find(({ pattern }) => pattern === "package.json")
      ?.create?.();
    await vi.advanceTimersByTimeAsync(899);
    expect(refresh).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(refresh).toHaveBeenCalledExactlyOnceWith(
      vscode.folder.uri.toString(),
    );
    provider.dispose();
  });

  it("replaces setting-owned watchers, cancels their pending work, and ignores stale callbacks", async () => {
    vi.useFakeTimers();
    const key = vscode.folder.uri.toString();
    vscode.configurationPaths.set(key, "before.config.mjs");
    const provider = new RehearsalTreeProvider(outputChannel() as never);
    const refresh = vi
      .spyOn(provider, "refreshWorkspace")
      .mockResolvedValue(undefined);
    const settingsRefresh = vi.spyOn(provider, "refresh").mockResolvedValue();
    const replaced = [...vscode.watchers];
    const before = replaced.find(
      ({ pattern }) => pattern === "before.config.mjs",
    );
    before?.change?.();
    await vi.advanceTimersByTimeAsync(600);

    vscode.configurationPaths.set(key, "after.config.mjs");
    configurationChanged();

    expect(settingsRefresh).toHaveBeenCalledOnce();
    expect(
      replaced.every(({ dispose }) => dispose.mock.calls.length === 1),
    ).toBe(true);
    before?.change?.();
    before?.create?.();
    before?.delete?.();
    await vi.advanceTimersByTimeAsync(900);
    expect(refresh).not.toHaveBeenCalled();
    const after = vscode.watchers.find(
      ({ pattern }) => pattern === "after.config.mjs",
    );
    expect(after?.dispose).not.toHaveBeenCalled();
    after?.change?.();
    await vi.advanceTimersByTimeAsync(900);
    expect(refresh).toHaveBeenCalledExactlyOnceWith(key);
    provider.dispose();
    expect(
      vscode.watchers.every(({ dispose }) => dispose.mock.calls.length === 1),
    ).toBe(true);
    after?.change?.();
    await vi.advanceTimersByTimeAsync(900);
    expect(refresh).toHaveBeenCalledOnce();
  });

  it("deduplicates known configuration paths and refuses watchers outside the workspace", () => {
    const key = vscode.folder.uri.toString();
    vscode.configurationPaths.set(key, "./rehearsal.config.mjs");
    const provider = new RehearsalTreeProvider(outputChannel() as never);
    vi.spyOn(provider, "refresh").mockResolvedValue();
    expect(vscode.watchers.map(({ pattern }) => pattern)).toEqual(
      PROJECT_REFRESH_PATHS,
    );

    for (const path of [
      "../other/private.mjs",
      "/other/private.mjs",
      "C:/other/private.mjs",
      "bad\u0000.mjs",
      "x".repeat(501),
    ]) {
      vscode.configurationPaths.set(key, path);
      configurationChanged();
    }

    expect(vscode.watchers.map(({ pattern }) => pattern)).toEqual(
      PROJECT_REFRESH_PATHS,
    );
    expect(
      vscode.watchers.every(({ dispose }) => dispose.mock.calls.length === 0),
    ).toBe(true);
    provider.dispose();
  });

  it("isolates resource-scoped settings and retires removed folders and queued events", async () => {
    vi.useFakeTimers();
    const other = {
      name: "other",
      uri: {
        fsPath: "/workspace/other",
        toString: () => "file:///workspace/other",
      },
    };
    vscode.module.workspace.workspaceFolders = [vscode.folder, other];
    vscode.configurationPaths.set(
      vscode.folder.uri.toString(),
      "first.config.mjs",
    );
    vscode.configurationPaths.set(other.uri.toString(), "second.config.mjs");
    const provider = new RehearsalTreeProvider(outputChannel() as never);
    const refresh = vi
      .spyOn(provider, "refreshWorkspace")
      .mockResolvedValue(undefined);
    vi.spyOn(provider, "refresh").mockResolvedValue();
    const originalFirst = vscode.watchers.filter(
      ({ base }) => base === vscode.folder,
    );
    const originalOther = vscode.watchers.filter(({ base }) => base === other);
    expect(originalFirst.map(({ pattern }) => pattern)).toContain(
      "first.config.mjs",
    );
    expect(originalOther.map(({ pattern }) => pattern)).toContain(
      "second.config.mjs",
    );
    expect(originalOther.map(({ pattern }) => pattern)).not.toContain(
      "first.config.mjs",
    );

    vscode.configurationPaths.set(other.uri.toString(), "third.config.mjs");
    configurationChanged();
    expect(
      originalFirst.every(({ dispose }) => dispose.mock.calls.length === 0),
    ).toBe(true);
    expect(
      originalOther.every(({ dispose }) => dispose.mock.calls.length === 1),
    ).toBe(true);
    originalFirst[0]?.change?.();
    vscode.module.workspace.workspaceFolders = [other];
    vscode.listeners.folders?.();
    expect(
      originalFirst.every(({ dispose }) => dispose.mock.calls.length === 1),
    ).toBe(true);
    originalFirst[0]?.change?.();
    const currentOther = vscode.watchers.find(
      ({ base, pattern }) => base === other && pattern === "third.config.mjs",
    );
    currentOther?.change?.();
    await vi.advanceTimersByTimeAsync(900);
    expect(refresh).toHaveBeenCalledExactlyOnceWith(other.uri.toString());

    vscode.module.workspace.workspaceFolders = [other, vscode.folder];
    vscode.listeners.folders?.();
    const newFirst = vscode.watchers.filter(
      ({ base, dispose }) =>
        base === vscode.folder && dispose.mock.calls.length === 0,
    );
    expect(newFirst.map(({ pattern }) => pattern)).toEqual([
      ...PROJECT_REFRESH_PATHS,
      "first.config.mjs",
    ]);
    newFirst.find(({ pattern }) => pattern === "package-lock.json")?.delete?.();
    await vi.advanceTimersByTimeAsync(900);
    expect(refresh).toHaveBeenLastCalledWith(vscode.folder.uri.toString());
    expect(refresh).toHaveBeenCalledTimes(2);
    provider.dispose();
  });
});
