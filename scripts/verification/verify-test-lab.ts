/** Read-only adapter acceptance against a reviewed parent's fresh owned fixture. */
import assert from "node:assert/strict";
import { constants } from "node:fs";
import { createHash } from "node:crypto";
import { lstat, open, readdir, readFile, realpath } from "node:fs/promises";
import { basename, dirname, isAbsolute, relative, resolve } from "node:path";
import { inspectProject } from "../../src/workspace/project_snapshot.js";
import { nativeStorageRoot } from "../native/native-development-storage.js";
import {
  bootstrapProjectDiscovery,
  type WorkspaceEntryKind,
} from "../../src/workspace/bootstrap_discovery.js";

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
  assert.ok(
    ["candidate-acceptance", "upgrade-acceptance"].includes(
      basename(dirname(dirname(m.fixtureRoot as string))),
    ),
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
  assert.match(
    m.postgresqlConfigPath as string,
    /^(?:[A-Za-z0-9_.-]+\/)*[A-Za-z0-9_.-]+\.mjs$/u,
  );
  assert.ok(
    !(m.postgresqlConfigPath as string)
      .split("/")
      .some((x) => x === "." || x === ".."),
  );
  assert.equal(typeof m.resourceProjectId, "string");
  assert.match(m.resourceProjectId as string, /^[a-z0-9][a-z0-9-]{0,95}$/u);
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
  assert.ok(inside(approvedRoot, path));
  const m = parseLabAdapterFixture(
    JSON.parse(
      (await stableBytes(path, 2 * 1024 * 1024, true)).toString("utf8"),
    ),
  );
  assert.ok(inside(approvedRoot, m.fixtureRoot));
  assert.ok(inside(approvedRoot, m.artifact.path));
  assert.ok(inside(m.fixtureRoot, path));
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
  return m;
}
const bootstrapProfile = async (workspaceRoot: string, workspaceName: string) =>
  bootstrapProjectDiscovery({
    workspaceName,
    async kind(path): Promise<WorkspaceEntryKind> {
      try {
        const metadata = await lstat(resolve(workspaceRoot, path));
        if (metadata.isSymbolicLink()) return "symlink";
        if (metadata.isFile()) return "file";
        if (metadata.isDirectory()) return "directory";
        return null;
      } catch {
        return null;
      }
    },
    async readText(path, maximumBytes): Promise<string | null> {
      try {
        const target = resolve(workspaceRoot, path);
        const metadata = await lstat(target);
        if (
          metadata.isSymbolicLink() ||
          !metadata.isFile() ||
          metadata.size > maximumBytes
        ) {
          return null;
        }
        return await readFile(target, "utf8");
      } catch {
        return null;
      }
    },
  });

