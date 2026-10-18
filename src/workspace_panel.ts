import { randomBytes } from "node:crypto";
import {
  extensionReleasePresentation,
  type ExtensionReleaseEvidence,
} from "./extension_release_view.js";
import {
  lstat,
  realpath,
  mkdtemp,
  writeFile,
  unlink,
  rmdir,
} from "node:fs/promises";
import { isAbsolute, join } from "node:path";
import {
  runRehearsalJson,
  resolveWorkspaceRehearsal,
} from "./process_adapter.js";
import {
  parseConfigurationMetadata,
  type ConfigurationMetadata,
} from "./configuration_contract.js";
import { editLiteralConfiguration } from "./literal_configuration.js";
import { parseActivityData } from "./contracts.js";
import { renderOperationProgress } from "./operation_progress.js";
import { ConfigurationReviewDocuments } from "./configuration_review_documents.js";
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
  configurationProposalChanges,
  parseConfigurationProposal,
  parseStructuredConfigurationValues,
} from "./configuration_editor.js";
import {
  DEFAULT_WORKSPACE_PREFERENCES,
  isLoopbackUrl,
  normalizeWorkspacePreferences,
  parseWorkspaceMessage,
  preferenceStorageKey,
  type WorkspacePreferences,
} from "./workspace_preferences.js";
import { knownWorkspaceTargets } from "./workspace_view_state.js";
import {
  buildVerificationReport,
  renderVerificationReportJson,
  renderVerificationReportMarkdown,
  verificationReportFilename,
} from "./verification_report.js";

const actionUri = (workspaceToken: string, action: WorkspaceActionId): string =>
  `command:rehearsal.workspaceAction?${encodeURIComponent(JSON.stringify([workspaceToken, action]))}`;

const PAGE_IDS = new Set<WorkspacePage>(WORKSPACE_PAGES);

/** Only locally controlled review guidance may be shown verbatim. */
class ConfigurationReviewError extends Error {}

const isWorkspacePage = (value: unknown): value is WorkspacePage =>
  typeof value === "string" && PAGE_IDS.has(value as WorkspacePage);

