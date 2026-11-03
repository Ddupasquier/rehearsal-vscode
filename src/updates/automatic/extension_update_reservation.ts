/** Exact local reservations for verified extension installation; never age-based recovery. */
import { constants, type BigIntStats } from "node:fs";
import {
  lstat,
  open,
  realpath,
  unlink,
  type FileHandle,
} from "node:fs/promises";
import { createHash, randomUUID } from "node:crypto";
import { hostname, userInfo } from "node:os";
import { isAbsolute, join } from "node:path";
import { EXTENSION_ID } from "../identity/extension_identity.js";
import {
  comparePublishedVersions,
  isPublishedVersion,
} from "../advisory/update_advisory.js";

export type ExtensionUpdateBlockedReason =
  | "update-in-progress"
  | "lock-unverified"
  | "lock-changed"
  | "installation-unconfirmed";
export class ExtensionUpdateBlockedError extends Error {
  constructor(readonly reason: ExtensionUpdateBlockedReason) {
    super(
      "Automatic extension updating needs installation or reservation review.",
    );
    this.name = "ExtensionUpdateBlockedError";
  }
}
interface EntryIdentity {
  dev: string;
  ino: string;
  birthtimeNs: string;
}
export interface UpdateFileIdentity extends EntryIdentity {
  ctimeNs: string;
  mtimeNs: string;
  size: string;
}
export interface LoadedExtensionState {
  version: string;
  path: string;
  manifestSha256: string;
  manifest: UpdateFileIdentity;
}
const equal = (a: unknown, b: unknown) =>
  JSON.stringify(a) === JSON.stringify(b);
const entryIdentity = (entry: BigIntStats): EntryIdentity => {
  if (entry.birthtimeNs <= 0n)
    throw new ExtensionUpdateBlockedError("lock-unverified");
  return {
    dev: String(entry.dev),
    ino: String(entry.ino),
    birthtimeNs: String(entry.birthtimeNs),
  };
};
export const updateFileIdentity = (entry: BigIntStats): UpdateFileIdentity => ({
  ...entryIdentity(entry),
  ctimeNs: String(entry.ctimeNs),
  mtimeNs: String(entry.mtimeNs),
  size: String(entry.size),
});
const regular = (entry: BigIntStats) =>
  entry.isFile() && !entry.isSymbolicLink() && entry.nlink === 1n;
export async function matchesUpdateFile(
  path: string,
  expected: UpdateFileIdentity,
): Promise<boolean> {
  try {
    const current = await lstat(path, { bigint: true });
    return regular(current) && equal(updateFileIdentity(current), expected);
  } catch {
    return false;
  }
}
const owner = (platform: NodeJS.Platform) => ({
  host: hostname(),
  user: userInfo().username,
  platform,
  uid: platform === "win32" ? null : (process.getuid?.() ?? null),
});
const readFlags = (platform = process.platform) =>
  constants.O_RDONLY | (platform === "win32" ? 0 : constants.O_NOFOLLOW);
const readBounded = async (file: FileHandle, maximum: number) => {
  const buffer = Buffer.alloc(maximum + 1);
  let offset = 0;
  while (offset < buffer.length) {
    const read = await file.read(
      buffer,
      offset,
      buffer.length - offset,
      offset,
    );
    if (!read.bytesRead) break;
    offset += read.bytesRead;
  }
  if (offset > maximum)
    throw new ExtensionUpdateBlockedError("lock-unverified");
  return buffer.subarray(0, offset);
};
export type UpdateProcessState = "running" | "stopped" | "unknown";
export const updateProcessState = (pid: number): UpdateProcessState => {
  try {
    process.kill(pid, 0);
    return "running";
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "ESRCH"
      ? "stopped"
      : "unknown";
  }
};

