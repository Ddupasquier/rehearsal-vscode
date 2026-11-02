import * as vscode from "vscode";

export type BundledDocumentName = "LICENSE" | "PRIVACY.md" | "SUPPORT.md";

/** VSCE renames LICENSE to LICENSE.txt; source checkouts retain LICENSE. */
export const openBundledDocument = async (
  extensionUri: vscode.Uri,
  filename: BundledDocumentName,
): Promise<void> => {
  let uri = vscode.Uri.joinPath(
    extensionUri,
    filename === "LICENSE" ? "LICENSE.txt" : filename,
  );
  if (filename === "LICENSE") {
    try {
      await vscode.workspace.fs.stat(uri);
    } catch (error) {
      if (
        !(error instanceof Error) ||
        (error as Error & { code?: unknown }).code !== "FileNotFound"
      )
        throw error;
      uri = vscode.Uri.joinPath(extensionUri, "LICENSE");
    }
  }
  const document = await vscode.workspace.openTextDocument(uri);
  await vscode.window.showTextDocument(document, { preview: true });
};
