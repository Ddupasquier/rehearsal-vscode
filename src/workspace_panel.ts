import { randomBytes } from "node:crypto";
import { relative, resolve, sep } from "node:path";
import * as vscode from "vscode";
import type { RehearsalTreeProvider } from "./tree_provider.js";
import {
  WORKSPACE_ACTION_IDS,
  type WorkspaceActionId,
} from "./action_catalog.js";
import {
  renderWorkspaceDocument,
  WORKSPACE_PAGES,
  type WorkspacePage,
} from "./workspace_view.js";
import type { RehearsalWorkspaceActions } from "./workspace_actions.js";
import {
  applyConfigurationProposal,
  configurationDiff,
  configurationFingerprint,
  parseConfigurationProposal,
} from "./configuration_editor.js";
import {
  DEFAULT_WORKSPACE_PREFERENCES,
  isLoopbackUrl,
  normalizeWorkspacePreferences,
  parseWorkspaceMessage,
  preferenceStorageKey,
  type WorkspacePreferences,
} from "./workspace_preferences.js";
import {
  buildVerificationReport,
  renderVerificationReportJson,
  renderVerificationReportMarkdown,
} from "./verification_report.js";

const actionUri = (workspaceToken: string, action: WorkspaceActionId): string =>
  `command:rehearsal.workspaceAction?${encodeURIComponent(JSON.stringify([workspaceToken, action]))}`;

const PAGE_IDS = new Set<WorkspacePage>(WORKSPACE_PAGES);

const isWorkspacePage = (value: unknown): value is WorkspacePage =>
  typeof value === "string" && PAGE_IDS.has(value as WorkspacePage);