export async function verifyPreparedLabAdapter(
  manifest: LabAdapterFixture,
  inspect: typeof inspectProject = inspectProject,
) {
  const postgresqlRoot = manifest.postgresqlRoot,
    libraryRoot = manifest.libraryRoot;
  const ready = await inspect({
    workspaceName: "Test Lab PostgreSQL",
    workspaceRoot: postgresqlRoot,
    configPath: manifest.postgresqlConfigPath,
    trusted: true,
    bootstrapDiscovery: await bootstrapProfile(
      postgresqlRoot,
      "Test Lab PostgreSQL",
    ),
  });
  if (ready.availability !== "ready") {
    const failedChecks = ready.readiness?.checks
      .filter(({ status }) => status === "fail")
      .map(({ id }) => id)
      .join(", ");
    throw new Error(
      `Expected ready Test Lab project; received ${ready.availability}${failedChecks ? ` (${failedChecks})` : ""}${ready.error ? ` (${ready.error.code}: ${ready.error.message})` : ""}.`,
    );
  }
  if (
    ready.version !== manifest.artifact.version ||
    ready.baseline?.rowCount !== 10_003
  ) {
    throw new Error(
      "The Test Lab overview did not preserve the installed version and safe aggregate baseline count.",
    );
  }
  if (
    !ready.baseline.generations?.some(({ active }) => active) ||
    ready.baseline.generations.length < 2
  ) {
    throw new Error(
      "The Test Lab overview did not expose active and retained baseline versions.",
    );
  }
  if (
    ready.packageLocation !==
      resolve(postgresqlRoot, "node_modules/@rehearsal-db/core") ||
    ready.candidates?.targets.length !== 1
  ) {
    throw new Error(
      `The Test Lab overview did not expose the project package location and configured target (package=${ready.packageLocation ?? "missing"}, targets=${String(ready.candidates?.targets.length ?? "missing")}).`,
    );
  }
  const runtimeTarget = ready.runtime?.targets[0];
  if (
    ready.activity?.state !== "idle" ||
    ready.runtime?.targets.length !== 1 ||
    runtimeTarget?.runtimeTarget !== "postgresql" ||
    typeof runtimeTarget.verifiedRuntimeAvailable !== "boolean" ||
    ready.runtime.state !== runtimeTarget.state
  ) {
    throw new Error(
      `The Test Lab overview did not consume the structured activity and runtime contracts (activity=${ready.activity?.state ?? "missing"}, targetCount=${String(ready.runtime?.targets.length ?? "missing")}, runtimeState=${ready.runtime?.state ?? "missing"}, targetState=${runtimeTarget?.state ?? "missing"}, runtimeTarget=${runtimeTarget?.runtimeTarget ?? "missing"}, verifiedRuntimeAvailable=${String(runtimeTarget?.verifiedRuntimeAvailable ?? "missing")}).`,
    );
  }
  if (ready.applicationUrl !== manifest.applicationUrl) {
    throw new Error(
      "The Test Lab overview did not expose the configured loopback application URL.",
    );
  }
  if (
    ready.resources?.schemaVersion !== 1 ||
    ready.resources.engine.state !== "running" ||
    ready.resources.environments.length !== 1 ||
    ready.resources.environments[0]?.provider !== "postgresql" ||
    ready.resources.environments[0]?.projectId !== manifest.resourceProjectId
  ) {
    throw new Error(
      "The Test Lab overview did not consume the ownership-scoped resource inventory.",
    );
  }
  if (
    !ready.discovery ||
    !ready.discovery.profile.detected.some(
      ({ id }) => id === "database.migrationDirectories",
    ) ||
    !ready.discovery.profile.suggested.some(
      ({ id }) => id === "application.proofCommand",
    ) ||
    !ready.discovery.profile.decisions.some(
      ({ id }) => id === "privacy.productionData",
    )
  ) {
    throw new Error(
      "The Test Lab overview did not consume the versioned core discovery profile.",
    );
  }

  const newUser = await inspect({
    workspaceName: "Test Lab Library",
    workspaceRoot: libraryRoot,
    trusted: true,
    bootstrapDiscovery: await bootstrapProfile(libraryRoot, "Test Lab Library"),
  });
  if (newUser.availability !== "not_ready") {
    throw new Error(
      `Expected clean-room project to need setup; received ${newUser.availability}.`,
    );
  }
  if (
    newUser.activity?.state !== "idle" ||
    newUser.readiness?.checks[0]?.id !== "configuration"
  ) {
    throw new Error(
      "The Test Lab overview did not retain safe activity and missing-configuration guidance.",
    );
  }
  if (
    !newUser.discovery ||
    newUser.discovery.profile.configuration.state !== "missing"
  ) {
    throw new Error(
      "The clean-room project did not retain its safe missing-configuration profile.",
    );
  }

  return {
    status: "passed",
    artifact: {
      sha256: manifest.artifact.sha256,
      version: manifest.artifact.version,
    },
    scope: "prepared-fixture-editor-adapter-only",
    payloadTrust: manifest.payloadTrust,
    installedVersion: ready.version,
    readyProject: {
      configPath: ready.configPath,
      packageLocation: ready.packageLocation,
      targetCount: ready.candidates.targets.length,
      baselineRows: ready.baseline.rowCount,
      retainedBaselines: ready.baseline.generations.length,
      candidateCount: ready.candidates.count,
      applicationUrl: ready.applicationUrl,
      activityState: ready.activity.state,
      runtimeState: ready.runtime.state,
      runtimeTarget: ready.runtime.targets[0]?.runtimeTarget,
      verifiedRuntimeAvailable:
        ready.runtime.targets[0]?.verifiedRuntimeAvailable,
      resourceEngine: ready.resources.engine.state,
      resourceTarget: ready.resources.environments[0]?.projectId,
      dockerDiskPercent: ready.resources.engine.disk?.usedPercent ?? null,
      discoverySource: ready.discovery.source,
      detected: ready.discovery.profile.detected.length,
      suggested: ready.discovery.profile.suggested.length,
      decisions: ready.discovery.profile.decisions.length,
    },
    cleanRoomProject: {
      availability: newUser.availability,
      activityState: newUser.activity.state,
      firstFailedCheck: newUser.readiness.checks[0]?.id,
      discoverySource: newUser.discovery.source,
      configurationState: newUser.discovery.profile.configuration.state,
    },
  };
}

const main = async () => {
  const [supplied, ...extra] = process.argv.slice(2);
  assert.ok(
    supplied && !extra.length,
    "Pass one reviewed private fixture manifest; this verifier never installs or prepares a runtime.",
  );
  await nativeStorageRoot();
  const approved = process.env.REHEARSAL_DEVELOPMENT_ROOT!;
  const manifest = await readLabAdapterFixture(supplied, approved);
  console.log(
    JSON.stringify(await verifyPreparedLabAdapter(manifest), null, 2),
  );
};
if (require.main === module)
  void main().catch(() => {
    console.error(
      "Prepared Editor adapter verification failed; fixture and runtime remain parent-owned.",
    );
    process.exitCode = 1;
  });
