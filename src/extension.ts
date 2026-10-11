import * as vscode from "vscode";
import { RehearsalTreeProvider } from "./tree_provider.js";
import { RehearsalWorkspacePanels } from "./workspace_panel.js";
import { RehearsalWorkspaceActions } from "./workspace_actions.js";

const DOCUMENTATION_URL = "https://ddupasquier.github.io/rehearsal-db/";

const openBundledDocument = async (
  context: vscode.ExtensionContext,
  filename: "LICENSE" | "PRIVACY.md" | "SUPPORT.md",
): Promise<void> => {
  const uri = vscode.Uri.joinPath(context.extensionUri, filename);
  await vscode.window.showTextDocument(
    await vscode.workspace.openTextDocument(uri),
    { preview: true },
  );
};

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
  const output = vscode.window.createOutputChannel("Rehearsal", { log: true });
  const provider = new RehearsalTreeProvider(output);
  const actions = new RehearsalWorkspaceActions(
    provider,
    output,
    context.workspaceState,
  );
  const workspaces = new RehearsalWorkspacePanels(
    context.extensionUri,
    provider,
    actions,
    context.workspaceState,
  );
  const tree = vscode.window.createTreeView("rehearsal.projects", {
    treeDataProvider: provider,
    showCollapseAll: true,
  });
  context.subscriptions.push(
    output,
    provider,
    actions,
    workspaces,
    tree,
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
    vscode.commands.registerCommand("rehearsal.openDocumentation", async () => {
      await vscode.env.openExternal(vscode.Uri.parse(DOCUMENTATION_URL));
    }),
    vscode.commands.registerCommand("rehearsal.openPrivacy", async () => {
      await openBundledDocument(context, "PRIVACY.md");
    }),
    vscode.commands.registerCommand("rehearsal.openSupport", async () => {
      await openBundledDocument(context, "SUPPORT.md");
    }),
    vscode.commands.registerCommand("rehearsal.openLicense", async () => {
      await openBundledDocument(context, "LICENSE");
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
