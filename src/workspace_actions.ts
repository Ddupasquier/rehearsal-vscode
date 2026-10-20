import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { createHash, randomUUID } from "node:crypto";
import {
  lstat,
  mkdir,
  open,
  realpath,
  unlink,
  type FileHandle,
} from "node:fs/promises";
import * as vscode from "vscode";
import {
  assertInspectionPlatform,
  runRehearsalJson,
} from "./process_adapter.js";
import { parseActivityData } from "./contracts.js";
import { EXTENSION_ID } from "./extension_identity.js";
import { terminalShellFamily } from "./platform_runtime.js";
import { isEligibleCoreUpdate } from "./update_advisory.js";
import { parseImageCleanupReview } from "./resource_contract.js";
import { parseStaleStopReview } from "./stale_review.js";
import { createOperationCompletionObserver } from "./operation_completion.js";
import { createActiveOperationMonitor } from "./active_operation_monitor.js";
import {
  shellCommand,
  WORKSPACE_ACTION_IDS,
  workspaceActionPlan,
  exactPackageUpdateArguments,
  type WorkspaceActionId,
} from "./action_catalog.js";
import type { RehearsalTreeProvider } from "./tree_provider.js";
import type { RehearsalReviewPanels } from "./review_panel.js";
import type { ProjectSnapshot } from "./project_snapshot.js";
import {
  activityStorageKey,
  reconcileActivityHistory,
  type WorkspaceActivityRecord,
} from "./workspace_activity.js";

const DOCUMENTATION_URL = "https://ddupasquier.github.io/rehearsal-db/";

const previewCommand = (arguments_: readonly string[]): string => {
  const shell = terminalShellFamily(vscode.env?.shell);
  return shell
    ? shellCommand(arguments_, shell)
    : `Arguments (shell integration required): ${JSON.stringify(arguments_)}`;
};

const ACTION_IDS = new Set<WorkspaceActionId>(WORKSPACE_ACTION_IDS);

const isActionId = (value: unknown): value is WorkspaceActionId =>
  typeof value === "string" && ACTION_IDS.has(value as WorkspaceActionId);

const inside = (root: string, target: string): boolean => {
  const path = relative(root, target);
  return path === "" || (!path.startsWith(`..${sep}`) && path !== "..");
};

interface PackageUpdateLease {
  readonly path: string;
  readonly handle: FileHandle;
}

const ownsPackageUpdateLease = async (
  lease: PackageUpdateLease,
): Promise<boolean> => {
  try {
    const [held, current] = await Promise.all([
      lease.handle.stat(),
      lstat(lease.path),
    ]);
    return (
      held.dev === current.dev && held.ino === current.ino && current.isFile()
    );
  } catch {
    return false;
  }
};

// The file is deliberately not reclaimed by age or PID. An interrupted editor
// cannot prove that the package manager it launched has stopped modifying files.
const releasePackageUpdateLease = async (
  lease: PackageUpdateLease,
): Promise<void> => {
  try {
    const [held, current] = await Promise.all([
      lease.handle.stat(),
      lstat(lease.path),
    ]);
    if (
      held.dev === current.dev &&
      held.ino === current.ino &&
      current.isFile()
    )
      await unlink(lease.path);
  } catch {
    // Missing, replaced or unavailable coordination storage must not be removed.
  } finally {
    await lease.handle.close().catch(() => {});
  }
};

const acquirePackageUpdateLease = async (
  directory: string,
  projectRoot: string,
): Promise<PackageUpdateLease | undefined> => {
  let lease: PackageUpdateLease | undefined;
  try {
    if (!isAbsolute(directory) || resolve(directory) === sep) return;
    await mkdir(directory, { recursive: true, mode: 0o700 });
    const root = await realpath(directory);
    const ownerDirectory = join(root, "package-update-leases");
    await mkdir(ownerDirectory, { mode: 0o700 }).catch(
      (error: NodeJS.ErrnoException) => {
        if (error.code !== "EEXIST") throw error;
      },
    );
    const owner = await lstat(ownerDirectory);
    if (!owner.isDirectory() || owner.isSymbolicLink()) return;
    const project = await realpath(projectRoot);
    const key = createHash("sha256").update(project).digest("hex");
    const path = join(ownerDirectory, `${key}.lock`);
    const handle = await open(path, "wx", 0o600);
    lease = { path, handle };
    await handle.writeFile(JSON.stringify({ version: 1, token: randomUUID() }));
    await handle.sync();
    return lease;
  } catch {
    if (lease) await releasePackageUpdateLease(lease);
    return;
  }
};

export class RehearsalWorkspaceActions implements vscode.Disposable {
  private disposed = false;
  private readonly subscriptions: vscode.Disposable[] = [];
  private readonly terminalWorkspaces = new Map<vscode.Terminal, string>();
  private readonly terminalActivities = new Map<vscode.Terminal, string>();
  private readonly packageUpdateLeases = new Map<
    vscode.Terminal,
    { readonly id: string; readonly lease: PackageUpdateLease }
  >();
  private readonly terminalExecutions = new Map<
    vscode.Terminal,
    vscode.TerminalShellExecution
  >();
  private readonly shellExecutions = new Map<
    vscode.Terminal,
    vscode.TerminalShellExecution
  >();
  private readonly settlingTerminals = new Set<vscode.Terminal>();
  private readonly unverifiedTerminals = new Set<vscode.Terminal>();
  private readonly fallbackTerminals = new Set<vscode.Terminal>();
  private readonly pendingCancellations = new Set<string>();
  private readonly workspaceTokens = new Map<string, string>();
  private readonly completionObservers = new Map<
    string,
    ReturnType<typeof createOperationCompletionObserver>
  >();
  private readonly activityEmitter = new vscode.EventEmitter<string>();
  private readonly activeMonitors = new Map<
    string,
    {
      terminal: vscode.Terminal;
      id: string;
      observer: ReturnType<typeof createActiveOperationMonitor>;
    }
  >();
  private readonly refreshedActivityIds = new Set<string>();
  readonly onDidRecordActivity = this.activityEmitter.event;

