import { randomBytes } from "node:crypto";
import { constants as filesystemConstants } from "node:fs";
import {
  extensionReleasePresentation,
  type ExtensionReleaseEvidence,
} from "./extension_release_view.js";
import {
  lstat,
  realpath,
  mkdtemp,
  open,
  writeFile,
  unlink,
  rmdir,
} from "node:fs/promises";
import { isAbsolute, join } from "node:path";
import {
  runRehearsalJson,
  resolveWorkspaceRehearsal,
  RehearsalCliError,
} from "./process_adapter.js";
import {
  parseConfigurationMetadata,
  ConfigurationInputError,
  type ConfigurationMetadata,
} from "./configuration_contract.js";
import { editLiteralConfiguration } from "./literal_configuration.js";
import { parseActivityData } from "./contracts.js";
import {
  openSandboxSessionState,
  renderOperationProgress,
} from "./operation_progress.js";
import { RehearsalReviewPanels } from "./review_panel.js";
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
import { readExactMigrationSource } from "./migration_failure_source.js";
import {
  migrationSourceDocumentMatches,
  readExactMigrationInput,
} from "./migration_source.js";
import { findMigrationInsight } from "./migration_insights.js";
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
  private readonly formDraftRevisions = new Map<string, number>();
  private readonly pendingExports = new Set<string>();
  private readonly pendingConfigurationReviews = new Set<string>();
  private readonly liveDocuments = new Map<
    string,
    { readonly key: string; delivery: number }
  >();
  private readonly subscriptions: vscode.Disposable[];
  private readonly reviewPanels: RehearsalReviewPanels;

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly projects: RehearsalTreeProvider,
    private readonly actions: RehearsalWorkspaceActions,
    private readonly workspaceState: vscode.Memento,
    private readonly extensionVersion = "unavailable",
    reviewPanels?: RehearsalReviewPanels,
    private readonly mayStartWork: () => boolean = () => true,
  ) {
    this.reviewPanels = reviewPanels ?? new RehearsalReviewPanels(extensionUri);
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
            this.reviewPanels.releaseWorkspace(workspaceKey);
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
      this.reviewPanels.releaseWorkspace(workspaceKey);
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
    this.formDraftRevisions.clear();
    this.liveDocuments.clear();
    this.reviewPanels.dispose();
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
    if (message.type === "openMigrationInsight") {
      await this.openMigrationInsight(panel, workspaceKey, message.findingId);
      return;
    }
    if (message.type === "openMigrationFailure") {
      await this.openMigrationFailure(panel, workspaceKey, message.operationId);
      return;
    }
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
      const applied = await this.reviewConfiguration(
        workspaceKey,
        { ...snapshot, configPath },
        message.values,
        snapshot.configPath,
      );
      const refreshed = this.projects.snapshotFor(workspaceKey);
      if (applied && refreshed) this.render(panel, workspaceKey, refreshed);
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
      if (
        !vscode.workspace.isTrusted ||
        !vscode.workspace.workspaceFolders?.some(
          ({ uri }) => uri.toString() === workspaceKey,
        )
      )
        return;
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
      const applied = await this.reviewConfiguration(
        workspaceKey,
        snapshot,
        message.values,
      );
      const refreshed = this.projects.snapshotFor(workspaceKey);
      if (applied && refreshed) this.render(panel, workspaceKey, refreshed);
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
  ): Promise<boolean> {
    if (!this.mayStartWork() || !vscode.workspace.isTrusted) return false;
    if (this.pendingConfigurationReviews.has(workspaceKey)) {
      void vscode.window.showInformationMessage(
        "Another configuration review is already in progress for this project. Finish or dismiss it before starting another.",
      );
      return false;
    }
    if (snapshot.activity && snapshot.activity.state !== "idle") {
      void vscode.window.showWarningMessage(
        "Finish or diagnose the current Rehearsal operation before editing its configuration.",
      );
      return false;
    }
    if (!snapshot.configPath) {
      void vscode.window.showInformationMessage(
        "Create a Rehearsal configuration before applying custom values.",
      );
      return false;
    }
    const folder = (vscode.workspace.workspaceFolders ?? []).find(
      ({ uri }) => uri.toString() === workspaceKey,
    );
    if (!folder) return false;
    const absolute = resolve(folder.uri.fsPath, snapshot.configPath);
    const local = relative(folder.uri.fsPath, absolute);
    if (local === ".." || local.startsWith(`..${sep}`)) return false;
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
      if (!vscode.workspace.isTrusted)
        this.reviewPanels.releaseWorkspace(workspaceKey);
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
        !this.mayStartWork() ||
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
          "This review no longer matches the current configuration or workspace. Saved and unsaved edits were not reverted. Close review, refresh Rehearsal, and review the current source.",
        );
    };
    const inspectBoundary = async (savedSourceSha256?: string) => {
      requireReview(savedSourceSha256);
      const root = await realpath(folder.uri.fsPath);
      requireReview(savedSourceSha256);
      let candidate = root;
      let device = 0;
      let inode = 0;
      const components = local.split(sep).filter(Boolean);
      for (const [index, component] of components.entries()) {
        candidate = join(candidate, component);
        const entry = await lstat(candidate);
        requireReview(savedSourceSha256);
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
      requireReview(savedSourceSha256);
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
      const requireBoundary = async (savedSourceSha256?: string) => {
        if (
          (await inspectBoundary(savedSourceSha256)).identity !==
          boundary.identity
        )
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
          ...(snapshot.configPath ? { configPath: snapshot.configPath } : {}),
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
      const savedFingerprint = configurationFingerprint(result.source);
      if (Buffer.byteLength(result.source) > 1024 * 1024)
        throw new ConfigurationReviewError(
          "The proposed configuration is too large for safe editing.",
        );
      const requireSavedBytes = async () => {
        requireReview(savedFingerprint);
        await requireBoundary(savedFingerprint);
        const file = await open(
          boundary.file,
          filesystemConstants.O_RDONLY |
            filesystemConstants.O_NONBLOCK |
            filesystemConstants.O_NOFOLLOW,
        );
        try {
          requireReview(savedFingerprint);
          const stat = await file.stat();
          requireReview(savedFingerprint);
          const expected = Buffer.from(result.source, "utf8");
          if (
            !stat.isFile() ||
            JSON.stringify([
              await realpath(folder.uri.fsPath),
              boundary.file,
              stat.dev,
              stat.ino,
            ]) !== boundary.identity
          )
            throw new ConfigurationReviewError(
              "The saved configuration could not be confirmed at its reviewed file. Review the current source before trying again; no automatic retry was started.",
            );
          if (stat.size !== expected.byteLength)
            throw new ConfigurationReviewError(
              "Configuration changed while saving. Review the current file and any unsaved edits before trying again. This review did not overwrite or revert those changes.",
            );
          requireReview(savedFingerprint);
          const bytes = Buffer.alloc(expected.byteLength + 1);
          let total = 0;
          while (total < bytes.byteLength) {
            const { bytesRead } = await file.read(
              bytes,
              total,
              bytes.byteLength - total,
              total,
            );
            requireReview(savedFingerprint);
            if (bytesRead === 0) break;
            total += bytesRead;
          }
          if (
            total !== expected.byteLength ||
            !bytes.subarray(0, total).equals(expected)
          )
            throw new ConfigurationReviewError(
              "Configuration changed while saving. Review the current file and any unsaved edits before trying again. This review did not overwrite or revert those changes.",
            );
          await requireBoundary(savedFingerprint);
        } finally {
          await file.close();
        }
        requireReview(savedFingerprint);
      };
      if (result.changedFields.length === 0) {
        void vscode.window.showInformationMessage(
          "The proposed values already match the active configuration.",
        );
        return false;
      }
      return await this.reviewPanels.review({
        workspaceKey,
        workspaceName: snapshot.workspaceName,
        title: "Review configuration changes",
        description:
          "Read the complete diff before saving. Nothing changes until you choose Apply changes. Application commands are not run by this edit.",
        path: snapshot.configPath,
        detail: configurationDiff({
          path: snapshot.configPath,
          before,
          after: result.source,
        }),
        format: "diff",
        changedFields: result.changedFields,
        applyLabel: "Apply changes",
        successMessage:
          "Saved the reviewed configuration changes. Return to your project to inspect the saved values; use Refresh if its check is still pending.",
        canApply: requireUnchanged,
        failureMessage: (error) =>
          error instanceof ConfigurationReviewError ? error.message : undefined,
        onReturn: () => reviewPanel?.reveal(vscode.ViewColumn.Active, false),
        onApply: async () => {
          requireUnchanged();
          await requireBoundary();
          requireUnchanged();
          if (metadata) {
            const validatedChanges =
              changes ??
              configurationProposalChanges(
                parseConfigurationProposal(rawValues),
              );
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
                ...(snapshot.configPath
                  ? { configPath: snapshot.configPath }
                  : {}),
                command: [
                  "configuration",
                  "review",
                  `--proposal=${relative(folder.uri.fsPath, input)}`,
                ],
                expectedCommand: "configuration review",
              }).catch((error: unknown) => {
                if (
                  error instanceof RehearsalCliError &&
                  error.exitCode === 2 &&
                  error.result.error.category === "configuration_invalid" &&
                  error.result.error.code === "CONFIGURATION_INVALID"
                )
                  throw new ConfigurationReviewError(
                    "Core refused this configuration proposal. This review did not save it. Close review, check the proposed settings, and review again.",
                  );
                throw error;
              });
              requireUnchanged();
              if (
                validation.result.data.sourceSha256 !== fingerprint ||
                validation.result.data.validation !==
                  "complete-config-passed" ||
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
          // Once our approved edit has applied, an editor auto-save may publish
          // exactly those bytes before this continuation resumes. Only that own
          // fingerprint is allowed through the otherwise unchanged guards.
          requireReview(savedFingerprint);
          await requireBoundary(savedFingerprint);
          requireReview(savedFingerprint);
          if (
            !document.isClosed &&
            configurationFingerprint(document.getText()) !== savedFingerprint
          )
            throw new ConfigurationReviewError(
              "Configuration changed before saving. Review the unsaved document; it was not saved by this review.",
            );
          if (!document.isClosed && !(await document.save()))
            throw new ConfigurationReviewError(
              "VS Code could not save the reviewed configuration changes.",
            );
          requireReview(savedFingerprint);
          if (
            !document.isClosed &&
            (document.isDirty ||
              configurationFingerprint(document.getText()) !== savedFingerprint)
          )
            throw new ConfigurationReviewError(
              "Configuration changed while saving. Review the current file and any unsaved edits before trying again. This review did not overwrite or revert those changes.",
            );
          // A hidden TextDocument can close after save. Its lifetime and save()
          // result are not durable evidence: confirm bounded, byte-exact data
          // through the original canonical regular-file boundary instead.
          await requireSavedBytes();
          if (
            !document.isClosed &&
            (document.isDirty ||
              configurationFingerprint(document.getText()) !== savedFingerprint)
          )
            throw new ConfigurationReviewError(
              "Configuration changed while confirming the save. Review the current file and any unsaved edits before trying again; no automatic retry was started.",
            );
          void vscode.window.showInformationMessage(
            "Applied the reviewed Rehearsal configuration changes.",
          );
          this.editing.delete(workspaceKey);
          // Expire pre-save drafts even if a file watcher owns the next inspection.
          this.formDraftRevisions.set(
            workspaceKey,
            (this.formDraftRevisions.get(workspaceKey) ?? 0) + 1,
          );
          try {
            await this.projects.refreshWorkspace(workspaceKey);
          } catch {
            void vscode.window.showWarningMessage(
              "Configuration changes were saved, but the project check could not refresh. Return to the project and choose Refresh; do not apply the same proposal again.",
            );
          }
        },
      });
    } catch (error) {
      void vscode.window.showErrorMessage(
        error instanceof ConfigurationReviewError ||
          error instanceof ConfigurationInputError
          ? error.message
          : "Rehearsal could not complete this configuration review. Refresh the project, check trust and local file permissions, then review the current configuration and try again.",
      );
      return false;
    } finally {
      this.pendingConfigurationReviews.delete(workspaceKey);
    }
  }

  private async openMigrationInsight(
    panel: vscode.WebviewPanel,
    workspaceKey: string,
    findingId: string,
  ): Promise<void> {
    try {
      const snapshot = this.projects.snapshotFor(workspaceKey);
      if (snapshot?.migrationInsights?.state !== "available") return;
      const report = snapshot.migrationInsights.report;
      const initial = findMigrationInsight(report, findingId);
      if (!initial?.entry.workspaceRelativePath) return;
      const requireCurrent = (): string => {
        const folder = vscode.workspace.workspaceFolders?.find(
          (entry) => entry.uri.toString() === workspaceKey,
        );
        if (
          this.disposed ||
          this.panels.get(workspaceKey) !== panel ||
          !vscode.workspace.isTrusted ||
          !folder ||
          this.projects.snapshotFor(workspaceKey) !== snapshot ||
          snapshot.availability !== "ready" ||
          snapshot.activity?.state !== "idle" ||
          !snapshot.migrationReview ||
          snapshot.migrationReview.candidateSha256 !== report.candidateSha256 ||
          folder.uri.fsPath !== snapshot.workspaceRoot
        )
          throw new Error("Static migration input is no longer current.");
        return folder.uri.fsPath;
      };
      const source = {
        filename: initial.entry.filename,
        sha256: initial.entry.sha256,
        workspaceRelativePath: initial.entry.workspaceRelativePath,
      };
      const root = requireCurrent(),
        checked = await readExactMigrationInput(root, source);
      if (requireCurrent() !== root) throw new Error("Workspace changed.");
      const document = await vscode.workspace.openTextDocument(
        vscode.Uri.file(checked.path),
      );
      const requireExactDocument = () => {
        requireCurrent();
        if (
          document.uri.scheme !== "file" ||
          document.uri.fsPath !== checked.path ||
          document.isDirty ||
          !migrationSourceDocumentMatches(checked.text, document.getText()) ||
          initial.finding.line > document.lineCount ||
          initial.finding.column >
            document.lineAt(initial.finding.line - 1).text.length + 1
        )
          throw new Error("Static migration input or position changed.");
      };
      requireExactDocument();
      const confirmed = await readExactMigrationInput(root, source);
      requireExactDocument();
      if (confirmed.identity !== checked.identity || requireCurrent() !== root)
        throw new Error("Migration input changed.");
      const position = new vscode.Position(
        initial.finding.line - 1,
        initial.finding.column - 1,
      );
      await vscode.window.showTextDocument(document, {
        preview: true,
        selection: new vscode.Range(position, position),
      });
    } catch {
      void vscode.window.showWarningMessage(
        "This static finding no longer matches an unchanged local migration or position. Refresh and review the current migration manually. No SQL was executed and no file was changed.",
      );
    }
  }

  private async openMigrationFailure(
    panel: vscode.WebviewPanel,
    workspaceKey: string,
    operationId: string,
  ): Promise<void> {
    try {
      const initial = this.projects
        .snapshotFor(workspaceKey)
        ?.activity?.recentFailures?.find(
          (entry) => entry.operationId === operationId,
        )?.diagnostic.source;
      if (!initial?.workspaceRelativePath) return;
      const binding = JSON.stringify(initial);
      const requireCurrent = (): string => {
        const folder = vscode.workspace.workspaceFolders?.find(
          (entry) => entry.uri.toString() === workspaceKey,
        );
        const activity = this.projects.snapshotFor(workspaceKey)?.activity;
        const source = activity?.recentFailures?.find(
          (entry) => entry.operationId === operationId,
        )?.diagnostic.source;
        if (
          this.disposed ||
          this.panels.get(workspaceKey) !== panel ||
          !vscode.workspace.isTrusted ||
          !folder ||
          JSON.stringify(source) !== binding ||
          !activity?.recent?.some(
            (entry) =>
              entry.progress.operationId === operationId &&
              entry.progress.state === "failed",
          )
        )
          throw new Error("Migration source is no longer current.");
        return folder.uri.fsPath;
      };
      const root = requireCurrent();
      const checked = await readExactMigrationSource(root, initial);
      if (requireCurrent() !== root) throw new Error("Workspace changed.");
      const document = await vscode.workspace.openTextDocument(
        vscode.Uri.file(checked.path),
      );
      requireCurrent();
      if (
        document.uri.scheme !== "file" ||
        document.uri.fsPath !== checked.path ||
        document.isDirty ||
        !migrationSourceDocumentMatches(checked.text, document.getText())
      )
        throw new Error("Migration input changed.");
      const confirmed = await readExactMigrationSource(root, initial);
      if (
        confirmed.identity !== checked.identity ||
        requireCurrent() !== root ||
        document.isDirty ||
        !migrationSourceDocumentMatches(checked.text, document.getText())
      )
        throw new Error("Migration input changed.");
      await vscode.window.showTextDocument(document, { preview: true });
    } catch {
      void vscode.window.showWarningMessage(
        "This migration input changed, is no longer available, or cannot be safely opened. Refresh and review the current local migration manually. No SQL was executed and no file was changed.",
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
    if (!vscode.workspace.isTrusted) {
      this.extensionReleases.clear();
      this.reviewPanels.releaseWorkspace(workspaceKey);
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
          sandboxSessionState: openSandboxSessionState(snapshot),
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
        formDraftRevision: this.formDraftRevisions.get(workspaceKey) ?? 0,
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
