import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";
import {
  mkdtemp,
  readdir,
  readFile,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ProjectSnapshot } from "../src/project_snapshot.js";
import { activityStorageKey } from "../src/workspace_activity.js";
interface ResourceReviewOptions {
  readonly detail: string;
  readonly workspaceKey: string;
  readonly format: "text" | "diff";
  readonly successMessage?: string;
  readonly canApply: () => void;
  readonly onApply: () => Promise<void | boolean>;
}
const mocks = vi.hoisted(() => ({
  trusted: true,
  shell: undefined as string | undefined,
  confirm: vi.fn(),
  error: vi.fn(),
  read: vi.fn(),
  execute: vi.fn(),
  terminal: vi.fn(),
  refresh: vi.fn(),
  publish: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  openExternal: vi.fn(),
  review: vi.fn(),
  reviewApproval: vi.fn(),
  releaseReviewWorkspace: vi.fn(),
  disposeReviews: vi.fn(),
  folders: [] as {
    name: string;
    uri: { scheme: string; fsPath: string; toString: () => string };
  }[],
  documents: [] as {
    isDirty: boolean;
    uri: { scheme: string; fsPath: string };
  }[],
  startListener: undefined as
    ((event: { terminal: unknown; execution: unknown }) => void) | undefined,
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
  env: {
    openExternal: mocks.openExternal,
    get shell() {
      return mocks.shell;
    },
  },
  Uri: { parse: (value: string) => ({ toString: () => value }) },
  workspace: {
    onDidChangeWorkspaceFolders: (listener: typeof mocks.folderListener) => {
      mocks.folderListener = listener;
      return { dispose() {} };
    },
    get isTrusted() {
      return mocks.trusted;
    },
    get workspaceFolders() {
      return mocks.folders;
    },
    get textDocuments() {
      return mocks.documents;
    },
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
    onDidStartTerminalShellExecution: (
      listener: typeof mocks.startListener,
    ) => {
      mocks.startListener = listener;
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
vi.mock("../src/process_adapter.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/process_adapter.js")>()),
  runRehearsalJson: mocks.read,
}));
vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return {
    ...actual,
    // The deterministic VS Code fixture uses this virtual project root. Lease
    // storage itself remains an actual, isolated temporary directory.
    realpath: async (path: string) =>
      path === "/workspace" ? path : actual.realpath(path),
  };
});
vi.mock("../src/review_panel.js", () => ({
  RehearsalReviewPanels: class {
    review = mocks.review;
    releaseWorkspace = mocks.releaseReviewWorkspace;
    dispose = mocks.disposeReviews;
  },
}));
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
let coordinationDirectory: string;
const automaticOptions = () => ({ automatic: true, coordinationDirectory });
const actions = (
  storage = new Map<string, unknown>(),
  onWrite?: () => Promise<void>,
  withReviews = true,
  mayStartWork: () => boolean = () => true,
  hostPlatform: () => NodeJS.Platform = () => process.platform,
) => {
  const runner = new RehearsalWorkspaceActions(
    {
      snapshotFor: () => current,
      refreshWorkspace: mocks.refresh,
      publishOperationActivity: mocks.publish,
    } as never,
    { info: mocks.info, warn: mocks.warn } as never,
    {
      get: (key: string) => storage.get(key),
      update: async (key: string, value: unknown) => {
        storage.set(key, value);
        await onWrite?.();
      },
    } as never,
    withReviews
      ? ({
          review: mocks.review,
          releaseWorkspace: mocks.releaseReviewWorkspace,
          dispose: mocks.disposeReviews,
        } as never)
      : undefined,
    mayStartWork,
    hostPlatform,
  );
  runners.push(runner);
  return runner;
};
afterEach(async () => {
  for (const runner of runners.splice(0)) runner.dispose();
  vi.useRealTimers();
  await rm(coordinationDirectory, { recursive: true, force: true });
});
beforeEach(async () => {
  coordinationDirectory = await mkdtemp(
    join(tmpdir(), "rehearsal-package-updates-"),
  );
  vi.clearAllMocks();
  mocks.trusted = true;
  mocks.shell = undefined;
  mocks.documents = [];
  current = snapshot;
  mocks.folders = [
    {
      name: "fixture",
      uri: {
        scheme: "file",
        fsPath: "/workspace",
        toString: () => "file:///workspace",
      },
    },
  ];
  mocks.closeListener = undefined;
  mocks.startListener = undefined;
  mocks.endListener = undefined;
  mocks.folderListener = undefined;
  mocks.integrationListener = undefined;
  mocks.execute.mockImplementation(() => ({}));
  mocks.confirm.mockImplementation(async (_title, _options, label) => label);
  mocks.reviewApproval.mockReset().mockResolvedValue(true);
  mocks.review.mockImplementation(async (options: ResourceReviewOptions) => {
    options.canApply();
    if (!(await mocks.reviewApproval(options))) return false;
    options.canApply();
    return (await options.onApply()) !== false;
  });
  mocks.terminal.mockReturnValue({
    show: vi.fn(),
    shellIntegration: {
      executeCommand: mocks.execute,
      cwd: mocks.folders[0]!.uri,
    },
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
  it.each(["loading", "ready"] as const)(
    "refuses every native Windows foreground shortcut while %s, independent of inspection",
    async (availability) => {
      current = { ...snapshot, availability };
      const storage = new Map<string, unknown>();
      const runner = actions(
        storage,
        undefined,
        true,
        () => true,
        () => "win32",
      );
      await runner.runWorkspace("file:///workspace", "guidedSetup");
      await runner.runWorkspace("file:///workspace", "doctor");
      expect(mocks.confirm).not.toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ modal: true }),
        expect.any(String),
      );
      expect(mocks.terminal).not.toHaveBeenCalled();
      expect(mocks.execute).not.toHaveBeenCalled();
      expect(mocks.read).not.toHaveBeenCalled();
      expect(storage.size).toBe(0);
    },
  );
  it("refuses automatic native Windows package updates before identity reads, leases or activity writes", async () => {
    const verify = vi.fn(async () => true);
    const storage = new Map<string, unknown>();
    const runner = actions(
      storage,
      undefined,
      true,
      () => true,
      () => "win32",
    );
    expect(
      await runner.updatePackageVersion(
        "file:///workspace",
        "0.1.0-rc.4",
        "0.1.0-rc.8",
        verify,
        "devDependencies",
        automaticOptions(),
      ),
    ).toBe(false);
    expect(verify).not.toHaveBeenCalled();
    expect(mocks.read).not.toHaveBeenCalled();
    expect(mocks.confirm).not.toHaveBeenCalled();
    expect(mocks.terminal).not.toHaveBeenCalled();
    expect(mocks.execute).not.toHaveBeenCalled();
    expect(await readdir(coordinationDirectory)).toEqual([]);
    expect(storage.size).toBe(0);
  });
  it("rechecks actual host before terminal creation after an awaited approval", async () => {
    let platform: NodeJS.Platform = "linux";
    mocks.confirm.mockImplementationOnce(async (_title, _options, label) => {
      platform = "win32";
      return label;
    });
    const storage = new Map<string, unknown>();
    await actions(
      storage,
      undefined,
      true,
      () => true,
      () => platform,
    ).runWorkspace("file:///workspace", "doctor");
    expect(mocks.terminal).not.toHaveBeenCalled();
    expect(mocks.execute).not.toHaveBeenCalled();
    expect(storage.size).toBe(0);
  });
  it("keeps public documentation available on native Windows without terminal authority", async () => {
    await actions(
      new Map(),
      undefined,
      true,
      () => true,
      () => "win32",
    ).runWorkspace("file:///workspace", "documentation");
    expect(mocks.openExternal).toHaveBeenCalledOnce();
    expect(mocks.terminal).not.toHaveBeenCalled();
  });
  it("uses PowerShell-compatible previews and text only for an identified PowerShell fallback", async () => {
    vi.useFakeTimers();
    mocks.shell = "C:\\Program Files\\PowerShell\\7\\pwsh.exe";
    const terminal = {
      show: vi.fn(),
      sendText: vi.fn(),
      dispose: vi.fn(),
      creationOptions: { shellPath: mocks.shell },
    };
    mocks.terminal.mockReturnValue(terminal);
    const launch = actions().runWorkspace(
      "file:///workspace",
      "startRuntime",
      "primary",
    );
    await vi.advanceTimersByTimeAsync(5_000);
    await launch;
    expect(mocks.confirm).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        detail: expect.stringContaining("Command: & 'npx'"),
      }),
      "Start Runtime",
    );
    expect(terminal.sendText).toHaveBeenCalledWith(
      expect.stringMatching(/^& 'npx' '--no-install' 'rehearsal'/u),
      true,
    );
    expect(mocks.execute).not.toHaveBeenCalled();
  });
  it.each(["C:\\Windows\\System32\\cmd.exe", "/usr/bin/unknown-shell"])(
    "refuses compatibility command text in %s without guessing quoting",
    async (shellPath) => {
      vi.useFakeTimers();
      const terminal = {
        show: vi.fn(),
        sendText: vi.fn(),
        dispose: vi.fn(),
        creationOptions: { shellPath },
      };
      mocks.terminal.mockReturnValue(terminal);
      const launch = actions().runWorkspace(
        "file:///workspace",
        "startRuntime",
        "primary",
      );
      await vi.advanceTimersByTimeAsync(5_000);
      await launch;
      expect(terminal.sendText).not.toHaveBeenCalled();
      expect(mocks.execute).not.toHaveBeenCalled();
      expect(mocks.confirm).toHaveBeenCalledWith(
        expect.stringContaining("shell cannot be quoted safely"),
      );
    },
  );
  const prepareStaleReview = () => {
    current = {
      ...snapshot,
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
        ...snapshot.resources!,
        environments: snapshot.resources!.environments.map((entry) => ({
          ...entry,
          state: "running" as const,
          runningContainerCount: 1,
        })),
      },
    };
    const data = {
      mode: "preview",
      plan: {
        schemaVersion: 1,
        action: "stop-stale",
        digest: "c".repeat(64),
        engineIdentity: "d".repeat(64),
        projectRootSha256: "e".repeat(64),
        context: "local",
        preserves: [
          "database contents",
          "Storage contents",
          "containers",
          "volumes",
          "images",
          "immutable baselines",
          "shared engine",
          "other projects",
        ],
        targets: [
          {
            target: "primary",
            projectId: "immutable",
            provider: "postgresql",
            displayName: "My sandbox",
            configurationSha256: "f".repeat(64),
            staleAfterSeconds: 3600,
            lastObservableActivityAt: "2026-01-01T00:00:00Z",
            containers: [
              {
                id: "a".repeat(64),
                running: true,
                startedAt: "2026-01-01T00:00:00Z",
                finishedAt: null,
              },
            ],
          },
        ],
      },
    };
    mocks.read.mockImplementation(async ({ command }) => ({
      result: {
        data:
          command[0] === "activity"
            ? { schemaVersion: 1, state: "idle", operation: null }
            : data,
      },
      exitCode: 0,
    }));
  };
  it("refuses new terminal, package and resource work when identity coexistence is unsafe", async () => {
    prepareStaleReview();
    const runner = actions(new Map(), undefined, true, () => false);
    await runner.runWorkspace("file:///workspace", "startRuntime", "primary");
    expect(
      await runner.updatePackageVersion(
        "file:///workspace",
        "0.1.0-rc.4",
        "0.1.0-rc.8",
        async () => true,
        "devDependencies",
        automaticOptions(),
      ),
    ).toBe(false);
    await runner.cleanupImages("file:///workspace", [id]);
    await runner.reviewStaleStop("file:///workspace");
    expect(mocks.read).not.toHaveBeenCalled();
    expect(mocks.confirm).not.toHaveBeenCalled();
    expect(mocks.review).not.toHaveBeenCalled();
    expect(mocks.terminal).not.toHaveBeenCalled();
    expect(mocks.execute).not.toHaveBeenCalled();
  });
  it.each(["approval", "receipt"] as const)(
    "rechecks identity coexistence after terminal %s before dispatch",
    async (phase) => {
      let allowed = true;
      if (phase === "approval")
        mocks.confirm.mockImplementation(async (_title, _options, label) => {
          allowed = false;
          return label;
        });
      const runner = actions(
        new Map(),
        phase === "receipt"
          ? async () => {
              allowed = false;
            }
          : undefined,
        true,
        () => allowed,
      );
      await runner.runWorkspace("file:///workspace", "startRuntime", "primary");
      expect(mocks.execute).not.toHaveBeenCalled();
      if (phase === "approval") expect(mocks.terminal).not.toHaveBeenCalled();
    },
  );
  it("refuses package installation when identity coexistence changes during approval", async () => {
    let allowed = true;
    mocks.confirm.mockImplementation(async () => {
      allowed = false;
      return "Update Exact Version";
    });
    const runner = actions(new Map(), undefined, true, () => allowed);
    expect(
      await runner.updatePackageVersion(
        "file:///workspace",
        "0.1.0-rc.4",
        "0.1.0-rc.8",
        async () => true,
        "devDependencies",
      ),
    ).toBe(false);
    expect(mocks.terminal).not.toHaveBeenCalled();
    expect(mocks.execute).not.toHaveBeenCalled();
  });
  it.each(["images", "stale"] as const)(
    "refuses %s apply when identity coexistence changes during review",
    async (operation) => {
      if (operation === "stale") prepareStaleReview();
      let allowed = true;
      mocks.reviewApproval.mockImplementationOnce(async () => {
        allowed = false;
        return true;
      });
      const runner = actions(new Map(), undefined, true, () => allowed);
      if (operation === "images")
        await runner.cleanupImages("file:///workspace", [id]);
      else await runner.reviewStaleStop("file:///workspace");
      expect(mocks.confirm).not.toHaveBeenCalled();
      expect(mocks.terminal).not.toHaveBeenCalled();
      expect(mocks.execute).not.toHaveBeenCalled();
    },
  );
  it("keeps explicit cancellation and cleanup observation available after coexistence changes", async () => {
    let allowed = true;
    const runner = actions(new Map(), undefined, true, () => allowed);
    await runner.runWorkspace("file:///workspace", "startRuntime", "primary");
    const terminal = mocks.terminal.mock.results[0]!.value;
    allowed = false;
    expect(terminal.dispose).not.toHaveBeenCalled();
    await runner.runWorkspace("file:///workspace", "cancelOwnedOperation");
    expect(terminal.dispose).toHaveBeenCalledOnce();
    expect(mocks.execute).toHaveBeenCalledOnce();
    expect(mocks.refresh).toHaveBeenCalled();
  });
  it.each([
    ["dependencies", "--save-prod"],
    ["optionalDependencies", "--save-optional"],
  ] as const)(
    "preserves %s and installs an exact checked release",
    async (group, flag) => {
      mocks.confirm.mockResolvedValue("Update Exact Version");
      await actions().updatePackageVersion(
        "file:///workspace",
        "0.1.0-rc.4",
        "0.1.0-rc.8",
        async () => true,
        group,
      );
      expect(mocks.execute).toHaveBeenCalledWith("npm", [
        "install",
        flag,
        "--save-exact",
        "@rehearsal-db/core@0.1.0-rc.8",
      ]);
    },
  );
  it("uses only the checked exact core release after native approval and fresh idle reads", async () => {
    const identity = vi.fn(async () => true);
    mocks.confirm.mockResolvedValue("Update Exact Version");
    await actions().updatePackageVersion(
      "file:///workspace",
      "0.1.0-rc.4",
      "0.1.0-rc.8",
      identity,
      "devDependencies",
    );
    expect(mocks.execute).toHaveBeenCalledWith("npm", [
      "install",
      "--save-dev",
      "--save-exact",
      "@rehearsal-db/core@0.1.0-rc.8",
    ]);
    expect(identity.mock.calls.length).toBeGreaterThanOrEqual(4);
    expect(mocks.read).toHaveBeenCalledWith(
      expect.objectContaining({
        command: ["activity"],
        expectedCommand: "activity",
      }),
    );
    expect(mocks.confirm).toHaveBeenCalledWith(
      expect.stringContaining("0.1.0-rc.8"),
      expect.objectContaining({ modal: true }),
      "Update Exact Version",
    );
  });
  it.each([
    ["dependencies", "--save-prod"],
    ["devDependencies", "--save-dev"],
    ["optionalDependencies", "--save-optional"],
  ] as const)(
    "automatically updates the exact opted-in %s package without scripts, repeated approval or focus stealing",
    async (group, flag) => {
      const verify = vi.fn(async () => true);
      const dispatched = await actions().updatePackageVersion(
        "file:///workspace",
        "0.1.0-rc.4",
        "0.1.0-rc.8",
        verify,
        group,
        automaticOptions(),
      );
      expect(dispatched).toBe(true);
      expect(mocks.confirm).not.toHaveBeenCalled();
      expect(mocks.execute).toHaveBeenCalledWith("npm", [
        "install",
        flag,
        "--save-exact",
        "@rehearsal-db/core@0.1.0-rc.8",
        "--ignore-scripts",
        "--no-audit",
        "--no-fund",
        "--registry=https://registry.npmjs.org",
        "--@rehearsal-db:registry=https://registry.npmjs.org",
      ]);
      expect(mocks.terminal.mock.results[0]!.value.show).not.toHaveBeenCalled();
      expect(verify.mock.calls.length).toBeGreaterThanOrEqual(4);
    },
  );
  it.each([
    "package.json",
    "package-lock.json",
    "npm-shrinkwrap.json",
    "node_modules/.package-lock.json",
    "node_modules/@rehearsal-db/core/package.json",
  ])(
    "defers automatic updates while %s has unsaved editor changes",
    async (path) => {
      mocks.documents = [
        {
          isDirty: true,
          uri: { scheme: "file", fsPath: `/workspace/${path}` },
        },
      ];
      const verify = vi.fn(async () => true);
      await actions().updatePackageVersion(
        "file:///workspace",
        "0.1.0-rc.4",
        "0.1.0-rc.8",
        verify,
        "devDependencies",
        automaticOptions(),
      );
      expect(verify).not.toHaveBeenCalled();
      expect(mocks.read).not.toHaveBeenCalled();
      expect(mocks.terminal).not.toHaveBeenCalled();
      expect(mocks.execute).not.toHaveBeenCalled();
      expect(mocks.confirm).not.toHaveBeenCalled();
    },
  );
  it("fails closed without automatic-update coordination storage", async () => {
    const dispatched = await actions().updatePackageVersion(
      "file:///workspace",
      "0.1.0-rc.4",
      "0.1.0-rc.8",
      async () => true,
      "devDependencies",
      { automatic: true },
    );
    expect(dispatched).toBe(false);
    expect(mocks.read).not.toHaveBeenCalled();
    expect(mocks.execute).not.toHaveBeenCalled();
  });
  it("holds an exclusive project lease after dispatch and releases only its confirmed execution", async () => {
    const first = actions();
    const end = mocks.endListener;
    await first.updatePackageVersion(
      "file:///workspace",
      "0.1.0-rc.4",
      "0.1.0-rc.8",
      async () => true,
      "devDependencies",
      automaticOptions(),
    );
    const directory = join(coordinationDirectory, "package-update-leases");
    const names = await readdir(directory);
    expect(names).toHaveLength(1);
    expect(names[0]).toMatch(/^[a-f0-9]{64}\.lock$/);
    const lock = join(directory, names[0]!);
    expect((await stat(lock)).mode & 0o777).toBe(0o600);
    expect(JSON.parse(await readFile(lock, "utf8"))).toEqual({
      version: 1,
      token: expect.any(String),
    });
    const terminal = mocks.terminal.mock.results[0]!.value;
    const execution = mocks.execute.mock.results[0]!.value;
    const second = actions();
    await second.updatePackageVersion(
      "file:///workspace",
      "0.1.0-rc.4",
      "0.1.0-rc.8",
      async () => true,
      "devDependencies",
      automaticOptions(),
    );
    expect(mocks.execute).toHaveBeenCalledOnce();
    end?.({ terminal, execution: {}, exitCode: 0 });
    expect(await readdir(directory)).toEqual(names);
    end?.({ terminal, execution, exitCode: 0 });
    await vi.waitFor(async () => expect(await readdir(directory)).toEqual([]));
    await second.updatePackageVersion(
      "file:///workspace",
      "0.1.0-rc.4",
      "0.1.0-rc.8",
      async () => true,
      "devDependencies",
      automaticOptions(),
    );
    expect(mocks.execute).toHaveBeenCalledTimes(2);
  });
  it("coordinates manually approved updates with automatic updates while keeping manual arguments and focus", async () => {
    const manual = await actions().updatePackageVersion(
      "file:///workspace",
      "0.1.0-rc.4",
      "0.1.0-rc.8",
      async () => true,
      "devDependencies",
      { coordinationDirectory },
    );
    expect(manual).toBe(true);
    expect(mocks.confirm).toHaveBeenCalledWith(
      expect.stringContaining("0.1.0-rc.8"),
      expect.objectContaining({ modal: true }),
      "Update Exact Version",
    );
    expect(mocks.execute).toHaveBeenCalledWith("npm", [
      "install",
      "--save-dev",
      "--save-exact",
      "@rehearsal-db/core@0.1.0-rc.8",
    ]);
    expect(mocks.terminal.mock.results[0]!.value.show).toHaveBeenCalledOnce();
    const automatic = await actions().updatePackageVersion(
      "file:///workspace",
      "0.1.0-rc.4",
      "0.1.0-rc.8",
      async () => true,
      "devDependencies",
      automaticOptions(),
    );
    expect(automatic).toBe(false);
    expect(mocks.execute).toHaveBeenCalledOnce();
  });
  it("does not reclaim an unverified completion, but releases on its owned terminal closing", async () => {
    const first = actions();
    const end = mocks.endListener;
    const close = mocks.closeListener;
    await first.updatePackageVersion(
      "file:///workspace",
      "0.1.0-rc.4",
      "0.1.0-rc.8",
      async () => true,
      "devDependencies",
      automaticOptions(),
    );
    const directory = join(coordinationDirectory, "package-update-leases");
    const terminal = mocks.terminal.mock.results[0]!.value;
    end?.({ terminal, execution: mocks.execute.mock.results[0]!.value });
    await actions().updatePackageVersion(
      "file:///workspace",
      "0.1.0-rc.4",
      "0.1.0-rc.8",
      async () => true,
      "devDependencies",
      automaticOptions(),
    );
    expect(mocks.execute).toHaveBeenCalledOnce();
    expect(await readdir(directory)).toHaveLength(1);
    close?.(terminal);
    await vi.waitFor(async () => expect(await readdir(directory)).toEqual([]));
  });
  it("preserves a foreign replacement lease when its original execution exits", async () => {
    const runner = actions();
    await runner.updatePackageVersion(
      "file:///workspace",
      "0.1.0-rc.4",
      "0.1.0-rc.8",
      async () => true,
      "devDependencies",
      automaticOptions(),
    );
    const directory = join(coordinationDirectory, "package-update-leases");
    const lock = join(directory, (await readdir(directory))[0]!);
    await rm(lock);
    await writeFile(lock, "replacement", { mode: 0o600 });
    mocks.endListener?.({
      terminal: mocks.terminal.mock.results[0]!.value,
      execution: mocks.execute.mock.results[0]!.value,
      exitCode: 0,
    });
    await vi.waitFor(() =>
      expect(runner.activityFor("file:///workspace")[0]?.outcome).toBe(
        "completed",
      ),
    );
    expect(await readFile(lock, "utf8")).toBe("replacement");
  });
  it("defers when coordination storage is unavailable instead of installing without a lease", async () => {
    const unavailable = join(coordinationDirectory, "not-a-directory");
    await writeFile(unavailable, "owned fixture");
    await actions().updatePackageVersion(
      "file:///workspace",
      "0.1.0-rc.4",
      "0.1.0-rc.8",
      async () => true,
      "devDependencies",
      { automatic: true, coordinationDirectory: unavailable },
    );
    expect(mocks.execute).not.toHaveBeenCalled();
    expect(mocks.terminal).not.toHaveBeenCalled();
    expect(await readFile(unavailable, "utf8")).toBe("owned fixture");
  });
  it("revalidates lease ownership before dispatch and preserves a replacement", async () => {
    let replacement: string | undefined;
    const runner = actions(new Map(), async () => {
      if (replacement) return;
      const directory = join(coordinationDirectory, "package-update-leases");
      replacement = join(directory, (await readdir(directory))[0]!);
      await rm(replacement);
      await writeFile(replacement, "replacement", { mode: 0o600 });
    });
    await runner.updatePackageVersion(
      "file:///workspace",
      "0.1.0-rc.4",
      "0.1.0-rc.8",
      async () => true,
      "devDependencies",
      automaticOptions(),
    );
    expect(mocks.execute).not.toHaveBeenCalled();
    expect(replacement).toBeDefined();
    expect(await readFile(replacement!, "utf8")).toBe("replacement");
  });
  it("does not reclaim a dispatched lease when the extension host is disposed", async () => {
    const runner = actions();
    await runner.updatePackageVersion(
      "file:///workspace",
      "0.1.0-rc.4",
      "0.1.0-rc.8",
      async () => true,
      "devDependencies",
      automaticOptions(),
    );
    runner.dispose();
    await actions().updatePackageVersion(
      "file:///workspace",
      "0.1.0-rc.4",
      "0.1.0-rc.8",
      async () => true,
      "devDependencies",
      automaticOptions(),
    );
    expect(mocks.execute).toHaveBeenCalledOnce();
    expect(
      await readdir(join(coordinationDirectory, "package-update-leases")),
    ).toHaveLength(1);
  });
  it("does not dispatch automatic installs through unverified shell fallback", async () => {
    vi.useFakeTimers();
    const terminal = { show: vi.fn(), sendText: vi.fn(), dispose: vi.fn() };
    mocks.terminal.mockReturnValue(terminal);
    const launch = actions().updatePackageVersion(
      "file:///workspace",
      "0.1.0-rc.4",
      "0.1.0-rc.8",
      async () => true,
      "devDependencies",
      automaticOptions(),
    );
    await vi.waitFor(() => expect(mocks.terminal).toHaveBeenCalledOnce());
    await vi.advanceTimersByTimeAsync(5_000);
    expect(await launch).toBe(false);
    expect(mocks.execute).not.toHaveBeenCalled();
    expect(terminal.sendText).not.toHaveBeenCalled();
    expect(terminal.show).not.toHaveBeenCalled();
    expect(
      await readdir(join(coordinationDirectory, "package-update-leases")),
    ).toEqual([]);
  });
  it("does not treat another project's dirty manifest as this project's update blocker", async () => {
    mocks.documents = [
      {
        isDirty: true,
        uri: { scheme: "file", fsPath: "/other-project/package.json" },
      },
    ];
    await actions().updatePackageVersion(
      "file:///workspace",
      "0.1.0-rc.4",
      "0.1.0-rc.8",
      async () => true,
      "devDependencies",
      automaticOptions(),
    );
    expect(mocks.execute).toHaveBeenCalledOnce();
  });
  it.each([
    "consent",
    "activity",
    "trust",
    "dirty-document",
    "source",
  ] as const)(
    "does not automatically install after %s changes during an idle read",
    async (change) => {
      let permitted = true;
      const verify = vi.fn(async () => permitted);
      mocks.read.mockImplementationOnce(async () => {
        if (change === "consent") permitted = false;
        if (change === "trust") mocks.trusted = false;
        if (change === "source") current = { ...snapshot };
        if (change === "dirty-document")
          mocks.documents = [
            {
              isDirty: true,
              uri: { scheme: "file", fsPath: "/workspace/package-lock.json" },
            },
          ];
        return {
          result: {
            data: {
              schemaVersion: 1,
              state: change === "activity" ? "busy" : "idle",
              operation:
                change === "activity"
                  ? {
                      kind: "run",
                      startedAt: "2026-10-18T12:00:00Z",
                      rehearsalVersion: "0.1.0-rc.4",
                    }
                  : null,
            },
          },
          exitCode: 0,
        };
      });
      await actions().updatePackageVersion(
        "file:///workspace",
        "0.1.0-rc.4",
        "0.1.0-rc.8",
        verify,
        "devDependencies",
        automaticOptions(),
      );
      expect(mocks.execute).not.toHaveBeenCalled();
      expect(mocks.terminal).not.toHaveBeenCalled();
      expect(mocks.confirm).not.toHaveBeenCalled();
    },
  );
  it("rechecks trust after asynchronous consent verification before invoking the CLI", async () => {
    const verify = vi.fn(async () => {
      mocks.trusted = false;
      return true;
    });
    await actions().updatePackageVersion(
      "file:///workspace",
      "0.1.0-rc.4",
      "0.1.0-rc.8",
      verify,
      "devDependencies",
      automaticOptions(),
    );
    expect(mocks.read).not.toHaveBeenCalled();
    expect(mocks.execute).not.toHaveBeenCalled();
  });
  it("rechecks automatic permission after reserving the terminal but before dispatch", async () => {
    let permitted = true;
    const runner = actions(new Map(), async () => {
      permitted = false;
    });
    await runner.updatePackageVersion(
      "file:///workspace",
      "0.1.0-rc.4",
      "0.1.0-rc.8",
      async () => permitted,
      "devDependencies",
      automaticOptions(),
    );
    expect(mocks.execute).not.toHaveBeenCalled();
    expect(mocks.confirm).not.toHaveBeenCalled();
    expect(mocks.terminal.mock.results[0]!.value.show).not.toHaveBeenCalled();
  });
  it("quietly defers automatic updates for an owned running terminal even when core reports idle", async () => {
    const runner = actions();
    await runner.runWorkspace("file:///workspace", "startRuntime", "primary");
    const terminal = mocks.terminal.mock.results[0]!.value;
    mocks.execute.mockClear();
    mocks.confirm.mockClear();
    terminal.show.mockClear();
    const verify = vi.fn(async () => true);
    await runner.updatePackageVersion(
      "file:///workspace",
      "0.1.0-rc.4",
      "0.1.0-rc.8",
      verify,
      "devDependencies",
      automaticOptions(),
    );
    expect(mocks.execute).not.toHaveBeenCalled();
    expect(mocks.terminal).toHaveBeenCalledOnce();
    expect(verify).not.toHaveBeenCalled();
    expect(mocks.confirm).not.toHaveBeenCalled();
    expect(terminal.show).not.toHaveBeenCalled();
  });
  it("refuses automatic updates for another package manager or an unknown registry identity", async () => {
    current = {
      ...snapshot,
      discovery: {
        source: "bootstrap",
        profile: {
          schemaVersion: 1,
          project: { name: "fixture", packageManifest: "present" },
          detected: [
            {
              category: "detected",
              id: "package.manager",
              label: "Package manager",
              value: "pnpm",
              evidence: [],
            },
          ],
          suggested: [],
          decisions: [],
          configuration: {
            state: "missing",
            activePath: null,
            discoveredPaths: [],
            fields: [],
          },
          safety: {
            projectCodeExecuted: false,
            environmentFilesRead: false,
            databaseContacted: false,
            containerEngineStarted: false,
          },
        },
      },
    };
    await actions().updatePackageVersion(
      "file:///workspace",
      "0.1.0-rc.4",
      "0.1.0-rc.8",
      async () => true,
      "devDependencies",
      automaticOptions(),
    );
    current = snapshot;
    await actions().updatePackageVersion(
      "file:///workspace",
      "0.1.0-rc.4",
      "0.1.0-rc.8",
      async () => false,
      "devDependencies",
      automaticOptions(),
    );
    expect(mocks.execute).not.toHaveBeenCalled();
    expect(mocks.confirm).not.toHaveBeenCalled();
  });
  it.each(["0.1.0-rc.3", "latest", "file:local", "0.2.0", "1.0.0"])(
    "does not expand automatic compatibility or registry selectors to %s",
    async (version) => {
      await actions().updatePackageVersion(
        "file:///workspace",
        "0.1.0-rc.4",
        version,
        async () => true,
        "devDependencies",
        automaticOptions(),
      );
      expect(mocks.read).not.toHaveBeenCalled();
      expect(mocks.execute).not.toHaveBeenCalled();
      expect(mocks.confirm).not.toHaveBeenCalled();
    },
  );
  it.each(["trust", "manifest", "activity", "cancel"])(
    "does not update after %s changes/refuses during review",
    async (mode) => {
      const identity = vi.fn(async () => true);
      if (mode === "activity")
        mocks.read.mockResolvedValue({
          result: {
            data: { schemaVersion: 1, state: "invalid", operation: null },
          },
          exitCode: 0,
        });
      mocks.confirm.mockImplementation(async () => {
        if (mode === "trust") mocks.trusted = false;
        if (mode === "manifest") identity.mockResolvedValue(false);
        return mode === "cancel" ? undefined : "Update Exact Version";
      });
      await actions().updatePackageVersion(
        "file:///workspace",
        "0.1.0-rc.4",
        "0.1.0-rc.8",
        identity,
        "devDependencies",
      );
      expect(mocks.terminal).not.toHaveBeenCalled();
      expect(mocks.execute).not.toHaveBeenCalled();
    },
  );
  it.each([
    "0.1.0-rc.4",
    "0.1.0-rc.3",
    "latest",
    "file:local",
    "0.1.0-rc.8+candidate",
    "0.2.0",
    "1.0.0",
  ])("refuses unsafe/non-new exact update selector %s", async (version) => {
    await actions().updatePackageVersion(
      "file:///workspace",
      "0.1.0-rc.4",
      version,
      async () => true,
      "devDependencies",
    );
    expect(mocks.terminal).not.toHaveBeenCalled();
  });
  it("previews exact selected images and runs only the digest-bound image-only command", async () => {
    await actions().cleanupImages("file:///workspace", [id]);
    expect(mocks.read).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceRoot: "/workspace",
        command: ["cleanup", "--images-only", `--image-id=${id}`],
      }),
    );
    expect(mocks.review).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceKey: "file:///workspace",
        format: "text",
        detail: expect.stringContaining("Data volumes: 0"),
      }),
    );
    const review = mocks.review.mock.calls[0]![0] as ResourceReviewOptions;
    expect(review.detail).toContain(id);
    expect(review.detail).toContain(image.tags[0]);
    expect(review.successMessage).toContain(
      "does not prove the command started",
    );
    expect(mocks.confirm).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ modal: true }),
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
  it("does not open a destructive confirmation or dispatch when the resource review is cancelled", async () => {
    mocks.reviewApproval.mockResolvedValueOnce(false);
    await actions().cleanupImages("file:///workspace", [id]);
    expect(mocks.review).toHaveBeenCalledOnce();
    expect(mocks.confirm).not.toHaveBeenCalled();
    expect(mocks.execute).not.toHaveBeenCalled();
  });
  it("rechecks workspace trust before the reviewed image cleanup can reach final confirmation", async () => {
    mocks.reviewApproval.mockImplementationOnce(async () => {
      mocks.trusted = false;
      return true;
    });
    await actions().cleanupImages("file:///workspace", [id]);
    expect(mocks.review).toHaveBeenCalledOnce();
    expect(mocks.confirm).not.toHaveBeenCalled();
    expect(mocks.execute).not.toHaveBeenCalled();
  });
  it("fails closed instead of replacing an unavailable resource review with a legacy modal", async () => {
    await actions(new Map(), undefined, false).cleanupImages(
      "file:///workspace",
      [id],
    );
    expect(mocks.review).not.toHaveBeenCalled();
    expect(mocks.confirm).not.toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ modal: true }),
      "Remove Selected Images",
    );
    expect(mocks.execute).not.toHaveBeenCalled();
  });
  it.each(["approved", "review-cancel", "final-cancel"] as const)(
    "previews exact stale targets in the product and handles %s without broadening stop scope",
    async (outcome) => {
      prepareStaleReview();
      if (outcome === "review-cancel")
        mocks.reviewApproval.mockResolvedValueOnce(false);
      if (outcome === "final-cancel")
        mocks.confirm.mockResolvedValueOnce(undefined);
      await actions().reviewStaleStop("file:///workspace");
      expect(mocks.review).toHaveBeenCalledWith(
        expect.objectContaining({
          workspaceKey: "file:///workspace",
          format: "text",
          detail: expect.stringContaining("My sandbox"),
        }),
      );
      const review = mocks.review.mock.calls[0]![0] as ResourceReviewOptions;
      expect(review.detail).toContain("primary");
      expect(review.detail).toContain(
        "Container age does not prove inactivity",
      );
      if (outcome === "review-cancel")
        expect(mocks.confirm).not.toHaveBeenCalled();
      else
        expect(mocks.confirm).toHaveBeenCalledWith(
          expect.any(String),
          expect.objectContaining({ modal: true }),
          "Stop Reviewed Environments",
        );
      if (outcome === "approved")
        expect(mocks.execute).toHaveBeenCalledWith("npx", [
          "--no-install",
          "rehearsal",
          "stop-stale",
          `--confirm-stop=${"c".repeat(64)}`,
          "--config=rehearsal.config.mjs",
        ]);
      else expect(mocks.execute).not.toHaveBeenCalled();
    },
  );
  it("does not reach stale-stop confirmation after its owning workspace is removed during review", async () => {
    prepareStaleReview();
    mocks.reviewApproval.mockImplementationOnce(async () => {
      mocks.folders = [];
      return true;
    });
    await actions().reviewStaleStop("file:///workspace");
    expect(mocks.review).toHaveBeenCalledOnce();
    expect(mocks.confirm).not.toHaveBeenCalled();
    expect(mocks.execute).not.toHaveBeenCalled();
  });
  it.each(["review", "confirmation"] as const)(
    "rechecks all image-review identity and eligibility boundaries after %s",
    async (phase) => {
      for (const boundary of [
        "trust",
        "folder",
        "snapshot",
        "source",
        "candidate",
        "disposed",
      ] as const) {
        mocks.trusted = true;
        mocks.folders = [
          {
            name: "fixture",
            uri: {
              scheme: "file",
              fsPath: "/workspace",
              toString: () => "file:///workspace",
            },
          },
        ];
        current = {
          ...snapshot,
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
            ...snapshot.resources!,
            catalog: {
              ...snapshot.resources!.catalog!,
              images: snapshot.resources!.catalog!.images.map((image) => ({
                ...image,
              })),
            },
          },
        };
        const runner = actions();
        const mutate = () => {
          if (boundary === "trust") mocks.trusted = false;
          if (boundary === "folder") mocks.folders = [];
          if (boundary === "snapshot") current = { ...current };
          if (boundary === "source")
            Object.assign(current.configurationMetadata!, {
              sourceSha256: "f".repeat(64),
            });
          if (boundary === "candidate")
            Object.assign(current.resources!.catalog!.images[0]!, {
              state: "in-use",
            });
          if (boundary === "disposed") runner.dispose();
        };
        mocks.confirm.mockClear();
        mocks.review.mockClear();
        mocks.execute.mockClear();
        if (phase === "review")
          mocks.reviewApproval.mockImplementationOnce(async () => {
            mutate();
            return true;
          });
        else
          mocks.confirm.mockImplementationOnce(
            async (_title, _options, label) => {
              mutate();
              return label;
            },
          );
        await runner.cleanupImages("file:///workspace", [id]);
        expect(mocks.review).toHaveBeenCalledOnce();
        if (phase === "review") expect(mocks.confirm).not.toHaveBeenCalled();
        else expect(mocks.confirm).toHaveBeenCalledOnce();
        expect(mocks.execute).not.toHaveBeenCalled();
      }
    },
  );
  it("rechecks source identity after the asynchronous terminal receipt write before image-cleanup dispatch", async () => {
    current = {
      ...snapshot,
      configurationMetadata: {
        schemaVersion: 1,
        path: "rehearsal.config.mjs",
        sourceSha256: "a".repeat(64),
        fields: [],
        profiles: [],
        pathResolution: "Project root",
        manualFields: "Manual review",
      },
    };
    const runner = actions(new Map(), async () => {
      Object.assign(current.configurationMetadata!, {
        sourceSha256: "f".repeat(64),
      });
    });
    await runner.cleanupImages("file:///workspace", [id]);
    expect(mocks.terminal).toHaveBeenCalledOnce();
    expect(mocks.execute).not.toHaveBeenCalled();
    expect(runner.activityFor("file:///workspace")[0]?.outcome).toBe(
      "unverified",
    );
  });
  it("does not open a review when ownership evidence changes while the core preview is in flight", async () => {
    mocks.read.mockImplementationOnce(async () => {
      current = { ...snapshot };
      return { result: { data: preview }, exitCode: 0 };
    });
    await actions().cleanupImages("file:///workspace", [id]);
    expect(mocks.review).not.toHaveBeenCalled();
    expect(mocks.confirm).not.toHaveBeenCalled();
    expect(mocks.execute).not.toHaveBeenCalled();
  });
  it("releases resource reviews for removed workspaces", () => {
    actions();
    mocks.folderListener?.({ removed: [mocks.folders[0]!] });
    expect(mocks.releaseReviewWorkspace).toHaveBeenCalledWith(
      "file:///workspace",
    );
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

  it("reconciles a sandbox that outlives monitoring once without turning the deadline into failure or restarting polling", async () => {
    vi.useFakeTimers();
    current = {
      ...snapshot,
      configuration: {
        application: {
          startCommand: "npm run dev",
          proofCommand: "npm test",
          readinessUrl: "http://localhost:43340/health",
        },
        cleanup: { retainBaselineGenerations: 2 },
      },
    };
    const busy = {
      schemaVersion: 1,
      state: "busy",
      operation: {
        kind: "open",
        startedAt: "2026-10-18T22:03:40Z",
        rehearsalVersion: "1.0.0",
      },
    };
    mocks.read.mockResolvedValue({ result: { data: busy }, exitCode: 0 });
    const runner = actions();
    await runner.runWorkspace("file:///workspace", "openSandbox");
    await vi.advanceTimersByTimeAsync(300_000);
    expect(mocks.publish).toHaveBeenCalledWith("file:///workspace", busy);
    expect(
      mocks.publish.mock.calls.every(([, value]) => value !== undefined),
    ).toBe(true);
    expect(mocks.refresh).toHaveBeenCalledOnce();
    expect(mocks.warn).not.toHaveBeenCalled();
    expect(runner.activityFor("file:///workspace")[0]?.outcome).toBe("running");
    const reads = mocks.read.mock.calls.length;
    await vi.advanceTimersByTimeAsync(300_000);
    expect(mocks.read).toHaveBeenCalledTimes(reads);
    expect(mocks.refresh).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
    const terminal = mocks.terminal.mock.results[0]!.value;
    mocks.endListener?.({
      terminal,
      execution: mocks.execute.mock.results[0]!.value,
      exitCode: 0,
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(mocks.refresh).toHaveBeenCalledTimes(2);
    expect(runner.activityFor("file:///workspace")[0]?.outcome).toBe(
      "completed",
    );
  });

  it("retains unavailable evidence if the deadline's final inspection itself fails", async () => {
    vi.useFakeTimers();
    current = {
      ...snapshot,
      configuration: {
        application: {
          startCommand: "npm run dev",
          proofCommand: "npm test",
          readinessUrl: "http://localhost:43340/health",
        },
        cleanup: { retainBaselineGenerations: 2 },
      },
    };
    mocks.read.mockResolvedValue({
      result: {
        data: {
          schemaVersion: 1,
          state: "busy",
          operation: {
            kind: "open",
            startedAt: "2026-10-18T22:03:40Z",
            rehearsalVersion: "1.0.0",
          },
        },
      },
      exitCode: 0,
    });
    mocks.refresh.mockRejectedValueOnce(
      new Error("PRIVATE_INSPECTION_FAILURE"),
    );
    const runner = actions();
    await runner.runWorkspace("file:///workspace", "openSandbox");
    await vi.advanceTimersByTimeAsync(300_000);
    expect(mocks.refresh).toHaveBeenCalledOnce();
    expect(mocks.publish).toHaveBeenLastCalledWith(
      "file:///workspace",
      undefined,
      "unavailable",
    );
    expect(runner.activityFor("file:///workspace")[0]?.outcome).toBe("running");
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

  it("waits for delayed integration, ignores another terminal, and reuses only its completed execution", async () => {
    vi.useFakeTimers();
    const terminal = {
      show: vi.fn(),
      sendText: vi.fn(),
      dispose: vi.fn(),
      shellIntegration: undefined as
        | {
            executeCommand: typeof mocks.execute;
            cwd: (typeof mocks.folders)[number]["uri"];
          }
        | undefined,
    };
    mocks.terminal.mockReturnValue(terminal);
    const runner = actions();
    const launch = runner.runWorkspace(
      "file:///workspace",
      "startRuntime",
      "primary",
    );
    await vi.advanceTimersByTimeAsync(0);
    mocks.integrationListener?.({
      terminal: {},
      shellIntegration: { executeCommand: mocks.execute },
    });
    await vi.advanceTimersByTimeAsync(4_000);
    expect(mocks.execute).not.toHaveBeenCalled();
    expect(terminal.sendText).not.toHaveBeenCalled();
    terminal.shellIntegration = {
      executeCommand: mocks.execute,
      cwd: mocks.folders[0]!.uri,
    };
    mocks.integrationListener?.({
      terminal,
      shellIntegration: terminal.shellIntegration,
    });
    await launch;
    expect(mocks.execute).toHaveBeenCalledOnce();
    expect(terminal.sendText).not.toHaveBeenCalled();
    expect(mocks.info).toHaveBeenCalledWith(
      "Dispatching Start runtime with verified shell integration.",
    );
    const firstExecution = mocks.execute.mock.results[0]!.value;
    mocks.startListener?.({ terminal, execution: firstExecution });
    mocks.endListener?.({ terminal, execution: firstExecution, exitCode: 0 });
    await vi.advanceTimersByTimeAsync(0);
    await runner.runWorkspace("file:///workspace", "startRuntime", "primary");
    expect(mocks.terminal).toHaveBeenCalledOnce();
    expect(mocks.execute).toHaveBeenCalledTimes(2);
    expect(runner.activityFor("file:///workspace")[1]?.outcome).toBe(
      "completed",
    );
    mocks.endListener?.({
      terminal,
      execution: mocks.execute.mock.results[1]!.value,
      exitCode: 0,
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("uses integration arriving after the startup deadline while fresh authorization is pending", async () => {
    vi.useFakeTimers();
    const terminal = {
      show: vi.fn(),
      sendText: vi.fn(),
      dispose: vi.fn(),
      shellIntegration: undefined as
        | {
            executeCommand: typeof mocks.execute;
            cwd: (typeof mocks.folders)[number]["uri"];
          }
        | undefined,
    };
    mocks.terminal.mockReturnValue(terminal);
    const startedAt = Date.now();
    let finishAuthorization: (() => void) | undefined;
    let paused = false;
    const identity = vi.fn(async () => {
      if (!paused && Date.now() - startedAt >= 5_000) {
        paused = true;
        await new Promise<void>((resolve) => {
          finishAuthorization = resolve;
        });
      }
      return true;
    });
    const runner = actions();
    const launch = runner.updatePackageVersion(
      "file:///workspace",
      "0.1.0-rc.4",
      "0.1.0-rc.8",
      identity,
      "devDependencies",
    );
    await vi.advanceTimersByTimeAsync(5_000);
    expect(finishAuthorization).toBeDefined();
    expect(mocks.execute).not.toHaveBeenCalled();
    expect(terminal.sendText).not.toHaveBeenCalled();
    terminal.shellIntegration = {
      executeCommand: mocks.execute,
      cwd: mocks.folders[0]!.uri,
    };
    finishAuthorization?.();
    await launch;
    expect(mocks.execute).toHaveBeenCalledWith("npm", [
      "install",
      "--save-dev",
      "--save-exact",
      "@rehearsal-db/core@0.1.0-rc.8",
    ]);
    expect(terminal.sendText).not.toHaveBeenCalled();
    expect(mocks.warn).not.toHaveBeenCalledWith(
      expect.stringContaining("compatibility mode"),
    );
  });

  it.each(["closed", "trust", "removed", "disposed", "manual"])(
    "does not dispatch or close unrelated shell work after %s invalidates startup waiting",
    async (change) => {
      vi.useFakeTimers();
      const terminal = { show: vi.fn(), sendText: vi.fn(), dispose: vi.fn() };
      mocks.terminal.mockReturnValue(terminal);
      const runner = actions();
      const launch = runner.runWorkspace(
        "file:///workspace",
        "startRuntime",
        "primary",
      );
      await vi.advanceTimersByTimeAsync(1_000);
      expect(terminal.sendText).not.toHaveBeenCalled();
      if (change === "closed") mocks.closeListener?.(terminal);
      else if (change === "trust") mocks.trusted = false;
      else if (change === "removed") {
        const removed = [...mocks.folders];
        mocks.folders = [];
        mocks.folderListener?.({ removed });
      } else if (change === "disposed") runner.dispose();
      else mocks.startListener?.({ terminal, execution: {} });
      await vi.advanceTimersByTimeAsync(4_000);
      await launch;
      expect(mocks.terminal).toHaveBeenCalledOnce();
      expect(mocks.execute).not.toHaveBeenCalled();
      expect(terminal.sendText).not.toHaveBeenCalled();
      expect(terminal.dispose).not.toHaveBeenCalled();
      expect(vi.getTimerCount()).toBe(0);
    },
  );

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
    await vi.advanceTimersByTimeAsync(4_999);
    expect(terminal.sendText).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    await launch;
    expect(terminal.sendText).toHaveBeenCalledOnce();
    expect(mocks.warn).toHaveBeenCalledWith(
      "Shell integration was unavailable after five seconds; Start runtime is using compatibility mode. Its exit cannot be verified; once it finishes, close this terminal before another action.",
    );
    await runner.runWorkspace("file:///workspace", "startRuntime", "primary");
    expect(mocks.terminal).toHaveBeenCalledOnce();
    expect(terminal.sendText).toHaveBeenCalledOnce();
    expect(mocks.warn).toHaveBeenLastCalledWith(
      "Rehearsal terminal dispatch blocked: compatibility completion unavailable.",
    );
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

  it.each([0, 9, 130])(
    "reuses the project terminal after the exact execution ends with %s",
    async (exitCode) => {
      vi.useFakeTimers();
      const runner = actions();
      await runner.runWorkspace("file:///workspace", "startRuntime", "primary");
      const terminal = mocks.terminal.mock.results[0]!.value;
      const previous = mocks.execute.mock.results[0]!.value;
      mocks.endListener?.({ terminal, execution: previous, exitCode });
      await vi.advanceTimersByTimeAsync(0);
      await runner.runWorkspace("file:///workspace", "startRuntime", "primary");
      expect(mocks.terminal).toHaveBeenCalledOnce();
      expect(mocks.execute).toHaveBeenCalledTimes(2);
      expect(terminal.show).toHaveBeenCalledTimes(2);
      const history = runner.activityFor("file:///workspace");
      expect(history).toHaveLength(2);
      expect(history[0]?.outcome).toBe("running");
      expect(history[1]?.exitCode).toBe(exitCode ?? null);
      mocks.endListener?.({ terminal, execution: previous, exitCode: 7 });
      await vi.advanceTimersByTimeAsync(0);
      expect(runner.activityFor("file:///workspace")[0]?.outcome).toBe(
        "running",
      );
    },
  );

  it("does not treat an execution with an unknown exit as safe terminal reuse", async () => {
    vi.useFakeTimers();
    const runner = actions();
    await runner.runWorkspace("file:///workspace", "startRuntime", "primary");
    const terminal = mocks.terminal.mock.results[0]!.value;
    mocks.endListener?.({
      terminal,
      execution: mocks.execute.mock.results[0]!.value,
    });
    await vi.advanceTimersByTimeAsync(0);
    await runner.runWorkspace("file:///workspace", "startRuntime", "primary");
    expect(mocks.terminal).toHaveBeenCalledOnce();
    expect(mocks.execute).toHaveBeenCalledOnce();
    expect(runner.activityFor("file:///workspace")[0]?.outcome).toBe(
      "unverified",
    );
    expect(mocks.confirm).toHaveBeenLastCalledWith(
      expect.stringContaining("completion is unverified"),
    );
    expect(mocks.warn).toHaveBeenLastCalledWith(
      "Rehearsal terminal dispatch blocked: command completion unverified.",
    );
  });

  it("focuses a busy terminal without dispatching a second command, even if core activity is idle", async () => {
    vi.useFakeTimers();
    const runner = actions();
    await runner.runWorkspace("file:///workspace", "startRuntime", "primary");
    await runner.runWorkspace("file:///workspace", "startRuntime", "primary");
    expect(mocks.terminal).toHaveBeenCalledOnce();
    expect(mocks.execute).toHaveBeenCalledOnce();
    expect(mocks.confirm).toHaveBeenLastCalledWith(
      expect.stringContaining("terminal is still busy"),
    );
    expect(mocks.warn).toHaveBeenLastCalledWith(
      "Rehearsal terminal dispatch blocked: owned command running.",
    );
  });

  it("reserves the terminal before simultaneous action launches can overlap", async () => {
    vi.useFakeTimers();
    const runner = actions();
    await Promise.all([
      runner.runWorkspace("file:///workspace", "startRuntime", "primary"),
      runner.runWorkspace("file:///workspace", "startRuntime", "primary"),
    ]);
    expect(mocks.terminal).toHaveBeenCalledOnce();
    expect(mocks.execute).toHaveBeenCalledOnce();
  });

  it("does not interrupt user-started work in a retained terminal or claim its exit", async () => {
    vi.useFakeTimers();
    const runner = actions();
    await runner.runWorkspace("file:///workspace", "startRuntime", "primary");
    const terminal = mocks.terminal.mock.results[0]!.value;
    mocks.endListener?.({
      terminal,
      execution: mocks.execute.mock.results[0]!.value,
      exitCode: 0,
    });
    await vi.advanceTimersByTimeAsync(0);
    const manualExecution = {};
    mocks.startListener?.({ terminal, execution: manualExecution });
    await runner.runWorkspace("file:///workspace", "startRuntime", "primary");
    expect(mocks.execute).toHaveBeenCalledOnce();
    expect(mocks.terminal).toHaveBeenCalledOnce();
    expect(mocks.warn).toHaveBeenLastCalledWith(
      "Rehearsal terminal dispatch blocked: shell command running.",
    );
    await runner.runWorkspace("file:///workspace", "cancelOwnedOperation");
    expect(terminal.dispose).not.toHaveBeenCalled();
    mocks.endListener?.({ terminal, execution: manualExecution, exitCode: 9 });
    await runner.runWorkspace("file:///workspace", "startRuntime", "primary");
    expect(mocks.terminal).toHaveBeenCalledOnce();
    expect(mocks.execute).toHaveBeenCalledTimes(2);
    expect(runner.activityFor("file:///workspace")[1]?.outcome).toBe(
      "completed",
    );
  });

  it.each(["changed", "unknown", "remote"])(
    "uses a fresh correctly scoped terminal when retained cwd is %s",
    async (kind) => {
      vi.useFakeTimers();
      const runner = actions();
      await runner.runWorkspace("file:///workspace", "startRuntime", "primary");
      const first = mocks.terminal.mock.results[0]!.value;
      mocks.endListener?.({
        terminal: first,
        execution: mocks.execute.mock.results[0]!.value,
        exitCode: 0,
      });
      await vi.advanceTimersByTimeAsync(0);
      first.shellIntegration.cwd =
        kind === "unknown"
          ? undefined
          : {
              scheme: kind === "remote" ? "vscode-remote" : "file",
              toString: () => "file:///another-project",
            };
      const second = {
        show: vi.fn(),
        dispose: vi.fn(),
        shellIntegration: {
          executeCommand: mocks.execute,
          cwd: mocks.folders[0]!.uri,
        },
      };
      mocks.terminal.mockReturnValueOnce(second);
      await runner.runWorkspace("file:///workspace", "startRuntime", "primary");
      expect(mocks.terminal).toHaveBeenCalledTimes(2);
      expect(mocks.terminal.mock.calls[1]![0].cwd).toBe(mocks.folders[0]!.uri);
      expect(second.show).toHaveBeenCalledOnce();
      expect(first.dispose).not.toHaveBeenCalled();
    },
  );

  it("rechecks a retained terminal's cwd after asynchronous receipt persistence", async () => {
    vi.useFakeTimers();
    const storage = new Map<string, unknown>();
    const runner = actions(storage);
    await runner.runWorkspace("file:///workspace", "startRuntime", "primary");
    const terminal = mocks.terminal.mock.results[0]!.value;
    mocks.endListener?.({
      terminal,
      execution: mocks.execute.mock.results[0]!.value,
      exitCode: 0,
    });
    await vi.advanceTimersByTimeAsync(0);
    vi.spyOn(storage, "set").mockImplementation((key, value) => {
      terminal.shellIntegration.cwd = {
        scheme: "file",
        toString: () => "file:///another-project",
      };
      return Map.prototype.set.call(storage, key, value);
    });
    await runner.runWorkspace("file:///workspace", "startRuntime", "primary");
    expect(mocks.execute).toHaveBeenCalledOnce();
    expect(terminal.dispose).not.toHaveBeenCalled();
    expect(runner.activityFor("file:///workspace")[0]?.outcome).toBe(
      "unverified",
    );
  });

  it("recreates a closed terminal rather than reusing its name or old ownership", async () => {
    vi.useFakeTimers();
    const runner = actions();
    await runner.runWorkspace("file:///workspace", "startRuntime", "primary");
    const first = mocks.terminal.mock.results[0]!.value;
    mocks.closeListener?.(first);
    await vi.advanceTimersByTimeAsync(0);
    const second = {
      show: vi.fn(),
      dispose: vi.fn(),
      shellIntegration: {
        executeCommand: mocks.execute,
        cwd: mocks.folders[0]!.uri,
      },
    };
    mocks.terminal.mockReturnValueOnce(second);
    await runner.runWorkspace("file:///workspace", "startRuntime", "primary");
    expect(mocks.terminal).toHaveBeenCalledTimes(2);
    expect(second.show).toHaveBeenCalledOnce();
    expect(runner.activityFor("file:///workspace")[1]?.outcome).toBe(
      "unverified",
    );
  });

  it("never lends a terminal to another project or a removed/reopened folder", async () => {
    vi.useFakeTimers();
    const runner = actions();
    await runner.runWorkspace("file:///workspace", "startRuntime", "primary");
    const first = mocks.terminal.mock.results[0]!.value;
    mocks.endListener?.({
      terminal: first,
      execution: mocks.execute.mock.results[0]!.value,
      exitCode: 0,
    });
    await vi.advanceTimersByTimeAsync(0);
    const secondFolder = {
      name: "second",
      uri: {
        scheme: "file",
        fsPath: "/second",
        toString: () => "file:///second",
      },
    };
    mocks.folders.push(secondFolder);
    const second = {
      show: vi.fn(),
      dispose: vi.fn(),
      shellIntegration: {
        executeCommand: mocks.execute,
        cwd: secondFolder.uri,
      },
    };
    mocks.terminal.mockReturnValueOnce(second);
    await runner.runWorkspace("file:///second", "startRuntime", "primary");
    expect(mocks.terminal).toHaveBeenCalledTimes(2);
    expect(mocks.terminal.mock.calls[1]![0].cwd).toBe(secondFolder.uri);
    mocks.folderListener?.({ removed: [mocks.folders[0]!] });
    mocks.terminal.mockReturnValueOnce({
      show: vi.fn(),
      dispose: vi.fn(),
      shellIntegration: {
        executeCommand: mocks.execute,
        cwd: mocks.folders[0]!.uri,
      },
    });
    await runner.runWorkspace("file:///workspace", "startRuntime", "primary");
    expect(mocks.terminal).toHaveBeenCalledTimes(3);
    expect(first.dispose).not.toHaveBeenCalled();
    expect(second.dispose).not.toHaveBeenCalled();
  });

  it("waits for completion persistence/refresh before allowing terminal reuse", async () => {
    vi.useFakeTimers();
    const runner = actions();
    await runner.runWorkspace("file:///workspace", "startRuntime", "primary");
    const terminal = mocks.terminal.mock.results[0]!.value;
    let finishRefresh: (() => void) | undefined;
    mocks.refresh.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          finishRefresh = resolve;
        }),
    );
    mocks.endListener?.({
      terminal,
      execution: mocks.execute.mock.results[0]!.value,
      exitCode: 0,
    });
    await vi.advanceTimersByTimeAsync(0);
    await runner.runWorkspace("file:///workspace", "startRuntime", "primary");
    expect(mocks.execute).toHaveBeenCalledOnce();
    expect(mocks.warn).toHaveBeenLastCalledWith(
      "Rehearsal terminal dispatch blocked: completion refresh pending.",
    );
    finishRefresh?.();
    await vi.advanceTimersByTimeAsync(0);
    await runner.runWorkspace("file:///workspace", "startRuntime", "primary");
    expect(mocks.execute).toHaveBeenCalledTimes(2);
    expect(mocks.terminal).toHaveBeenCalledOnce();
  });

  it("cannot cancel a newer execution reused during an older cancellation modal", async () => {
    vi.useFakeTimers();
    const runner = actions();
    await runner.runWorkspace("file:///workspace", "startRuntime", "primary");
    const terminal = mocks.terminal.mock.results[0]!.value;
    const previous = mocks.execute.mock.results[0]!.value;
    let approve: ((value: string) => void) | undefined;
    mocks.confirm.mockImplementation(async (title, _options, label) =>
      title === "Cancel the Rehearsal operation started by this extension?"
        ? new Promise<string>((resolve) => {
            approve = resolve;
          })
        : label,
    );
    const cancellation = runner.runWorkspace(
      "file:///workspace",
      "cancelOwnedOperation",
    );
    mocks.endListener?.({ terminal, execution: previous, exitCode: 0 });
    await vi.advanceTimersByTimeAsync(0);
    await runner.runWorkspace("file:///workspace", "startRuntime", "primary");
    approve?.("Cancel Operation");
    await cancellation;
    expect(mocks.terminal).toHaveBeenCalledOnce();
    expect(mocks.execute).toHaveBeenCalledTimes(2);
    expect(terminal.dispose).not.toHaveBeenCalled();
    expect(runner.activityFor("file:///workspace")[0]?.outcome).toBe("running");
  });

  it("cannot close a manual shell command started while an owned launch is waiting for persistence", async () => {
    vi.useFakeTimers();
    let finishWrite: (() => void) | undefined;
    const pause = new Promise<void>((resolve) => {
      finishWrite = resolve;
    });
    const runner = actions(new Map(), () => pause);
    const launch = runner.runWorkspace(
      "file:///workspace",
      "startRuntime",
      "primary",
    );
    await vi.advanceTimersByTimeAsync(0);
    const terminal = mocks.terminal.mock.results[0]!.value;
    mocks.startListener?.({ terminal, execution: {} });
    await runner.runWorkspace("file:///workspace", "cancelOwnedOperation");
    expect(terminal.dispose).not.toHaveBeenCalled();
    expect(mocks.execute).not.toHaveBeenCalled();
    finishWrite?.();
    await launch;
    expect(terminal.dispose).not.toHaveBeenCalled();
    expect(mocks.execute).not.toHaveBeenCalled();
  });

  it("cannot close a manual shell execution that starts during cancellation review", async () => {
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
    const cancellation = runner.runWorkspace(
      "file:///workspace",
      "cancelOwnedOperation",
    );
    mocks.startListener?.({ terminal, execution: {} });
    approve?.("Cancel Operation");
    await cancellation;
    expect(terminal.dispose).not.toHaveBeenCalled();
    expect(runner.activityFor("file:///workspace")[0]?.outcome).toBe("running");
  });

  it("does not dispatch after the terminal closes during a launch reservation", async () => {
    vi.useFakeTimers();
    let finishWrite: (() => void) | undefined;
    const pause = new Promise<void>((resolve) => {
      finishWrite = resolve;
    });
    const runner = actions(new Map(), () => pause);
    const launch = runner.runWorkspace(
      "file:///workspace",
      "startRuntime",
      "primary",
    );
    await vi.advanceTimersByTimeAsync(0);
    const terminal = mocks.terminal.mock.results[0]!.value;
    mocks.closeListener?.(terminal);
    finishWrite?.();
    await launch;
    await vi.advanceTimersByTimeAsync(0);
    expect(mocks.execute).not.toHaveBeenCalled();
    expect(runner.activityFor("file:///workspace")[0]?.outcome).toBe(
      "unverified",
    );
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