  constructor(
    private readonly projects: RehearsalTreeProvider,
    private readonly output: vscode.LogOutputChannel,
    private readonly workspaceState: vscode.Memento,
    private readonly reviews?: RehearsalReviewPanels,
    private readonly mayStartWork: () => boolean = () => true,
    private readonly hostPlatform: () => NodeJS.Platform = () =>
      process.platform,
  ) {
    this.subscriptions.push(
      vscode.workspace.onDidChangeWorkspaceFolders(({ removed }) => {
        for (const folder of removed) {
          const key = folder.uri.toString();
          this.reviews?.releaseWorkspace(key);
          this.completionObservers.get(key)?.dispose();
          this.completionObservers.delete(key);
          this.activeMonitors.get(key)?.observer.dispose();
          this.activeMonitors.delete(key);
          for (const [terminal, owner] of this.terminalWorkspaces) {
            if (owner !== key) continue;
            this.terminalWorkspaces.delete(terminal);
            this.terminalActivities.delete(terminal);
            this.terminalExecutions.delete(terminal);
            this.shellExecutions.delete(terminal);
            this.unverifiedTerminals.delete(terminal);
            this.fallbackTerminals.delete(terminal);
          }
        }
      }),
      vscode.window.onDidCloseTerminal((terminal) => {
        void this.releaseTerminalPackageLease(terminal);
        const workspaceKey = this.terminalWorkspaces.get(terminal);
        if (!workspaceKey) return;
        this.terminalWorkspaces.delete(terminal);
        this.shellExecutions.delete(terminal);
        this.unverifiedTerminals.delete(terminal);
        void this.finishTerminalAction(terminal, workspaceKey, null);
      }),
      vscode.window.onDidStartTerminalShellExecution((event) => {
        if (this.terminalWorkspaces.has(event.terminal))
          this.shellExecutions.set(event.terminal, event.execution);
      }),
      vscode.window.onDidEndTerminalShellExecution((event) => {
        const trackedShell =
          this.shellExecutions.get(event.terminal) === event.execution;
        const trackedAction =
          this.terminalExecutions.get(event.terminal) === event.execution;
        if (trackedShell) this.shellExecutions.delete(event.terminal);
        if (
          event.exitCode === undefined &&
          (trackedShell || trackedAction) &&
          this.terminalWorkspaces.has(event.terminal)
        )
          this.unverifiedTerminals.add(event.terminal);
        const workspaceKey = this.terminalWorkspaces.get(event.terminal);
        if (
          !workspaceKey ||
          !this.terminalExecutions.has(event.terminal) ||
          this.terminalExecutions.get(event.terminal) !== event.execution
        )
          return;
        this.output.info(
          `Rehearsal terminal action ended${event.exitCode === undefined ? "" : ` with exit ${event.exitCode}`}.`,
        );
        void this.finishTerminalAction(
          event.terminal,
          workspaceKey,
          event.exitCode ?? null,
        );
      }),
    );
  }

  registerWorkspace(workspaceKey: string): string {
    const token = randomUUID();
    this.workspaceTokens.set(token, workspaceKey);
    return token;
  }

  releaseWorkspace(token: string): void {
    this.workspaceTokens.delete(token);
  }

  async runToken(token: unknown, action: unknown): Promise<void> {
    if (typeof token !== "string") return;
    const workspaceKey = this.workspaceTokens.get(token);
    if (!workspaceKey) return;
    await this.runWorkspace(workspaceKey, action);
  }

  async runWorkspace(
    workspaceKey: unknown,
    action: unknown,
    resourceTarget?: unknown,
  ): Promise<void> {
    if (typeof workspaceKey !== "string" || !isActionId(action)) return;
    const folder = (vscode.workspace.workspaceFolders ?? []).find(
      ({ uri }) => uri.toString() === workspaceKey,
    );
    if (!folder) {
      void vscode.window.showInformationMessage(
        "That Rehearsal project is no longer open.",
      );
      return;
    }
    const snapshot = this.projects.snapshotFor(workspaceKey);
    if (!snapshot) {
      await this.refresh(workspaceKey, true);
      return;
    }
    const actionSnapshot =
      resourceTarget !== undefined && snapshot.resources
        ? {
            ...snapshot,
            resources: {
              ...snapshot.resources,
              environments: snapshot.resources.environments.filter(
                (entry) => entry.target === resourceTarget,
              ),
            },
          }
        : snapshot;
    let plan = workspaceActionPlan(actionSnapshot, action);
    if (resourceTarget !== undefined) {
      const environment = snapshot.resources?.environments.find(
        (entry) => entry.target === resourceTarget,
      );
      if (
        typeof resourceTarget !== "string" ||
        !environment ||
        !["startRuntime", "stopRuntime", "discardRuntime"].includes(action) ||
        !snapshot.resources?.catalog ||
        !vscode.workspace.isTrusted
      )
        return;
      if (action === "discardRuntime" && environment.protected) {
        void vscode.window.showWarningMessage(
          "Unprotect this environment through its reviewed configuration before discarding its data.",
        );
        return;
      }
      if (plan?.arguments) {
        const volumes = snapshot.resources.catalog.volumes.filter(
          (volume) => volume.target === environment.target,
        );
        plan = {
          ...plan,
          arguments: [...plan.arguments, `--target=${environment.target}`],
          ...(plan.confirmation
            ? {
                confirmation: {
                  ...plan.confirmation,
                  detail: `${plan.confirmation.detail}\n\nSelected environment: ${environment.displayName ?? environment.target}\nImmutable ID: ${environment.projectId}\nContainers: ${environment.containerCount}\nPersistent data volumes: ${volumes.map((v) => v.name).join(", ") || "None observed"}\nShared images: preserved\nCurrent sandbox edits: ${action === "discardRuntime" ? "deleted" : "preserved"}`,
                },
              }
            : {}),
        };
      }
    }
    if (!plan) {
      void vscode.window.showInformationMessage(
        "That action is not available for the project's current state. Refresh Rehearsal and try again.",
      );
      return;
    }

    switch (plan.kind) {
      case "check_updates":
        await vscode.commands.executeCommand(
          "rehearsal.checkUpdates",
          workspaceKey,
        );
        return;
      case "refresh":
        await this.refresh(workspaceKey, true);
        return;
      case "documentation":
        await vscode.env.openExternal(
          vscode.Uri.parse(
            snapshot.error?.code === "platform_unsupported"
              ? `${DOCUMENTATION_URL}getting-started/#windows-use-a-wsl-2-linux-workspace`
              : DOCUMENTATION_URL,
          ),
        );
        return;
      case "show_output":
        this.output.show(true);
        return;
      case "inspection_settings":
        await vscode.commands.executeCommand(
          "workbench.action.openSettings",
          `@ext:${EXTENSION_ID} Rehearsal inspection timeout`,
        );
        return;
      case "cancel_owned_operation":
        await this.cancelOwnedOperation(workspaceKey);
        return;
      case "manage_trust":
        await vscode.commands.executeCommand("workbench.trust.manage");
        return;
      case "open_application":
        if (snapshot.applicationUrl) {
          await vscode.env.openExternal(
            vscode.Uri.parse(snapshot.applicationUrl),
          );
        }
        return;
      case "open_config": {
        if (!snapshot.configPath) return;
        const absolute = resolve(folder.uri.fsPath, snapshot.configPath);
        if (!inside(folder.uri.fsPath, absolute)) {
          void vscode.window.showErrorMessage(
            "Rehearsal refused to open a configuration outside this project.",
          );
          return;
        }
        await vscode.window.showTextDocument(
          await vscode.workspace.openTextDocument(vscode.Uri.file(absolute)),
        );
        return;
      }
      case "terminal":
        if (!this.terminalHostSupported(true) || !this.mayStartWork()) return;
        if (!vscode.workspace.isTrusted) {
          void vscode.window.showWarningMessage(
            "Trust this workspace before running a Rehearsal command.",
          );
          return;
        }
        if (!plan.arguments || plan.arguments.length === 0) return;
        if (plan.confirmation) {
          const selected = await vscode.window.showWarningMessage(
            plan.confirmation.title,
            {
              modal: true,
              detail: `${plan.confirmation.detail}\n\nCommand: ${previewCommand(plan.arguments)}`,
            },
            plan.confirmation.confirmLabel,
          );
          if (selected !== plan.confirmation.confirmLabel) return;
        } else {
          const selected = await vscode.window.showInformationMessage(
            `Run ${plan.label}?`,
            {
              modal: true,
              detail: `${plan.detail}\n\nCommand: ${previewCommand(plan.arguments)}`,
            },
            "Run Command",
          );
          if (selected !== "Run Command") return;
        }
        await this.runInTerminal(
          folder,
          workspaceKey,
          plan.label,
          plan.arguments,
        );
    }
  }

