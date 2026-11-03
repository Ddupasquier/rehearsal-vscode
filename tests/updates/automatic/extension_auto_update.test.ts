import { createHash } from "node:crypto";
import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rename,
  rm,
  stat,
  lstat,
  symlink,
  writeFile,
} from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  VerifiedExtensionUpdate,
  ExtensionUpdateRuntime,
} from "../../../src/updates/automatic/extension_update_artifact.js";
import {
  acquireExtensionUpdateReservation,
  readLoadedExtensionState,
  type UpdateProcessState,
} from "../../../src/updates/automatic/extension_update_reservation.js";

const editor = vi.hoisted(() => ({
  registeredVersion: "0.1.17" as unknown,
  registeredPath: undefined as string | undefined,
  legacyInstalled: false,
  execute: vi.fn(),
  info: vi.fn(),
  warning: vi.fn(),
  lookup: vi.fn(),
  uri: (path: string) => ({
    scheme: "file",
    fsPath: path,
    path,
    toString: () => `file://${path}`,
  }),
}));
vi.mock("vscode", () => ({
  version: "1.110.0",
  Uri: { file: editor.uri },
  commands: { executeCommand: editor.execute },
  extensions: {
    getExtension: editor.lookup,
  },
  window: {
    showInformationMessage: editor.info,
    showWarningMessage: editor.warning,
  },
}));

import { AutomaticExtensionInstaller } from "../../../src/updates/automatic/extension_auto_update.js";

const version = "0.1.99";
const expectReadOnly = (mode: number) => {
  expect(mode & 0o222).toBe(0);
  if (process.platform !== "win32") expect(mode & 0o777).toBe(0o400);
};
const bytes = Buffer.from(
  "Synthetic already-verified VSIX bytes; no archive is executed or installed.",
);
const verified = (): VerifiedExtensionUpdate => ({
  bytes: new Uint8Array(bytes),
  sha256: createHash("sha256").update(bytes).digest("hex"),
  manifest: {
    publisher: "rehearsal-db",
    name: "rehearsal-db",
    version,
    engines: { vscode: "^1.101.0", node: ">=22 <27" },
  },
});
const owners: AutomaticExtensionInstaller[] = [];
const directories: string[] = [];
const tasks: Promise<unknown>[] = [];
const track = <T>(promise: Promise<T>): Promise<T> => {
  tasks.push(promise);
  return promise;
};
const fixture = async () => {
  const base = resolve("test-results");
  await mkdir(base, { recursive: true });
  const root = await mkdtemp(join(base, "extension-auto-unit-"));
  directories.push(root);
  const storagePath = join(root, "storage");
  const loadedPath = join(root, "loaded-extension");
  await mkdir(loadedPath);
  await writeFile(
    join(loadedPath, "package.json"),
    JSON.stringify({
      publisher: "rehearsal-db",
      name: "rehearsal-db",
      version: "0.1.17",
    }),
  );
  editor.registeredPath = loadedPath;
  const download = vi.fn(
    async (
      _version: string,
      _signal: AbortSignal,
      _runtime: ExtensionUpdateRuntime,
    ): Promise<VerifiedExtensionUpdate> => verified(),
  );
  const create = (
    platform?: NodeJS.Platform,
    processState?: (pid: number) => UpdateProcessState,
  ) => {
    const owner = new AutomaticExtensionInstaller({
      storagePath,
      loadedVersion: "0.1.17",
      preview: false,
      download,
      loadedExtensionPath: loadedPath,
      ...(processState ? { processState } : {}),
      ...(platform ? { platform } : {}),
    });
    owners.push(owner);
    return owner;
  };
  return {
    root,
    storagePath,
    loadedPath,
    download,
    create,
    entries: async () => await readdir(storagePath).catch(() => [] as string[]),
  };
};
const deferredDownload = (download: ReturnType<typeof vi.fn>) => {
  let release: ((value: VerifiedExtensionUpdate) => void) | undefined;
  let signal: AbortSignal | undefined;
  download.mockImplementationOnce(
    (_version: string, abort: AbortSignal) =>
      new Promise<VerifiedExtensionUpdate>((resolve, reject) => {
        signal = abort;
        release = resolve;
        abort.addEventListener(
          "abort",
          () => reject(new Error("Disposable download aborted")),
          { once: true },
        );
      }),
  );
  return {
    release: (value = verified()) => release!(value),
    signal: () => signal,
  };
};

