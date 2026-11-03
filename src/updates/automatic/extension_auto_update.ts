import { createHash } from "node:crypto";
import { mkdir, open, readFile, rmdir, mkdtemp, lstat } from "node:fs/promises";
import { join } from "node:path";
import * as vscode from "vscode";
import {
  comparePublishedVersions,
  isPublishedVersion,
} from "../advisory/update_advisory.js";
import { downloadVerifiedExtensionUpdate } from "./extension_update_artifact.js";
import {
  acquireExtensionUpdateReservation,
  ExtensionUpdateBlockedError,
  readLoadedExtensionState,
  removeOwnedUpdateFile,
  updateFileIdentity,
  matchesUpdateFile,
  type UpdateFileIdentity,
  type UpdateProcessState,
} from "./extension_update_reservation.js";
import {
  EXTENSION_ID,
  LEGACY_EXTENSION_ID,
  extensionArtifactFilename,
} from "../identity/extension_identity.js";

export class AutomaticExtensionInstaller implements vscode.Disposable {
  private disposed = false;
  private readonly installed = new Set<string>();
  private readonly running = new Map<string, Promise<boolean>>();
  private readonly aborts = new Set<AbortController>();
  constructor(
    private readonly options: {
      storagePath: string;
      loadedVersion: string;
      preview: boolean;
      download?: typeof downloadVerifiedExtensionUpdate;
      platform?: NodeJS.Platform;
      loadedExtensionPath?: string;
      processState?: (pid: number) => UpdateProcessState;
    },
  ) {}

  install(
    version: string,
    permissionCurrent: () => boolean,
    whenIdle: () => Promise<boolean>,
  ): Promise<boolean> {
    if (
      this.disposed ||
      vscode.extensions.getExtension(LEGACY_EXTENSION_ID) !== undefined ||
      !isPublishedVersion(version) ||
      comparePublishedVersions(version, this.options.loadedVersion) !== 1 ||
      (!this.options.preview && version.includes("-"))
    )
      return Promise.resolve(false);
    if (this.installed.has(version)) return Promise.resolve(true);
    const existing = this.running.get(version);
    if (existing) return existing;
    const pending = this.perform(version, permissionCurrent, whenIdle).finally(
      () => this.running.delete(version),
    );
    this.running.set(version, pending);
    return pending;
  }

