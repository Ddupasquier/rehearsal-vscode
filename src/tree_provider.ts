import * as vscode from "vscode";
import { inspectProject } from "./project_snapshot.js";
import type { ProjectSnapshot } from "./project_snapshot.js";
import { overviewItemAccessibilityLabel, overviewItems } from "./tree_model.js";
import type { OverviewItem } from "./tree_model.js";

type TreeNode = WorkspaceNode | DetailNode;

class WorkspaceNode extends vscode.TreeItem {
  readonly kind = "workspace";

  constructor(
    readonly folder: vscode.WorkspaceFolder,
    readonly snapshot: ProjectSnapshot | undefined,
  ) {
    super(folder.name, vscode.TreeItemCollapsibleState.Expanded);
    this.id = `workspace:${folder.uri.toString()}`;
    this.contextValue = "rehearsalWorkspace";
    this.iconPath = new vscode.ThemeIcon("folder-library");
    if (snapshot?.version) this.description = snapshot.version;
    this.tooltip = snapshot
      ? `${folder.name}: ${snapshot.availability.replaceAll("_", " ")}`
      : `${folder.name}: refresh to inspect Rehearsal`;
    this.accessibilityInformation = {
      label: snapshot?.version
        ? `${folder.name}, Rehearsal ${snapshot.version}`
        : folder.name,
    };
  }
}

class DetailNode extends vscode.TreeItem {
  readonly kind = "detail";

  constructor(
    readonly workspace: WorkspaceNode,
    readonly detail: OverviewItem,
  ) {
    super(detail.label, vscode.TreeItemCollapsibleState.None);
    this.id = `${workspace.id}:${detail.id}`;
    if (detail.description) this.description = detail.description;
    this.tooltip = detail.tooltip;
    this.accessibilityInformation = {
      label: overviewItemAccessibilityLabel(detail),
    };
    this.iconPath = new vscode.ThemeIcon(detail.icon);
    this.contextValue = detail.cliCommand
      ? "rehearsalDetailWithCommand"
      : "rehearsalDetail";
    if (detail.url) {
      this.command = {
        command: "vscode.open",
        title: "Open local application",
        arguments: [vscode.Uri.parse(detail.url)],
      };
    } else if (detail.cliCommand) {
      this.command = {
        command: "rehearsal.showCliCommand",
        title: "Show equivalent CLI command",
        arguments: [this],
      };
    }
  }
}

export class RehearsalTreeProvider
  implements vscode.TreeDataProvider<TreeNode>, vscode.Disposable
{
  private readonly changes = new vscode.EventEmitter<TreeNode | undefined>();
  private readonly snapshots = new Map<string, ProjectSnapshot>();
  private readonly controllers = new Map<string, AbortController>();
  private readonly subscriptions: vscode.Disposable[];

  readonly onDidChangeTreeData = this.changes.event;

  constructor(
    private readonly output: vscode.OutputChannel,
    private readonly trusted: () => boolean = () => vscode.workspace.isTrusted,
  ) {
    this.subscriptions = [
      vscode.workspace.onDidChangeWorkspaceFolders(() => {
        this.pruneRemovedFolders();
        this.changes.fire(undefined);
      }),
      vscode.workspace.onDidGrantWorkspaceTrust(() => void this.refresh()),
      vscode.workspace.onDidChangeConfiguration((event) => {
        if (event.affectsConfiguration("rehearsal.configPath")) {
          void this.refresh();
        }
      }),
    ];
  }

  getTreeItem(element: TreeNode): vscode.TreeItem {
    return element;
  }

  getChildren(element?: TreeNode): TreeNode[] {
    if (!element) {
      return (vscode.workspace.workspaceFolders ?? []).map((folder) =>
        this.workspaceNode(folder),
      );
    }
    if (element.kind === "detail") return [];
    const snapshot = this.snapshots.get(element.folder.uri.toString());
    return snapshot
      ? overviewItems(snapshot).map((item) => new DetailNode(element, item))
      : [];
  }

  async refresh(token?: vscode.CancellationToken): Promise<void> {
    const folders = vscode.workspace.workspaceFolders ?? [];
    if (folders.length === 0) {
      this.changes.fire(undefined);
      return;
    }
    await Promise.all(
      folders.map((folder) => this.refreshFolder(folder, token)),
    );
    this.changes.fire(undefined);
  }

  showCliCommand(node: TreeNode | undefined): void {
    if (!node || node.kind !== "detail" || !node.detail.cliCommand) return;
    void vscode.window.showInformationMessage(node.detail.cliCommand);
  }

  dispose(): void {
    for (const controller of this.controllers.values()) controller.abort();
    this.controllers.clear();
    this.changes.dispose();
    for (const subscription of this.subscriptions) subscription.dispose();
  }

  private workspaceNode(folder: vscode.WorkspaceFolder): WorkspaceNode {
    return new WorkspaceNode(folder, this.snapshots.get(folder.uri.toString()));
  }

  private async refreshFolder(
    folder: vscode.WorkspaceFolder,
    token?: vscode.CancellationToken,
  ): Promise<void> {
    const key = folder.uri.toString();
    this.controllers.get(key)?.abort();
    const controller = new AbortController();
    this.controllers.set(key, controller);
    const cancellation = token?.onCancellationRequested(() =>
      controller.abort(),
    );
    const configuredPath = vscode.workspace
      .getConfiguration("rehearsal", folder.uri)
      .get<string>("configPath", "")
      .trim();
    this.output.appendLine(`Refreshing Rehearsal overview for ${folder.name}.`);
    let snapshot: ProjectSnapshot;
    try {
      snapshot = await inspectProject({
        workspaceName: folder.name,
        workspaceRoot: folder.uri.fsPath,
        trusted: this.trusted(),
        ...(configuredPath ? { configPath: configuredPath } : {}),
        signal: controller.signal,
      });
    } finally {
      cancellation?.dispose();
    }
    if (controller.signal.aborted || this.controllers.get(key) !== controller)
      return;
    this.controllers.delete(key);
    this.snapshots.set(key, snapshot);
    this.output.appendLine(
      `Rehearsal overview for ${folder.name}: ${snapshot.availability.replaceAll("_", " ")}.`,
    );
  }

  private pruneRemovedFolders(): void {
    const active = new Set(
      (vscode.workspace.workspaceFolders ?? []).map(({ uri }) =>
        uri.toString(),
      ),
    );
    for (const key of this.snapshots.keys()) {
      if (!active.has(key)) this.snapshots.delete(key);
    }
    for (const [key, controller] of this.controllers) {
      if (!active.has(key)) {
        controller.abort();
        this.controllers.delete(key);
      }
    }
  }
}