  dispose(): void {
    this.disposed = true;
    for (const subscription of this.subscriptions) subscription.dispose();
    this.terminalWorkspaces.clear();
    this.workspaceTokens.clear();
    this.terminalActivities.clear();
    // Closing the editor is not proof that its npm child has exited. Keep the
    // exclusive file, but do not retain descriptors after disposal.
    for (const { lease } of this.packageUpdateLeases.values())
      void lease.handle.close().catch(() => {});
    this.packageUpdateLeases.clear();
    this.terminalExecutions.clear();
    this.shellExecutions.clear();
    this.settlingTerminals.clear();
    this.unverifiedTerminals.clear();
    this.fallbackTerminals.clear();
    this.pendingCancellations.clear();
    for (const observer of this.completionObservers.values())
      observer.dispose();
    this.completionObservers.clear();
    for (const record of this.activeMonitors.values())
      record.observer.dispose();
    this.activeMonitors.clear();
    this.refreshedActivityIds.clear();
    this.activityEmitter.dispose();
  }

  /** A freshness advisory supplies a checked exact version, never a moving tag. */
  async updatePackageVersion(
    workspaceKey: string,
    installedVersion: string,
    version: string,
    verifyIdentity: () => Promise<boolean>,
    group: import("./update_advisory.js").DependencyGroup,
    options?: {
      readonly automatic?: boolean;
      readonly coordinationDirectory?: string;
    },
  ): Promise<boolean> {
    if (
      !this.terminalHostSupported(options?.automatic !== true) ||
      !this.mayStartWork()
    )
      return false;
    const automatic = options?.automatic === true;
    if (automatic && !options?.coordinationDirectory) return false;
    if (
      !isEligibleCoreUpdate(installedVersion, version) ||
      !["dependencies", "devDependencies", "optionalDependencies"].includes(
        group,
      )
    )
      return false;
    const folder = vscode.workspace.workspaceFolders?.find(
      ({ uri }) => uri.toString() === workspaceKey,
    );
    const snapshot = this.projects.snapshotFor(workspaceKey);
    if (!folder || !snapshot || snapshot.version !== installedVersion)
      return false;
    const manager = snapshot.discovery?.profile.detected.find(
      (item) => item.id === "package.manager",
    )?.value;
    if (
      automatic &&
      (folder.uri.scheme !== "file" ||
        (manager !== undefined && manager !== "npm"))
    )
      return false;
    if (
      automatic &&
      [...this.terminalWorkspaces.entries()].some(
        ([terminal, owner]) =>
          owner === workspaceKey &&
          terminal.exitStatus === undefined &&
          (this.terminalActivities.has(terminal) ||
            this.shellExecutions.has(terminal) ||
            this.unverifiedTerminals.has(terminal) ||
            this.settlingTerminals.has(terminal)),
      )
    ) {
      this.output.info(
        "Automatic Rehearsal package update deferred: the project's terminal is not idle and verified.",
      );
      return false;
    }
    const dependencyFiles = new Set(
      [
        "package.json",
        "package-lock.json",
        "npm-shrinkwrap.json",
        "node_modules/.package-lock.json",
        "node_modules/@rehearsal-db/core/package.json",
      ].map((path) => resolve(folder.uri.fsPath, path)),
    );
    const contextCurrent = () =>
      !this.disposed &&
      this.terminalHostSupported(false) &&
      this.mayStartWork() &&
      vscode.workspace.isTrusted &&
      this.projects.snapshotFor(workspaceKey) === snapshot &&
      Boolean(
        vscode.workspace.workspaceFolders?.some(
          ({ uri }) =>
            uri.toString() === workspaceKey && uri.fsPath === folder.uri.fsPath,
        ),
      ) &&
      (!automatic ||
        !(vscode.workspace.textDocuments ?? []).some(
          (document) =>
            document.isDirty &&
            document.uri.scheme === "file" &&
            dependencyFiles.has(resolve(document.uri.fsPath)),
        ));
    // For automatic calls this callback proves the separate, currently persisted
    // package-update opt-in as well as registry provenance and exact installation.
    const allowed = async () => {
      try {
        if (!contextCurrent() || !(await verifyIdentity()) || !contextCurrent())
          return false;
        const activity = await runRehearsalJson<unknown>({
          workspaceRoot: folder.uri.fsPath,
          command: ["activity"],
          expectedCommand: "activity",
          ...(snapshot.configPath ? { configPath: snapshot.configPath } : {}),
        });
        if (
          !contextCurrent() ||
          parseActivityData(activity.result.data).state !== "idle"
        )
          return false;
        return (await verifyIdentity()) && contextCurrent();
      } catch {
        return false;
      }
    };
    if (!(await allowed())) {
      if (automatic)
        this.output.info(
          "Automatic Rehearsal package update deferred: permission, package identity, idle activity or saved dependency files could not be confirmed.",
        );
      else
        void vscode.window.showInformationMessage(
          "A safe, idle, unchanged package installation could not be confirmed. No update was run; review the current project before retrying.",
        );
      return false;
    }
    const args = [
      ...exactPackageUpdateArguments(version, group),
      ...(automatic
        ? [
            "--ignore-scripts",
            "--no-audit",
            "--no-fund",
            "--registry=https://registry.npmjs.org",
            "--@rehearsal-db:registry=https://registry.npmjs.org",
          ]
        : []),
    ];
    if (!automatic) {
      const choice = await vscode.window.showWarningMessage(
        `Update Rehearsal in ${folder.name} from ${installedVersion} to ${version}?`,
        {
          modal: true,
          detail: `This updates this project's manifest, lockfile and dependencies through its configured package manager/registry. Review the dependency diff afterward. No runtime or data cleanup is requested.\n\nCommand: ${previewCommand(args)}`,
        },
        "Update Exact Version",
      );
      if (choice !== "Update Exact Version") return false;
    }
    if (!(await allowed())) {
      if (automatic)
        this.output.info(
          "Automatic Rehearsal package update deferred: its permission or project state changed before installation.",
        );
      else
        void vscode.window.showInformationMessage(
          "The project, trust or operation changed during review. No update was run; check again before installing.",
        );
      return false;
    }
    const coordinated =
      automatic || options?.coordinationDirectory !== undefined;
    const lease = coordinated
      ? await acquirePackageUpdateLease(
          options!.coordinationDirectory!,
          folder.uri.fsPath,
        )
      : undefined;
    if (coordinated && !lease) {
      this.output.info(
        "Rehearsal package update deferred: exclusive project coordination is unavailable or another update owns it.",
      );
      return false;
    }
    let dispatched = false;
    const authorizeDispatch = async () => {
      if (!(await allowed())) return false;
      if (lease && !(await ownsPackageUpdateLease(lease))) return false;
      return (!lease || (await verifyIdentity())) && contextCurrent();
    };
    try {
      return await this.runInTerminal(
        folder,
        workspaceKey,
        "Update Rehearsal",
        args,
        authorizeDispatch,
        !automatic,
        automatic,
        lease
          ? (terminal, id) => {
              this.packageUpdateLeases.set(terminal, { id, lease });
              dispatched = true;
            }
          : undefined,
      );
    } finally {
      if (lease && !dispatched) await releasePackageUpdateLease(lease);
    }
  }