  private async perform(
    version: string,
    permissionCurrent: () => boolean,
    whenIdle: () => Promise<boolean>,
  ): Promise<boolean> {
    const allowed = () =>
      !this.disposed &&
      vscode.extensions.getExtension(LEGACY_EXTENSION_ID) === undefined &&
      permissionCurrent();
    if (!allowed() || !(await whenIdle()) || !allowed()) return false;
    await mkdir(this.options.storagePath, { recursive: true, mode: 0o700 });
    if (!allowed()) return false;
    const lock = await acquireExtensionUpdateReservation({
      storagePath: this.options.storagePath,
      version,
      installation: () => {
        const registered = vscode.extensions.getExtension(EXTENSION_ID);
        return readLoadedExtensionState(
          this.options.loadedExtensionPath,
          this.options.loadedVersion,
          registered?.extensionUri?.fsPath,
          registered?.packageJSON.version,
        );
      },
      ready: async () => allowed() && (await whenIdle()) && allowed(),
      permissionCurrent: allowed,
      ...(this.options.processState
        ? { processState: this.options.processState }
        : {}),
    });
    if (!lock) return false;
    const abort = new AbortController();
    this.aborts.add(abort);
    let temporary: string | undefined;
    let temporaryFileIdentity: UpdateFileIdentity | undefined;
    let temporarySha256: string | undefined;
    let temporaryDirectoryIdentity: UpdateFileIdentity | undefined;
    let dispatched = false;
    let accepted = false;
    try {
      if (!allowed() || !(await whenIdle()) || !allowed()) return false;
      const verified = await (
        this.options.download ?? downloadVerifiedExtensionUpdate
      )(version, abort.signal, {
        vscodeVersion: vscode.version,
        nodeVersion: process.versions.node,
      });
      if (!allowed() || !(await whenIdle()) || !allowed()) return false;
      const current = vscode.extensions.getExtension(EXTENSION_ID)?.packageJSON
        .version as unknown;
      if (typeof current !== "string") return false;
      if (typeof current === "string") {
        const comparison = comparePublishedVersions(current, version);
        if (comparison === 0 || comparison === 1) return true;
        if (comparison === null) return false;
      }
      temporary = await mkdtemp(
        join(this.options.storagePath, "verified-update-"),
      );
      temporaryDirectoryIdentity = updateFileIdentity(
        await lstat(temporary, { bigint: true }),
      );
      const target = join(temporary, extensionArtifactFilename(version));
      const file = await open(target, "wx", 0o600);
      try {
        await file.writeFile(verified.bytes);
        await file.chmod(0o400);
        temporaryFileIdentity = updateFileIdentity(
          await file.stat({ bigint: true }),
        );
        temporarySha256 = createHash("sha256")
          .update(verified.bytes)
          .digest("hex");
      } finally {
        await file.close();
      }
      if (!(await matchesUpdateFile(target, temporaryFileIdentity)))
        throw new Error("Verified update file identity changed.");
      if (
        createHash("sha256")
          .update(await readFile(target))
          .digest("hex") !== verified.sha256
      )
        throw new Error("Verified update file changed.");
      if (!allowed() || !(await whenIdle()) || !allowed()) return false;
      if (!(await matchesUpdateFile(target, temporaryFileIdentity)))
        throw new Error(
          "Verified update file identity changed before installation.",
        );
      if (
        createHash("sha256")
          .update(await readFile(target))
          .digest("hex") !== verified.sha256
      )
        throw new Error("Verified update file changed before installation.");
      if (!allowed()) return false;
      if (!(await lock.owns()))
        throw new ExtensionUpdateBlockedError("lock-changed");
      await lock.markDispatched();
      if (!allowed()) return false;
      if (!(await lock.owns()))
        throw new ExtensionUpdateBlockedError("lock-changed");
      if (!(await matchesUpdateFile(target, temporaryFileIdentity)))
        throw new Error(
          "Verified update file identity changed before installation.",
        );
      dispatched = true;
      try {
        await vscode.commands.executeCommand(
          "workbench.extensions.installExtension",
          vscode.Uri.file(target),
        );
      } catch {
        throw new ExtensionUpdateBlockedError("installation-unconfirmed");
      }
      accepted = true;
      this.installed.add(version);
      if (allowed())
        void vscode.window.showInformationMessage(
          `Rehearsal ${version} was accepted by VS Code's installer. Your current extension remains loaded until VS Code restarts it; restart when convenient. No sandbox was restarted.`,
        );
      return true;
    } finally {
      abort.abort();
      this.aborts.delete(abort);
      if (temporary && (!dispatched || accepted)) {
        const target = join(temporary, extensionArtifactFilename(version));
        if (temporaryFileIdentity)
          await removeOwnedUpdateFile(
            target,
            temporaryFileIdentity,
            (this.options.platform ?? process.platform) === "win32",
            temporarySha256,
          );
        try {
          const current = await lstat(temporary, { bigint: true });
          if (
            current.isDirectory() &&
            !current.isSymbolicLink() &&
            temporaryDirectoryIdentity &&
            String(current.dev) === temporaryDirectoryIdentity.dev &&
            String(current.ino) === temporaryDirectoryIdentity.ino &&
            String(current.birthtimeNs) ===
              temporaryDirectoryIdentity.birthtimeNs
          )
            await rmdir(temporary);
        } catch {
          /* Changed or nonempty recovery directories stay intact. */
        }
      }
      if (!dispatched || accepted) await lock.release();
      else await lock.close();
    }
  }

  dispose(): void {
    this.disposed = true;
    for (const abort of this.aborts) abort.abort();
    this.aborts.clear();
  }
}
