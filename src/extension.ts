import * as vscode from "vscode";
import { RehearsalTreeProvider } from "./tree_provider.js";
import { RehearsalWorkspacePanels } from "./workspace_panel.js";
import { RehearsalWorkspaceActions } from "./workspace_actions.js";
import { AutomaticDashboardController } from "./automatic_dashboard.js";
import { createUpdateAdvisory } from "./update_advisory_host.js";
import { RehearsalReviewPanels } from "./review_panel.js";
import { AutomaticUpdateScheduler } from "./automatic_update_scheduler.js";
import { readAutomaticUpdateSettings } from "./automatic_update_settings.js";
import { openBundledDocument } from "./bundled_documents.js";
import { LEGACY_EXTENSION_ID } from "./extension_identity.js";
import { createLegacyExtensionGuard } from "./extension_migration.js";

const DOCUMENTATION_URL = "https://ddupasquier.github.io/rehearsal-db/";

const selectWorkspaceKey = async (
  provided: unknown,
): Promise<string | undefined> => {
  if (typeof provided === "string") return provided;
  const folders = vscode.workspace.workspaceFolders ?? [];
  if (folders.length === 0) {
    void vscode.window.showInformationMessage(
      "Open a project folder to view its Rehearsal workspace.",
    );
    return undefined;
  }
  if (folders.length === 1) return folders[0]?.uri.toString();
  const selected = await vscode.window.showQuickPick(
    folders.map((folder) => ({
      label: folder.name,
      description: folder.uri.fsPath,
      workspaceKey: folder.uri.toString(),
    })),
    {
      title: "Open Rehearsal Workspace",
      placeHolder: "Choose a workspace folder",
    },
  );
  return selected?.workspaceKey;
};

