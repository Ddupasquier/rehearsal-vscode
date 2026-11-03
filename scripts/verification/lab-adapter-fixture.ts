/** Generic prepared-fixture input proof; no installation, runtime or fixture ownership. */
import assert from "node:assert/strict";
import { constants } from "node:fs";
import { createHash } from "node:crypto";
import { lstat, open, readdir, readlink, realpath } from "node:fs/promises";
import { basename, dirname, isAbsolute, relative, resolve } from "node:path";

export interface LabAdapterFixture {
  parentOwnership: {
    scope: "reviewed-parent-owned-fresh-workspace";
    runId: string;
    workspaceSnapshotSha256: string;
  };
  schemaVersion: 1;
  scope: "editor-adapter-fixture";
  fixtureRoot: string;
  postgresqlRoot: string;
  libraryRoot: string;
  resourceProjectId: string;
  applicationUrl: string;
  postgresqlConfigPath: string;
  payloadTrust: "reviewed-parent-extracted-and-byte-compared";
  artifact: {
    path: string;
    sha256: string;
    version: string;
    files: { path: string; sha256: string; size: number }[];
  };
}
const keys = (value: Record<string, unknown>, expected: string[]) =>
  assert.deepEqual(Object.keys(value).sort(), expected.sort());
const object = (value: unknown): Record<string, unknown> => {
  assert.ok(value && typeof value === "object" && !Array.isArray(value));
  return value as Record<string, unknown>;
};
const inside = (root: string, path: string) => {
  const tail = relative(root, path);
  return tail !== "" && !tail.startsWith("..") && !isAbsolute(tail);
};
export function parseLabAdapterFixture(value: unknown): LabAdapterFixture {
  const m = object(value);
  keys(m, [
    "parentOwnership",
    "schemaVersion",
    "scope",
    "fixtureRoot",
    "postgresqlRoot",
    "libraryRoot",
    "resourceProjectId",
    "applicationUrl",
    "postgresqlConfigPath",
    "payloadTrust",
    "artifact",
  ]);
  assert.equal(m.schemaVersion, 1);
  assert.equal(m.scope, "editor-adapter-fixture");
  assert.equal(m.payloadTrust, "reviewed-parent-extracted-and-byte-compared");
  for (const k of ["fixtureRoot", "postgresqlRoot", "libraryRoot"]) {
    assert.equal(typeof m[k], "string");
    assert.ok(
      isAbsolute(m[k] as string) &&
        (m[k] as string).length <= 2048 &&
        resolve(m[k] as string) === m[k],
    );
  }
  assert.equal(basename(m.fixtureRoot as string), "workspace");
  assert.equal(
    basename(dirname(dirname(m.fixtureRoot as string))),
    "candidate-acceptance",
  );
  assert.equal(
    m.postgresqlRoot,
    resolve(m.fixtureRoot as string, "projects/postgresql"),
  );
  assert.equal(
    m.libraryRoot,
    resolve(m.fixtureRoot as string, "projects/library"),
  );
  const ownership = object(m.parentOwnership);
  keys(ownership, ["scope", "runId", "workspaceSnapshotSha256"]);
  assert.equal(ownership.scope, "reviewed-parent-owned-fresh-workspace");
  assert.equal(typeof ownership.runId, "string");
  assert.match(ownership.runId as string, /^rtl-[a-f0-9]{10}$/u);
  assert.equal(typeof ownership.workspaceSnapshotSha256, "string");
  assert.match(ownership.workspaceSnapshotSha256 as string, /^[a-f0-9]{64}$/u);
  assert.equal(typeof m.postgresqlConfigPath, "string");
  assert.equal(m.postgresqlConfigPath, ".rehearsal/candidate.config.mjs");
  assert.equal(typeof m.resourceProjectId, "string");
  assert.equal(m.resourceProjectId, `${ownership.runId}-postgresql-rehearsal`);
  assert.equal(typeof m.applicationUrl, "string");
  const url = new URL(m.applicationUrl as string);
  assert.equal(url.protocol, "http:");
  assert.equal(url.hostname, "127.0.0.1");
  assert.ok(Number(url.port) >= 1024 && Number(url.port) <= 65535);
  assert.equal(url.username + url.password + url.search + url.hash, "");
  assert.equal(url.pathname, "/");
  assert.equal(m.applicationUrl, `http://127.0.0.1:${url.port}`);
  const a = object(m.artifact);
  keys(a, ["path", "sha256", "version", "files"]);
  assert.equal(typeof a.path, "string");
  assert.ok(
    isAbsolute(a.path as string) && resolve(a.path as string) === a.path,
  );
  assert.equal(a.path, resolve(m.fixtureRoot as string, "../candidate.tgz"));
  assert.equal(typeof a.sha256, "string");
  assert.match(String(a.sha256), /^[a-f0-9]{64}$/u);
  assert.equal(typeof a.version, "string");
  assert.match(
    String(a.version),
    /^(?:0|[1-9][0-9]{0,5})\.(?:0|[1-9][0-9]{0,5})\.(?:0|[1-9][0-9]{0,5})$/u,
  );
  assert.ok(
    Array.isArray(a.files) && a.files.length > 0 && a.files.length <= 2048,
  );
  let total = 0;
  const seen = new Set<string>();
  for (const raw of a.files) {
    const f = object(raw);
    keys(f, ["path", "sha256", "size"]);
    assert.equal(typeof f.path, "string");
    assert.match(f.path as string, /^[A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_.-]+)*$/u);
    assert.ok(
      !(f.path as string).split("/").some((x) => x === "." || x === ".."),
    );
    assert.notEqual(
      (f.path as string).split("/")[0],
      "node_modules",
      "Dependency trees are parent-owned, never published Core payload.",
    );
    assert.ok(!seen.has(f.path as string));
    seen.add(f.path as string);
    assert.equal(typeof f.sha256, "string");
    assert.match(String(f.sha256), /^[a-f0-9]{64}$/u);
    assert.ok(
      Number.isSafeInteger(f.size) &&
        Number(f.size) >= 0 &&
        Number(f.size) <= 8 * 1024 * 1024,
    );
    total += Number(f.size);
    assert.ok(total <= 64 * 1024 * 1024);
  }
  assert.ok(seen.has("package.json"));
  return m as unknown as LabAdapterFixture;
}
async function stableBytes(
  path: string,
  maximum: number,
  privateFile = false,
): Promise<Buffer> {
  assert.equal(await realpath(path), path);
  const h = await open(
    path,
    constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
  );
  try {
    const before = await h.stat(),
      leaf = await lstat(path);
    assert.ok(
      before.isFile() &&
        leaf.isFile() &&
        !leaf.isSymbolicLink() &&
        before.nlink === 1 &&
        before.dev === leaf.dev &&
        before.ino === leaf.ino &&
        before.size <= maximum,
    );
    if (privateFile)
      assert.ok(
        (before.mode & 0o077) === 0 && before.uid === process.getuid?.(),
      );
    const bytes = Buffer.alloc(before.size);
    let offset = 0;
    while (offset < bytes.length) {
      const r = await h.read(bytes, offset, bytes.length - offset, offset);
      assert.ok(r.bytesRead > 0);
      offset += r.bytesRead;
    }
    const after = await h.stat();
    for (const k of ["dev", "ino", "size", "mtimeMs", "ctimeMs"] as const)
      assert.equal(after[k], before[k]);
    assert.equal(await realpath(path), path);
    const finalLeaf = await lstat(path);
    assert.ok(finalLeaf.isFile() && !finalLeaf.isSymbolicLink());
    for (const key of ["dev", "ino", "size", "mtimeMs", "ctimeMs"] as const)
      assert.equal(finalLeaf[key], before[key]);
    return bytes;
  } finally {
    await h.close();
  }
}
export async function readLabAdapterFixture(
  path: string,
  approvedRoot: string,
): Promise<LabAdapterFixture> {
  path = resolve(path);
  assert.equal(await realpath(approvedRoot), approvedRoot);
  assert.ok(inside(approvedRoot, path));
  const m = parseLabAdapterFixture(
    JSON.parse(
      (await stableBytes(path, 2 * 1024 * 1024, true)).toString("utf8"),
    ),
  );
  assert.ok(inside(approvedRoot, m.fixtureRoot));
  assert.ok(inside(approvedRoot, m.artifact.path));
  assert.equal(path, resolve(m.fixtureRoot, "editor-adapter-fixture.json"));
  const snapshot = resolve(m.fixtureRoot, "../workspace-snapshot.json");
  assert.ok(inside(approvedRoot, snapshot));
  assert.equal(
    createHash("sha256")
      .update(await stableBytes(snapshot, 2 * 1024 * 1024, true))
      .digest("hex"),
    m.parentOwnership.workspaceSnapshotSha256,
  );
  for (const dir of [m.fixtureRoot, m.postgresqlRoot, m.libraryRoot]) {
    assert.equal(await realpath(dir), dir);
    const info = await lstat(dir);
    assert.ok(info.isDirectory() && !info.isSymbolicLink());
    if (dir === m.fixtureRoot)
      assert.ok((info.mode & 0o077) === 0 && info.uid === process.getuid?.());
  }
  assert.equal(
    createHash("sha256")
      .update(await stableBytes(m.artifact.path, 32 * 1024 * 1024, true))
      .digest("hex"),
    m.artifact.sha256,
  );
  const directory = async (dir: string, boundary: string) => {
    assert.ok(dir === boundary || inside(boundary, dir));
    assert.ok(inside(m.fixtureRoot, dir));
    assert.equal(await realpath(dir), dir);
    const info = await lstat(dir);
    assert.ok(info.isDirectory() && !info.isSymbolicLink());
  };
  // Parent proves extraction from the reviewed tar; independently compare every installed byte.
  for (const project of [m.postgresqlRoot, m.libraryRoot]) {
    const packageRoot = resolve(project, "node_modules/@rehearsal-db/core");
    assert.equal(await realpath(packageRoot), packageRoot);
    const files: string[] = [];
    let entries = 0;
    const walk = async (dir: string, depth = 0) => {
      assert.ok(depth <= 32);
      await directory(dir, packageRoot);
      for (const entry of await readdir(dir, { withFileTypes: true })) {
        assert.ok(++entries <= 4096);
        const file = resolve(dir, entry.name);
        // npm may nest runtime dependencies here. They remain parent-owned,
        // parent-managed dependencies, not bytes published in the Core tar.
        if (dir === packageRoot && entry.name === "node_modules") {
          assert.ok(entry.isDirectory() && !entry.isSymbolicLink());
          await directory(file, packageRoot);
          continue;
        }
        if (entry.isDirectory()) await walk(file, depth + 1);
        else {
          assert.ok(entry.isFile() && !entry.isSymbolicLink());
          files.push(relative(packageRoot, file));
          assert.ok(files.length <= 2048);
        }
      }
    };
    await walk(packageRoot);
    assert.deepEqual(files.sort(), m.artifact.files.map((f) => f.path).sort());
    for (const f of m.artifact.files) {
      const bytes = await stableBytes(
        resolve(packageRoot, f.path),
        8 * 1024 * 1024,
      );
      assert.equal(bytes.length, f.size);
      assert.equal(createHash("sha256").update(bytes).digest("hex"), f.sha256);
    }
  }
  // Baseline's intentional current link is permitted only when its canonical target stays in this fixture.
  let baselineEntries = 0;
  const baseline = resolve(m.postgresqlRoot, ".rehearsal");
  const scan = async (dir: string, depth = 0) => {
    assert.ok(depth <= 32);
    await directory(dir, baseline);
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const file = resolve(dir, entry.name);
      assert.ok(++baselineEntries <= 10000);
      if (entry.isSymbolicLink()) {
        assert.equal(file, resolve(baseline, "current"));
        assert.ok(inside(baseline, await realpath(file)));
      } else if (entry.isDirectory()) await scan(file, depth + 1);
      else assert.ok(entry.isFile());
    }
  };
  await scan(baseline);
  for (const file of [
    ".rehearsal",
    "rehearsal.config.mjs",
    "rehearsal.config.js",
    "rehearsal.config.cjs",
    "rehearsal.config.ts",
  ])
    await lstat(resolve(m.libraryRoot, file)).then(
      () => {
        throw Error("Prepared Library fixture must remain unconfigured.");
      },
      (error: NodeJS.ErrnoException) => {
        if (error.code !== "ENOENT") throw error;
      },
    );
  return m;
}

