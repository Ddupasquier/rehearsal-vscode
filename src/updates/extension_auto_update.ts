import { createHash, randomUUID } from "node:crypto";
import {
  mkdir,
  open,
  readFile,
  unlink,
  rmdir,
  mkdtemp,
  lstat,
} from "node:fs/promises";
import { join } from "node:path";
import * as vscode from "vscode";
import {
  comparePublishedVersions,
  isPublishedVersion,
} from "./update_advisory.js";
import { downloadVerifiedExtensionUpdate } from "./extension_update_artifact.js";
import {
  EXTENSION_ID,
  LEGACY_EXTENSION_ID,
  extensionArtifactFilename,
} from "./extension_identity.js";

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
    // Exclusive cross-window lock. Never steal an update whose completion is unknown.
    const lockPath = join(this.options.storagePath, "extension-update.lock");
    let lock;
    try {
      lock = await open(lockPath, "wx", 0o600);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "EEXIST") return false;
      throw error;
    }
    const abort = new AbortController();
    this.aborts.add(abort);
    const ownedLock = await lock.stat();
    const ownsLock = async () => {
      try {
        const current = await lstat(lockPath);
        return (
          current.isFile() &&
          !current.isSymbolicLink() &&
          current.dev === ownedLock.dev &&
          current.ino === ownedLock.ino
        );
      } catch {
        return false;
      }
    };
    let temporary: string | undefined;
    let temporaryFileIdentity: { dev: number; ino: number } | undefined;
    try {
      await lock.writeFile(
        JSON.stringify({ pid: process.pid, token: randomUUID(), version }),
      );
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
      const target = join(temporary, extensionArtifactFilename(version));
      const file = await open(target, "wx", 0o600);
      try {
        const identity = await file.stat();
        temporaryFileIdentity = { dev: identity.dev, ino: identity.ino };
        await file.writeFile(verified.bytes);
        await file.chmod(0o400);
      } finally {
        await file.close();
      }
      if (
        createHash("sha256")
          .update(await readFile(target))
          .digest("hex") !== verified.sha256
      )
        throw new Error("Verified update file changed.");
      if (!allowed() || !(await whenIdle()) || !allowed()) return false;
      if (
        createHash("sha256")
          .update(await readFile(target))
          .digest("hex") !== verified.sha256
      )
        throw new Error("Verified update file changed before installation.");
      if (!allowed() || !(await ownsLock()) || !allowed()) return false;
      await vscode.commands.executeCommand(
        "workbench.extensions.installExtension",
        vscode.Uri.file(target),
      );
      this.installed.add(version);
      if (allowed())
        void vscode.window.showInformationMessage(
          `Rehearsal ${version} was accepted by VS Code's installer. Your current extension remains loaded until VS Code restarts it; restart when convenient. No sandbox was restarted.`,
        );
      return true;
    } finally {
      abort.abort();
      this.aborts.delete(abort);
      if (temporary) {
        const target = join(temporary, extensionArtifactFilename(version));
        // Windows cannot unlink a read-only file. Change only the exact file we
        // created, through a handle checked against its current directory entry.
        if ((this.options.platform ?? process.platform) === "win32") {
          let file;
          try {
            const entry = await lstat(target);
            if (
              temporaryFileIdentity &&
              entry.isFile() &&
              !entry.isSymbolicLink() &&
              entry.dev === temporaryFileIdentity.dev &&
              entry.ino === temporaryFileIdentity.ino
            ) {
              file = await open(target, "r");
              const held = await file.stat();
              const current = await lstat(target);
              if (
                current.isFile() &&
                !current.isSymbolicLink() &&
                held.dev === entry.dev &&
                held.ino === entry.ino &&
                current.dev === held.dev &&
                current.ino === held.ino
              )
                await file.chmod(0o600);
            }
          } catch {
            // An unavailable/replaced path is not authority to change its mode.
          } finally {
            await file?.close().catch(() => {});
          }
        }
        await unlink(target).catch(() => {});
        await rmdir(temporary).catch(() => {});
      }
      await lock.close();
      if (await ownsLock()) await unlink(lockPath).catch(() => {});
    }
  }

  dispose(): void {
    this.disposed = true;
    for (const abort of this.aborts) abort.abort();
    this.aborts.clear();
  }
}
