import { relative, resolve, sep } from "node:path";
import { randomUUID } from "node:crypto";
import * as vscode from "vscode";
import {
  shellCommand,
  WORKSPACE_ACTION_IDS,
  workspaceActionPlan,
  type WorkspaceActionId,
} from "./action_catalog.js";
import type { RehearsalTreeProvider } from "./tree_provider.js";
import {
  activityStorageKey,
  normalizeActivityHistory,
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
  private readonly subscriptions: vscode.Disposable[] = [];
  private readonly terminalWorkspaces = new Map<vscode.Terminal, string>();
  private readonly terminalActivities = new Map<vscode.Terminal, string>();
  private readonly workspaceTokens = new Map<string, string>();
  private readonly activityEmitter = new vscode.EventEmitter<string>();
  readonly onDidRecordActivity = this.activityEmitter.event;

  constructor(
    private readonly projects: RehearsalTreeProvider,
    private readonly output: vscode.LogOutputChannel,
    private readonly workspaceState: vscode.Memento,
  ) {
    this.subscriptions.push(
      vscode.window.onDidCloseTerminal((terminal) => {
        const workspaceKey = this.terminalWorkspaces.get(terminal);
        if (!workspaceKey) return;
        this.terminalWorkspaces.delete(terminal);
        void this.finishActivity(terminal, workspaceKey, null);
        void this.refresh(workspaceKey, false);
      }),
      vscode.window.onDidEndTerminalShellExecution((event) => {
        const workspaceKey = this.terminalWorkspaces.get(event.terminal);
        if (!workspaceKey) return;
        this.output.info(
          `Rehearsal terminal action ended${event.exitCode === undefined ? "" : ` with exit ${event.exitCode}`}.`,
        );
        void this.finishActivity(
          event.terminal,
          workspaceKey,
          event.exitCode ?? null,
        );
        void this.refresh(workspaceKey, false);
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

  async runWorkspace(workspaceKey: unknown, action: unknown): Promise<void> {
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
    const plan = workspaceActionPlan(snapshot, action);
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
    for (const subscription of this.subscriptions) subscription.dispose();
    this.terminalWorkspaces.clear();
    this.workspaceTokens.clear();
    this.terminalActivities.clear();
    this.activityEmitter.dispose();
  }

  activityFor(workspaceKey: string): readonly WorkspaceActivityRecord[] {
    return normalizeActivityHistory(
      this.workspaceState.get(activityStorageKey(workspaceKey)),
    );
  }

  async clearActivity(workspaceKey: string): Promise<void> {
    await this.workspaceState.update(
      activityStorageKey(workspaceKey),
      undefined,
    );
    this.activityEmitter.fire(workspaceKey);
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
    terminal.show(false);
    this.output.info(`Started ${label} for ${folder.name}.`);

    if (terminal.shellIntegration) {
      terminal.shellIntegration.executeCommand(arguments_[0]!, [
        ...arguments_.slice(1),
      ]);
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
      integration.executeCommand(arguments_[0]!, [...arguments_.slice(1)]);
    } else {
      terminal.sendText(shellCommand(arguments_), true);
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
          ? "cancelled"
          : exitCode === 0
            ? "completed"
            : "failed",
      exitCode,
    });
  }

  private async cancelOwnedOperation(workspaceKey: string): Promise<void> {
    const terminals = [...this.terminalWorkspaces.entries()]
      .filter(([, key]) => key === workspaceKey)
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
    for (const terminal of terminals) terminal.dispose();
  }
}