/** Loaded context plus its canonical manifest, rather than a newly registered descriptor alone. */
export async function readLoadedExtensionState(
  loadedPath: string | undefined,
  loadedVersion: string,
  registeredPath: string | undefined,
  registeredVersion: unknown,
): Promise<LoadedExtensionState | null> {
  if (
    !loadedPath ||
    !registeredPath ||
    registeredVersion !== loadedVersion ||
    !isPublishedVersion(loadedVersion)
  )
    return null;
  try {
    const path = await realpath(loadedPath);
    if ((await realpath(registeredPath)) !== path) return null;
    const manifestPath = join(path, "package.json");
    const entry = await lstat(manifestPath, { bigint: true });
    if (!regular(entry)) return null;
    const handle = await open(manifestPath, readFlags());
    try {
      const before = await handle.stat({ bigint: true });
      if (
        !regular(before) ||
        before.size > 1024n * 1024n ||
        !equal(updateFileIdentity(before), updateFileIdentity(entry))
      )
        return null;
      const bytes = await readBounded(handle, 1024 * 1024);
      const after = await handle.stat({ bigint: true });
      const current = await lstat(join(path, "package.json"), { bigint: true });
      if (
        bytes.length > 1024 * 1024 ||
        !regular(current) ||
        !equal(updateFileIdentity(before), updateFileIdentity(after)) ||
        !equal(updateFileIdentity(after), updateFileIdentity(current))
      )
        return null;
      const manifest = JSON.parse(bytes.toString("utf8")) as Record<
        string,
        unknown
      >;
      if (
        manifest.publisher !== "rehearsal-db" ||
        manifest.name !== "rehearsal-db" ||
        manifest.version !== loadedVersion
      )
        return null;
      return {
        path,
        version: loadedVersion,
        manifestSha256: createHash("sha256").update(bytes).digest("hex"),
        manifest: updateFileIdentity(after),
      };
    } finally {
      await handle.close();
    }
  } catch {
    return null;
  }
}

/** Preserve changed/replaced entries; Windows chmod uses the same held-file proof. */
export async function removeOwnedUpdateFile(
  path: string,
  expected: UpdateFileIdentity,
  windows = false,
  expectedSha256?: string,
): Promise<boolean> {
  let file: FileHandle | undefined;
  try {
    const entry = await lstat(path, { bigint: true });
    if (!regular(entry) || !equal(updateFileIdentity(entry), expected))
      return false;
    file = await open(path, readFlags());
    const held = await file.stat({ bigint: true });
    const current = await lstat(path, { bigint: true });
    if (
      !regular(current) ||
      !equal(updateFileIdentity(held), expected) ||
      !equal(updateFileIdentity(current), expected)
    )
      return false;
    let finalExpected = expected;
    if (windows) {
      if (
        !expectedSha256 ||
        (await hashUpdateFile(file, expected.size)) !== expectedSha256
      )
        return false;
      if (
        !equal(
          updateFileIdentity(await file.stat({ bigint: true })),
          expected,
        ) ||
        !(await matchesUpdateFile(path, expected))
      )
        return false;
      await file.chmod(0o600);
      const writable = updateFileIdentity(await file.stat({ bigint: true }));
      // chmod changes ctime, but never the recorded content size or mtime.
      if (
        !equal({ ...writable, ctimeNs: expected.ctimeNs }, expected) ||
        (await hashUpdateFile(file, expected.size)) !== expectedSha256
      )
        return false;
      finalExpected = writable;
    }
    const after = await file.stat({ bigint: true });
    const final = await lstat(path, { bigint: true });
    if (
      !regular(final) ||
      !equal(updateFileIdentity(after), finalExpected) ||
      !equal(updateFileIdentity(final), finalExpected)
    )
      return false;
    await unlink(path);
    return true;
  } catch {
    return false;
  } finally {
    await file?.close().catch(() => {});
  }
}

async function hashUpdateFile(
  file: FileHandle,
  size: string,
): Promise<string | null> {
  const maximum = Number(size);
  if (!Number.isSafeInteger(maximum) || maximum < 0) return null;
  const hash = createHash("sha256"),
    buffer = Buffer.alloc(65536);
  let offset = 0;
  while (offset <= maximum) {
    const read = await file.read(
      buffer,
      0,
      Math.min(buffer.length, maximum - offset + 1),
      offset,
    );
    if (!read.bytesRead) break;
    offset += read.bytesRead;
    if (offset > maximum) return null;
    hash.update(buffer.subarray(0, read.bytesRead));
  }
  return offset === maximum ? hash.digest("hex") : null;
}