  activityFor(workspaceKey: string): readonly WorkspaceActivityRecord[] {
    return reconcileActivityHistory(
      this.workspaceState.get(activityStorageKey(workspaceKey)),
      new Set(
        [...this.terminalWorkspaces.entries()]
          .filter(([, key]) => key === workspaceKey)
          .flatMap(([terminal]) => {
            const id = this.terminalActivities.get(terminal);
            return id ? [id] : [];
          }),
      ),
    );
  }

  /** Retained display evidence is not permission after its workspace or source changes. */
  private resourceReviewGuard(
    workspaceKey: string,
    folder: vscode.WorkspaceFolder,
    snapshot: ProjectSnapshot,
    eligible: (current: ProjectSnapshot) => boolean,
  ): () => void {
    const configPath = snapshot.configPath;
    const sourceSha256 = snapshot.configurationMetadata?.sourceSha256;
    const version = snapshot.version;
    const resources = snapshot.resources;
    return () => {
      const current = this.projects.snapshotFor(workspaceKey);
      if (
        this.disposed ||
        !this.mayStartWork() ||
        !vscode.workspace.isTrusted ||
        !current ||
        current !== snapshot ||
        current.configPath !== configPath ||
        current.configurationMetadata?.sourceSha256 !== sourceSha256 ||
        current.version !== version ||
        current.resources !== resources ||
        (current.activity !== undefined && current.activity.state !== "idle") ||
        !vscode.workspace.workspaceFolders?.some(
          (entry) =>
            entry.uri.toString() === workspaceKey &&
            entry.uri.scheme === folder.uri.scheme &&
            entry.uri.fsPath === folder.uri.fsPath,
        ) ||
        !eligible(current)
      )
        throw new Error(
          "The reviewed resource context changed. Refresh and start a new review.",
        );
    };
  }

