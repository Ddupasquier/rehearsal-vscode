import {
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rename,
  rm,
  symlink,
  writeFile,
  lstat,
} from "node:fs/promises";
import { createHash } from "node:crypto";
import type { BigIntStats, Stats } from "node:fs";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  acquireExtensionUpdateReservation,
  readLoadedExtensionState,
  removeOwnedUpdateFile,
  updateFileIdentity,
  type ExtensionUpdateReservation,
  type LoadedExtensionState,
  type UpdateProcessState,
} from "../../../src/updates/automatic/extension_update_reservation.js";

const race = vi.hoisted(() => ({
  afterLstat: undefined as ((path: string) => Promise<void>) | undefined,
  windowsMode: false,
}));
vi.mock("node:fs/promises", async (original) => {
  const actual = await original<typeof import("node:fs/promises")>();
  const reported = <T extends Stats | BigIntStats>(entry: T): T =>
    race.windowsMode
      ? (Object.assign(Object.create(entry), {
          mode:
            typeof entry.mode === "bigint"
              ? (entry.mode & ~0o777n) | 0o666n
              : (entry.mode & ~0o777) | 0o666,
        }) as T)
      : entry;
  return {
    ...actual,
    open: async (...args: Parameters<typeof actual.open>) => {
      const handle = await actual.open(...args);
      const stat = handle.stat.bind(handle) as (options?: {
        bigint?: boolean;
      }) => Promise<Stats | BigIntStats>;
      handle.stat = (async (options?: { bigint?: boolean }) =>
        reported(await stat(options))) as typeof handle.stat;
      return handle;
    },
    lstat: async (...args: Parameters<typeof actual.lstat>) => {
      const result = await actual.lstat(args[0], args[1]);
      await race.afterLstat?.(String(args[0]));
      return reported(result);
    },
  };
});

const roots: string[] = [];
const held: ExtensionUpdateReservation[] = [];
afterEach(async () => {
  race.afterLstat = undefined;
  race.windowsMode = false;
  await Promise.all(held.splice(0).map((lease) => lease.close()));
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});
const fixture = async () => {
  await mkdir(resolve("test-results"), { recursive: true });
  const root = await mkdtemp(resolve("test-results/update-reservation-"));
  roots.push(root);
  const storagePath = join(root, "storage");
  await mkdir(storagePath);
  const installed = async (version = "0.1.17", name = "loaded") => {
    const path = join(root, name);
    await mkdir(path, { recursive: true });
    await writeFile(
      join(path, "package.json"),
      JSON.stringify({
        publisher: "rehearsal-db",
        name: "rehearsal-db",
        version,
      }),
    );
    return (await readLoadedExtensionState(path, version, path, version))!;
  };
  const baseline = await installed();
  expect(baseline).not.toBeNull();
  const installation = vi.fn<() => Promise<LoadedExtensionState | null>>(
    async () => baseline,
  );
  const ready = vi.fn(async () => true);
  const acquire = async (
    state: UpdateProcessState = "stopped",
    version = "0.1.99",
  ) => {
    const lease = await acquireExtensionUpdateReservation({
      storagePath,
      version,
      installation,
      ready,
      processState: () => state,
    });
    if (lease) held.push(lease);
    return lease;
  };
  const path = join(storagePath, "extension-update.lock");
  const abandon = async (dispatched = false) => {
    const lease = (await acquire())!;
    if (dispatched) await lease.markDispatched();
    await lease.close();
    return readFile(path, "utf8");
  };
  return {
    root,
    storagePath,
    path,
    baseline,
    installation,
    installed,
    ready,
    acquire,
    abandon,
  };
};