interface RecordData {
  schemaVersion: 1;
  extensionId: typeof EXTENSION_ID;
  storagePath: string;
  owner: ReturnType<typeof owner>;
  pid: number;
  token: string;
  version: string;
  phase: "preparing" | "installer-dispatched";
  file: EntryIdentity;
  installation: LoadedExtensionState | null;
}
interface ReadReservation {
  record: RecordData;
  bytes: string;
  identity: UpdateFileIdentity;
}
const keys = (value: object, expected: string[]) =>
  equal(Object.keys(value).sort(), expected.sort());
const loadedState = (value: unknown): value is LoadedExtensionState => {
  if (
    !value ||
    typeof value !== "object" ||
    !keys(value, ["version", "path", "manifestSha256", "manifest"])
  )
    return false;
  const state = value as LoadedExtensionState;
  return (
    isPublishedVersion(state.version) &&
    typeof state.path === "string" &&
    isAbsolute(state.path) &&
    /^[a-f0-9]{64}$/u.test(state.manifestSha256) &&
    !!state.manifest &&
    keys(state.manifest, [
      "dev",
      "ino",
      "birthtimeNs",
      "ctimeNs",
      "mtimeNs",
      "size",
    ]) &&
    Object.values(state.manifest).every(
      (part) => typeof part === "string" && /^\d+$/u.test(part),
    ) &&
    BigInt(state.manifest.birthtimeNs) > 0n
  );
};
async function readReservation(
  path: string,
  storagePath: string,
  platform: NodeJS.Platform,
): Promise<ReadReservation> {
  let file: FileHandle | undefined;
  try {
    const observed = await lstat(path, { bigint: true });
    if (!regular(observed))
      throw new ExtensionUpdateBlockedError("lock-unverified");
    file = await open(path, readFlags(platform));
    const entry = await file.stat({ bigint: true });
    if (
      !regular(entry) ||
      entry.size > 16384n ||
      !equal(updateFileIdentity(observed), updateFileIdentity(entry)) ||
      (platform !== "win32" &&
        ((entry.mode & 0o077n) !== 0n ||
          !process.getuid ||
          entry.uid !== BigInt(process.getuid())))
    )
      throw new ExtensionUpdateBlockedError("lock-unverified");
    const buffer = Buffer.alloc(16385);
    let length = 0;
    while (length < buffer.length) {
      const read = await file.read(
        buffer,
        length,
        buffer.length - length,
        length,
      );
      if (!read.bytesRead) break;
      length += read.bytesRead;
    }
    const current = await lstat(path, { bigint: true });
    if (
      length > 16384 ||
      !regular(current) ||
      !equal(updateFileIdentity(entry), updateFileIdentity(current))
    )
      throw new ExtensionUpdateBlockedError("lock-changed");
    const bytes = buffer.subarray(0, length).toString("utf8");
    const record = JSON.parse(bytes) as RecordData;
    if (
      !record ||
      !keys(record, [
        "schemaVersion",
        "extensionId",
        "storagePath",
        "owner",
        "pid",
        "token",
        "version",
        "phase",
        "file",
        "installation",
      ]) ||
      record.schemaVersion !== 1 ||
      record.extensionId !== EXTENSION_ID ||
      record.storagePath !== storagePath ||
      !equal(record.owner, owner(platform)) ||
      !Number.isSafeInteger(record.pid) ||
      record.pid <= 1 ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u.test(
        record.token,
      ) ||
      !isPublishedVersion(record.version) ||
      !["preparing", "installer-dispatched"].includes(record.phase) ||
      !equal(record.file, entryIdentity(entry)) ||
      (record.installation !== null && !loadedState(record.installation))
    )
      throw new ExtensionUpdateBlockedError("lock-unverified");
    return { record, bytes, identity: updateFileIdentity(entry) };
  } catch (error) {
    if (error instanceof ExtensionUpdateBlockedError) throw error;
    throw new ExtensionUpdateBlockedError("lock-unverified");
  } finally {
    await file?.close();
  }
}