export class RehearsalWorkspacePanels implements vscode.Disposable {
  private readonly panels = new Map<string, vscode.WebviewPanel>();
  private readonly workspaceTokens = new Map<string, string>();
  private readonly activePages = new Map<string, WorkspacePage>();
  private readonly preferences = new Map<string, WorkspacePreferences>();
  private readonly subscriptions: vscode.Disposable[];

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly projects: RehearsalTreeProvider,
    private readonly actions: RehearsalWorkspaceActions,
    private readonly workspaceState: vscode.Memento,
  ) {
    this.subscriptions = [
      projects.onDidUpdateSnapshot(({ workspaceKey, snapshot }) => {
        const panel = this.panels.get(workspaceKey);
        if (panel) this.render(panel, workspaceKey, snapshot);
      }),
      actions.onDidRecordActivity((workspaceKey) => {
        const panel = this.panels.get(workspaceKey);
        const snapshot = this.projects.snapshotFor(workspaceKey);
        if (panel && snapshot) this.render(panel, workspaceKey, snapshot);
      }),
    ];
  }

  async open(workspaceKey: string): Promise<void> {
    const existing = this.panels.get(workspaceKey);
    if (existing) {
      existing.reveal(vscode.ViewColumn.Active, true);
      const snapshot = this.projects.snapshotFor(workspaceKey);
      if (snapshot) this.render(existing, workspaceKey, snapshot);
      return;
    }

    const snapshot =
      this.projects.snapshotFor(workspaceKey) ??
      (await this.projects.refreshWorkspace(workspaceKey));
    if (!snapshot) {
      void vscode.window.showInformationMessage(
        "That Rehearsal workspace is no longer open.",
      );
      return;
    }

    const mediaRoot = vscode.Uri.joinPath(this.extensionUri, "media");
    const panel = vscode.window.createWebviewPanel(
      "rehearsal.workspace",
      `${snapshot.workspaceName} · Rehearsal`,
      vscode.ViewColumn.Active,
      {
        enableScripts: true,
        enableCommandUris: ["rehearsal.workspaceAction"],
        retainContextWhenHidden: false,
        localResourceRoots: [mediaRoot],
      },
    );
    panel.iconPath = vscode.Uri.joinPath(mediaRoot, "rehearsal-readme.png");
    const workspaceToken = this.actions.registerWorkspace(workspaceKey);
    this.workspaceTokens.set(workspaceKey, workspaceToken);
    this.activePages.set(workspaceKey, "overview");
    this.preferences.set(
      workspaceKey,
      normalizeWorkspacePreferences(
        this.workspaceState.get(preferenceStorageKey(workspaceKey)),
      ),
    );
    panel.webview.onDidReceiveMessage((message: unknown) => {
      void this.handleMessage(panel, workspaceKey, message);
    });
    panel.onDidDispose(() => {
      this.panels.delete(workspaceKey);
      this.workspaceTokens.delete(workspaceKey);
      this.activePages.delete(workspaceKey);
      this.preferences.delete(workspaceKey);
      this.actions.releaseWorkspace(workspaceToken);
    });
    this.panels.set(workspaceKey, panel);
    this.render(panel, workspaceKey, snapshot);
  }

  dispose(): void {
    for (const subscription of this.subscriptions) subscription.dispose();
    for (const panel of this.panels.values()) panel.dispose();
    this.panels.clear();
    this.workspaceTokens.clear();
    this.activePages.clear();
    this.preferences.clear();
  }

  async resetLocalState(workspaceKey: string): Promise<void> {
    await this.workspaceState.update(
      preferenceStorageKey(workspaceKey),
      undefined,
    );
    await this.actions.clearActivity(workspaceKey);
    this.preferences.set(workspaceKey, DEFAULT_WORKSPACE_PREFERENCES);
    this.activePages.set(workspaceKey, "overview");
    const panel = this.panels.get(workspaceKey);
    const snapshot = this.projects.snapshotFor(workspaceKey);
    if (panel && snapshot) this.render(panel, workspaceKey, snapshot);
  }

  private async handleMessage(
    panel: vscode.WebviewPanel,
    workspaceKey: string,
    rawMessage: unknown,
  ): Promise<void> {
    const message = parseWorkspaceMessage(rawMessage);
    if (!message) return;
    if (message.type === "navigate") {
      if (isWorkspacePage(message.page)) {
        this.activePages.set(workspaceKey, message.page);
      }
      return;
    }
    const snapshot = this.projects.snapshotFor(workspaceKey);
    if (!snapshot) return;
    if (message.type === "preferences") {
      const preferences = normalizeWorkspacePreferences(message.preferences);
      const targets = new Set([
        "all",
        ...(snapshot.runtime?.targets.map(({ name }) => name) ?? []),
      ]);
      const safePreferences = {
        ...preferences,
        selectedTarget: targets.has(preferences.selectedTarget)
          ? preferences.selectedTarget
          : "all",
        applicationUrl: isLoopbackUrl(preferences.applicationUrl)
          ? preferences.applicationUrl
          : "",
      };
      this.preferences.set(workspaceKey, safePreferences);
      await this.workspaceState.update(
        preferenceStorageKey(workspaceKey),
        safePreferences,
      );
      return;
    }
    if (message.type === "openApplication") {
      if (typeof message.url !== "string" || !isLoopbackUrl(message.url)) {
        void vscode.window.showErrorMessage(
          "Rehearsal opens HTTP(S) loopback application addresses only.",
        );
        return;
      }
      await vscode.env.openExternal(vscode.Uri.parse(message.url));
      return;
    }
    if (message.type === "exportReport") {
      await this.exportReport(snapshot, message.format);
      return;
    }
    if (message.type === "resetLocalState") {
      const confirmed = await vscode.window.showWarningMessage(
        "Reset Rehearsal's saved editor preferences for this project?",
        {
          modal: true,
          detail:
            "This clears only view filters, the selected display profile, the custom loopback address, and the extension's bounded activity receipts. It does not change Rehearsal configuration, baselines, runtimes, databases, or Storage.",
        },
        "Reset Editor State",
      );
      if (confirmed === "Reset Editor State") {
        await this.resetLocalState(workspaceKey);
        void vscode.window.showInformationMessage(
          "Reset the saved Rehearsal editor state for this project.",
        );
      }
      return;
    }
    if (message.type === "reviewConfiguration") {
      await this.reviewConfiguration(workspaceKey, snapshot, message.values);
      const refreshed = this.projects.snapshotFor(workspaceKey);
      if (refreshed) this.render(panel, workspaceKey, refreshed);
    }
  }

  private async exportReport(
    snapshot: Parameters<typeof renderWorkspaceDocument>[0],
    format: unknown,
  ): Promise<void> {
    if (format !== "markdown" && format !== "json") return;
    const extension = format === "markdown" ? "md" : "json";
    const destination = await vscode.window.showSaveDialog({
      title: "Export privacy-safe Rehearsal report",
      defaultUri: vscode.Uri.file(
        `${snapshot.workspaceName}-rehearsal-report.${extension}`,
      ),
      filters:
        format === "markdown" ? { Markdown: ["md"] } : { JSON: ["json"] },
    });
    if (!destination) return;
    const report = buildVerificationReport(snapshot);
    const content =
      format === "markdown"
        ? renderVerificationReportMarkdown(report)
        : renderVerificationReportJson(report);
    await vscode.workspace.fs.writeFile(
      destination,
      new TextEncoder().encode(content),
    );
    void vscode.window.showInformationMessage(
      `Saved Rehearsal report as ${destination.path.split("/").at(-1) ?? `report.${extension}`}.`,
    );
  }

  private async reviewConfiguration(
    workspaceKey: string,
    snapshot: Parameters<typeof renderWorkspaceDocument>[0],
    rawValues: unknown,
  ): Promise<void> {
    if (!snapshot.configPath) {
      void vscode.window.showInformationMessage(
        "Create a Rehearsal configuration before applying custom values.",
      );
      return;
    }
    const folder = (vscode.workspace.workspaceFolders ?? []).find(
      ({ uri }) => uri.toString() === workspaceKey,
    );
    if (!folder) return;
    const absolute = resolve(folder.uri.fsPath, snapshot.configPath);
    const local = relative(folder.uri.fsPath, absolute);
    if (local === ".." || local.startsWith(`..${sep}`)) return;
    try {
      const proposal = parseConfigurationProposal(rawValues);
      const document = await vscode.workspace.openTextDocument(
        vscode.Uri.file(absolute),
      );
      if (document.isDirty) {
        throw new Error(
          "Save or discard the current configuration edits before reviewing another proposal.",
        );
      }
      const before = document.getText();
      if (Buffer.byteLength(before) > 1024 * 1024) {
        throw new Error(
          "The active configuration is too large for safe editing.",
        );
      }
      const fingerprint = configurationFingerprint(before);
      const result = applyConfigurationProposal({ source: before, proposal });
      if (result.changedFields.length === 0) {
        void vscode.window.showInformationMessage(
          "The proposed values already match the active configuration.",
        );
        return;
      }
      await vscode.window.showTextDocument(
        await vscode.workspace.openTextDocument({
          language: "diff",
          content: configurationDiff({
            path: snapshot.configPath,
            before,
            after: result.source,
          }),
        }),
        { preview: true, preserveFocus: false },
      );
      const selected = await vscode.window.showWarningMessage(
        `Apply ${result.changedFields.length} reviewed Rehearsal configuration ${result.changedFields.length === 1 ? "change" : "changes"}?`,
        {
          modal: true,
          detail: `${result.changedFields.join(", ")}\n\nApplication commands are stored but are not executed by this edit. Rehearsal validates the complete configuration before any later operation.`,
        },
        "Apply Changes",
      );
      if (selected !== "Apply Changes") return;
      if (
        document.isDirty ||
        configurationFingerprint(document.getText()) !== fingerprint
      ) {
        throw new Error(
          "The configuration changed during review. Refresh Rehearsal and review the new diff.",
        );
      }
      const edit = new vscode.WorkspaceEdit();
      const end = document.lineAt(document.lineCount - 1).range.end;
      edit.replace(
        document.uri,
        new vscode.Range(new vscode.Position(0, 0), end),
        result.source,
      );
      if (
        !(await vscode.workspace.applyEdit(edit)) ||
        !(await document.save())
      ) {
        throw new Error(
          "VS Code could not save the reviewed configuration changes.",
        );
      }
      void vscode.window.showInformationMessage(
        "Applied the reviewed Rehearsal configuration changes.",
      );
      await this.projects.refreshWorkspace(workspaceKey);
    } catch (error) {
      void vscode.window.showErrorMessage(
        error instanceof Error ? error.message : "Configuration review failed.",
      );
    }
  }

  private render(
    panel: vscode.WebviewPanel,
    workspaceKey: string,
    snapshot: Parameters<typeof renderWorkspaceDocument>[0],
  ): void {
    const workspaceToken = this.workspaceTokens.get(workspaceKey);
    if (!workspaceToken) return;
    const mediaRoot = vscode.Uri.joinPath(this.extensionUri, "media");
    panel.title = `${snapshot.workspaceName} · Rehearsal`;
    panel.webview.html = renderWorkspaceDocument(
      snapshot,
      {
        resourceSource: panel.webview.cspSource,
        stylesheetUri: panel.webview
          .asWebviewUri(vscode.Uri.joinPath(mediaRoot, "workspace.css"))
          .toString(),
        logoUri: panel.webview
          .asWebviewUri(vscode.Uri.joinPath(mediaRoot, "rehearsal-readme.png"))
          .toString(),
        actionUris: Object.fromEntries(
          WORKSPACE_ACTION_IDS.map((action) => [
            action,
            actionUri(workspaceToken, action),
          ]),
        ) as Record<WorkspaceActionId, string>,
        scriptNonce: randomBytes(18).toString("base64url"),
      },
      this.activePages.get(workspaceKey) ?? "overview",
      this.preferences.get(workspaceKey) ?? DEFAULT_WORKSPACE_PREFERENCES,
      this.actions.activityFor(workspaceKey),
    );
  }
}
