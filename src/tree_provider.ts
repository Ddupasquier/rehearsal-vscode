import * as vscode from "vscode";
import {
  bootstrapProjectDiscovery,
  type WorkspaceEntryKind,
} from "./bootstrap_discovery.js";
import { inspectProject } from "./project_snapshot.js";
import type { ProjectSnapshot } from "./project_snapshot.js";
import { parseActivityData } from "./contracts.js";
import type { ActiveOperationMonitorState } from "./active_operation_monitor.js";
import { overviewItemAccessibilityLabel, overviewItems } from "./tree_model.js";
import type { OverviewItem } from "./tree_model.js";
import {
  projectRefreshPatterns,
  WorkspaceRefreshScheduler,
} from "./workspace_refresh.js";

type TreeNode = DashboardNode | WorkspaceNode | DetailNode;

export interface SnapshotUpdate {
  readonly workspaceKey: string;
  readonly snapshot: ProjectSnapshot;
}

export interface InspectionUpdate {
  readonly workspaceKey: string;
  readonly state: "loading" | "idle";
}

class DashboardNode extends vscode.TreeItem {
  readonly kind = "dashboard";

  constructor() {
    super("Open Rehearsal dashboard", vscode.TreeItemCollapsibleState.None);
    this.id = "rehearsal:open-dashboard";
    this.contextValue = "rehearsalDashboardAction";
    this.iconPath = new vscode.ThemeIcon("dashboard");
    this.tooltip =
      "Open the project-aware Rehearsal dashboard. Use the project picker when more than one folder is open.";
    this.accessibilityInformation = {
      label: "Open Rehearsal dashboard",
      role: "button",
    };
    this.command = {
      command: "rehearsal.openWorkspace",
      title: "Open Rehearsal Dashboard",
    };
  }
}

class WorkspaceNode extends vscode.TreeItem {
  readonly kind = "workspace";

