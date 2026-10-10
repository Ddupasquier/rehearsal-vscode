import * as vscode from "vscode";
import { RehearsalTreeProvider } from "./tree_provider.js";

const DOCUMENTATION_URL = "https://ddupasquier.github.io/rehearsal-db/";

export const activate = (context: vscode.ExtensionContext): void => {
  const output = vscode.window.createOutputChannel("Rehearsal", { log: true });
  const provider = new RehearsalTreeProvider(output);
  const tree = vscode.window.createTreeView("rehearsal.projects", {
    treeDataProvider: provider,
    showCollapseAll: true,
  });
  context.subscriptions.push(
    output,
    provider,
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
    vscode.commands.registerCommand(
      "rehearsal.showCliCommand",
      (node: Parameters<RehearsalTreeProvider["showCliCommand"]>[0]) =>
        provider.showCliCommand(node),
    ),
  );
  if (vscode.workspace.isTrusted) void provider.refresh();
};

export const deactivate = (): void => {};
