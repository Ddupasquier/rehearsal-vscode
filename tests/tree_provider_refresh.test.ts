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
  const watchers: {
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
        onDidChangeWorkspaceFolders: vi.fn(() => disposable()),
        onDidGrantWorkspaceTrust: vi.fn(() => disposable()),
        onDidChangeConfiguration: vi.fn(() => disposable()),
        getConfiguration: vi.fn(() => ({
          get: (_key: string, fallback: unknown) => fallback,
        })),
        createFileSystemWatcher: vi.fn((pattern: RelativePattern) => {
          const watcher = {
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

import { PROJECT_REFRESH_PATHS } from "../src/workspace_refresh.js";
import { RehearsalTreeProvider } from "../src/tree_provider.js";

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vscode.watchers.splice(0);
});

describe("RehearsalTreeProvider project watchers", () => {
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
});