describe("extension update reservation recovery", () => {
  it("owns and releases a new Windows lock whose stat mode reports0666", async () => {
    const f = await fixture();
    race.windowsMode = true;
    const lease = (await acquireExtensionUpdateReservation({
      storagePath: f.storagePath,
      version: "0.1.99",
      installation: f.installation,
      ready: async () => true,
      platform: "win32",
    }))!;
    held.push(lease);
    expect(await lease.owns()).toBe(true);
    const record = JSON.parse(await readFile(f.path, "utf8"));
    expect(record.owner.uid).toBeNull();
    expect(record.owner.platform).toBe("win32");
    await lease.markDispatched();
    expect(await lease.owns()).toBe(true);
    await lease.release();
    await expect(readFile(f.path)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("still refuses group/other access on the POSIX lock path", async () => {
    const f = await fixture();
    race.windowsMode = true;
    await expect(
      acquireExtensionUpdateReservation({
        storagePath: f.storagePath,
        version: "0.1.99",
        installation: f.installation,
        ready: async () => true,
        platform: "linux",
      }),
    ).rejects.toMatchObject({ reason: "lock-changed" });
    await readFile(f.path);
  });

  it.each([false, true])(
    "preserves a same-inode mutation during cleanup; Windows=%s",
    async (windows) => {
      const f = await fixture();
      const path = join(f.root, "owned.vsix");
      await writeFile(path, "old", { mode: 0o600 });
      const expected = updateFileIdentity(await lstat(path, { bigint: true }));
      let observations = 0;
      race.afterLstat = async (observed) => {
        if (observed === path && ++observations === 2) {
          race.afterLstat = undefined;
          await writeFile(path, "new");
        }
      };
      expect(
        await removeOwnedUpdateFile(
          path,
          expected,
          windows,
          createHash("sha256").update("old").digest("hex"),
        ),
      ).toBe(false);
      expect(observations).toBe(2);
      expect(await readFile(path, "utf8")).toBe("new");
    },
  );

  it("recovers a dead preparing owner only with its exact unchanged loaded installation", async () => {
    const f = await fixture();
    const before = await f.abandon();
    const next = (await f.acquire())!;
    expect(await next.owns()).toBe(true);
    expect(await readFile(f.path, "utf8")).not.toBe(before);
    await next.release();
    await expect(readFile(f.path)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it.each(["running", "unknown"] as const)(
    "preserves an owner whose process is %s",
    async (state) => {
      const f = await fixture();
      const before = await f.abandon();
      f.installation.mockClear();
      await expect(f.acquire(state)).rejects.toMatchObject({
        reason: state === "running" ? "update-in-progress" : "lock-unverified",
      });
      expect(await readFile(f.path, "utf8")).toBe(before);
      expect(f.installation).not.toHaveBeenCalled();
    },
  );

  it.each(["missing", "changed"] as const)(
    "preserves a dead preparing lock with %s installation evidence",
    async (kind) => {
      const f = await fixture();
      const before = await f.abandon();
      f.installation.mockResolvedValue(
        kind === "missing"
          ? null
          : { ...f.baseline, manifestSha256: "a".repeat(64) },
      );
      await expect(f.acquire()).rejects.toMatchObject({
        reason: "installation-unconfirmed",
      });
      expect(await readFile(f.path, "utf8")).toBe(before);
    },
  );

  it("preserves dispatched installation while the old package remains loaded", async () => {
    const f = await fixture();
    const before = await f.abandon(true);
    await expect(f.acquire()).rejects.toMatchObject({
      reason: "installation-unconfirmed",
    });
    expect(await readFile(f.path, "utf8")).toBe(before);
  });

  it("recovers a dispatched lock after the requested package is proven actively loaded", async () => {
    const f = await fixture();
    await f.abandon(true);
    f.installation.mockResolvedValue(await f.installed("0.1.99", "new-loaded"));
    const next = (await f.acquire("stopped", "0.1.100"))!;
    expect(await next.owns()).toBe(true);
    await next.release();
  });

  it("does not treat a newer descriptor as proof that the loaded package changed", async () => {
    const f = await fixture();
    expect(
      await readLoadedExtensionState(
        f.baseline.path,
        "0.1.17",
        f.baseline.path,
        "0.1.99",
      ),
    ).toBeNull();
    expect(
      await readLoadedExtensionState(
        f.baseline.path,
        "0.1.99",
        f.baseline.path,
        "0.1.99",
      ),
    ).toBeNull();
  });

  it.each([
    "legacy",
    "malformed",
    "foreign",
    "extra-key",
    "invalid-installation",
  ] as const)("preserves %s reservation metadata", async (kind) => {
    const f = await fixture();
    const original = JSON.parse(await f.abandon());
    const contents =
      kind === "legacy"
        ? JSON.stringify({
            pid: process.pid,
            token: original.token,
            version: original.version,
          })
        : kind === "malformed"
          ? "{not json"
          : JSON.stringify(
              kind === "foreign"
                ? {
                    ...original,
                    owner: { ...original.owner, host: "another-host" },
                  }
                : kind === "extra-key"
                  ? { ...original, extra: true }
                  : { ...original, installation: {} },
            );
    await writeFile(f.path, contents);
    await expect(f.acquire()).rejects.toMatchObject({
      reason: "lock-unverified",
    });
    expect(await readFile(f.path, "utf8")).toBe(contents);
  });

  it("preserves the lock if permission or idle state is revoked during recovery", async () => {
    const f = await fixture();
    const before = await f.abandon();
    f.ready.mockResolvedValue(false);
    expect(await f.acquire()).toBeUndefined();
    expect(await readFile(f.path, "utf8")).toBe(before);
  });

  it("rechecks synchronous consent after the last installation observation", async () => {
    const f = await fixture();
    const before = await f.abandon();
    let allowed = true,
      reads = 0;
    f.installation.mockImplementation(async () => {
      if (++reads === 2) allowed = false;
      return f.baseline;
    });
    expect(
      await acquireExtensionUpdateReservation({
        storagePath: f.storagePath,
        version: "0.1.99",
        installation: f.installation,
        ready: async () => true,
        permissionCurrent: () => allowed,
        processState: () => "stopped",
      }),
    ).toBeUndefined();
    expect(await readFile(f.path, "utf8")).toBe(before);
  });

  it("preserves a same-byte replacement made during the final recovery check", async () => {
    const f = await fixture();
    const before = await f.abandon();
    f.ready.mockImplementationOnce(async () => {
      await rename(f.path, join(f.root, "preserved-lock"));
      await writeFile(f.path, before, { mode: 0o600, flag: "wx" });
      return true;
    });
    await expect(f.acquire()).rejects.toMatchObject({
      reason: "lock-unverified",
    });
    expect(await readFile(f.path, "utf8")).toBe(before);
  });

  it("preserves a symlink reservation without reading its target", async () => {
    const f = await fixture();
    const target = join(f.root, "foreign.json");
    await writeFile(target, "preserve me");
    await symlink(target, f.path);
    await expect(f.acquire()).rejects.toMatchObject({
      reason: "lock-unverified",
    });
    expect(await realpath(f.path)).toBe(await realpath(target));
    expect(await readFile(target, "utf8")).toBe("preserve me");
  });
});
