import assert from "node:assert/strict";
import {
  mkdtemp,
  mkdir,
  writeFile,
  rm,
  symlink,
  chmod,
  link,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { createHash } from "node:crypto";
import { describe, it, expect } from "vitest";
import {
  parseLabAdapterFixture,
  readLabAdapterFixture,
  verifyPreparedLabAdapter,
  type LabAdapterFixture,
} from "../../scripts/verification/verify-test-lab.js";
import type { inspectProject } from "../../src/workspace/project_snapshot.js";
const sha = (s: string) => createHash("sha256").update(s).digest("hex");
function manifest(root: string): LabAdapterFixture {
  return {
    parentOwnership: {
      scope: "reviewed-parent-owned-fresh-workspace",
      runId: "rtl-0123456789",
      workspaceSnapshotSha256: sha("snapshot"),
    },
    schemaVersion: 1,
    scope: "editor-adapter-fixture",
    fixtureRoot: root,
    postgresqlRoot: resolve(root, "projects/postgresql"),
    libraryRoot: resolve(root, "projects/library"),
    postgresqlConfigPath: ".rehearsal/candidate.config.mjs",
    resourceProjectId: "rtl-owned-postgresql-rehearsal",
    applicationUrl: "http://127.0.0.1:45123",
    payloadTrust: "reviewed-parent-extracted-and-byte-compared",
    artifact: {
      path: resolve(root, "candidate.tgz"),
      sha256: sha("archive"),
      version: "2.3.0",
      files: [{ path: "package.json", sha256: sha("{}"), size: 2 }],
    },
  };
}
const snapshots = (m: LabAdapterFixture) => [
  {
    availability: "ready",
    version: m.artifact.version,
    baseline: {
      rowCount: 10003,
      generations: [{ active: true }, { active: false }],
    },
    packageLocation: resolve(
      m.postgresqlRoot,
      "node_modules/@rehearsal-db/core",
    ),
    candidates: { targets: [{}], count: 0 },
    activity: { state: "idle" },
    runtime: {
      state: "running",
      targets: [
        {
          runtimeTarget: "postgresql",
          state: "running",
          verifiedRuntimeAvailable: true,
        },
      ],
    },
    applicationUrl: m.applicationUrl,
    resources: {
      schemaVersion: 1,
      engine: { state: "running" },
      environments: [
        { provider: "postgresql", projectId: m.resourceProjectId },
      ],
    },
    discovery: {
      source: "core",
      profile: {
        detected: [{ id: "database.migrationDirectories" }],
        suggested: [{ id: "application.proofCommand" }],
        decisions: [{ id: "privacy.productionData" }],
      },
    },
  },
  {
    availability: "not_ready",
    activity: { state: "idle" },
    readiness: { checks: [{ id: "configuration" }] },
    discovery: {
      source: "core",
      profile: { configuration: { state: "missing" } },
    },
  },
];
describe("prepared read-only Lab adapter fixture", () => {
  it("keeps all adapter assertions and passes reviewed identity/address/config to actual inspection seam", async () => {
    const m = manifest(resolve(tmpdir(), "editor-adapter-fixture-synthetic"));
    const queue = snapshots(m);
    const calls: unknown[] = [];
    const inspect = (async (input: unknown) => {
      calls.push(input);
      return queue.shift();
    }) as unknown as typeof inspectProject;
    const report = await verifyPreparedLabAdapter(m, inspect);
    expect(report.status).toBe("passed");
    expect(calls).toMatchObject([
      { workspaceRoot: m.postgresqlRoot, configPath: m.postgresqlConfigPath },
      { workspaceRoot: m.libraryRoot },
    ]);
  });
  it("refuses stale version, wrong row/generation/activity/resource/discovery or clean-room state", async () => {
    const m = manifest(resolve(tmpdir(), "editor-adapter-fixture-synthetic"));
    for (const change of [
      { version: "2.2.0" },
      { packageLocation: "/foreign/node_modules/@rehearsal-db/core" },
      {
        baseline: {
          rowCount: 10002,
          generations: [{ active: true }, { active: false }],
        },
      },
      { baseline: { rowCount: 10003, generations: [{ active: true }] } },
      { activity: { state: "busy" } },
      { applicationUrl: "http://127.0.0.1:5176" },
      {
        resources: {
          schemaVersion: 1,
          engine: { state: "running" },
          environments: [{ provider: "postgresql", projectId: "foreign" }],
        },
      },
      { discovery: null },
    ]) {
      const queue = snapshots(m);
      Object.assign(queue[0]!, change);
      await expect(
        verifyPreparedLabAdapter(m, (async () =>
          queue.shift()) as unknown as typeof inspectProject),
      ).rejects.toThrow();
    }
    const queue = snapshots(m);
    Object.assign(queue[1]!, { availability: "ready" });
    await expect(
      verifyPreparedLabAdapter(m, (async () =>
        queue.shift()) as unknown as typeof inspectProject),
    ).rejects.toThrow();
  });
  it("rejects borrowed roots, unsafe URLs/configs and malformed exact inventory", () => {
    const m = manifest(resolve(tmpdir(), "editor-adapter-fixture-synthetic"));
    for (const change of [
      { fixtureRoot: m.postgresqlRoot },
      { postgresqlRoot: m.libraryRoot },
      { applicationUrl: "http://localhost:45123" },
      { applicationUrl: "http://127.0.0.1:45123/?secret=x" },
      { postgresqlConfigPath: "../foreign.mjs" },
      {
        artifact: {
          ...m.artifact,
          files: [{ path: "../package.json", sha256: sha("{}"), size: 2 }],
        },
      },
      {
        artifact: {
          ...m.artifact,
          files: [...m.artifact.files, ...m.artifact.files],
        },
      },
    ])
      expect(() => parseLabAdapterFixture({ ...m, ...change })).toThrow();
  });
  it("reads only private confined manifest/archive/packages and refuses changed payload/external baseline links", async () => {
    const owned = await mkdtemp(resolve(tmpdir(), "editor-adapter-fixture-"));
    const root = resolve(
      owned,
      "candidate-acceptance/rtl-0123456789/workspace",
    );
    await mkdir(root, { recursive: true, mode: 0o700 });
    await writeFile(resolve(root, "../workspace-snapshot.json"), "snapshot", {
      mode: 0o600,
    });
    try {
      const m = manifest(root);
      for (const p of [m.postgresqlRoot, m.libraryRoot]) {
        await mkdir(resolve(p, "node_modules/@rehearsal-db/core"), {
          recursive: true,
          mode: 0o700,
        });
        await writeFile(
          resolve(p, "node_modules/@rehearsal-db/core/package.json"),
          "{}",
        );
      }
      await mkdir(resolve(m.postgresqlRoot, ".rehearsal/generations/one"), {
        recursive: true,
      });
      await symlink(
        "generations/one",
        resolve(m.postgresqlRoot, ".rehearsal/current"),
      );
      await writeFile(m.artifact.path, "archive", { mode: 0o600 });
      const path = resolve(root, "fixture.json");
      await writeFile(path, JSON.stringify(m), { mode: 0o600 });
      expect(await readLabAdapterFixture(path, tmpdir())).toEqual(m);
      const installed = resolve(
        m.libraryRoot,
        "node_modules/@rehearsal-db/core",
      );
      // Empty directories do not alter the file inventory, but must still consume the finite walk budget.
      for (let i = 0; i < 4097; i++)
        await mkdir(resolve(installed, "empty-" + i));
      await expect(readLabAdapterFixture(path, tmpdir())).rejects.toThrow();
      for (let i = 0; i < 4097; i++)
        await rm(resolve(installed, "empty-" + i), { recursive: true });
      const deep = Array.from({ length: 34 }, () => "nested").join("/");
      await mkdir(resolve(installed, deep), { recursive: true });
      await expect(readLabAdapterFixture(path, tmpdir())).rejects.toThrow();
      await rm(resolve(installed, "nested"), { recursive: true });
      const baseline = resolve(m.postgresqlRoot, ".rehearsal");
      await mkdir(resolve(baseline, deep), { recursive: true });
      await expect(readLabAdapterFixture(path, tmpdir())).rejects.toThrow();
      await rm(resolve(baseline, "nested"), { recursive: true });
      const external = resolve(owned, "outside-baseline");
      await mkdir(external);
      await writeFile(resolve(external, "regular.json"), "{}");
      await rm(baseline, { recursive: true });
      await symlink(external, baseline);
      await expect(readLabAdapterFixture(path, tmpdir())).rejects.toThrow();
      await rm(baseline);
      await mkdir(baseline);
      await symlink(external, resolve(baseline, "generations"));
      await expect(readLabAdapterFixture(path, tmpdir())).rejects.toThrow();
      await rm(resolve(baseline, "generations"));
      await mkdir(resolve(baseline, "generations/one"), { recursive: true });
      await symlink("generations/one", resolve(baseline, "current"));
      expect(await readLabAdapterFixture(path, tmpdir())).toEqual(m);

      const { chmod, link } = await import("node:fs/promises");
      await chmod(path, 0o644);
      await expect(readLabAdapterFixture(path, tmpdir())).rejects.toThrow();
      await chmod(path, 0o600);
      const alias = resolve(root, "manifest-alias.json");
      await link(path, alias);
      await expect(readLabAdapterFixture(path, tmpdir())).rejects.toThrow();
      await rm(alias);
      await writeFile(resolve(root, "../workspace-snapshot.json"), "changed", {
        mode: 0o600,
      });
      await expect(readLabAdapterFixture(path, tmpdir())).rejects.toThrow();
      await writeFile(resolve(root, "../workspace-snapshot.json"), "snapshot", {
        mode: 0o600,
      });

      await writeFile(
        resolve(m.libraryRoot, "node_modules/@rehearsal-db/core/package.json"),
        "changed",
      );
      await expect(readLabAdapterFixture(path, tmpdir())).rejects.toThrow();
      await writeFile(
        resolve(m.libraryRoot, "node_modules/@rehearsal-db/core/package.json"),
        "{}",
      );
      await symlink(tmpdir(), resolve(m.postgresqlRoot, ".rehearsal/foreign"));
      await expect(readLabAdapterFixture(path, tmpdir())).rejects.toThrow();
    } finally {
      await rm(owned, { recursive: true, force: true });
    }
  });
});
