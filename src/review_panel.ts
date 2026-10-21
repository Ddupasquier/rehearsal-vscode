import { randomBytes } from "node:crypto";
import * as vscode from "vscode";
import {
  renderReviewDocument,
  validateReviewContent,
  type ReviewContent,
} from "./action_review_view.js";
export { renderReviewDocument } from "./action_review_view.js";
export type { ReviewContent, ReviewAssets } from "./action_review_view.js";

const MAXIMUM_REVIEWS = 16;
const MAXIMUM_TOTAL_BYTES = 8 * 1024 * 1024;

export interface ReviewOptions extends ReviewContent {
  readonly workspaceKey: string;
  readonly canApply: () => void;
  /** Return false when a subsequent native confirmation was cancelled. */
  readonly onApply: () => Promise<void | boolean>;
  readonly onReturn?: () => void;
  /** Caller-owned, fixed guidance only. Unknown errors retain the generic alert. */
  readonly failureMessage?: (error: unknown) => string | undefined;
}

/** Non-modal presentation. Callers retain all authorization and save/resource guards. */
export class RehearsalReviewPanels implements vscode.Disposable {
  private readonly reviews = new Set<{
    readonly panel: vscode.WebviewPanel;
    readonly bytes: number;
    readonly workspaceKey: string;
  }>();
  private bytes = 0;
  private disposed = false;

  constructor(private readonly extensionUri: vscode.Uri) {}

  async review(options: ReviewOptions): Promise<boolean> {
    const bytes = validateReviewContent(options);
    if (
      this.disposed ||
      this.reviews.size >= MAXIMUM_REVIEWS ||
      this.bytes + bytes > MAXIMUM_TOTAL_BYTES
    )
      throw new Error("Close an existing review before opening another.");
    options.canApply();
    const mediaRoot = vscode.Uri.joinPath(this.extensionUri, "media");
    const token = randomBytes(18).toString("base64url");
    const panel = vscode.window.createWebviewPanel(
      "rehearsal.review",
      `${options.title} · Rehearsal`,
      vscode.ViewColumn.Active,
      {
        enableScripts: true,
        enableCommandUris: false,
        retainContextWhenHidden: true,
        localResourceRoots: [mediaRoot],
      },
    );
    let closed = false;
    let applying = false;
    let failed = false;
    let applied = false;
    let settled = false;
    let released = false;
    const subscriptions: vscode.Disposable[] = [];
    const entry = { panel, bytes, workspaceKey: options.workspaceKey };
    this.reviews.add(entry);
    this.bytes += bytes;
    return new Promise<boolean>((resolve, reject) => {
      const settle = (result: boolean) => {
        if (settled) return;
        settled = true;
        resolve(result);
      };
      const release = () => {
        if (released) return;
        released = true;
        this.reviews.delete(entry);
        this.bytes -= bytes;
        subscriptions.forEach((subscription) => subscription.dispose());
      };
      const close = () => {
        if (!applying) settle(applied);
        if (!closed) panel.dispose();
        if (!applying) release();
      };
      const post = async (state: string, message?: string) => {
        if (closed) return;
        try {
          await panel.webview.postMessage({
            type: "reviewState",
            token,
            state,
            ...(message === undefined ? {} : { message }),
          });
        } catch {
          // Delivery is not operation evidence. The host's one-shot guard remains
          // authoritative if the view is closing or its script is unavailable.
        }
      };
      subscriptions.push(
        panel.onDidDispose(() => {
          closed = true;
          if (!applying) {
            settle(applied);
            release();
          }
        }),
        panel.webview.onDidReceiveMessage((raw: unknown) => {
          if (
            !raw ||
            typeof raw !== "object" ||
            Array.isArray(raw) ||
            closed ||
            released ||
            applying
          )
            return;
          const message = raw as Record<string, unknown>;
          if (
            message.token !== token ||
            Object.keys(message).length !== 2 ||
            typeof message.type !== "string" ||
            !["applyReview", "cancelReview", "returnFromReview"].includes(
              message.type,
            )
          )
            return;
          if (message.type === "cancelReview") {
            close();
            return;
          }
          if (message.type === "returnFromReview") {
            if (!applied) return;
            try {
              options.onReturn?.();
            } catch {
              // A stale dashboard cannot turn a completed save into a retry.
            } finally {
              close();
            }
            return;
          }
          if (failed || applied || this.disposed) return;
          applying = true;
          void (async () => {
            try {
              options.canApply();
              await post("applying");
              if (this.disposed || closed)
                throw new Error("Review closed before applying.");
              options.canApply();
              const result = await options.onApply();
              applying = false;
              if (result === false) {
                if (closed || this.disposed) {
                  settle(false);
                  release();
                } else await post("cancelled");
                return;
              }
              applied = true;
              settle(true);
              if (closed || this.disposed) release();
              else
                await post(
                  "succeeded",
                  options.successMessage ?? "Review completed.",
                );
            } catch (error) {
              applying = false;
              failed = true;
              if (!settled) {
                settled = true;
                reject(error);
              }
              if (closed || this.disposed) {
                release();
              } else {
                let message: string | undefined;
                try {
                  const candidate = options.failureMessage?.(error);
                  if (
                    typeof candidate === "string" &&
                    candidate.length > 0 &&
                    candidate.length <= 500 &&
                    !/[\x00-\x1f\x7f]/u.test(candidate)
                  )
                    message = candidate;
                } catch {
                  /* A guidance failure never reveals the original error. */
                }
                await post("failed", message);
              }
            }
          })();
        }),
      );
      try {
        panel.webview.html = renderReviewDocument(options, {
          resourceSource: panel.webview.cspSource,
          stylesheetUri: panel.webview
            .asWebviewUri(vscode.Uri.joinPath(mediaRoot, "workspace.css"))
            .toString(),
          scriptNonce: token,
        });
      } catch {
        close();
      }
    });
  }

  releaseWorkspace(workspaceKey: string): void {
    for (const entry of [...this.reviews])
      if (entry.workspaceKey === workspaceKey) entry.panel.dispose();
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const entry of [...this.reviews]) entry.panel.dispose();
  }
}
