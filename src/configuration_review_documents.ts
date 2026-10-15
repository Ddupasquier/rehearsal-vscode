import { randomBytes } from "node:crypto";
import * as vscode from "vscode";

const SCHEME = "rehearsal-configuration-review";
const MAXIMUM_ENTRIES = 16;
const MAXIMUM_DOCUMENT_BYTES = 2 * 1024 * 1024;
const MAXIMUM_TOTAL_BYTES = 8 * 1024 * 1024;
const UNAVAILABLE =
  "This read-only Rehearsal review has expired or its trusted project is no longer open. Create a new review from the dashboard.\n";

/** Bounded, in-memory review documents; never create editable untitled files. */
export class ConfigurationReviewDocuments
  implements vscode.TextDocumentContentProvider, vscode.Disposable
{
  private readonly entries = new Map<
    string,
    {
      readonly uri: vscode.Uri;
      readonly workspaceKey: string;
      readonly text: string;
      readonly bytes: number;
    }
  >();
  private bytes = 0;
  private disposed = false;
  private readonly changes = new vscode.EventEmitter<vscode.Uri>();
  readonly onDidChange = this.changes.event;
  private readonly registration: vscode.Disposable;

  constructor(private readonly canRead: (workspaceKey: string) => boolean) {
    this.registration = vscode.workspace.registerTextDocumentContentProvider(
      SCHEME,
      this,
    );
  }

  create(workspaceKey: string, text: string): vscode.Uri {
    if (this.disposed || !this.canRead(workspaceKey))
      throw new Error(
        "Open a trusted Rehearsal project before reviewing changes.",
      );
    const bytes = Buffer.byteLength(text, "utf8");
    if (bytes > MAXIMUM_DOCUMENT_BYTES)
      throw new Error(
        "This configuration diff is too large for editor review. Review the configuration manually instead.",
      );
    while (
      this.entries.size >= MAXIMUM_ENTRIES ||
      this.bytes + bytes > MAXIMUM_TOTAL_BYTES
    ) {
      const oldest = this.entries.keys().next().value;
      if (!oldest) break;
      this.remove(oldest);
    }
    const uri = vscode.Uri.parse(
      `${SCHEME}:/${randomBytes(16).toString("hex")}/configuration-review.diff`,
    );
    this.entries.set(uri.toString(), { uri, workspaceKey, text, bytes });
    this.bytes += bytes;
    return uri;
  }

  provideTextDocumentContent(uri: vscode.Uri): string {
    const entry = this.entries.get(uri.toString());
    return !this.disposed && entry && this.canRead(entry.workspaceKey)
      ? entry.text
      : UNAVAILABLE;
  }

  releaseWorkspace(workspaceKey: string): void {
    for (const [key, entry] of this.entries)
      if (entry.workspaceKey === workspaceKey) this.remove(key);
  }

  clear(): void {
    for (const key of this.entries.keys()) this.remove(key);
  }

  dispose(): void {
    if (this.disposed) return;
    this.clear();
    this.disposed = true;
    this.registration.dispose();
    this.changes.dispose();
  }

  private remove(key: string): void {
    const entry = this.entries.get(key);
    if (!entry) return;
    this.entries.delete(key);
    this.bytes -= entry.bytes;
    this.changes.fire(entry.uri);
  }
}
