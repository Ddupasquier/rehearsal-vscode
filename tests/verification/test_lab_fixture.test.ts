import { createHash } from "node:crypto";
import {
  mkdtemp,
  mkdir,
  writeFile,
  readFile,
  readdir,
  rm,
  realpath,
  rename,
  symlink,
  chmod,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { relative, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { execFile } from "node:child_process";
import {
  selectLabVerificationMode,
  verifyLabInput,
} from "../../scripts/verification/verify-test-lab.js";
import {
  captureLabAdapterInputs,
  parseLabAdapterFixture,
  readLabAdapterFixture,
  type LabAdapterFixture,
} from "../../scripts/verification/lab-adapter-fixture.js";
import type { inspectProject } from "../../src/workspace/inspection/project_snapshot.js";

vi.mock("node:child_process", async (actual) => ({
  ...(await actual<typeof import("node:child_process")>()),
  execFile: vi.fn((_command: unknown, ...args: unknown[]) => {
    const callback = args.at(-1);
    if (typeof callback === "function")
      callback(
        Error("Process execution is forbidden in prepared fixture tests."),
      );
    else
      throw Error("Process execution is forbidden in prepared fixture tests.");
  }),
}));
const sha = (bytes: string) => createHash("sha256").update(bytes).digest("hex");
const snapshots = (m: LabAdapterFixture) => [
  {
    availability: "ready",
    version: m.artifact.version,
    configPath: m.postgresqlConfigPath,
    baseline: {
      rowCount: 10003,
      generations: [{ active: true }, { active: false }],
    },
    packageLocation: relative(
      m.postgresqlRoot,
      resolve(m.postgresqlRoot, "node_modules/@rehearsal-db/core"),
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

describe.skipIf(process.platform === "win32")(
  "prepared Lab adapter POSIX ownership and mode contract",
  () => {
    let owned: string;
    let manifest: LabAdapterFixture;
    let path: string;
    beforeEach(async () => {
      vi.clearAllMocks();
      owned = await realpath(
        await mkdtemp(resolve(tmpdir(), "editor-prepared-")),
      );
      for (const key of [
        "REHEARSAL_DEVELOPMENT_ROOT",
        "TMPDIR",
        "TMP",
        "TEMP",
        "NODE_COMPILE_CACHE",
        "NPM_CONFIG_CACHE",
        "npm_config_cache",
        "NPM_CONFIG_LOGS_DIR",
        "npm_config_logs_dir",
      ])
        vi.stubEnv(key, owned);
      vi.stubEnv("REHEARSAL_EDITOR_TEST_ROOT", resolve(owned, "profiles"));
      vi.stubEnv("REHEARSAL_TEST_LAB_ROOT", undefined);
      const report = resolve(owned, "candidate-acceptance/rtl-0123456789");
      const root = resolve(report, "workspace");
      await mkdir(root, { recursive: true, mode: 0o700 });
      const payload = JSON.stringify({
        name: "@rehearsal-db/core",
        version: "2.3.0",
      });
      manifest = {
        schemaVersion: 1,
        scope: "editor-adapter-fixture",
        parentOwnership: {
          scope: "reviewed-parent-owned-fresh-workspace",
          runId: "rtl-0123456789",
          workspaceSnapshotSha256: sha("snapshot"),
        },
        fixtureRoot: root,
        postgresqlRoot: resolve(root, "projects/postgresql"),
        libraryRoot: resolve(root, "projects/library"),
        postgresqlConfigPath: ".rehearsal/candidate.config.mjs",
        resourceProjectId: "rtl-0123456789-postgresql-rehearsal",
        applicationUrl: "http://127.0.0.1:45123",
        payloadTrust: "reviewed-parent-extracted-and-byte-compared",
        artifact: {
          path: resolve(report, "candidate.tgz"),
          sha256: sha("archive"),
          version: "2.3.0",
          files: [
            {
              path: "package.json",
              sha256: sha(payload),
              size: Buffer.byteLength(payload),
            },
          ],
        },
      };
      for (const project of [manifest.postgresqlRoot, manifest.libraryRoot]) {
        await mkdir(resolve(project, "node_modules/@rehearsal-db/core"), {
          recursive: true,
        });
        await writeFile(
          resolve(project, "node_modules/@rehearsal-db/core/package.json"),
          payload,
        );
        await writeFile(
          resolve(project, "package.json"),
          JSON.stringify({
            name: "ordinary-library",
            scripts: { "test:rehearsal": "node proof.mjs" },
          }),
        );
      }
      for (const generation of ["one", "two"]) {
        await mkdir(
          resolve(
            manifest.postgresqlRoot,
            ".rehearsal/generations",
            generation,
          ),
          { recursive: true },
        );
        await writeFile(
          resolve(
            manifest.postgresqlRoot,
            ".rehearsal/generations",
            generation,
            "baseline-manifest.json",
          ),
          "{}",
        );
      }
      await mkdir(resolve(manifest.postgresqlRoot, ".rehearsal/secrets"));
      await mkdir(
        resolve(manifest.postgresqlRoot, "infrastructure/rehearsal"),
        { recursive: true },
      );
      await symlink(
        "generations/two",
        resolve(manifest.postgresqlRoot, ".rehearsal/current"),
      );
      for (const file of [
        "rehearsal.config.mjs",
        manifest.postgresqlConfigPath,
        ".rehearsal/secrets/privacy.key",
        "infrastructure/rehearsal/source-policy.json",
      ])
        await writeFile(
          resolve(manifest.postgresqlRoot, file),
          "synthetic owned input",
          { mode: 0o600 },
        );
      await writeFile(resolve(report, "workspace-snapshot.json"), "snapshot", {
        mode: 0o600,
      });
      await writeFile(manifest.artifact.path, "archive", { mode: 0o600 });
      path = resolve(root, "editor-adapter-fixture.json");
      await writeFile(path, JSON.stringify(manifest), { mode: 0o600 });
    });
    afterEach(async () => {
      vi.unstubAllEnvs();
      await rm(owned, { recursive: true, force: true });
    });

    it("consumes the actual producer argv/manifest without a canonical Lab selector, copying, installing or allocating temporary fixtures", async () => {
      const queue = snapshots(manifest),
        calls: unknown[] = [];
      const before = await captureLabAdapterInputs(path, owned);
      const result = await verifyLabInput([path], (async (input: unknown) => {
        calls.push(input);
        return queue.shift();
      }) as unknown as typeof inspectProject);
      expect(result).toMatchObject({
        status: "passed",
        scope: "prepared-fixture-editor-adapter-only",
        artifact: {
          sha256: manifest.artifact.sha256,
          version: manifest.artifact.version,
        },
        payloadTrust: manifest.payloadTrust,
        readyProject: {
          resourceTarget: manifest.resourceProjectId,
          applicationUrl: manifest.applicationUrl,
          baselineRows: 10003,
        },
      });
      expect(calls).toMatchObject([
        {
          workspaceRoot: manifest.postgresqlRoot,
          configPath: manifest.postgresqlConfigPath,
        },
        { workspaceRoot: manifest.libraryRoot },
      ]);
      expect(process.env.REHEARSAL_TEST_LAB_ROOT).toBeUndefined();
      expect(execFile).not.toHaveBeenCalled();
      expect(await readdir(owned)).toEqual(["candidate-acceptance"]);
      expect((await captureLabAdapterInputs(path, owned)).fingerprint).toBe(
        before.fingerprint,
      );
    });
    it("preserves legacy archive selection and requires its existing independent Lab owner selector", async () => {
      expect(selectLabVerificationMode([manifest.artifact.path])).toEqual({
        mode: "archive",
        path: manifest.artifact.path,
      });
      await expect(verifyLabInput([manifest.artifact.path])).rejects.toThrow(
        "REHEARSAL_TEST_LAB_ROOT",
      );
      expect(execFile).not.toHaveBeenCalled();
      for (const args of [
        [],
        [path, "extra"],
        ["relative.json"],
        ["unknown.zip"],
      ])
        expect(() => selectLabVerificationMode(args)).toThrow();
    });
    it("keeps legacy copy/install mode functional using only authored fixtures and denied real processes", async () => {
      vi.stubEnv("REHEARSAL_TEST_LAB_ROOT", manifest.fixtureRoot);
      const installed = ((
        _command: unknown,
        _args: unknown,
        _options: unknown,
        callback: (error: null) => void,
      ) => callback(null)) as unknown as typeof execFile;
      vi.mocked(execFile)
        .mockImplementationOnce(installed)
        .mockImplementationOnce(installed);
      const queue = snapshots(manifest),
        calls: { workspaceRoot: string; configPath?: string }[] = [];
      Object.assign(queue[0]!, {
        applicationUrl: "http://127.0.0.1:5176",
        resources: {
          schemaVersion: 1,
          engine: { state: "running" },
          environments: [
            {
              provider: "postgresql",
              projectId: "rehearsal-test-lab-postgresql-rehearsal",
            },
          ],
        },
      });
      const before = await captureLabAdapterInputs(path, owned);
      const result = await verifyLabInput(
        [manifest.artifact.path],
        (async (input: { workspaceRoot: string; configPath?: string }) => {
          calls.push(input);
          return queue.shift();
        }) as unknown as typeof inspectProject,
      );
      expect(result).toMatchObject({
        status: "passed",
        artifact: "candidate.tgz",
      });
      expect(result.scope).toBeUndefined();
      expect(execFile).toHaveBeenCalledTimes(2);
      for (const call of vi.mocked(execFile).mock.calls)
        expect(call.slice(0, 2)).toEqual([
          "npm",
          [
            "install",
            "--ignore-scripts",
            "--no-save",
            "--no-audit",
            "--no-fund",
            manifest.artifact.path,
          ],
        ]);
      expect(
        calls.every(
          (input) =>
            input.workspaceRoot.startsWith(
              resolve(owned, "rehearsal-vscode-lab-"),
            ) && input.configPath === undefined,
        ),
      ).toBe(true);
      expect(await readdir(owned)).toEqual(["candidate-acceptance"]);
      expect((await captureLabAdapterInputs(path, owned)).fingerprint).toBe(
        before.fingerprint,
      );
    });
    it("refuses malformed ownership, borrowed paths, arbitrary config, resource identity and payload inventory", () => {
      for (const change of [
        { fixtureRoot: manifest.postgresqlRoot },
        { libraryRoot: manifest.postgresqlRoot },
        { resourceProjectId: "foreign" },
        { postgresqlConfigPath: "../borrowed.mjs" },
        { applicationUrl: "http://localhost:45123" },
        {
          artifact: {
            ...manifest.artifact,
            path: resolve(manifest.fixtureRoot, "candidate.tgz"),
          },
        },
        {
          artifact: {
            ...manifest.artifact,
            files: [...manifest.artifact.files, ...manifest.artifact.files],
          },
        },
        {
          artifact: {
            ...manifest.artifact,
            files: [
              { path: "node_modules/foreign.js", sha256: sha("x"), size: 1 },
            ],
          },
        },
      ])
        expect(() =>
          parseLabAdapterFixture({ ...manifest, ...change }),
        ).toThrow();
    });
    it("accepts real nested npm dependencies separately but rejects changed published payload and escaped baseline links", async () => {
      const packageRoot = resolve(
        manifest.libraryRoot,
        "node_modules/@rehearsal-db/core",
      );
      await mkdir(resolve(packageRoot, "node_modules/pg"), { recursive: true });
      await writeFile(
        resolve(packageRoot, "node_modules/pg/package.json"),
        "{}",
      );
      expect(await readLabAdapterFixture(path, owned)).toEqual(manifest);
      await writeFile(resolve(packageRoot, "extra.js"), "unknown");
      await expect(readLabAdapterFixture(path, owned)).rejects.toThrow();
      await rm(resolve(packageRoot, "extra.js"));
      await symlink(
        owned,
        resolve(manifest.postgresqlRoot, ".rehearsal/foreign"),
      );
      await expect(readLabAdapterFixture(path, owned)).rejects.toThrow();
    });
    it("refuses a public/replaced manifest and unexpected Library state before any inspection", async () => {
      await chmod(path, 0o644);
      await expect(readLabAdapterFixture(path, owned)).rejects.toThrow();
      await chmod(path, 0o600);
      const original = path + ".original";
      await rename(path, original);
      await symlink(original, path);
      await expect(readLabAdapterFixture(path, owned)).rejects.toThrow();
      await rm(path);
      await rename(original, path);
      await writeFile(
        resolve(manifest.libraryRoot, "rehearsal.config.mjs"),
        "foreign",
      );
      await expect(readLabAdapterFixture(path, owned)).rejects.toThrow();
      expect(execFile).not.toHaveBeenCalled();
    });
    it("retains the original inspection failure when input preservation also fails", async () => {
      const primary = Error("Synthetic inspection failure");
      const failure = await verifyLabInput([path], (async () => {
        await writeFile(
          resolve(manifest.postgresqlRoot, ".rehearsal/secrets/privacy.key"),
          "changed owned key",
        );
        throw primary;
      }) as typeof inspectProject).catch((error) => error);
      expect(failure).toBeInstanceOf(AggregateError);
      expect(failure.errors[0]).toBe(primary);
      expect(execFile).not.toHaveBeenCalled();
    });
    it.each([
      "config",
      "baseline",
      "key",
      "manifest",
      "archive",
      "snapshot",
      "library-lock",
    ])(
      "refuses %s drift during actual readonly inspection and preserves the changed parent input",
      async (kind) => {
        const file =
          kind === "config"
            ? resolve(manifest.postgresqlRoot, manifest.postgresqlConfigPath)
            : kind === "baseline"
              ? resolve(
                  manifest.postgresqlRoot,
                  ".rehearsal/generations/two/baseline-manifest.json",
                )
              : kind === "key"
                ? resolve(
                    manifest.postgresqlRoot,
                    ".rehearsal/secrets/privacy.key",
                  )
                : kind === "manifest"
                  ? path
                  : kind === "archive"
                    ? manifest.artifact.path
                    : kind === "snapshot"
                      ? resolve(
                          manifest.fixtureRoot,
                          "../workspace-snapshot.json",
                        )
                      : resolve(manifest.libraryRoot, "package-lock.json");
        const queue = snapshots(manifest);
        await expect(
          verifyLabInput([path], (async () => {
            if (queue.length === 2)
              await writeFile(file, "changed owned input");
            return queue.shift();
          }) as unknown as typeof inspectProject),
        ).rejects.toThrow();
        expect(await readFile(file, "utf8")).toBe("changed owned input");
        expect(execFile).not.toHaveBeenCalled();
      },
    );
  },
);