export interface ExtensionUpdateReservation {
  owns(): Promise<boolean>;
  markDispatched(): Promise<void>;
  release(): Promise<void>;
  close(): Promise<void>;
}
export async function acquireExtensionUpdateReservation({
  storagePath,
  version,
  installation,
  ready,
  permissionCurrent = () => true,
  processState = updateProcessState,
  platform = process.platform,
}: {
  storagePath: string;
  version: string;
  installation: () => Promise<LoadedExtensionState | null>;
  ready: () => Promise<boolean>;
  permissionCurrent?: () => boolean;
  processState?: (pid: number) => UpdateProcessState;
  platform?: NodeJS.Platform;
}): Promise<ExtensionUpdateReservation | undefined> {
  const canonical = await realpath(storagePath);
  const path = join(canonical, "extension-update.lock");
  for (let attempt = 0; attempt < 2; attempt++) {
    if (!permissionCurrent()) return undefined;
    let handle: FileHandle;
    try {
      handle = await open(path, "wx+", 0o600);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      const previous = await readReservation(path, canonical, platform);
      const ownerState = processState(previous.record.pid);
      if (ownerState !== "stopped")
        throw new ExtensionUpdateBlockedError(
          ownerState === "running" ? "update-in-progress" : "lock-unverified",
        );
      const loaded = await installation();
      const recoverable =
        loaded !== null &&
        ((previous.record.phase === "preparing" &&
          equal(previous.record.installation, loaded)) ||
          [0, 1].includes(
            comparePublishedVersions(loaded.version, previous.record.version) ??
              -1,
          ));
      if (!recoverable)
        throw new ExtensionUpdateBlockedError("installation-unconfirmed");
      if (!(await ready())) return undefined;
      const current = await readReservation(path, canonical, platform);
      if (
        !equal(current, previous) ||
        !equal(await installation(), loaded) ||
        processState(previous.record.pid) !== "stopped"
      )
        throw new ExtensionUpdateBlockedError("lock-changed");
      if (!permissionCurrent()) return undefined;
      if (!(await removeOwnedUpdateFile(path, previous.identity)))
        throw new ExtensionUpdateBlockedError("lock-changed");
      continue;
    }
    let bytes = "";
    let identity: UpdateFileIdentity;
    let closed = false;
    const close = async () => {
      if (!closed) {
        closed = true;
        await handle.close();
      }
    };
    let record: RecordData;
    const owns = async () => {
      try {
        const current = await readReservation(path, canonical, platform);
        return current.bytes === bytes && equal(current.identity, identity);
      } catch {
        return false;
      }
    };
    const write = async () => {
      const buffer = Buffer.from(JSON.stringify(record));
      for (let offset = 0; offset < buffer.length;) {
        const result = await handle.write(
          buffer,
          offset,
          buffer.length - offset,
          offset,
        );
        if (!result.bytesWritten)
          throw new ExtensionUpdateBlockedError("lock-changed");
        offset += result.bytesWritten;
      }
      await handle.truncate(buffer.length);
      await handle.sync();
      identity = updateFileIdentity(await handle.stat({ bigint: true }));
      bytes = buffer.toString("utf8");
      if (!(await owns()))
        throw new ExtensionUpdateBlockedError("lock-changed");
    };
    try {
      record = {
        schemaVersion: 1,
        extensionId: EXTENSION_ID,
        storagePath: canonical,
        owner: owner(platform),
        pid: process.pid,
        token: randomUUID(),
        version,
        phase: "preparing",
        file: entryIdentity(await handle.stat({ bigint: true })),
        installation: await installation(),
      };
      await write();
      return {
        owns,
        markDispatched: async () => {
          if (!(await owns()))
            throw new ExtensionUpdateBlockedError("lock-changed");
          record.phase = "installer-dispatched";
          await write();
        },
        close,
        release: async () => {
          const owned = await owns();
          await close();
          if (owned) await removeOwnedUpdateFile(path, identity);
        },
      };
    } catch (error) {
      await close();
      throw error;
    }
  }
  throw new ExtensionUpdateBlockedError("lock-changed");
}