export class RehearsalWorkspacePanels implements vscode.Disposable {
  private disposed = false;
  private readonly extensionReleases = new Map<
    string,
    ExtensionReleaseEvidence
  >();
  private readonly panels = new Map<string, vscode.WebviewPanel>();
  private readonly workspaceTokens = new Map<string, string>();
  private readonly activePages = new Map<string, WorkspacePage>();
  private readonly preferences = new Map<string, WorkspacePreferences>();
  private readonly editing = new Set<string>();
  private readonly pendingExports = new Set<string>();
  private readonly pendingConfigurationReviews = new Set<string>();
  private readonly liveDocuments = new Map<
    string,
    { readonly key: string; delivery: number }
  >();
  private readonly subscriptions: vscode.Disposable[];
  private readonly configurationReviews: ConfigurationReviewDocuments;

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly projects: RehearsalTreeProvider,
    private readonly actions: RehearsalWorkspaceActions,
    private readonly workspaceState: vscode.Memento,
    private readonly extensionVersion = "unavailable",
  ) {
    this.configurationReviews = new ConfigurationReviewDocuments(
      (workspaceKey) =>
        vscode.workspace.isTrusted &&
        this.panels.has(workspaceKey) &&
        Boolean(
          vscode.workspace.workspaceFolders?.some(
            ({ uri }) => uri.toString() === workspaceKey,
          ),
        ),
    );
    this.subscriptions = [
      vscode.workspace.onDidChangeWorkspaceFolders(() => {
        for (const key of this.extensionReleases.keys())
          if (
            !vscode.workspace.workspaceFolders?.some(
              ({ uri }) => uri.toString() === key,
            )
          )
            this.extensionReleases.delete(key);
        for (const workspaceKey of this.panels.keys())
          if (
            !vscode.workspace.workspaceFolders?.some(
              ({ uri }) => uri.toString() === workspaceKey,
            )
          )
            this.configurationReviews.releaseWorkspace(workspaceKey);
      }),
      projects.onDidUpdateSnapshot(({ workspaceKey, snapshot }) => {
        const panel = this.panels.get(workspaceKey);
        if (panel) this.render(panel, workspaceKey, snapshot);
      }),
      projects.onDidChangeInspection(({ workspaceKey }) => {
        const panel = this.panels.get(workspaceKey);
        if (!panel) return;
        const snapshot =
          this.projects.snapshotFor(workspaceKey) ??
          this.loadingSnapshot(workspaceKey);
        if (snapshot) this.render(panel, workspaceKey, snapshot);
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
      const visible = snapshot ?? this.loadingSnapshot(workspaceKey);
      if (visible) this.render(existing, workspaceKey, visible);
      return;
    }

    const folder = (vscode.workspace.workspaceFolders ?? []).find(
      ({ uri }) => uri.toString() === workspaceKey,
    );
    if (!folder) {
      void vscode.window.showInformationMessage(
        "That Rehearsal workspace is no longer open.",
      );
      return;
    }

    const mediaRoot = vscode.Uri.joinPath(this.extensionUri, "media");
    const panel = vscode.window.createWebviewPanel(
      "rehearsal.workspace",
      `${folder.name} · Rehearsal`,
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
    let wasVisible = panel.visible;
    panel.onDidChangeViewState(() => {
      // Hidden webviews are discarded by VS Code; a later reveal needs a new document.
      const becameVisible = panel.visible && !wasVisible;
      wasVisible = panel.visible;
      if (!panel.visible) this.liveDocuments.delete(workspaceKey);
      if (becameVisible) {
        this.editing.delete(workspaceKey);
        const current = this.projects.snapshotFor(workspaceKey);
        if (current) this.render(panel, workspaceKey, current);
      }
    });
    panel.onDidDispose(() => {
      this.panels.delete(workspaceKey);
      this.workspaceTokens.delete(workspaceKey);
      this.activePages.delete(workspaceKey);
      this.preferences.delete(workspaceKey);
      this.editing.delete(workspaceKey);
      this.liveDocuments.delete(workspaceKey);
      this.configurationReviews.releaseWorkspace(workspaceKey);
      this.actions.releaseWorkspace(workspaceToken);
    });
    this.panels.set(workspaceKey, panel);
    const snapshot = this.projects.snapshotFor(workspaceKey);
    this.render(
      panel,
      workspaceKey,
      snapshot ?? {
        workspaceName: folder.name,
        workspaceRoot: folder.uri.fsPath,
        availability: "loading",
      },
    );
    if (!snapshot) await this.projects.refreshWorkspace(workspaceKey);
  }

  dispose(): void {
    this.disposed = true;
    for (const subscription of this.subscriptions) subscription.dispose();
    for (const panel of this.panels.values()) panel.dispose();
    this.panels.clear();
    this.workspaceTokens.clear();
    this.activePages.clear();
    this.preferences.clear();
    this.extensionReleases.clear();
    this.editing.clear();
    this.liveDocuments.clear();
    this.configurationReviews.dispose();
  }

  updateExtensionRelease(
    key: string,
    evidence: ExtensionReleaseEvidence,
  ): void {
    if (
      this.disposed ||
      !vscode.workspace.isTrusted ||
      !vscode.workspace.workspaceFolders?.some(
        ({ uri }) => uri.toString() === key,
      )
    )
      return;
    this.extensionReleases.set(key, evidence);
    const panel = this.panels.get(key);
    if (!panel?.visible) return;
    // Advisory completion must not reset navigation, focus, scroll or unsaved forms.
    void Promise.resolve(
      panel.webview.postMessage({
        type: "extensionReleaseUpdated",
        ...extensionReleasePresentation(this.extensionVersion, evidence),
      }),
    ).catch(() => {});
  }

  async resetLocalState(workspaceKey: string): Promise<void> {
    this.liveDocuments.delete(workspaceKey);
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
    if (this.panels.get(workspaceKey) !== panel) return;
    const message = parseWorkspaceMessage(rawMessage);
    if (!message) return;
    if (message.type === "editing") {
      if (message.editing) this.editing.add(workspaceKey);
      else {
        this.editing.delete(workspaceKey);
        const current = this.projects.snapshotFor(workspaceKey);
        if (current) this.render(panel, workspaceKey, current);
      }
      return;
    }
    if (message.type === "navigate") {
      if (isWorkspacePage(message.page)) {
        this.activePages.set(workspaceKey, message.page);
      }
      return;
    }
    const snapshot = this.projects.snapshotFor(workspaceKey);
    if (!snapshot) return;
    if (message.type === "reviewStaleStop") {
      await this.actions.reviewStaleStop(workspaceKey);
      return;
    }
    if (message.type === "cleanupImages") {
      await this.actions.cleanupImages(workspaceKey, message.ids);
      return;
    }
    if (message.type === "resourceAction") {
      await this.actions.runWorkspace(
        workspaceKey,
        message.action,
        message.target,
      );
      return;
    }
    if (message.type === "reviewResourceConfiguration") {
      this.editing.delete(workspaceKey);
      const environment = snapshot.resources?.environments.find(
        (entry) => entry.target === message.target,
      );
      if (
        !environment ||
        snapshot.resources?.catalog === undefined ||
        !vscode.workspace.isTrusted
      )
        return;
      const folder = (vscode.workspace.workspaceFolders ?? []).find(
        (folder) => folder.uri.toString() === workspaceKey,
      );
      if (!folder) return;
      const configPath = relative(folder.uri.fsPath, environment.configPath);
      if (
        configPath === ".." ||
        configPath.startsWith(`..${sep}`) ||
        !configPath
      )
        return;
      await this.reviewConfiguration(
        workspaceKey,
        { ...snapshot, configPath },
        message.values,
        snapshot.configPath,
      );
      const refreshed = this.projects.snapshotFor(workspaceKey);
      if (refreshed) this.render(panel, workspaceKey, refreshed);
      return;
    }
    if (message.type === "preferences") {
      const preferences = normalizeWorkspacePreferences(message.preferences);
      const targets = new Set(["all", ...knownWorkspaceTargets(snapshot)]);
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
      await this.exportReport(
        panel,
        workspaceKey,
        snapshot,
        message.format,
        typeof message.leftId === "string" &&
          typeof message.rightId === "string"
          ? { leftId: message.leftId, rightId: message.rightId }
          : undefined,
      );
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
      this.editing.delete(workspaceKey);
      await this.reviewConfiguration(workspaceKey, snapshot, message.values);
      const refreshed = this.projects.snapshotFor(workspaceKey);
      if (refreshed) this.render(panel, workspaceKey, refreshed);
    }
  }

  private async exportReport(
    panel: vscode.WebviewPanel,
    workspaceKey: string,
    snapshot: Parameters<typeof renderWorkspaceDocument>[0],
    format: unknown,
    comparison?: { readonly leftId: string; readonly rightId: string },
  ): Promise<void> {
    if (format !== "markdown" && format !== "json") return;
    if (this.pendingExports.has(workspaceKey)) return;
    const folder = vscode.workspace.workspaceFolders?.find(
      ({ uri }) => uri.toString() === workspaceKey,
    );
    if (!folder) return;
    const allowed = () =>
      vscode.workspace.isTrusted &&
      this.panels.get(workspaceKey) === panel &&
      vscode.workspace.workspaceFolders?.includes(folder) === true &&
      folder.uri.fsPath === snapshot.workspaceRoot &&
      this.projects.snapshotFor(workspaceKey) === snapshot;
    if (!allowed()) return;
    this.pendingExports.add(workspaceKey);
    try {
      const destination = await vscode.window.showSaveDialog({
        title: "Export privacy-safe Rehearsal report",
        defaultUri: vscode.Uri.joinPath(
          folder.uri,
          verificationReportFilename(snapshot.workspaceName, format),
        ),
        filters:
          format === "markdown" ? { Markdown: ["md"] } : { JSON: ["json"] },
      });
      if (!destination) return;
      if (
        !allowed() ||
        destination.scheme !== "file" ||
        destination.authority !== "" ||
        destination.query !== "" ||
        destination.fragment !== "" ||
        !isAbsolute(destination.fsPath)
      )
        throw new Error("Report export context or local destination changed.");
      const report = buildVerificationReport(snapshot, new Date(), {
        extensionVersion: this.extensionVersion,
        ...(comparison ? { comparison } : {}),
      });
      const content =
        format === "markdown"
          ? renderVerificationReportMarkdown(report)
          : renderVerificationReportJson(report);
      if (!allowed()) throw new Error("Report export context changed.");
      await vscode.workspace.fs.writeFile(
        destination,
        new TextEncoder().encode(content),
      );
      if (allowed())
        void vscode.window.showInformationMessage(
          "Saved the Rehearsal verification report.",
        );
    } catch {
      void vscode.window.showErrorMessage(
        "Rehearsal could not export the report. Refresh the project, check trust and local file permissions, then choose a local destination and try again.",
      );
    } finally {
      this.pendingExports.delete(workspaceKey);
    }
  }

  private async reviewConfiguration(
    workspaceKey: string,
    snapshot: Parameters<typeof renderWorkspaceDocument>[0],
    rawValues: unknown,
    topologyConfigPath: string | undefined = snapshot.configPath,
  ): Promise<void> {
    if (!vscode.workspace.isTrusted) return;
    if (this.pendingConfigurationReviews.has(workspaceKey)) {
      void vscode.window.showInformationMessage(
        "Another configuration review is already in progress for this project. Finish or dismiss it before starting another.",
      );
      return;
    }
    if (snapshot.activity && snapshot.activity.state !== "idle") {
      void vscode.window.showWarningMessage(
        "Finish or diagnose the current Rehearsal operation before editing its configuration.",
      );
      return;
    }
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
    const reviewPanel = this.panels.get(workspaceKey);
    const identity = (
      current: Parameters<typeof renderWorkspaceDocument>[0] | undefined,
      sourceSha256: string | null = current?.configurationMetadata
        ?.sourceSha256 ?? null,
    ) =>
      current
        ? JSON.stringify([
            current.workspaceRoot,
            current.configPath ?? null,
            current.version ?? null,
            sourceSha256,
          ])
        : null;
    const reviewedSnapshot = this.projects.snapshotFor(workspaceKey);
    const reviewedIdentity = identity(reviewedSnapshot);
    const requireReview = (savedSourceSha256?: string) => {
      if (!vscode.workspace.isTrusted) this.configurationReviews.clear();
      const current = this.projects.snapshotFor(workspaceKey);
      const observedOwnSave =
        savedSourceSha256 !== undefined &&
        current?.configPath === snapshot.configPath &&
        current?.configurationMetadata?.sourceSha256 === savedSourceSha256 &&
        identity(
          current,
          reviewedSnapshot?.configurationMetadata?.sourceSha256 ?? null,
        ) === reviewedIdentity;
      if (
        !reviewPanel ||
        this.panels.get(workspaceKey) !== reviewPanel ||
        !this.workspaceTokens.has(workspaceKey) ||
        !vscode.workspace.isTrusted ||
        !vscode.workspace.workspaceFolders?.some(
          ({ uri }) =>
            uri.toString() === workspaceKey && uri.fsPath === folder.uri.fsPath,
        ) ||
        !current ||
        current.workspaceRoot !== folder.uri.fsPath ||
        (identity(current) !== reviewedIdentity && !observedOwnSave) ||
        (current.activity && current.activity.state !== "idle") ||
        [
          "operation_active",
          "operation_attention",
          "error",
          "untrusted",
        ].includes(current.availability)
      )
        throw new ConfigurationReviewError(
          "Configuration review stopped because project trust, identity or availability changed. No further review action was performed. Refresh and review again.",
        );
    };
    const inspectBoundary = async () => {
      requireReview();
      const root = await realpath(folder.uri.fsPath);
      requireReview();
      let candidate = root;
      let device = 0;
      let inode = 0;
      const components = local.split(sep).filter(Boolean);
      for (const [index, component] of components.entries()) {
        candidate = join(candidate, component);
        const entry = await lstat(candidate);
        requireReview();
        if (
          entry.isSymbolicLink() ||
          (index === components.length - 1
            ? !entry.isFile()
            : !entry.isDirectory())
        )
          throw new ConfigurationReviewError(
            "Configuration review requires a regular project-local file with no symbolic-link redirects. Open and review linked configuration manually instead.",
          );
        device = entry.dev;
        inode = entry.ino;
      }
      const file = await realpath(candidate);
      requireReview();
      if (
        !components.length ||
        file !== candidate ||
        relative(root, file).startsWith(`..${sep}`)
      )
        throw new ConfigurationReviewError(
          "Configuration review refused a path outside its original project.",
        );
      return { file, identity: JSON.stringify([root, file, device, inode]) };
    };
    this.pendingConfigurationReviews.add(workspaceKey);
    try {
      requireReview();
      const boundary = await inspectBoundary();
      const requireBoundary = async () => {
        if ((await inspectBoundary()).identity !== boundary.identity)
          throw new ConfigurationReviewError(
            "Configuration file identity changed during review. Refresh and review the current regular file before applying changes.",
          );
      };
      const document = await vscode.workspace.openTextDocument(
        vscode.Uri.file(boundary.file),
      );
      requireReview();
      if (document.isDirty) {
        throw new ConfigurationReviewError(
          "Save or discard the current configuration edits before reviewing another proposal.",
        );
      }
      const before = document.getText();
      if (Buffer.byteLength(before) > 1024 * 1024) {
        throw new ConfigurationReviewError(
          "The active configuration is too large for safe editing.",
        );
      }
      const fingerprint = configurationFingerprint(before);
      const requireUnchanged = () => {
        requireReview();
        if (
          document.isClosed ||
          document.isDirty ||
          configurationFingerprint(document.getText()) !== fingerprint
        )
          throw new ConfigurationReviewError(
            "The configuration changed during review. Refresh Rehearsal and review the current source.",
          );
      };
      const idle = async () => {
        requireUnchanged();
        const result = await runRehearsalJson<unknown>({
          workspaceRoot: folder.uri.fsPath,
          command: ["activity"],
          expectedCommand: "activity",
          ...(snapshot.configPath ? { configPath: snapshot.configPath } : {}),
        });
        requireUnchanged();
        if (parseActivityData(result.result.data).state !== "idle")
          throw new ConfigurationReviewError(
            "Rehearsal is not idle. Finish or diagnose the owning operation before changing its configuration.",
          );
      };
      await idle();
      requireUnchanged();
      const generic =
        rawValues &&
        typeof rawValues === "object" &&
        !Array.isArray(rawValues) &&
        "fields" in rawValues;
      const resolved = await resolveWorkspaceRehearsal(folder.uri.fsPath);
      requireUnchanged();
      let metadata: ConfigurationMetadata | undefined;
      if (resolved.configurationReviewSchema === 1) {
        const response = await runRehearsalJson<unknown>({
          workspaceRoot: folder.uri.fsPath,
          configPath: snapshot.configPath,
          command: ["configuration"],
          expectedCommand: "configuration",
        });
        requireUnchanged();
        metadata = parseConfigurationMetadata(response.result.data);
        if (
          metadata.sourceSha256 !== fingerprint ||
          metadata.path.replaceAll("\\", "/") !==
            snapshot.configPath.replaceAll("\\", "/")
        )
          throw new ConfigurationReviewError(
            "Configuration changed before review. Refresh and try again.",
          );
      }
      const changes = generic
        ? parseStructuredConfigurationValues(rawValues, metadata)
        : null;
      const result = changes
        ? {
            source: editLiteralConfiguration(before, changes),
            changedFields: changes.map((change) => change.path),
          }
        : applyConfigurationProposal({
            source: before,
            proposal: parseConfigurationProposal(rawValues),
          });
      if (result.changedFields.length === 0) {
        void vscode.window.showInformationMessage(
          "The proposed values already match the active configuration.",
        );
        return;
      }
      const reviewUri = this.configurationReviews.create(
        workspaceKey,
        configurationDiff({
          path: snapshot.configPath,
          before,
          after: result.source,
        }),
      );
      const diffDocument = await vscode.workspace.openTextDocument(reviewUri);
      requireUnchanged();
      await vscode.window.showTextDocument(diffDocument, {
        preview: true,
        preserveFocus: false,
      });
      requireUnchanged();
      const selected = await vscode.window.showWarningMessage(
        `Apply ${result.changedFields.length} reviewed Rehearsal configuration ${result.changedFields.length === 1 ? "change" : "changes"}?`,
        {
          modal: true,
          detail: `${result.changedFields.join(", ")}\n\nApplication commands are stored but are not executed by this edit. Rehearsal validates the complete configuration before any later operation.`,
        },
        "Apply Changes",
      );
      if (selected !== "Apply Changes") return;
      requireUnchanged();
      await requireBoundary();
      requireUnchanged();
      if (metadata) {
        const validatedChanges =
          changes ??
          configurationProposalChanges(parseConfigurationProposal(rawValues));
        const temporary = await mkdtemp(
          join(folder.uri.fsPath, ".rehearsal-config-review-"),
        );
        const input = join(temporary, "proposal.json");
        try {
          requireUnchanged();
          await writeFile(
            input,
            JSON.stringify({
              schemaVersion: 1,
              sourceSha256: fingerprint,
              changes: validatedChanges,
              ...(topologyConfigPath && metadata.dependentTargetReview
                ? { topologyConfigPath }
                : {}),
            }),
            { mode: 0o600, flag: "wx" },
          );
          requireUnchanged();
          const validation = await runRehearsalJson<{
            sourceSha256: string;
            validation: string;
            writesConfiguration: boolean;
            executesProposedCommands: boolean;
          }>({
            workspaceRoot: folder.uri.fsPath,
            configPath: snapshot.configPath,
            command: [
              "configuration",
              "review",
              `--proposal=${relative(folder.uri.fsPath, input)}`,
            ],
            expectedCommand: "configuration review",
          });
          requireUnchanged();
          if (
            validation.result.data.sourceSha256 !== fingerprint ||
            validation.result.data.validation !== "complete-config-passed" ||
            validation.result.data.writesConfiguration !== false ||
            validation.result.data.executesProposedCommands !== false
          )
            throw new ConfigurationReviewError(
              "Core refused the exact configuration proposal.",
            );
        } finally {
          await unlink(input).catch(() => undefined);
          await rmdir(temporary).catch(() => undefined);
        }
        requireUnchanged();
      }
      const edit = new vscode.WorkspaceEdit();
      await idle();
      await requireBoundary();
      requireUnchanged();
      const end = document.lineAt(document.lineCount - 1).range.end;
      edit.replace(
        document.uri,
        new vscode.Range(new vscode.Position(0, 0), end),
        result.source,
      );
      if (!(await vscode.workspace.applyEdit(edit))) {
        throw new ConfigurationReviewError(
          "VS Code could not save the reviewed configuration changes.",
        );
      }
      requireReview();
      await requireBoundary();
      requireReview();
      if (
        document.isClosed ||
        configurationFingerprint(document.getText()) !==
          configurationFingerprint(result.source)
      )
        throw new ConfigurationReviewError(
          "Configuration changed before saving. Review the unsaved document; it was not saved by this review.",
        );
      if (!(await document.save()))
        throw new ConfigurationReviewError(
          "VS Code could not save the reviewed configuration changes.",
        );
      requireReview(configurationFingerprint(result.source));
      if (
        document.isClosed ||
        document.isDirty ||
        configurationFingerprint(document.getText()) !==
          configurationFingerprint(result.source)
      )
        throw new ConfigurationReviewError(
          "Configuration changed while saving. Review the current file and any unsaved edits before trying again. This review did not overwrite or revert those changes.",
        );
      void vscode.window.showInformationMessage(
        "Applied the reviewed Rehearsal configuration changes.",
      );
      await this.projects.refreshWorkspace(workspaceKey);
    } catch (error) {
      void vscode.window.showErrorMessage(
        error instanceof ConfigurationReviewError
          ? error.message
          : "Rehearsal could not complete this configuration review. Refresh the project, check trust and local file permissions, then review the current configuration and try again.",
      );
    } finally {
      this.pendingConfigurationReviews.delete(workspaceKey);
    }
  }

  private render(
    panel: vscode.WebviewPanel,
    workspaceKey: string,
    snapshot: Parameters<typeof renderWorkspaceDocument>[0],
  ): void {
    const workspaceToken = this.workspaceTokens.get(workspaceKey);
    if (!workspaceToken) return;
    if (!vscode.workspace.isTrusted) {
      this.extensionReleases.clear();
      this.configurationReviews.clear();
      snapshot = {
        workspaceName: snapshot.workspaceName,
        workspaceRoot: snapshot.workspaceRoot,
        availability: "untrusted",
      };
    }
    if (panel.visible === false) {
      this.liveDocuments.delete(workspaceKey);
      return;
    }
    const unsafe =
      !vscode.workspace.isTrusted ||
      [
        "operation_active",
        "operation_attention",
        "error",
        "untrusted",
      ].includes(snapshot.availability);
    if (this.editing.has(workspaceKey) && !unsafe) {
      void panel.webview.postMessage({
        type: "inspectionUpdated",
        loading: this.projects.inspectionStateFor(workspaceKey) === "loading",
      });
      return;
    }
    // A safety transition must clear stale detail/form controls even during editing.
    if (unsafe) this.editing.delete(workspaceKey);
    const activityHistory = this.actions.activityFor(workspaceKey);
    const inspectionState = this.projects.inspectionStateFor(workspaceKey);
    const activity = snapshot.activity;
    const operation = activity?.operation;
    const liveKey =
      vscode.workspace.isTrusted &&
      snapshot.availability === "operation_active" &&
      activity?.state === "busy" &&
      operation
        ? JSON.stringify({
            ...snapshot,
            activity: {
              ...activity,
              operation: {
                ...operation,
                // Durations/stages are patched in place, not a reason to reload HTML.
                progress: operation.progress
                  ? { operationId: operation.progress.operationId }
                  : operation.progress,
              },
            },
            activityHistory,
            inspectionState,
          })
        : null;
    const currentDocument = this.liveDocuments.get(workspaceKey);
    if (liveKey !== null && currentDocument?.key === liveKey) {
      const delivery = ++currentDocument.delivery;
      const recover = () => {
        if (
          this.panels.get(workspaceKey) !== panel ||
          this.liveDocuments.get(workspaceKey) !== currentDocument ||
          currentDocument.delivery !== delivery
        )
          return;
        this.liveDocuments.delete(workspaceKey);
        const latest = this.projects.snapshotFor(workspaceKey);
        if (latest) this.render(panel, workspaceKey, latest);
      };
      void Promise.resolve(
        panel.webview.postMessage({
          type: "operationProgressUpdated",
          html: renderOperationProgress(snapshot),
        }),
      ).then((delivered) => {
        if (!delivered) recover();
      }, recover);
      return;
    }
    this.liveDocuments.delete(workspaceKey);
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
        extensionVersion: this.extensionVersion,
        extensionRelease: this.extensionReleases.get(workspaceKey),
      },
      this.activePages.get(workspaceKey) ?? "overview",
      this.preferences.get(workspaceKey) ?? DEFAULT_WORKSPACE_PREFERENCES,
      activityHistory,
      inspectionState,
    );
    if (liveKey !== null) {
      this.liveDocuments.set(workspaceKey, { key: liveKey, delivery: 0 });
    }
  }

  private loadingSnapshot(
    workspaceKey: string,
  ): Parameters<typeof renderWorkspaceDocument>[0] | undefined {
    const folder = (vscode.workspace.workspaceFolders ?? []).find(
      ({ uri }) => uri.toString() === workspaceKey,
    );
    return folder
      ? {
          workspaceName: folder.name,
          workspaceRoot: folder.uri.fsPath,
          availability: "loading",
        }
      : undefined;
  }
}
