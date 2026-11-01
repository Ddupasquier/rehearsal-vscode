import { describe, it, expect } from "vitest";
import { runInNewContext } from "node:vm";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import {
  mkdtemp,
  mkdir,
  readFile,
  writeFile,
  symlink,
  rm,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  captureRealConsumerFiles,
  parseRealConsumerAcceptanceArguments,
} from "../../scripts/native/verify-native-real-consumer.js";
import {
  nativeControlProbe,
  assertNativeEditorNamespace,
  parseNativeEditorAcceptanceArguments,
  assertInstalledPrismaEditorManifest,
} from "../../scripts/native/verify-native-prisma-editor.js";
const args = () => [
  "--vsix=/approved/input/editor.vsix",
  `--vsix-sha=${"a".repeat(64)}`,
  "--core-tar=/approved/input/core.tgz",
  `--core-sha=${"b".repeat(64)}`,
  "--workspace=/approved/consumer",
  "--code=/approved/code/bin/code",
  "--electron=/approved/code/code",
  `--electron-sha=${"c".repeat(64)}`,
  "--code-version=1.143.0",
  "--evidence=/approved/evidence",
];
describe("failure-only native consumer diagnostics", () => {
  const api: {
    consumerDiagnostic?: (error: unknown) => unknown;
  } = {};
  const nativeRequire = createRequire(__filename);
  runInNewContext(
    readFileSync(
      join(__dirname, "../../scripts/native/native-editor-driver.cjs"),
      "utf8",
    ),
    {
      exports: api,
      require: (name: string) =>
        name === "vscode" || name.startsWith("./") ? {} : nativeRequire(name),
    },
  );
  it("distinguishes assertions, bounded observations and reads without exception payloads", () => {
    for (const [code, expected] of [
      ["ERR_ASSERTION", "ASSERTION_FAILED"],
      ["NATIVE_OBSERVATION_TIMEOUT", "OBSERVATION_TIMEOUT"],
      ["ENOENT", "INPUT_READ_FAILED"],
      ["PRIVATE_TOKEN", "UNCLASSIFIED_ERROR"],
    ]) {
      const observation = api.consumerDiagnostic!({
        code,
        message: "https://private.invalid/TOKEN",
        actual: "PRIVATE_SOURCE",
        expected: "PRIVATE_PATH",
        stack:
          "Error PRIVATE\n at /private/root/native-real-consumer-test.cjs:194:12",
      });
      expect(observation).toEqual({
        code: expected,
        location: "native-real-consumer-test.cjs:194:12",
      });
      expect(JSON.stringify(observation)).not.toMatch(/private|PRIVATE|TOKEN/);
    }
  });
  it("refuses arbitrary locations and malformed or absent error values", () => {
    for (const value of [
      null,
      undefined,
      {},
      { code: 7, stack: "https://private.invalid:123:4" },
    ])
      expect(api.consumerDiagnostic!(value)).toEqual({
        code: "UNCLASSIFIED_ERROR",
        location: "native-real-consumer-test",
      });
  });
});
describe("closed native companion scenario dispatch", () => {
  const nativeRequire = createRequire(__filename);
  const source = readFileSync(
    join(__dirname, "../../scripts/native/native-editor-driver.cjs"),
    "utf8",
  );
  it("accepts the launcher Knex configuration and dispatches only its existing native review companion", async () => {
    const root = await mkdtemp(join(tmpdir(), "knex-companion-config-"));
    try {
      const evidence = join(root, "evidence");
      await mkdir(evidence);
      const resultPath = join(evidence, "result.json"),
        configPath = join(root, "config.json");
      const config = {
        scenario: "knex-review",
        migrationKind: "knex",
        root,
        evidence,
        resultPath,
      };
      await writeFile(configPath, JSON.stringify(config), { mode: 0o600 });
      const selected: string[] = [];
      let resolveClosed!: () => void;
      const closed = new Promise<void>((resolve) => {
        resolveClosed = resolve;
      });
      const api: {
        readConfiguration?: () => Promise<unknown>;
        activate?: () => void;
      } = {};
      runInNewContext(source, {
        exports: api,
        Buffer,
        process: { env: { REHEARSAL_NATIVE_CANCELLATION_CONFIG: configPath } },
        require: (name: string) => {
          if (name === "vscode")
            return {
              workspace: { textDocuments: [] },
              commands: {
                executeCommand: async (command: string) => {
                  expect(command).toBe("workbench.action.closeWindow");
                  resolveClosed();
                },
              },
            };
          if (name === "./native-editor-recovery.cjs")
            return nativeRequire(
              join(
                __dirname,
                "../../scripts/native/native-editor-recovery.cjs",
              ),
            );
          if (name.startsWith("./")) {
            selected.push(name);
            expect(name).toBe("./native-prisma-review-test.cjs");
            return {
              run: async () => {
                await writeFile(
                  resultPath,
                  JSON.stringify({ status: "passed", scenario: "knex-review" }),
                );
              },
            };
          }
          return nativeRequire(name);
        },
      });
      expect(await api.readConfiguration!()).toEqual(config);
      api.activate!();
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        await Promise.race([
          closed,
          new Promise((_, reject) => {
            timer = setTimeout(
              () => reject(Error("Companion dispatch incomplete")),
              1000,
            );
          }),
        ]);
      } finally {
        clearTimeout(timer);
      }
      expect(selected).toEqual(["./native-prisma-review-test.cjs"]);
      expect(JSON.parse(await readFile(resultPath, "utf8"))).toMatchObject({
        status: "passed",
        scenario: "knex-review",
        driverFinalized: true,
        recoveryRequired: false,
      });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
  it("refuses unknown and path-like scenarios before selecting any companion", async () => {
    const root = await mkdtemp(join(tmpdir(), "unknown-companion-config-"));
    try {
      const configPath = join(root, "config.json");
      for (const scenario of [
        "knex-review/private-canary",
        "knex-review ",
        "KNEX-review",
        "unknown",
      ]) {
        await writeFile(
          configPath,
          JSON.stringify({
            scenario,
            migrationKind: "knex",
            root,
            evidence: root,
            resultPath: join(root, "result.json"),
          }),
          { mode: 0o600 },
        );
        const selected: string[] = [];
        const api: { readConfiguration?: () => Promise<unknown> } = {};
        runInNewContext(source, {
          exports: api,
          Buffer,
          process: {
            env: { REHEARSAL_NATIVE_CANCELLATION_CONFIG: configPath },
          },
          require: (name: string) => {
            if (name === "vscode") return {};
            if (name === "./native-editor-recovery.cjs")
              return nativeRequire(
                join(
                  __dirname,
                  "../../scripts/native/native-editor-recovery.cjs",
                ),
              );
            if (name.startsWith("./")) {
              selected.push(name);
              throw Error("Unexpected companion selection");
            }
            return nativeRequire(name);
          },
        });
        await expect(api.readConfiguration!()).rejects.toThrow(
          "Unknown native editor scenario.",
        );
        expect(selected).toEqual([]);
      }
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
describe("source activation and document observation aggregate budget", () => {
  const fixture = () => {
    let clock = 0;
    const api: {
      observeSourceOpening?: (
        activation: () => Promise<boolean>,
        document: () => boolean,
        phase: (value: string) => void,
      ) => Promise<void>;
    } = {};
    const nativeRequire = createRequire(__filename);
    runInNewContext(
      readFileSync(
        join(__dirname, "../../scripts/native/native-real-consumer-test.cjs"),
        "utf8",
      ),
      {
        exports: api,
        Date: { now: () => clock },
        require: (name: string) =>
          name === "node:timers/promises"
            ? {
                setTimeout: async (ms: number) => {
                  clock += ms;
                },
              }
            : name === "vscode" || name.startsWith("./")
              ? {}
              : nativeRequire(name),
      },
    );
    return { observe: api.observeSourceOpening!, now: () => clock };
  };
  it("distinguishes missing activation from dispatched activation without renewing the sixty-second budget", async () => {
    const missing = fixture(),
      missingPhases: string[] = [];
    await expect(
      missing.observe(
        async () => false,
        () => true,
        (p) => missingPhases.push(p),
      ),
    ).rejects.toMatchObject({ code: "NATIVE_OBSERVATION_TIMEOUT" });
    expect(missingPhases).toEqual(["source-activation-dispatch"]);
    expect(missing.now()).toBe(60000);
    const late = fixture(),
      phases: string[] = [];
    await expect(
      late.observe(
        async () => late.now() >= 40000,
        () => late.now() >= 65000,
        (p) => phases.push(p),
      ),
    ).rejects.toMatchObject({ code: "NATIVE_OBSERVATION_TIMEOUT" });
    expect(phases).toEqual([
      "source-activation-dispatch",
      "source-document-observation",
    ]);
    expect(late.now()).toBe(60000);
  });
  it("accepts actual document observation after dispatch within the shared budget", async () => {
    const f = fixture();
    await expect(
      f.observe(
        async () => f.now() >= 100,
        () => f.now() >= 200,
        () => {},
      ),
    ).resolves.toBeUndefined();
    expect(f.now()).toBe(200);
  });
});
describe("closed real-consumer native protocol", () => {
  it("keeps native tool selectors limited to migration review", () => {
    for (const kind of ["drizzle", "knex"]) {
      expect(
        parseNativeEditorAcceptanceArguments([
          ...args(),
          `--migration-kind=${kind}`,
        ]).get("migration-kind"),
      ).toBe(kind);
      expect(() =>
        parseRealConsumerAcceptanceArguments([
          ...args(),
          `--migration-kind=${kind}`,
        ]),
      ).toThrow();
    }
    expect(
      parseNativeEditorAcceptanceArguments(args()).has("migration-kind"),
    ).toBe(false);
    for (const values of [
      [...args(), "--migration-kind=alembic"],
      [...args(), "--migration-kind=drizzle", "--migration-kind=prisma"],
    ])
      expect(() => parseNativeEditorAcceptanceArguments(values)).toThrow();
  });

  it("reuses the exact default Prisma argument protocol without arbitrary scenario/script inputs", () => {
    expect([...parseRealConsumerAcceptanceArguments(args())]).toEqual([
      ...parseNativeEditorAcceptanceArguments(args()),
    ]);
    expect(() =>
      parseNativeEditorAcceptanceArguments(
        args(),
        "arbitrary" as "prisma-review",
      ),
    ).toThrow();
  });
  it.each(
    [
      [],
      [...args(), "--scenario=other"],
      [...args(), "--companion=/elsewhere/script.cjs"],
      [...args(), args()[0]!],
      args().filter((a) => !a.startsWith("--core-sha=")),
      args().map((a) =>
        a.startsWith("--vsix-sha=") ? "--vsix-sha=unknown" : a,
      ),
      args().map((a) =>
        a.startsWith("--workspace=") ? "--workspace=relative" : a,
      ),
    ].map((values) => ({ values })),
  )("refuses missing/unknown/duplicate/unsafe arguments %#", ({ values }) =>
    expect(() => parseRealConsumerAcceptanceArguments(values)).toThrow(),
  );
  it("confines evidence and workspace to separate owned namespaces", () => {
    expect(() =>
      assertNativeEditorNamespace(
        "/approved",
        "/approved/consumer",
        "/approved/evidence",
      ),
    ).not.toThrow();
    for (const [workspace, evidence] of [
      ["/elsewhere/consumer", "/approved/evidence"],
      ["/approved", "/approved/evidence"],
      ["/approved/consumer", "/approved/consumer/evidence"],
      ["/approved/consumer", "/approved"],
      ["/approved/notes/consumer", "/approved/evidence"],
      ["/approved/consumer", "/approved/x/../evidence"],
    ])
      expect(() =>
        assertNativeEditorNamespace("/approved", workspace!, evidence!),
      ).toThrow();
  });
  it("permits only installer __metadata while preserving every product manifest field", () => {
    const manifest = {
        name: "rehearsal-db",
        publisher: "rehearsal-db",
        version: "0.1.26",
        main: "./dist/src/extension.js",
      },
      bytes = (value: unknown) => Buffer.from(JSON.stringify(value));
    expect(() =>
      assertInstalledPrismaEditorManifest(
        bytes(manifest),
        bytes({ ...manifest, __metadata: { installedTimestamp: 1 } }),
      ),
    ).not.toThrow();
    for (const patch of [
      { version: "0.1.25" },
      { main: "elsewhere.js" },
      { unreviewed: true },
    ])
      expect(() =>
        assertInstalledPrismaEditorManifest(
          bytes(manifest),
          bytes({ ...manifest, ...patch, __metadata: {} }),
        ),
      ).toThrow();
  });
});
describe("real-consumer selected-input preservation", () => {
  const fixture = async (
    run: (root: string, workspace: string) => Promise<void>,
  ) => {
    const root = await mkdtemp(join(tmpdir(), "consumer-native-input-")),
      workspace = join(root, "consumer");
    try {
      await mkdir(workspace);
      await writeFile(
        join(workspace, "package.json"),
        JSON.stringify({ private: true }),
      );
      await writeFile(
        join(workspace, "rehearsal.config.mjs"),
        "export default {};\n",
      );
      await run(root, workspace);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  };
  it("fully hashes selected files including synthetic credentials without retaining contents or paths", async () =>
    fixture(async (root, workspace) => {
      await writeFile(
        join(workspace, ".env.rehearsal-auth.local"),
        "SYNTHETIC_SECRET=never-report\n",
      );
      const before = await captureRealConsumerFiles(workspace, root);
      expect(await captureRealConsumerFiles(workspace, root)).toEqual(before);
      expect(Object.keys(before).sort()).toEqual([
        "bytes",
        "files",
        "schemaVersion",
        "sha256",
      ]);
      expect(JSON.stringify(before)).not.toContain("SYNTHETIC");
      expect(JSON.stringify(before)).not.toContain(workspace);
      await writeFile(
        join(workspace, ".env.rehearsal-auth.local"),
        "SYNTHETIC_SECRET=changed\n",
      );
      expect(await captureRealConsumerFiles(workspace, root)).not.toEqual(
        before,
      );
    }));
  it("binds config and baseline raw files and identity across observations", async () =>
    fixture(async (root, workspace) => {
      const base = join(workspace, ".rehearsal-native");
      await mkdir(base);
      await writeFile(join(base, "baseline.ndjson"), "{}\n");
      const before = await captureRealConsumerFiles(workspace, root);
      await writeFile(join(base, "baseline.ndjson"), "{}\n{}\n");
      expect(await captureRealConsumerFiles(workspace, root)).not.toEqual(
        before,
      );
    }));
  it("excludes personal-note namespaces from selected input capture", async () =>
    fixture(async (root, workspace) => {
      await mkdir(join(workspace, "notes"));
      await writeFile(
        join(workspace, "notes/private.txt"),
        "SYNTHETIC_PRIVATE_NOTE",
      );
      const before = await captureRealConsumerFiles(workspace, root);
      await writeFile(
        join(workspace, "notes/private.txt"),
        "SYNTHETIC_CHANGED_NOTE",
      );
      expect(await captureRealConsumerFiles(workspace, root)).toEqual(before);
    }));
  it("accepts exact baseline pointer links confined inside the owned workspace", async () =>
    fixture(async (root, workspace) => {
      const base = join(workspace, ".rehearsal-native");
      await mkdir(base);
      await mkdir(join(base, "generation"));
      await writeFile(join(base, "generation/manifest.json"), "{}");
      await symlink("generation", join(base, "current"));
      expect((await captureRealConsumerFiles(workspace, root)).files).toBe(4);
    }));
  it("refuses external input links even elsewhere under approved storage", async () =>
    fixture(async (root, workspace) => {
      const external = join(root, "outside.env");
      await writeFile(external, "SYNTHETIC_OTHER_OWNER");
      await symlink(external, join(workspace, ".env.rehearsal-auth.local"));
      await expect(captureRealConsumerFiles(workspace, root)).rejects.toThrow();
    }));
});

describe("native disclosure control discovery", () => {
  it("discovers a collapsed DETAILS finding before keyboard opening while preserving the default visible-only probe", () => {
    const node = {
      parentElement: { tagName: "DETAILS", open: false, parentElement: null },
      getBoundingClientRect: () => ({ width: 0, height: 0 }),
      closest: () => null,
    };
    const document = {
      title: "Example · Rehearsal",
      readyState: "complete",
      querySelector: () => node,
    };
    expect(
      runInNewContext(nativeControlProbe("button", "Example"), { document }),
    ).toBe(false);
    expect(
      runInNewContext(nativeControlProbe("button", "Example", true), {
        document,
      }),
    ).toBe(true);
    node.parentElement.open = true;
    expect(
      runInNewContext(nativeControlProbe("button", "Example", true), {
        document,
      }),
    ).toBe(false);
    node.getBoundingClientRect = () => ({ width: 80, height: 24 });
    expect(
      runInNewContext(nativeControlProbe("button", "Example"), { document }),
    ).toBe(true);
  });
  it("refuses hidden pages, missing controls, wrong workspaces and incomplete documents", () => {
    const node = {
      parentElement: { tagName: "DETAILS", open: false, parentElement: null },
      getBoundingClientRect: () => ({ width: 0, height: 0 }),
      closest: (): unknown => ({ hidden: true }),
    };
    const document = {
      title: "Example · Rehearsal",
      readyState: "complete",
      querySelector: (): unknown => node,
    };
    const check = () =>
      runInNewContext(nativeControlProbe("button", "Example", true), {
        document,
      });
    expect(check()).toBe(false);
    node.closest = () => null;
    expect(check()).toBe(true);
    document.querySelector = () => null;
    expect(check()).toBe(false);
    document.querySelector = () => node;
    document.title = "Other · Rehearsal";
    expect(check()).toBe(false);
    document.title = "Example · Rehearsal";
    document.readyState = "loading";
    expect(check()).toBe(false);
  });
});