  async cleanupImages(workspaceKey: string, rawIds: unknown): Promise<void> {
    if (
      !this.mayStartWork() ||
      !vscode.workspace.isTrusted ||
      !Array.isArray(rawIds) ||
      !rawIds.length ||
      rawIds.length > 100 ||
      new Set(rawIds).size !== rawIds.length ||
      rawIds.some(
        (id) => typeof id !== "string" || !/^sha256:[a-f0-9]{64}$/u.test(id),
      )
    )
      return;
    const snapshot = this.projects.snapshotFor(workspaceKey);
    const folder = (vscode.workspace.workspaceFolders ?? []).find(
      (folder) => folder.uri.toString() === workspaceKey,
    );
    if (
      !snapshot ||
      !folder ||
      !snapshot.resources?.catalog ||
      rawIds.some(
        (id) =>
          !snapshot.resources!.catalog!.images.some(
            (image) => image.id === id && image.state === "candidate",
          ),
      )
    )
      return;
    if (!this.reviews) {
      void vscode.window.showInformationMessage(
        "The Rehearsal resource review is unavailable. Reopen the project dashboard and start a fresh review; no removal was requested.",
      );
      return;
    }
    const ids = [...rawIds] as string[];
    const configPath = snapshot.configPath;
    const command = [
      "cleanup",
      "--images-only",
      ...ids.map((id) => `--image-id=${id}`),
    ];
    const canApply = this.resourceReviewGuard(
      workspaceKey,
      folder,
      snapshot,
      (current) =>
        ids.every(
          (id) =>
            current.resources?.catalog?.images.some(
              (image) => image.id === id && image.state === "candidate",
            ) === true,
        ),
    );
    try {
      canApply();
      const result = await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: "Revalidating selected images",
          cancellable: true,
        },
        async (_progress, token) => {
          const abort = new AbortController();
          const subscription = token.onCancellationRequested(() =>
            abort.abort(),
          );
          try {
            return await runRehearsalJson<unknown>({
              workspaceRoot: folder.uri.fsPath,
              command,
              expectedCommand: "cleanup",
              ...(snapshot.configPath
                ? { configPath: snapshot.configPath }
                : {}),
              signal: abort.signal,
              timeoutMs: 90_000,
            });
          } finally {
            subscription.dispose();
          }
        },
      );
      canApply();
      const review = parseImageCleanupReview(result.result.data, ids);
      await this.reviews.review({
        workspaceKey,
        workspaceName: snapshot.workspaceName,
        title: "Review selected image cleanup",
        description:
          "Read the exact image identities, references and estimated recovery before continuing to the final removal confirmation. This review changes no resources.",
        detail: `Core rechecked the exact images below against every running and stopped container.\n\n${review.images.map((image) => `${image.tags.join(", ")}\n${image.id}\n${image.bytes.toLocaleString()} bytes`).join("\n\n")}\n\nEstimated upper bound: ${(review.bytes / 1024 ** 3).toFixed(2)} GiB. Shared layers may reduce recovery.\nContainers: 0\nData volumes: 0\nBaselines: 0\n\nRehearsal revalidates again immediately before removal. No force removal or global pruning is used.`,
        format: "text",
        applyLabel: "Continue to removal confirmation",
        successMessage:
          "Review complete. Check the Rehearsal terminal and refreshed resource evidence for command status. This review alone does not prove the command started or any image was removed.",
        canApply,
        onApply: async () => {
          canApply();
          const selected = await vscode.window.showWarningMessage(
            `Remove ${review.images.length} selected unused image${review.images.length === 1 ? "" : "s"}?`,
            {
              modal: true,
              detail: `Remove only the ${review.images.length} exact images listed in the Rehearsal review.\nEstimated upper bound: ${(review.bytes / 1024 ** 3).toFixed(2)} GiB; shared layers may reduce recovery.\nContainers: 0 · Data volumes: 0 · Baselines: 0\nCore revalidates before removal. No force removal or global pruning.`,
            },
            "Remove Selected Images",
          );
          canApply();
          if (selected !== "Remove Selected Images") return false;
          await this.runInTerminal(
            folder,
            workspaceKey,
            "Remove selected unused images",
            [
              "npx",
              "--no-install",
              "rehearsal",
              ...command,
              "--write",
              `--confirm-cleanup=${review.digest}`,
              ...(configPath ? [`--config=${configPath}`] : []),
            ],
            async () => {
              try {
                canApply();
                return true;
              } catch {
                return false;
              }
            },
          );
        },
      });
    } catch {
      void vscode.window.showErrorMessage(
        "Selected image cleanup could not be completed. Check the project terminal and Activity for any command result before refreshing Local Resources and reviewing again.",
      );
    }
  }

  async clearActivity(workspaceKey: string): Promise<void> {
    await this.workspaceState.update(
      activityStorageKey(workspaceKey),
      undefined,
    );
    this.activityEmitter.fire(workspaceKey);
  }

  async reviewStaleStop(workspaceKey: string): Promise<void> {
    if (!this.mayStartWork() || !vscode.workspace.isTrusted) return;
    const snapshot = this.projects.snapshotFor(workspaceKey);
    const folder = vscode.workspace.workspaceFolders?.find(
      (folder) => folder.uri.toString() === workspaceKey,
    );
    if (!snapshot?.configurationMetadata || !snapshot.resources || !folder)
      return;
    if (!this.reviews) {
      void vscode.window.showInformationMessage(
        "The Rehearsal resource review is unavailable. Reopen the project dashboard and start a fresh review; no stopping was requested.",
      );
      return;
    }
    const configPath = snapshot.configPath;
    const knownTargets = snapshot.resources.environments.map(
      ({ target, projectId }) => ({ target, projectId }),
    );
    const canApply = this.resourceReviewGuard(
      workspaceKey,
      folder,
      snapshot,
      (current) =>
        knownTargets.every(
          (target) =>
            current.resources?.environments.some(
              (entry) =>
                entry.target === target.target &&
                entry.projectId === target.projectId,
            ) === true,
        ),
    );
    try {
      canApply();
      const preview = await runRehearsalJson<unknown>({
        workspaceRoot: folder.uri.fsPath,
        command: ["stop-stale"],
        expectedCommand: "stop-stale",
        ...(snapshot.configPath ? { configPath: snapshot.configPath } : {}),
      });
      canApply();
      const review = parseStaleStopReview(
        preview.result.data,
        snapshot.resources.environments,
      );
      if (!review.targets.length) {
        void vscode.window.showInformationMessage(
          "No configured environment matches the long-running review cutoff. Configure resources.staleAfterSeconds or keep your active sessions running.",
        );
        return;
      }
      await this.reviews.review({
        workspaceKey,
        workspaceName: snapshot.workspaceName,
        title: "Review long-running environments",
        description:
          "Inspect the exact project-owned targets before continuing to the final stop confirmation. This review changes no runtime or data.",
        detail: `${review.targets.map((target) => `${target.displayName} (${target.target})\n${target.projectId}\n${target.containerCount} owned containers · last start/stop ${target.lastActivityAt}`).join("\n\n")}\n\nContainer age does not prove inactivity. Check your active application sessions. Database and Storage contents, all volumes, images, immutable baselines, other projects, and the shared engine remain intact.\n\nCore revalidates the exact context, configuration, container identities and timestamps immediately before each stop.`,
        format: "text",
        applyLabel: "Continue to stop confirmation",
        successMessage:
          "Review complete. Check the Rehearsal terminal and refreshed environment evidence for command status. This review alone does not prove the command started or any environment stopped.",
        canApply,
        onApply: async () => {
          canApply();
          const approved = await vscode.window.showWarningMessage(
            "Stop these exact long-running Rehearsal environments?",
            {
              modal: true,
              detail: `Stop only the ${review.targets.length} exact environments listed in the Rehearsal review. Container age does not prove inactivity. Database and Storage contents, volumes, images and baselines remain intact. Other projects and the shared engine are not stopped. Core revalidates before each stop.`,
            },
            "Stop Reviewed Environments",
          );
          canApply();
          if (approved !== "Stop Reviewed Environments") return false;
          await this.runInTerminal(
            folder,
            workspaceKey,
            "Stop reviewed long-running environments",
            [
              "npx",
              "--no-install",
              "rehearsal",
              "stop-stale",
              `--confirm-stop=${review.digest}`,
              ...(configPath ? [`--config=${configPath}`] : []),
            ],
            async () => {
              try {
                canApply();
                return true;
              } catch {
                return false;
              }
            },
          );
        },
      });
    } catch {
      void vscode.window.showErrorMessage(
        "Long-running environment review could not be completed. Check the project terminal and Activity for any command result before refreshing and reviewing the resource policy or diagnostics.",
      );
    }
  }

  private async refresh(
    workspaceKey: string,
    showProgress: boolean,
  ): Promise<void> {
    const refresh = async (token?: vscode.CancellationToken) => {
      await this.projects.refreshWorkspace(workspaceKey, token);
    };
    if (!showProgress) {
      await refresh();
      return;
    }
    await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: "Refreshing Rehearsal project",
        cancellable: true,
      },
      async (_progress, token) => refresh(token),
    );
  }

  private async runInTerminal(
    folder: vscode.WorkspaceFolder,
    workspaceKey: string,
    label: string,
    arguments_: readonly string[],
    authorize?: () => Promise<boolean>,
    revealTerminal = true,
    requireShellIntegration = false,
    onDispatched?: (terminal: vscode.Terminal, id: string) => void,
  ): Promise<boolean> {
    if (!this.terminalHostSupported(revealTerminal)) return false;
    const canLaunch = () =>
      !this.disposed &&
      this.terminalHostSupported(false) &&
      this.mayStartWork() &&
      vscode.workspace.isTrusted &&
      Boolean(
        vscode.workspace.workspaceFolders?.some(
          ({ uri }) => uri.toString() === workspaceKey,
        ),
      );
    if (!canLaunch() || (authorize && !(await authorize())) || !canLaunch())
      return false;
    const owned = [...this.terminalWorkspaces.entries()]
      .filter(
        ([terminal, owner]) =>
          owner === workspaceKey && terminal.exitStatus === undefined,
      )
      .map(([terminal]) => terminal);
    const busy = owned.find(
      (terminal) =>
        this.terminalActivities.has(terminal) ||
        this.shellExecutions.has(terminal) ||
        this.unverifiedTerminals.has(terminal) ||
        this.settlingTerminals.has(terminal),
    );
    if (busy) {
      if (revealTerminal) busy.show(false);
      const reason = this.fallbackTerminals.has(busy)
        ? "compatibility completion unavailable"
        : this.unverifiedTerminals.has(busy)
          ? "command completion unverified"
          : this.settlingTerminals.has(busy)
            ? "completion refresh pending"
            : this.terminalActivities.has(busy)
              ? "owned command running"
              : "shell command running";
      this.output.warn(`Rehearsal terminal dispatch blocked: ${reason}.`);
      const guidance = {
        "compatibility completion unavailable":
          "VS Code could not track this Rehearsal command because shell integration was unavailable. If it is still running, let it finish. Once it has finished, close that terminal and try again.",
        "command completion unverified":
          "This project's Rehearsal terminal completion is unverified. Finish the current command, then close that terminal and try again.",
        "completion refresh pending":
          "The previous Rehearsal command has ended. Its project check is still finishing; try again when the check finishes.",
        "owned command running":
          "This project's Rehearsal terminal is still busy. Finish the current command before starting another; Ctrl+C or Ctrl+Z closes a sandbox app.",
        "shell command running":
          "A shell command is still running in this project's Rehearsal terminal. Finish it before starting another Rehearsal action.",
      };
      if (revealTerminal)
        void vscode.window.showInformationMessage(guidance[reason]);
      return false;
    }
    const correctDirectory = (terminal: vscode.Terminal) =>
      terminal.shellIntegration?.cwd?.scheme === "file" &&
      terminal.shellIntegration.cwd.toString() === folder.uri.toString();
    const reusable = owned.find(correctDirectory);
    const terminal =
      reusable ??
      vscode.window.createTerminal({
        name: `Rehearsal · ${folder.name}`,
        cwd: folder.uri,
        iconPath: new vscode.ThemeIcon("database"),
        isTransient: true,
      });
    this.terminalWorkspaces.set(terminal, workspaceKey);
    const activity: WorkspaceActivityRecord = {
      id: randomUUID(),
      label,
      startedAt: new Date().toISOString(),
      finishedAt: null,
      outcome: "running",
      exitCode: null,
    };
    this.terminalActivities.set(terminal, activity.id);
    await this.writeActivity(workspaceKey, activity);
    const canDispatch = () =>
      canLaunch() &&
      terminal.exitStatus === undefined &&
      this.terminalWorkspaces.get(terminal) === workspaceKey &&
      this.terminalActivities.get(terminal) === activity.id &&
      !this.shellExecutions.has(terminal) &&
      ((!terminal.shellIntegration?.cwd && !reusable) ||
        correctDirectory(terminal));
    if (!canDispatch()) {
      await this.finishTerminalAction(terminal, workspaceKey, null);
      return false;
    }
    if (revealTerminal) terminal.show(false);
    this.output.info(`Started ${label} for ${folder.name}.`);

    const integration =
      terminal.shellIntegration ??
      (await new Promise<vscode.TerminalShellIntegration | null>(
        (resolvePromise) => {
          let settled = false;
          const subscription =
            vscode.window.onDidChangeTerminalShellIntegration(
              ({ terminal: changedTerminal, shellIntegration }) => {
                if (changedTerminal !== terminal || settled) return;
                settled = true;
                subscription.dispose();
                clearTimeout(timeout);
                resolvePromise(shellIntegration);
              },
            );
          const timeout = setTimeout(() => {
            if (settled) return;
            settled = true;
            subscription.dispose();
            resolvePromise(null);
          }, 5_000);
        },
      ));
    if ((authorize && !(await authorize())) || !canDispatch()) {
      await this.finishTerminalAction(terminal, workspaceKey, null);
      return false;
    }
    // Integration can arrive after the deadline while final authorization awaits.
    // Prefer its current API rather than needlessly entering untracked fallback.
    const currentIntegration = terminal.shellIntegration ?? integration;
    if (requireShellIntegration && !currentIntegration) {
      this.output.info(
        "Automatic Rehearsal package update deferred: verified shell integration is unavailable. No package command was sent.",
      );
      await this.finishTerminalAction(terminal, workspaceKey, null);
      return false;
    }
    if (currentIntegration) {
      this.output.info(`Dispatching ${label} with verified shell integration.`);
      this.terminalExecutions.set(
        terminal,
        currentIntegration.executeCommand(arguments_[0]!, [
          ...arguments_.slice(1),
        ]),
      );
    } else {
      const creation = terminal.creationOptions;
      const shell = terminalShellFamily(
        (creation && "shellPath" in creation
          ? creation.shellPath
          : undefined) ?? vscode.env?.shell,
      );
      if (!shell) {
        this.output.warn(
          "Rehearsal command was not sent: this terminal shell has no verified compatibility quoting.",
        );
        if (revealTerminal)
          void vscode.window.showWarningMessage(
            "Rehearsal did not send this command because shell integration is unavailable and this shell cannot be quoted safely. Use a supported shell with VS Code shell integration. On Windows, open the project with Remote - WSL in a WSL 2 Linux distribution.",
          );
        await this.finishTerminalAction(terminal, workspaceKey, null);
        return false;
      }
      this.output.warn(
        `Shell integration was unavailable after five seconds; ${label} is using compatibility mode. Its exit cannot be verified; once it finishes, close this terminal before another action.`,
      );
      this.fallbackTerminals.add(terminal);
      terminal.sendText(shellCommand(arguments_, shell), true);
    }
    onDispatched?.(terminal, activity.id);
    this.monitorTerminalActivity(folder, workspaceKey, terminal, activity.id);
    return true;
  }

  private terminalHostSupported(showGuidance: boolean): boolean {
    try {
      assertInspectionPlatform(this.hostPlatform());
      return true;
    } catch {
      if (showGuidance)
        void vscode.window.showWarningMessage(
          "Rehearsal did not start a command on native Windows. Open this project in VS Code Remote - WSL using WSL 2 and its Linux home filesystem, then retry there. No terminal, package update or database operation was started.",
        );
      return false;
    }
  }

  private monitorTerminalActivity(
    folder: vscode.WorkspaceFolder,
    workspaceKey: string,
    terminal: vscode.Terminal,
    id: string,
  ): void {
    if (this.disposed) return;
    this.activeMonitors.get(workspaceKey)?.observer.dispose();
    const record = { terminal, id, observer: createActiveOperationMonitor() };
    this.activeMonitors.set(workspaceKey, record);
    const allowed = () =>
      !this.disposed &&
      vscode.workspace.isTrusted &&
      this.activeMonitors.get(workspaceKey) === record &&
      this.terminalActivities.get(terminal) === id &&
      Boolean(
        vscode.workspace.workspaceFolders?.some(
          ({ uri }) => uri.toString() === workspaceKey,
        ),
      );
    void record.observer
      .observe({
        allowed,
        readActivity: async (signal) =>
          (
            await runRehearsalJson<unknown>({
              workspaceRoot: folder.uri.fsPath,
              command: ["activity"],
              expectedCommand: "activity",
              ...(this.projects.snapshotFor(workspaceKey)?.configPath
                ? {
                    configPath:
                      this.projects.snapshotFor(workspaceKey)!.configPath!,
                  }
                : {}),
              signal,
              timeoutMs: 10_000,
            })
          ).result.data,
        publish: (activity) => {
          if (allowed())
            this.projects.publishOperationActivity(workspaceKey, activity);
        },
      })
      .then(async (result) => {
        if (!allowed()) return;
        if (result.state === "idle") {
          this.refreshedActivityIds.add(id);
          await this.refresh(workspaceKey, false);
        } else if (result.state === "timeout" && result.observedBusy) {
          // A long-lived `open` session is expected to outlive bounded monitoring.
          // Reconcile once through public inspection, without extending polling,
          // replaying old project facts or interpreting the deadline as failure.
          await this.refresh(workspaceKey, false);
          if (allowed())
            this.output.info(
              "Live progress monitoring reached its five-minute limit. Rehearsal checked the project again; an open sandbox is not a failed operation.",
            );
        } else if (
          result.state !== "aborted" &&
          !(
            ["stale", "invalid"].includes(result.state) &&
            this.projects.snapshotFor(workspaceKey)?.activity?.state ===
              result.state
          )
        ) {
          this.projects.publishOperationActivity(
            workspaceKey,
            undefined,
            result.state,
          );
          this.output.warn(
            "Live Rehearsal activity observation ended without a verified completion. Use Refresh Project Overview or check the owned terminal.",
          );
        }
      })
      .catch(() => {
        if (allowed())
          this.projects.publishOperationActivity(
            workspaceKey,
            undefined,
            "unavailable",
          );
      })
      .finally(() => {
        record.observer.dispose();
        if (this.activeMonitors.get(workspaceKey) === record)
          this.activeMonitors.delete(workspaceKey);
      });
  }

  private stopTerminalMonitor(
    terminal: vscode.Terminal,
    workspaceKey: string,
  ): void {
    const record = this.activeMonitors.get(workspaceKey);
    if (record?.terminal !== terminal) return;
    record.observer.dispose();
    this.activeMonitors.delete(workspaceKey);
  }

  private async finishTerminalAction(
    terminal: vscode.Terminal,
    workspaceKey: string,
    exitCode: number | null,
  ): Promise<void> {
    if (this.settlingTerminals.has(terminal)) return;
    this.settlingTerminals.add(terminal);
    try {
      this.stopTerminalMonitor(terminal, workspaceKey);
      const id = this.terminalActivities.get(terminal);
      if (!id) return;
      const alreadyRefreshed = this.refreshedActivityIds.delete(id);
      await this.finishActivity(terminal, workspaceKey, exitCode);
      if (!alreadyRefreshed) await this.refresh(workspaceKey, false);
    } finally {
      this.settlingTerminals.delete(terminal);
    }
  }

  private async writeActivity(
    workspaceKey: string,
    record: WorkspaceActivityRecord,
  ): Promise<void> {
    const history = [
      record,
      ...this.activityFor(workspaceKey).filter(({ id }) => id !== record.id),
    ].slice(0, 20);
    await this.workspaceState.update(activityStorageKey(workspaceKey), history);
    this.activityEmitter.fire(workspaceKey);
  }

  private async finishActivity(
    terminal: vscode.Terminal,
    workspaceKey: string,
    exitCode: number | null,
  ): Promise<void> {
    const id = this.terminalActivities.get(terminal);
    if (!id) return;
    if (exitCode !== null) await this.releaseTerminalPackageLease(terminal, id);
    this.terminalActivities.delete(terminal);
    this.terminalExecutions.delete(terminal);
    this.fallbackTerminals.delete(terminal);
    const record = this.activityFor(workspaceKey).find(
      (entry) => entry.id === id,
    );
    if (!record) return;
    await this.writeActivity(workspaceKey, {
      ...record,
      finishedAt: exitCode === null ? null : new Date().toISOString(),
      outcome:
        exitCode === null
          ? "unverified"
          : exitCode === 0
            ? "completed"
            : exitCode === 130
              ? "cancelled"
              : "failed",
      exitCode,
    });
  }

  private async releaseTerminalPackageLease(
    terminal: vscode.Terminal,
    id?: string,
  ): Promise<void> {
    const record = this.packageUpdateLeases.get(terminal);
    if (!record || (id !== undefined && record.id !== id)) return;
    this.packageUpdateLeases.delete(terminal);
    await releasePackageUpdateLease(record.lease);
  }

  private async cancelOwnedOperation(workspaceKey: string): Promise<void> {
    if (this.pendingCancellations.has(workspaceKey) || this.disposed) return;
    this.pendingCancellations.add(workspaceKey);
    try {
      await this.cancelWorkspaceTerminals(workspaceKey);
    } finally {
      this.pendingCancellations.delete(workspaceKey);
    }
  }

  private async cancelWorkspaceTerminals(workspaceKey: string): Promise<void> {
    const terminals = [...this.terminalWorkspaces.entries()]
      .filter(
        ([terminal, key]) =>
          key === workspaceKey &&
          this.terminalActivities.has(terminal) &&
          (this.terminalExecutions.has(terminal) ||
            this.fallbackTerminals.has(terminal)),
      )
      .map(([terminal]) => ({
        terminal,
        activityId: this.terminalActivities.get(terminal),
        execution: this.terminalExecutions.get(terminal),
      }));
    if (terminals.length === 0) {
      void vscode.window.showInformationMessage(
        "No editor-started Rehearsal operation is running for this project.",
      );
      return;
    }
    const selected = await vscode.window.showWarningMessage(
      "Cancel the Rehearsal operation started by this extension?",
      {
        modal: true,
        detail:
          "Only the owned VS Code terminal is closed. Rehearsal handles interruption cleanup and preserves unrelated runtimes.",
      },
      "Cancel Operation",
    );
    if (selected !== "Cancel Operation") return;
    const folder = vscode.workspace.workspaceFolders?.find(
      (folder) => folder.uri.toString() === workspaceKey,
    );
    if (this.disposed || !vscode.workspace.isTrusted || !folder) return;
    const stillOwned = terminals.filter(
      ({ terminal, activityId, execution }) =>
        this.terminalWorkspaces.get(terminal) === workspaceKey &&
        this.terminalActivities.get(terminal) === activityId &&
        this.terminalExecutions.get(terminal) === execution &&
        (execution !== undefined || this.fallbackTerminals.has(terminal)) &&
        (!this.shellExecutions.has(terminal) ||
          this.shellExecutions.get(terminal) === execution),
    );
    if (!stillOwned.length) return;
    for (const { terminal } of stillOwned) {
      this.stopTerminalMonitor(terminal, workspaceKey);
      terminal.dispose();
    }
    if (this.completionObservers.has(workspaceKey)) return;
    const observer = createOperationCompletionObserver({
      allowed: () =>
        !this.disposed &&
        vscode.workspace.isTrusted &&
        Boolean(
          vscode.workspace.workspaceFolders?.some(
            ({ uri }) => uri.toString() === workspaceKey,
          ),
        ),
    });
    this.completionObservers.set(workspaceKey, observer);
    try {
      const configPath = this.projects.snapshotFor(workspaceKey)?.configPath;
      const completion = await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: "Waiting for Rehearsal's owned cleanup",
          cancellable: true,
        },
        async (_progress, token) => {
          const abort = new AbortController();
          const listener = token.onCancellationRequested(() => abort.abort());
          try {
            return await observer.observe(
              async (signal) =>
                (
                  await runRehearsalJson<unknown>({
                    workspaceRoot: folder.uri.fsPath,
                    command: ["activity"],
                    expectedCommand: "activity",
                    ...(configPath ? { configPath } : {}),
                    signal,
                    timeoutMs: 30000,
                  })
                ).result.data,
              abort.signal,
            );
          } finally {
            listener.dispose();
          }
        },
      );
      await this.refresh(workspaceKey, false);
      if (completion.state !== "idle")
        void vscode.window.showWarningMessage(
          "Cleanup outcome is not yet verified. Rehearsal has refreshed its actual activity; review the owning terminal or diagnostics before another change. No unrelated process was stopped.",
        );
    } finally {
      observer.dispose();
      this.completionObservers.delete(workspaceKey);
    }
  }
}
