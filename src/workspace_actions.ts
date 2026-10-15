import { relative, resolve, sep } from "node:path";
import { randomUUID } from "node:crypto";
import * as vscode from "vscode";
import { runRehearsalJson } from "./process_adapter.js";
import { parseImageCleanupReview } from "./resource_contract.js";
import { parseStaleStopReview } from "./stale_review.js";
import { createOperationCompletionObserver } from "./operation_completion.js";
import { createActiveOperationMonitor } from "./active_operation_monitor.js";
import {
  shellCommand,
  WORKSPACE_ACTION_IDS,
  workspaceActionPlan,
  type WorkspaceActionId,
} from "./action_catalog.js";
import type { RehearsalTreeProvider } from "./tree_provider.js";
import {
  activityStorageKey,
  reconcileActivityHistory,
  type WorkspaceActivityRecord,
} from "./workspace_activity.js";

const DOCUMENTATION_URL = "https://ddupasquier.github.io/rehearsal-db/";

const ACTION_IDS = new Set<WorkspaceActionId>(WORKSPACE_ACTION_IDS);

const isActionId = (value: unknown): value is WorkspaceActionId =>
  typeof value === "string" && ACTION_IDS.has(value as WorkspaceActionId);

const inside = (root: string, target: string): boolean => {
  const path = relative(root, target);
  return path === "" || (!path.startsWith(`..${sep}`) && path !== "..");
};

