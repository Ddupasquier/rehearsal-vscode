import { randomBytes } from "node:crypto";
import * as vscode from "vscode";
import {
  parseUpdatePromptMessage,
  renderUpdatePromptDocument,
  validateUpdatePromptContent,
  type UpdatePromptContent,
  type UpdatePromptResult,
} from "./update_prompt_view.js";
export type {
  AutomaticUpdatePreferences,
  UpdatePromptChoice,
  UpdatePromptResult,
} from "./update_prompt_view.js";

export interface UpdatePromptOptions extends UpdatePromptContent {
  readonly workspaceKey: string;
  readonly canApply: () => void;
}

/** Choice collection only. The advisory host owns settings, permissions and installers. */
export class RehearsalUpdatePrompts implements vscode.Disposable {
  private disposed = false;
  private readonly prompts = new Map<string, { close(): void }>();
  constructor(private readonly extensionUri: vscode.Uri) {}

  async prompt(
    options: UpdatePromptOptions,
  ): Promise<UpdatePromptResult | undefined> {
    validateUpdatePromptContent(options);
    if (
      typeof options.workspaceKey !== "string" ||
      !options.workspaceKey.length ||
      options.workspaceKey.length > 4096 ||
      /[\x00-\x1f\x7f]/u.test(options.workspaceKey) ||
      typeof options.canApply !== "function"
    )
      throw new Error("The update prompt context is invalid.");
    const workspaceKey = options.workspaceKey;
    const authorize = options.canApply;
    authorize();
    if (
      this.disposed ||
      this.prompts.size >= 16 ||
      this.prompts.has(workspaceKey)
    ) {
      authorize();
      return undefined;
    }
    const content: UpdatePromptContent = {
      workspaceName: options.workspaceName,
      core: options.core ? { ...options.core } : null,
      extension: options.extension ? { ...options.extension } : null,
      channel: options.channel,
      automatic: { ...options.automatic },
    };
    const mediaRoot = vscode.Uri.joinPath(this.extensionUri, "media");
    const token = randomBytes(18).toString("base64url");
    const panel = vscode.window.createWebviewPanel(
      "rehearsal.updates",
      "Rehearsal updates",
      vscode.ViewColumn.Active,
      {
        enableScripts: true,
        enableCommandUris: false,
        retainContextWhenHidden: true,
        localResourceRoots: [mediaRoot],
      },
    );
    return new Promise<UpdatePromptResult | undefined>((resolve) => {
      let settled = false;
      const subscriptions: vscode.Disposable[] = [];
      const entry = { close: () => finish(undefined) };
      const finish = (
        result: UpdatePromptResult | undefined,
        closePanel = true,
      ) => {
        if (settled) return;
        try {
          authorize();
        } catch {
          result = undefined;
        }
        settled = true;
        if (this.prompts.get(workspaceKey) === entry)
          this.prompts.delete(workspaceKey);
        subscriptions.forEach((subscription) => subscription.dispose());
        resolve(result);
        if (closePanel) panel.dispose();
      };
      this.prompts.set(workspaceKey, entry);
      subscriptions.push(
        panel.onDidDispose(() => finish(undefined, false)),
        panel.webview.onDidReceiveMessage((raw) => {
          if (this.disposed || this.prompts.get(workspaceKey) !== entry) return;
          const result = parseUpdatePromptMessage(raw, token, content);
          if (result) finish(result);
        }),
      );
      try {
        panel.webview.html = renderUpdatePromptDocument(content, {
          resourceSource: panel.webview.cspSource,
          stylesheetUri: panel.webview
            .asWebviewUri(vscode.Uri.joinPath(mediaRoot, "workspace.css"))
            .toString(),
          scriptNonce: token,
        });
      } catch {
        finish(undefined);
      }
    });
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    [...this.prompts.values()].forEach((prompt) => prompt.close());
  }
}