beforeEach(() => {
  editor.registeredVersion = "0.1.17";
  editor.registeredPath = undefined;
  editor.legacyInstalled = false;
  editor.lookup.mockReset().mockImplementation((id: string) =>
    id === "rehearsal-db.rehearsal" && editor.legacyInstalled
      ? { packageJSON: { version: "0.1.18" } }
      : id !== "rehearsal-db.rehearsal-db" ||
          editor.registeredVersion === undefined
        ? undefined
        : {
            packageJSON: { version: editor.registeredVersion },
            ...(editor.registeredPath
              ? { extensionUri: editor.uri(editor.registeredPath) }
              : {}),
          },
  );
  editor.execute.mockReset().mockResolvedValue(undefined);
  editor.info.mockReset();
  editor.warning.mockReset();
});
afterEach(async () => {
  owners.splice(0).forEach((owner) => owner.dispose());
  await Promise.allSettled(tasks.splice(0));
  for (const directory of directories.splice(0))
    await rm(directory, { recursive: true, force: true });
});

describe("automatic extension installation boundary", () => {
  it("resumes a provably abandoned preparing reservation through the actual installer", async () => {
    const f = await fixture();
    await mkdir(f.storagePath);
    const lease = await acquireExtensionUpdateReservation({
      storagePath: f.storagePath,
      version,
      installation: () =>
        readLoadedExtensionState(
          f.loadedPath,
          "0.1.17",
          f.loadedPath,
          "0.1.17",
        ),
      ready: async () => true,
    });
    await lease!.close();
    expect(
      await track(
        f
          .create(undefined, () => "stopped")
          .install(
            version,
            () => true,
            async () => true,
          ),
      ),
    ).toBe(true);
    expect(f.download).toHaveBeenCalledOnce();
    expect(editor.execute).toHaveBeenCalledOnce();
    expect(await f.entries()).toEqual([]);
  });

  it("reports an unverified abandoned reservation instead of silently deferring", async () => {
    const f = await fixture();
    await mkdir(f.storagePath, { recursive: true });
    const path = join(f.storagePath, "extension-update.lock");
    const original = JSON.stringify({
      pid: 123456789,
      token: "legacy-token",
      version,
    });
    await writeFile(path, original, { mode: 0o600 });
    await expect(
      track(
        f.create().install(
          version,
          () => true,
          async () => true,
        ),
      ),
    ).rejects.toMatchObject({ reason: "lock-unverified" });
    expect(await readFile(path, "utf8")).toBe(original);
    expect(f.download).not.toHaveBeenCalled();
    expect(editor.execute).not.toHaveBeenCalled();
  });

  it.each(["darwin", "win32"] as const)(
    "preserves a replaced temporary VSIX during %s cleanup",
    async (platform) => {
      const f = await fixture();
      let replaced = "";
      let replacementMode = 0;
      editor.execute.mockImplementationOnce(async (_command, uri) => {
        replaced = uri.fsPath;
        await rename(replaced, join(f.root, "retained-original.vsix"));
        await writeFile(replaced, "foreign replacement", {
          mode: 0o600,
          flag: "wx",
        });
        replacementMode = (await stat(replaced)).mode;
      });
      expect(
        await track(
          f.create(platform).install(
            version,
            () => true,
            async () => true,
          ),
        ),
      ).toBe(true);
      expect(await readFile(replaced, "utf8")).toBe("foreign replacement");
      expect((await stat(replaced)).mode).toBe(replacementMode);
    },
  );

  it.each(["darwin", "win32"] as const)(
    "preserves same-inode modified temporary bytes during %s cleanup",
    async (platform) => {
      const f = await fixture();
      let changed = "";
      editor.execute.mockImplementationOnce(async (_command, uri) => {
        changed = uri.fsPath;
        await chmod(changed, 0o600);
        await writeFile(changed, "changed in place");
      });
      expect(
        await track(
          f.create(platform).install(
            version,
            () => true,
            async () => true,
          ),
        ),
      ).toBe(true);
      expect(await readFile(changed, "utf8")).toBe("changed in place");
    },
  );

  it.each(["darwin", "win32"] as const)(
    "preserves a temporary symlink and its foreign target during %s cleanup",
    async (platform) => {
      const f = await fixture();
      const foreign = join(f.root, "foreign.vsix");
      await writeFile(foreign, "foreign bytes", { mode: 0o400 });
      let changed = "";
      editor.execute.mockImplementationOnce(async (_command, uri) => {
        changed = uri.fsPath;
        await rename(changed, join(f.root, "retained-original.vsix"));
        await symlink(foreign, changed);
      });
      expect(
        await track(
          f.create(platform).install(
            version,
            () => true,
            async () => true,
          ),
        ),
      ).toBe(true);
      expect((await lstat(changed)).isSymbolicLink()).toBe(true);
      expect(await readFile(foreign, "utf8")).toBe("foreign bytes");
      expectReadOnly((await stat(foreign)).mode);
    },
  );

  it("cleans its exact owned read-only file through the Windows cleanup branch", async () => {
    const f = await fixture();
    let installedPath: string | undefined;
    editor.execute.mockImplementationOnce(async (_command, uri) => {
      installedPath = uri.fsPath;
      expectReadOnly((await stat(uri.fsPath)).mode);
    });
    expect(
      await track(
        f.create("win32").install(
          version,
          () => true,
          async () => true,
        ),
      ),
    ).toBe(true);
    expect(await f.entries()).toEqual([]);
    await expect(stat(installedPath!)).rejects.toMatchObject({
      code: "ENOENT",
    });
  });
  it("passes exact verified read-only bytes only to the VS Code installer, without prompting or reloading", async () => {
    const f = await fixture();
    let installedPath: string | undefined;
    editor.execute.mockImplementationOnce(
      async (command: string, uri: ReturnType<typeof editor.uri>) => {
        expect(command).toBe("workbench.extensions.installExtension");
        installedPath = uri.fsPath;
        expect(dirname(dirname(uri.fsPath))).toBe(f.storagePath);
        expect(await readFile(uri.fsPath)).toEqual(bytes);
        expectReadOnly((await stat(uri.fsPath)).mode);
      },
    );
    const result = await track(
      f.create().install(
        version,
        () => true,
        async () => true,
      ),
    );
    expect(result).toBe(true);
    expect(f.download).toHaveBeenCalledWith(version, expect.any(AbortSignal), {
      vscodeVersion: "1.110.0",
      nodeVersion: process.versions.node,
    });
    expect(editor.execute).toHaveBeenCalledTimes(1);
    expect(editor.lookup).toHaveBeenCalledWith("rehearsal-db.rehearsal-db");
    expect(editor.lookup).toHaveBeenCalledWith("rehearsal-db.rehearsal");
    expect(editor.warning).not.toHaveBeenCalled();
    expect(
      editor.execute.mock.calls.some(([command]) =>
        String(command).includes("reload"),
      ),
    ).toBe(false);
    expect(editor.info).toHaveBeenCalledWith(
      expect.stringContaining("accepted by VS Code's installer"),
    );
    expect(await f.entries()).toEqual([]);
    await expect(stat(installedPath!)).rejects.toMatchObject({
      code: "ENOENT",
    });
  });
  it("refuses an installed legacy preview before download or canonical installation", async () => {
    const f = await fixture();
    editor.lookup.mockImplementation((id: string) =>
      id === "rehearsal-db.rehearsal"
        ? { packageJSON: { version: "0.1.18" } }
        : undefined,
    );
    await expect(
      track(
        f.create().install(
          version,
          () => true,
          async () => true,
        ),
      ),
    ).resolves.toBe(false);
    expect(editor.lookup).toHaveBeenCalledWith("rehearsal-db.rehearsal");
    expect(f.download).not.toHaveBeenCalled();
    expect(editor.execute).not.toHaveBeenCalled();
    expect(await f.entries()).toEqual([]);
  });
  it("rechecks legacy coexistence after downloading before dispatching the installer", async () => {
    const f = await fixture();
    const download = deferredDownload(f.download);
    const pending = track(
      f.create().install(
        version,
        () => true,
        async () => true,
      ),
    );
    await vi.waitFor(() => expect(download.signal()).toBeDefined());
    editor.legacyInstalled = true;
    download.release();
    await expect(pending).resolves.toBe(false);
    expect(editor.execute).not.toHaveBeenCalled();
    expect(await f.entries()).toEqual([]);
  });
  it("refuses a legacy extension appearing at the final idle check after writing verified bytes", async () => {
    const f = await fixture();
    const idle = async () => {
      if (
        (await f.entries()).some((entry) =>
          entry.startsWith("verified-update-"),
        )
      )
        editor.legacyInstalled = true;
      return true;
    };
    await expect(
      track(f.create().install(version, () => true, idle)),
    ).resolves.toBe(false);
    expect(editor.legacyInstalled).toBe(true);
    expect(editor.execute).not.toHaveBeenCalled();
    expect(await f.entries()).toEqual([]);
  });
  it.each(["0.1.17", "0.1.16", "latest", "file:local", "0.1.99-rc.1"])(
    "does not download unsupported or non-new selector %s",
    async (selector) => {
      const f = await fixture();
      await expect(
        track(
          f.create().install(
            selector,
            () => true,
            async () => true,
          ),
        ),
      ).resolves.toBe(false);
      expect(f.download).not.toHaveBeenCalled();
      expect(editor.execute).not.toHaveBeenCalled();
    },
  );
  it.each(["permission", "activity"] as const)(
    "defers before download when %s does not authorize it",
    async (kind) => {
      const f = await fixture();
      await expect(
        track(
          f.create().install(
            version,
            () => kind !== "permission",
            async () => kind !== "activity",
          ),
        ),
      ).resolves.toBe(false);
      expect(f.download).not.toHaveBeenCalled();
      expect(editor.execute).not.toHaveBeenCalled();
      expect(await f.entries()).toEqual([]);
    },
  );
  it("honors consent revocation while a verified download is in flight and cleans the owned lock", async () => {
    const f = await fixture();
    const download = deferredDownload(f.download);
    let allowed = true;
    const pending = track(
      f.create().install(
        version,
        () => allowed,
        async () => true,
      ),
    );
    await vi.waitFor(() => expect(download.signal()).toBeDefined());
    allowed = false;
    download.release();
    await expect(pending).resolves.toBe(false);
    expect(editor.execute).not.toHaveBeenCalled();
    expect(await f.entries()).toEqual([]);
  });
  it("defers if activity starts after verification without changing a running session", async () => {
    const f = await fixture();
    let checks = 0;
    await expect(
      track(
        f.create().install(
          version,
          () => true,
          async () => ++checks < 3,
        ),
      ),
    ).resolves.toBe(false);
    expect(f.download).toHaveBeenCalledOnce();
    expect(editor.execute).not.toHaveBeenCalled();
    expect(await f.entries()).toEqual([]);
  });
  it.each(["0.1.99", "0.2.0"])(
    "does not reinstall or downgrade an already current extension (%j)",
    async (current) => {
      const f = await fixture();
      editor.registeredVersion = current;
      await expect(
        track(
          f.create().install(
            version,
            () => true,
            async () => true,
          ),
        ),
      ).resolves.toBe(true);
      expect(editor.execute).not.toHaveBeenCalled();
      expect(await f.entries()).toEqual([]);
    },
  );
  it.each(["unknown", null, undefined])(
    "does not downgrade or proceed without a proven current installed version (%j)",
    async (current) => {
      const f = await fixture();
      editor.registeredVersion = current;
      await expect(
        track(
          f.create().install(
            version,
            () => true,
            async () => true,
          ),
        ),
      ).resolves.toBe(false);
      expect(editor.execute).not.toHaveBeenCalled();
      expect(await f.entries()).toEqual([]);
    },
  );
  it("rejects mismatched verified-file checksums and cleans its temporary file and lock", async () => {
    const f = await fixture();
    f.download.mockResolvedValueOnce({ ...verified(), sha256: "0".repeat(64) });
    await expect(
      track(
        f.create().install(
          version,
          () => true,
          async () => true,
        ),
      ),
    ).rejects.toThrow();
    expect(editor.execute).not.toHaveBeenCalled();
    expect(await f.entries()).toEqual([]);
  });
  it("detects a modified local VSIX after the last asynchronous idle check before installer dispatch", async () => {
    const f = await fixture();
    let modified = false;
    const idle = async () => {
      const directory = (await f.entries()).find((entry) =>
        entry.startsWith("verified-update-"),
      );
      if (directory && !modified) {
        const path = join(
          f.storagePath,
          directory,
          `rehearsal-db-${version}.vsix`,
        );
        await chmod(path, 0o600);
        await writeFile(path, "Modified local bytes");
        modified = true;
      }
      return true;
    };
    const outcome = await track(
      f.create().install(version, () => true, idle),
    ).then(
      (value) => ({ value }),
      (error) => ({ error }),
    );
    expect(modified).toBe(true);
    expect(editor.execute).not.toHaveBeenCalled();
    expect(
      "error" in outcome || ("value" in outcome && outcome.value === false),
    ).toBe(true);
    const recovery = (await f.entries()).find((entry) =>
      entry.startsWith("verified-update-"),
    );
    expect(recovery).toBeDefined();
    expect(
      await readFile(
        join(f.storagePath, recovery!, `rehearsal-db-${version}.vsix`),
        "utf8",
      ),
    ).toBe("Modified local bytes");
  });
  it("coalesces duplicate parallel attempts into one download and one installer call", async () => {
    const f = await fixture();
    const download = deferredDownload(f.download);
    const instance = f.create();
    const first = track(
      instance.install(
        version,
        () => true,
        async () => true,
      ),
    );
    const second = track(
      instance.install(
        version,
        () => true,
        async () => true,
      ),
    );
    expect(first).toBe(second);
    await vi.waitFor(() => expect(download.signal()).toBeDefined());
    download.release();
    expect(await Promise.all([first, second])).toEqual([true, true]);
    expect(f.download).toHaveBeenCalledOnce();
    expect(editor.execute).toHaveBeenCalledOnce();
    expect(await f.entries()).toEqual([]);
  });
  it("preserves another instance's exact exclusive lock instead of stealing its update", async () => {
    const f = await fixture();
    const download = deferredDownload(f.download);
    const first = track(
      f.create().install(
        version,
        () => true,
        async () => true,
      ),
    );
    await vi.waitFor(() => expect(download.signal()).toBeDefined());
    const path = join(f.storagePath, "extension-update.lock");
    const lock = await readFile(path, "utf8");
    await expect(
      track(
        f.create().install(
          version,
          () => true,
          async () => true,
        ),
      ),
    ).rejects.toMatchObject({ reason: "update-in-progress" });
    expect(await readFile(path, "utf8")).toBe(lock);
    expect(f.download).toHaveBeenCalledOnce();
    download.release();
    await expect(first).resolves.toBe(true);
    expect(await f.entries()).toEqual([]);
  });
  it.each(["pending download", "final idle callback"] as const)(
    "preserves a foreign replacement lock and refuses dispatch after replacement during %s",
    async (phase) => {
      const f = await fixture();
      const lockPath = join(f.storagePath, "extension-update.lock");
      const retainedOriginal = join(f.root, "retained-original-lock");
      const foreignLock =
        "Foreign replacement lock; this installer does not own it.";
      let replaced = false;
      const replaceLock = async () => {
        // Keep the original inode alive so the replacement cannot reuse it.
        await rename(lockPath, retainedOriginal);
        await writeFile(lockPath, foreignLock, { flag: "wx", mode: 0o600 });
        replaced = true;
      };
      const download =
        phase === "pending download" ? deferredDownload(f.download) : null;
      const pending = track(
        f.create().install(
          version,
          () => true,
          async () => {
            if (
              phase === "final idle callback" &&
              !replaced &&
              (await f.entries()).some((entry) =>
                entry.startsWith("verified-update-"),
              )
            )
              await replaceLock();
            return true;
          },
        ),
      );
      if (download) {
        await vi.waitFor(() => expect(download.signal()).toBeDefined());
        await replaceLock();
        download.release();
      }
      const outcome = await pending.then(
        (value) => ({ value }),
        (error) => ({ error }),
      );
      expect(replaced).toBe(true);
      expect(
        "error" in outcome || ("value" in outcome && outcome.value === false),
      ).toBe(true);
      expect(editor.execute).not.toHaveBeenCalled();
      expect(await readFile(lockPath, "utf8")).toBe(foreignLock);
      expect(await stat(retainedOriginal)).toBeDefined();
      expect(await f.entries()).toEqual(["extension-update.lock"]);
    },
  );
  it("aborts an owned download on disposal and releases only its own temporary state", async () => {
    const f = await fixture();
    const download = deferredDownload(f.download);
    const instance = f.create();
    const pending = track(
      instance.install(
        version,
        () => true,
        async () => true,
      ),
    );
    await vi.waitFor(() => expect(download.signal()).toBeDefined());
    instance.dispose();
    await pending.catch(() => undefined);
    expect(download.signal()!.aborted).toBe(true);
    expect(editor.execute).not.toHaveBeenCalled();
    expect(await f.entries()).toEqual([]);
  });
  it("preserves installation recovery when a dispatched VS Code command rejects", async () => {
    const f = await fixture();
    editor.execute.mockRejectedValueOnce(
      new Error("Installer command unavailable"),
    );
    await expect(
      track(
        f.create().install(
          version,
          () => true,
          async () => true,
        ),
      ),
    ).rejects.toMatchObject({ reason: "installation-unconfirmed" });
    const entries = await f.entries();
    expect(entries).toContain("extension-update.lock");
    expect(entries.some((entry) => entry.startsWith("verified-update-"))).toBe(
      true,
    );
    expect(
      JSON.parse(
        await readFile(join(f.storagePath, "extension-update.lock"), "utf8"),
      ).phase,
    ).toBe("installer-dispatched");
    expect(editor.info).not.toHaveBeenCalled();
  });
});