export class RehearsalWorkspaceActions implements vscode.Disposable {
  private disposed = false;
  private readonly subscriptions: vscode.Disposable[] = [];
  private readonly terminalWorkspaces = new Map<vscode.Terminal, string>();
  private readonly terminalActivities = new Map<vscode.Terminal, string>();
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
  ) {
    this.subscriptions.push(
      vscode.workspace.onDidChangeWorkspaceFolders(({ removed }) => {
        for (const folder of removed) {
          const key = folder.uri.toString();
          this.completionObservers.get(key)?.dispose();
          this.completionObservers.delete(key);
          this.activeMonitors.get(key)?.observer.dispose();
          this.activeMonitors.delete(key);
        }
      }),
      vscode.window.onDidCloseTerminal((terminal) => {
        const workspaceKey = this.terminalWorkspaces.get(terminal);
        if (!workspaceKey) return;
        this.terminalWorkspaces.delete(terminal);
        void this.finishTerminalAction(terminal, workspaceKey, null);
      }),
      vscode.window.onDidEndTerminalShellExecution((event) => {
        const workspaceKey = this.terminalWorkspaces.get(event.terminal);
        if (!workspaceKey) return;
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
      case "refresh":
        await this.refresh(workspaceKey, true);
        return;
      case "documentation":
        await vscode.env.openExternal(vscode.Uri.parse(DOCUMENTATION_URL));
        return;
      case "show_output":
        this.output.show(true);
        return;
      case "inspection_settings":
        await vscode.commands.executeCommand(
          "workbench.action.openSettings",
          "@ext:rehearsal-db.rehearsal Rehearsal inspection timeout",
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
              detail: `${plan.confirmation.detail}\n\nCommand: ${shellCommand(plan.arguments)}`,
            },
            plan.confirmation.confirmLabel,
          );
          if (selected !== plan.confirmation.confirmLabel) return;
        } else {
          const selected = await vscode.window.showInformationMessage(
            `Run ${plan.label}?`,
            {
              modal: true,
              detail: `${plan.detail}\n\nCommand: ${shellCommand(plan.arguments)}`,
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
    for (const observer of this.completionObservers.values())
      observer.dispose();
    this.completionObservers.clear();
    for (const record of this.activeMonitors.values())
      record.observer.dispose();
    this.activeMonitors.clear();
    this.refreshedActivityIds.clear();
    this.activityEmitter.dispose();
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

  async cleanupImages(workspaceKey: string, rawIds: unknown): Promise<void> {
    if (
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
    const ids = rawIds as string[];
    const command = [
      "cleanup",
      "--images-only",
      ...ids.map((id) => `--image-id=${id}`),
    ];
    try {
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
      const review = parseImageCleanupReview(result.result.data, ids);
      const selected = await vscode.window.showWarningMessage(
        `Remove ${review.images.length} selected unused image${review.images.length === 1 ? "" : "s"}?`,
        {
          modal: true,
          detail: `Core rechecked the exact images below against every running and stopped container.\n\n${review.images.map((image) => `${image.tags.join(", ")}\n${image.id}\n${image.bytes.toLocaleString()} bytes`).join("\n\n")}\n\nEstimated upper bound: ${(review.bytes / 1024 ** 3).toFixed(2)} GiB. Shared layers may reduce recovery.\nContainers: 0\nData volumes: 0\nBaselines: 0\n\nRehearsal revalidates again immediately before removal. No force removal or global pruning is used.`,
        },
        "Remove Selected Images",
      );
      if (selected !== "Remove Selected Images") return;
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
          ...(snapshot.configPath ? [`--config=${snapshot.configPath}`] : []),
        ],
      );
    } catch {
      void vscode.window.showErrorMessage(
        "Selected image cleanup could not be verified. Nothing was requested for removal. Refresh Local Resources and preview again.",
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
    if (!vscode.workspace.isTrusted) return;
    const snapshot = this.projects.snapshotFor(workspaceKey);
    const folder = vscode.workspace.workspaceFolders?.find(
      (folder) => folder.uri.toString() === workspaceKey,
    );
    if (!snapshot?.configurationMetadata || !snapshot.resources || !folder)
      return;
    try {
      const preview = await runRehearsalJson<unknown>({
        workspaceRoot: folder.uri.fsPath,
        command: ["stop-stale"],
        expectedCommand: "stop-stale",
        ...(snapshot.configPath ? { configPath: snapshot.configPath } : {}),
      });
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
      const approved = await vscode.window.showWarningMessage(
        "Stop these exact long-running Rehearsal environments?",
        {
          modal: true,
          detail: `${review.targets.map((target) => `${target.displayName} (${target.target})\n${target.containerCount} owned containers · last start/stop ${target.lastActivityAt}`).join("\n\n")}\n\nContainer age does not prove inactivity. Check your active application sessions. Database and Storage contents, all volumes, images, immutable baselines, other projects, and the shared engine remain intact.\n\nCore revalidates the exact context, configuration, container identities and timestamps immediately before each stop.`,
        },
        "Stop Reviewed Environments",
      );
      if (approved !== "Stop Reviewed Environments") return;
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
          ...(snapshot.configPath ? [`--config=${snapshot.configPath}`] : []),
        ],
      );
    } catch {
      void vscode.window.showErrorMessage(
        "Long-running environments could not be verified. Nothing was requested for stopping. Refresh and review the resource policy or diagnostics.",
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
  ): Promise<void> {
    const canLaunch = () =>
      !this.disposed &&
      vscode.workspace.isTrusted &&
      Boolean(
        vscode.workspace.workspaceFolders?.some(
          ({ uri }) => uri.toString() === workspaceKey,
        ),
      );
    if (!canLaunch()) return;
    const terminal = vscode.window.createTerminal({
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
    if (!canLaunch()) return;
    terminal.show(false);
    this.output.info(`Started ${label} for ${folder.name}.`);

    if (terminal.shellIntegration) {
      terminal.shellIntegration.executeCommand(arguments_[0]!, [
        ...arguments_.slice(1),
      ]);
      this.monitorTerminalActivity(folder, workspaceKey, terminal, activity.id);
      return;
    }

    const integration =
      await new Promise<vscode.TerminalShellIntegration | null>(
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
          }, 1_500);
        },
      );
    if (integration) {
      if (!canLaunch()) return;
      integration.executeCommand(arguments_[0]!, [...arguments_.slice(1)]);
    } else {
      if (!canLaunch()) return;
      terminal.sendText(shellCommand(arguments_), true);
    }
    this.monitorTerminalActivity(folder, workspaceKey, terminal, activity.id);
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
    this.stopTerminalMonitor(terminal, workspaceKey);
    const id = this.terminalActivities.get(terminal);
    if (!id) return;
    const alreadyRefreshed = this.refreshedActivityIds.delete(id);
    await this.finishActivity(terminal, workspaceKey, exitCode);
    if (!alreadyRefreshed) await this.refresh(workspaceKey, false);
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
    this.terminalActivities.delete(terminal);
    const record = this.activityFor(workspaceKey).find(
      (entry) => entry.id === id,
    );
    if (!record) return;
    await this.writeActivity(workspaceKey, {
      ...record,
      finishedAt: new Date().toISOString(),
      outcome:
        exitCode === null
          ? "unverified"
          : exitCode === 0
            ? "completed"
            : "failed",
      exitCode,
    });
  }

  private async cancelOwnedOperation(workspaceKey: string): Promise<void> {
    const terminals = [...this.terminalWorkspaces.entries()]
      .filter(
        ([terminal, key]) =>
          key === workspaceKey && this.terminalActivities.has(terminal),
      )
      .map(([terminal]) => terminal);
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
    for (const terminal of terminals) {
      this.stopTerminalMonitor(terminal, workspaceKey);
      terminal.dispose();
    }
    if (this.completionObservers.has(workspaceKey)) return;
    const folder = vscode.workspace.workspaceFolders?.find(
      (folder) => folder.uri.toString() === workspaceKey,
    );
    if (!folder) return;
    const observer = createOperationCompletionObserver();
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