/** Capture only immutable reviewed inputs; runtime caches and parent leases stay parent-owned. */
export async function captureLabAdapterInputs(
  path: string,
  approvedRoot: string,
) {
  const manifest = await readLabAdapterFixture(path, approvedRoot);
  const entries: Record<string, string> = {};
  let count = 0,
    total = 0;
  const boundary = resolve(manifest.postgresqlRoot, ".rehearsal/generations");
  const walk = async (file: string, depth = 0): Promise<void> => {
    assert.ok(depth <= 32 && ++count <= 12000);
    const before = await lstat(file, { bigint: true });
    const identity = [
      before.dev,
      before.ino,
      before.birthtimeNs,
      before.mode,
      before.size,
      before.mtimeNs,
      before.ctimeNs,
    ]
      .map(String)
      .join(":");
    if (before.isSymbolicLink()) {
      assert.equal(
        file,
        resolve(manifest.postgresqlRoot, ".rehearsal/current"),
      );
      assert.ok(inside(boundary, await realpath(file)));
      entries[file] = `link:${identity}:${await readlink(file)}`;
    } else if (before.isDirectory()) {
      assert.equal(await realpath(file), file);
      entries[file] = `directory:${identity}`;
      for (const name of (await readdir(file)).sort())
        await walk(resolve(file, name), depth + 1);
    } else {
      assert.ok(
        before.isFile() &&
          before.nlink === 1n &&
          before.size <= 32n * 1024n * 1024n,
      );
      total += Number(before.size);
      assert.ok(total <= 256 * 1024 * 1024);
      const bytes = await stableBytes(file, 32 * 1024 * 1024);
      const after = await lstat(file, { bigint: true });
      assert.equal(
        [
          after.dev,
          after.ino,
          after.birthtimeNs,
          after.mode,
          after.size,
          after.mtimeNs,
          after.ctimeNs,
        ]
          .map(String)
          .join(":"),
        identity,
      );
      entries[file] =
        `file:${identity}:${createHash("sha256").update(bytes).digest("hex")}`;
    }
  };
  for (const file of [
    resolve(path),
    manifest.artifact.path,
    resolve(manifest.fixtureRoot, "../workspace-snapshot.json"),
    resolve(manifest.postgresqlRoot, "rehearsal.config.mjs"),
    resolve(manifest.postgresqlRoot, "package.json"),
    resolve(manifest.postgresqlRoot, manifest.postgresqlConfigPath),
    resolve(manifest.postgresqlRoot, ".rehearsal/secrets/privacy.key"),
    resolve(manifest.postgresqlRoot, ".rehearsal/current"),
    boundary,
    resolve(manifest.postgresqlRoot, "infrastructure/rehearsal"),
    resolve(manifest.libraryRoot, "package.json"),
  ])
    await walk(file);
  const lock = resolve(manifest.libraryRoot, "package-lock.json");
  if (
    await lstat(lock).then(
      () => true,
      (error: NodeJS.ErrnoException) => {
        if (error.code !== "ENOENT") throw error;
        return false;
      },
    )
  )
    await walk(lock);
  else entries[lock] = "absent";
  return {
    manifest,
    fingerprint: createHash("sha256")
      .update(JSON.stringify(entries))
      .digest("hex"),
  };
}