export const activate = (context: vscode.ExtensionContext): void => {
  const mayStartWork = createLegacyExtensionGuard(
    () => vscode.extensions.getExtension(LEGACY_EXTENSION_ID) !== undefined,
    () => {
      void vscode.window
        .showWarningMessage(
          "Rehearsal DB cannot start new work while the legacy Rehearsal extension is present. Finish any active commands, save work, explicitly uninstall rehearsal-db.rehearsal in Extensions, then reload VS Code. Project configuration, baselines and database data are not changed by this migration.",
          "Open Extensions",
        )
        .then((choice) => {
          if (choice === "Open Extensions")
            return vscode.commands.executeCommand(
              "workbench.extensions.search",
              `@id:${LEGACY_EXTENSION_ID}`,
            );
          return undefined;
        });
    },
  );
  if (!mayStartWork()) return;
  const output = vscode.window.createOutputChannel("Rehearsal", { log: true });
  const provider = new RehearsalTreeProvider(output);
  const reviews = new RehearsalReviewPanels(context.extensionUri);
  const actions = new RehearsalWorkspaceActions(
    provider,
    output,
    context.workspaceState,
    reviews,
    mayStartWork,
  );
  const workspaces = new RehearsalWorkspacePanels(
    context.extensionUri,
    provider,
    actions,
    context.workspaceState,
    String(context.extension.packageJSON.version),
    reviews,
    mayStartWork,
  );
  const tree = vscode.window.createTreeView("rehearsal.projects", {
    treeDataProvider: provider,
    showCollapseAll: true,
  });
  const automaticDashboard = new AutomaticDashboardController();
  const updates = createUpdateAdvisory({
    projects: provider,
    actions,
    state: context.workspaceState,
    version: String(context.extension.packageJSON.version),
    preview: context.extension.packageJSON.preview === true,
    extensionUri: context.extensionUri,
    storagePath: context.globalStorageUri.fsPath,
    onExtensionRelease: (key, evidence) =>
      workspaces.updateExtensionRelease(key, evidence),
  });
  const tryAutomaticDashboard = (workspaceKey: string): void => {
    const folders = vscode.workspace.workspaceFolders ?? [];
    const folder = folders.find(({ uri }) => uri.toString() === workspaceKey);
    if (!folder) return;
    const selected = automaticDashboard.choose({
      enabled: vscode.workspace
        .getConfiguration("rehearsal", folder.uri)
        .get<boolean>("openDashboardAutomatically", true),
      trusted: vscode.workspace.isTrusted,
      workspaceKeys: folders.map(({ uri }) => uri.toString()),
      updatedWorkspaceKey: workspaceKey,
    });
    if (!selected) return;
    output.info(
      `Opening the Rehearsal dashboard automatically for ${folder.name}.`,
    );
    void workspaces
      .open(selected)
      .then(() => {
        output.info(
          `Opened the Rehearsal dashboard automatically for ${folder.name}.`,
        );
      })
      .catch((error: unknown) => {
        const message = error instanceof Error ? error.message : String(error);
        output.error(
          `Automatic dashboard opening failed for ${folder.name}: ${message}`,
        );
      });
  };
  const automaticUpdateScheduler = new AutomaticUpdateScheduler(async () => {
    if (!mayStartWork()) return;
    for (const folder of vscode.workspace.workspaceFolders ?? []) {
      const snapshot = provider.snapshotFor(folder.uri.toString());
      if (!snapshot || snapshot.availability === "loading") continue;
      await updates.check(folder.uri.toString(), false);
    }
  });
  const scheduleAutomaticUpdates = () => {
    const settings = readAutomaticUpdateSettings();
    automaticUpdateScheduler.setEnabled(
      mayStartWork() && (settings.extension || settings.cli),
    );
  };
  scheduleAutomaticUpdates();
  context.subscriptions.push(
    output,
    provider,
    reviews,
    actions,
    workspaces,
    tree,
    updates,
    automaticUpdateScheduler,
    vscode.extensions.onDidChange(() => {
      if (mayStartWork()) return;
      automaticUpdateScheduler.setEnabled(false);
      updates.dispose();
    }),
    provider.onDidUpdateSnapshot(({ workspaceKey }) => {
      tryAutomaticDashboard(workspaceKey);
      if (mayStartWork()) void updates.open(workspaceKey);
    }),
    vscode.workspace.onDidChangeWorkspaceFolders(({ removed }) => {
      for (const folder of removed) updates.remove(folder.uri.toString());
      if (vscode.workspace.isTrusted) void provider.refresh();
    }),
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (event.affectsConfiguration("rehearsal.automaticUpdates")) {
        scheduleAutomaticUpdates();
        if (mayStartWork())
          for (const folder of vscode.workspace.workspaceFolders ?? []) {
            void updates.resumeAutomatic(folder.uri.toString());
            void updates.check(folder.uri.toString());
          }
      }
      if (!event.affectsConfiguration("rehearsal.openDashboardAutomatically"))
        return;
      const folders = vscode.workspace.workspaceFolders ?? [];
      if (folders.length === 1 && folders[0]) {
        tryAutomaticDashboard(folders[0].uri.toString());
      }
    }),
    vscode.commands.registerCommand("rehearsal.refresh", async () => {
      await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: "Checking Rehearsal projects",
          cancellable: true,
        },
        async (_progress, token) => provider.refresh(token),
      );
    }),
    vscode.commands.registerCommand(
      "rehearsal.checkUpdates",
      async (workspaceKey: unknown) => {
        if (!mayStartWork()) return;
        const selected = await selectWorkspaceKey(workspaceKey);
        if (selected) await updates.check(selected);
      },
    ),
    vscode.commands.registerCommand(
      "rehearsal.shutdownVm",
      async (workspaceKey: unknown) => {
        if (!mayStartWork()) return;
        const selected = await selectWorkspaceKey(workspaceKey);
        if (selected) await actions.reviewVmShutdown(selected);
      },
    ),
    vscode.commands.registerCommand(
      "rehearsal.configureUpdateChecks",
      async (workspaceKey: unknown) => {
        if (!mayStartWork()) return;
        const selected = await selectWorkspaceKey(workspaceKey);
        if (selected) await updates.configure(selected);
      },
    ),
    vscode.commands.registerCommand("rehearsal.openDocumentation", async () => {
      await vscode.env.openExternal(vscode.Uri.parse(DOCUMENTATION_URL));
    }),
    vscode.commands.registerCommand("rehearsal.openPrivacy", async () => {
      await openBundledDocument(context.extensionUri, "PRIVACY.md");
    }),
    vscode.commands.registerCommand("rehearsal.openSupport", async () => {
      await openBundledDocument(context.extensionUri, "SUPPORT.md");
    }),
    vscode.commands.registerCommand("rehearsal.openLicense", async () => {
      await openBundledDocument(context.extensionUri, "LICENSE");
    }),
    vscode.commands.registerCommand(
      "rehearsal.resetLocalState",
      async (workspaceKey: unknown) => {
        const selected = await selectWorkspaceKey(workspaceKey);
        if (!selected) return;
        const confirmed = await vscode.window.showWarningMessage(
          "Reset Rehearsal's saved editor preferences for this project?",
          {
            modal: true,
            detail:
              "This clears only view filters, the selected display profile, the custom loopback address, and the extension's bounded activity receipts. It does not change Rehearsal configuration, baselines, runtimes, databases, or Storage.",
          },
          "Reset Editor State",
        );
        if (confirmed !== "Reset Editor State") return;
        await workspaces.resetLocalState(selected);
        void vscode.window.showInformationMessage(
          "Reset the saved Rehearsal editor state for this project.",
        );
      },
    ),
    vscode.commands.registerCommand(
      "rehearsal.openWorkspace",
      async (workspaceKey: unknown) => {
        const selected = await selectWorkspaceKey(workspaceKey);
        if (selected) await workspaces.open(selected);
      },
    ),
    vscode.commands.registerCommand(
      "rehearsal.workspaceAction",
      async (workspaceToken: unknown, action: unknown) =>
        actions.runToken(workspaceToken, action),
    ),
    vscode.commands.registerCommand(
      "rehearsal.treeAction",
      async (workspaceKey: unknown, action: unknown) =>
        actions.runWorkspace(workspaceKey, action),
    ),
    vscode.commands.registerCommand(
      "rehearsal.showCliCommand",
      (node: Parameters<RehearsalTreeProvider["showCliCommand"]>[0]) =>
        provider.showCliCommand(node),
    ),
  );
  if (vscode.workspace.isTrusted) void provider.refresh();
};

export const deactivate = (): void => {};