  constructor(
    readonly folder: vscode.WorkspaceFolder,
    readonly snapshot: ProjectSnapshot | undefined,
    readonly loading: boolean,
  ) {
    super(folder.name, vscode.TreeItemCollapsibleState.Expanded);
    this.id = `workspace:${folder.uri.toString()}`;
    this.contextValue = "rehearsalWorkspace";
    this.iconPath = new vscode.ThemeIcon("folder-library");
    if (loading) this.description = "Checking…";
    else if (snapshot?.version) this.description = snapshot.version;
    this.tooltip = loading
      ? `${folder.name}: safely checking local Rehearsal project information`
      : snapshot
        ? `${folder.name}: ${snapshot.availability.replaceAll("_", " ")}`
        : `${folder.name}: refresh to inspect Rehearsal`;
    this.accessibilityInformation = {
      label: loading
        ? `${folder.name}, checking Rehearsal project information`
        : snapshot?.version
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
  private readonly inspectionChanges =
    new vscode.EventEmitter<InspectionUpdate>();
  private readonly snapshots = new Map<string, ProjectSnapshot>();
  private readonly loadingWorkspaces = new Set<string>();
  private readonly controllers = new Map<string, AbortController>();
  private readonly workspaceWatchers = new Map<
    string,
    {
      readonly patterns: readonly string[];
      readonly watchers: vscode.FileSystemWatcher[];
    }
  >();
  private readonly refreshScheduler: WorkspaceRefreshScheduler;
  private readonly subscriptions: vscode.Disposable[];

  readonly onDidChangeTreeData = this.changes.event;
  readonly onDidUpdateSnapshot = this.snapshotChanges.event;
  readonly onDidChangeInspection = this.inspectionChanges.event;

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
        const configPathChanged = event.affectsConfiguration(
          "rehearsal.configPath",
        );
        if (configPathChanged) this.syncWorkspaceWatchers();
        if (
          configPathChanged ||
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
      return [
        new DashboardNode(),
        ...(vscode.workspace.workspaceFolders ?? []).map((folder) =>
          this.workspaceNode(folder),
        ),
      ];
    }
    if (element.kind === "detail" || element.kind === "dashboard") return [];
    const snapshot = this.snapshots.get(element.folder.uri.toString());
    const loading = this.loadingWorkspaces.has(element.folder.uri.toString());
    const items = snapshot ? [...overviewItems(snapshot)] : [];
    if (loading) {
      items.unshift({
        id: "inspection-loading",
        label: "Checking project information",
        description: "Please wait",
        tooltip:
          "Rehearsal is reading bounded, project-local metadata. You can cancel from the progress notification.",
        icon: "loading~spin",
      });
    }
    return items.map((item) => new DetailNode(element, item));
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

  /** Activity observation never republishes database/configuration details mid-mutation. */
  publishOperationActivity(
    workspaceKey: string,
    raw: unknown,
    failure?: ActiveOperationMonitorState,
  ): void {
    const previous = this.snapshots.get(workspaceKey);
    if (
      !previous ||
      !this.trusted() ||
      !vscode.workspace.workspaceFolders?.some(
        ({ uri }) => uri.toString() === workspaceKey,
      )
    )
      return;
    let activity;
    try {
      activity = raw === undefined ? undefined : parseActivityData(raw);
    } catch {
      activity = undefined;
    }
    if (activity?.state === "idle") return;
    const snapshot: ProjectSnapshot = {
      workspaceName: previous.workspaceName,
      workspaceRoot: previous.workspaceRoot,
      ...(previous.version ? { version: previous.version } : {}),
      ...(previous.compatibility
        ? { compatibility: previous.compatibility }
        : {}),
      ...(previous.packageLocation
        ? { packageLocation: previous.packageLocation }
        : {}),
      ...(previous.configPath ? { configPath: previous.configPath } : {}),
      availability:
        activity?.state === "busy"
          ? "operation_active"
          : activity
            ? "operation_attention"
            : "error",
      ...(activity
        ? { activity }
        : {
            error: {
              code: `activity_monitor_${failure ?? "unavailable"}`,
              message:
                "Live operation activity is no longer available. Refresh the project to inspect its actual state.",
              suggestions: [
                "Use Refresh Project Overview or check the owned terminal. No completion or successful cleanup was inferred.",
              ],
            },
          }),
    };
    this.snapshots.set(workspaceKey, snapshot);
    this.snapshotChanges.fire({ workspaceKey, snapshot });
    this.changes.fire(undefined);
  }

  inspectionStateFor(workspaceKey: string): "loading" | "idle" {
    return this.loadingWorkspaces.has(workspaceKey) ? "loading" : "idle";
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
    this.inspectionChanges.dispose();
    this.refreshScheduler.dispose();
    for (const key of this.workspaceWatchers.keys()) {
      this.removeWorkspaceWatchers(key);
    }
    for (const subscription of this.subscriptions) subscription.dispose();
  }

  private workspaceNode(folder: vscode.WorkspaceFolder): WorkspaceNode {
    const key = folder.uri.toString();
    return new WorkspaceNode(
      folder,
      this.snapshots.get(key),
      this.loadingWorkspaces.has(key),
    );
  }

  private async refreshFolder(
    folder: vscode.WorkspaceFolder,
    token?: vscode.CancellationToken,
  ): Promise<ProjectSnapshot | undefined> {
    const key = folder.uri.toString();
    this.controllers.get(key)?.abort();
    const controller = new AbortController();
    this.controllers.set(key, controller);
    this.setInspectionState(key, "loading");
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
    } catch (error) {
      if (this.controllers.get(key) === controller) {
        this.controllers.delete(key);
        this.setInspectionState(key, "idle");
      }
      throw error;
    } finally {
      cancellation?.dispose();
    }
    if (controller.signal.aborted || this.controllers.get(key) !== controller) {
      if (this.controllers.get(key) === controller) {
        this.controllers.delete(key);
        this.setInspectionState(key, "idle");
      }
      return undefined;
    }
    this.controllers.delete(key);
    this.snapshots.set(key, snapshot);
    this.setInspectionState(key, "idle");
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
    for (const key of this.loadingWorkspaces) {
      if (!active.has(key)) this.loadingWorkspaces.delete(key);
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

  private setInspectionState(
    workspaceKey: string,
    state: "loading" | "idle",
  ): void {
    const loading = state === "loading";
    if (loading === this.loadingWorkspaces.has(workspaceKey)) return;
    if (loading) this.loadingWorkspaces.add(workspaceKey);
    else this.loadingWorkspaces.delete(workspaceKey);
    this.changes.fire(undefined);
    this.inspectionChanges.fire({ workspaceKey, state });
  }

  private syncWorkspaceWatchers(): void {
    const folders = vscode.workspace.workspaceFolders ?? [];
    const active = new Set(folders.map(({ uri }) => uri.toString()));
    for (const key of this.workspaceWatchers.keys()) {
      if (!active.has(key)) this.removeWorkspaceWatchers(key);
    }
    for (const folder of folders) {
      const key = folder.uri.toString();
      const patterns = projectRefreshPatterns(
        vscode.workspace
          .getConfiguration("rehearsal", folder.uri)
          .get<unknown>("configPath", ""),
      );
      const previous = this.workspaceWatchers.get(key);
      if (
        previous?.patterns.length === patterns.length &&
        previous.patterns.every((pattern, index) => pattern === patterns[index])
      )
        continue;
      this.removeWorkspaceWatchers(key);
      const subscription = {
        patterns,
        watchers: [] as vscode.FileSystemWatcher[],
      };
      this.workspaceWatchers.set(key, subscription);
      for (const pattern of patterns) {
        const watcher = vscode.workspace.createFileSystemWatcher(
          new vscode.RelativePattern(folder, pattern),
        );
        const changed = () => {
          if (this.workspaceWatchers.get(key) === subscription) {
            this.refreshScheduler.schedule(key);
          }
        };
        watcher.onDidChange(changed);
        watcher.onDidCreate(changed);
        watcher.onDidDelete(changed);
        subscription.watchers.push(watcher);
      }
    }
  }

  private removeWorkspaceWatchers(workspaceKey: string): void {
    this.refreshScheduler.cancel(workspaceKey);
    const subscription = this.workspaceWatchers.get(workspaceKey);
    this.workspaceWatchers.delete(workspaceKey);
    for (const watcher of subscription?.watchers ?? []) {
      watcher.dispose();
    }
  }
}
