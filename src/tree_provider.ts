import * as vscode from "vscode";
import {
  bootstrapProjectDiscovery,
  type WorkspaceEntryKind,
} from "./bootstrap_discovery.js";
import { inspectProject } from "./project_snapshot.js";
import type { ProjectSnapshot } from "./project_snapshot.js";
import { overviewItemAccessibilityLabel, overviewItems } from "./tree_model.js";
import type { OverviewItem } from "./tree_model.js";
import {
  PROJECT_REFRESH_PATHS,
  WorkspaceRefreshScheduler,
} from "./workspace_refresh.js";

type TreeNode = WorkspaceNode | DetailNode;

export interface SnapshotUpdate {
  readonly workspaceKey: string;
  readonly snapshot: ProjectSnapshot;
}

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
    this.command = {
      command: "rehearsal.openWorkspace",
      title: "Open Rehearsal Workspace",
      arguments: [folder.uri.toString()],
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
    this.contextValue =
      detail.cliCommand || detail.extensionAction
        ? "rehearsalDetailWithCommand"
        : "rehearsalDetail";
    if (detail.extensionAction) {
      this.command = {
        command: "rehearsal.treeAction",
        title: detail.label,
        arguments: [workspace.folder.uri.toString(), detail.extensionAction],
      };
    } else if (detail.url) {
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
  private readonly snapshotChanges = new vscode.EventEmitter<SnapshotUpdate>();
  private readonly snapshots = new Map<string, ProjectSnapshot>();
  private readonly controllers = new Map<string, AbortController>();
  private readonly workspaceWatchers = new Map<
    string,
    vscode.FileSystemWatcher[]
  >();
  private readonly refreshScheduler: WorkspaceRefreshScheduler;
  private readonly subscriptions: vscode.Disposable[];

  readonly onDidChangeTreeData = this.changes.event;
  readonly onDidUpdateSnapshot = this.snapshotChanges.event;

  constructor(
    private readonly output: vscode.LogOutputChannel,
    private readonly trusted: () => boolean = () => vscode.workspace.isTrusted,
  ) {
    this.refreshScheduler = new WorkspaceRefreshScheduler(
      async (workspaceKey) => {
        this.output.info(
          "Project files changed; refreshing the Rehearsal overview.",
        );
        try {
          await this.refreshWorkspace(workspaceKey);
        } catch {
          this.output.error(
            "Automatic Rehearsal refresh failed; use Refresh Project Overview to retry.",
          );
        }
      },
    );
    this.subscriptions = [
      vscode.workspace.onDidChangeWorkspaceFolders(() => {
        this.pruneRemovedFolders();
        this.syncWorkspaceWatchers();
        this.changes.fire(undefined);
      }),
      vscode.workspace.onDidGrantWorkspaceTrust(() => void this.refresh()),
      vscode.workspace.onDidChangeConfiguration((event) => {
        if (
          event.affectsConfiguration("rehearsal.configPath") ||
          event.affectsConfiguration("rehearsal.inspectionTimeoutSeconds")
        ) {
          void this.refresh();
        }
      }),
    ];
    this.syncWorkspaceWatchers();
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
    let nextFolder = 0;
    const worker = async () => {
      while (nextFolder < folders.length && !token?.isCancellationRequested) {
        const folder = folders[nextFolder];
        nextFolder += 1;
        if (folder) await this.refreshFolder(folder, token);
      }
    };
    await Promise.all(
      Array.from({ length: Math.min(2, folders.length) }, () => worker()),
    );
    this.changes.fire(undefined);
  }

  snapshotFor(workspaceKey: string): ProjectSnapshot | undefined {
    return this.snapshots.get(workspaceKey);
  }

  async refreshWorkspace(
    workspaceKey: string,
    token?: vscode.CancellationToken,
  ): Promise<ProjectSnapshot | undefined> {
    const folder = (vscode.workspace.workspaceFolders ?? []).find(
      ({ uri }) => uri.toString() === workspaceKey,
    );
    if (!folder) return undefined;
    const snapshot = await this.refreshFolder(folder, token);
    this.changes.fire(undefined);
    return snapshot;
  }

  showCliCommand(node: TreeNode | undefined): void {
    if (!node || node.kind !== "detail" || !node.detail.cliCommand) return;
    void vscode.window.showInformationMessage(node.detail.cliCommand);
  }

  dispose(): void {
    for (const controller of this.controllers.values()) controller.abort();
    this.controllers.clear();
    this.changes.dispose();
    this.snapshotChanges.dispose();
    this.refreshScheduler.dispose();
    for (const watchers of this.workspaceWatchers.values()) {
      for (const watcher of watchers) watcher.dispose();
    }
    this.workspaceWatchers.clear();
    for (const subscription of this.subscriptions) subscription.dispose();
  }

  private workspaceNode(folder: vscode.WorkspaceFolder): WorkspaceNode {
    return new WorkspaceNode(folder, this.snapshots.get(folder.uri.toString()));
  }

  private async refreshFolder(
    folder: vscode.WorkspaceFolder,
    token?: vscode.CancellationToken,
  ): Promise<ProjectSnapshot | undefined> {
    const key = folder.uri.toString();
    this.controllers.get(key)?.abort();
    const controller = new AbortController();
    this.controllers.set(key, controller);
    const cancellation = token?.onCancellationRequested(() =>
      controller.abort(),
    );
    const workspaceTrusted = this.trusted();
    const configuredPath = vscode.workspace
      .getConfiguration("rehearsal", folder.uri)
      .get<string>("configPath", "")
      .trim();
    const configuredTimeoutSeconds = vscode.workspace
      .getConfiguration("rehearsal", folder.uri)
      .get<number>("inspectionTimeoutSeconds", 90);
    const timeoutMs =
      Math.min(300, Math.max(15, configuredTimeoutSeconds)) * 1_000;
    this.output.appendLine(`Refreshing Rehearsal overview for ${folder.name}.`);
    let snapshot: ProjectSnapshot;
    try {
      const bootstrapDiscovery = workspaceTrusted
        ? await bootstrapProjectDiscovery({
            workspaceName: folder.name,
            kind: async (path): Promise<WorkspaceEntryKind> => {
              const type = await this.workspaceEntryType(folder, path);
              if (type === null) return null;
              if ((type & vscode.FileType.SymbolicLink) !== 0) return "symlink";
              if ((type & vscode.FileType.File) !== 0) return "file";
              if ((type & vscode.FileType.Directory) !== 0) return "directory";
              return null;
            },
            readText: async (path, maximumBytes) => {
              const uri = this.workspaceUri(folder, path);
              try {
                const metadata = await vscode.workspace.fs.stat(uri);
                if (
                  (metadata.type & vscode.FileType.SymbolicLink) !== 0 ||
                  (metadata.type & vscode.FileType.File) === 0 ||
                  metadata.size > maximumBytes
                ) {
                  return null;
                }
                return new TextDecoder("utf-8", { fatal: true }).decode(
                  await vscode.workspace.fs.readFile(uri),
                );
              } catch (error) {
                if (error instanceof vscode.FileSystemError) return null;
                throw error;
              }
            },
          })
        : undefined;
      snapshot = await inspectProject({
        workspaceName: folder.name,
        workspaceRoot: folder.uri.fsPath,
        trusted: workspaceTrusted,
        ...(bootstrapDiscovery ? { bootstrapDiscovery } : {}),
        ...(configuredPath ? { configPath: configuredPath } : {}),
        timeoutMs,
        signal: controller.signal,
      });
    } finally {
      cancellation?.dispose();
    }
    if (controller.signal.aborted || this.controllers.get(key) !== controller)
      return undefined;
    this.controllers.delete(key);
    this.snapshots.set(key, snapshot);
    this.snapshotChanges.fire({ workspaceKey: key, snapshot });
    this.output.appendLine(
      `Rehearsal overview for ${folder.name}: ${snapshot.availability.replaceAll("_", " ")}.`,
    );
    if (snapshot.error) {
      this.output.warn(
        `Inspection for ${folder.name} ended with ${snapshot.error.code}.`,
      );
    }
    return snapshot;
  }

  private workspaceUri(
    folder: vscode.WorkspaceFolder,
    projectPath: string,
  ): vscode.Uri {
    const segments = projectPath.split("/");
    if (
      segments.some(
        (segment) => segment === "" || segment === "." || segment === "..",
      )
    ) {
      throw new Error(
        "Bootstrap discovery accepts only project-relative paths.",
      );
    }
    return vscode.Uri.joinPath(folder.uri, ...segments);
  }

  private async workspaceEntryType(
    folder: vscode.WorkspaceFolder,
    projectPath: string,
  ): Promise<vscode.FileType | null> {
    try {
      return (
        await vscode.workspace.fs.stat(this.workspaceUri(folder, projectPath))
      ).type;
    } catch (error) {
      if (error instanceof vscode.FileSystemError) return null;
      throw error;
    }
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
    for (const key of this.workspaceWatchers.keys()) {
      if (!active.has(key)) this.removeWorkspaceWatchers(key);
    }
  }

  private syncWorkspaceWatchers(): void {
    const folders = vscode.workspace.workspaceFolders ?? [];
    const active = new Set(folders.map(({ uri }) => uri.toString()));
    for (const key of this.workspaceWatchers.keys()) {
      if (!active.has(key)) this.removeWorkspaceWatchers(key);
    }
    for (const folder of folders) {
      const key = folder.uri.toString();
      if (this.workspaceWatchers.has(key)) continue;
      const watchers = PROJECT_REFRESH_PATHS.map((path) => {
        const watcher = vscode.workspace.createFileSystemWatcher(
          new vscode.RelativePattern(folder, path),
        );
        const changed = () => this.refreshScheduler.schedule(key);
        watcher.onDidChange(changed);
        watcher.onDidCreate(changed);
        watcher.onDidDelete(changed);
        return watcher;
      });
      this.workspaceWatchers.set(key, watchers);
    }
  }

  private removeWorkspaceWatchers(workspaceKey: string): void {
    this.refreshScheduler.cancel(workspaceKey);
    for (const watcher of this.workspaceWatchers.get(workspaceKey) ?? []) {
      watcher.dispose();
    }
    this.workspaceWatchers.delete(workspaceKey);
  }
}
