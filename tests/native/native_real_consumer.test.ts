import { describe, it, expect } from "vitest";
import { runInNewContext } from "node:vm";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { mkdtemp, mkdir, writeFile, symlink, rm } from "node:fs/promises";
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
describe("actual real-consumer public-read observer", () => {
  type ReadOptions = {
    workspaceRoot: string;
    command: readonly string[];
    expectedCommand: string;
    configPath?: string;
    timeoutMs?: number;
    signal?: AbortSignal;
  };
  type Adapter = {
    runRehearsalJson: (options: ReadOptions) => Promise<unknown>;
    runEngineShutdown: () => Promise<unknown>;
  };
  const fixture = async (
    exercise: (adapter: Adapter) => Promise<void>,
    upstreamFailure?: Error,
  ) => {
    const config = {
      scenario: "real-consumer",
      workspace: "/owned/consumer",
      installedExtension: "/owned/installed",
      version: "0.1.29",
      coreVersion: "2.3.0",
      resultPath: "/owned/result.json",
    };
    const forwarded: ReadOptions[] = [],
      reply = Object.freeze({ marker: "original-public-result" });
    let activated = false,
      disposed = false,
      shutdownCalls = 0,
      exerciseFailure: unknown;
    const read = async (options: ReadOptions) => {
      forwarded.push(options);
      if (upstreamFailure) throw upstreamFailure;
      return reply;
    };
    const shutdown = async () => {
      shutdownCalls++;
    };
    const inspect = async () => ({});
    const adapter: Adapter = {
        runRehearsalJson: read,
        runEngineShutdown: shutdown,
      },
      snapshots = { inspectProject: inspect };
    const api: { run?: () => Promise<void> } = {};
    const nativeRequire = createRequire(__filename);
    runInNewContext(
      readFileSync(
        join(__dirname, "../../scripts/native/native-real-consumer-test.cjs"),
        "utf8",
      ),
      {
        exports: api,
        require: (name: string) => {
          if (name === "vscode")
            return {
              workspace: {
                isTrusted: true,
                workspaceFolders: [
                  {
                    uri: {
                      scheme: "file",
                      authority: "",
                      fsPath: config.workspace,
                    },
                  },
                ],
              },
              extensions: {
                getExtension: () => ({
                  packageJSON: { version: config.version },
                  extensionPath: config.installedExtension,
                  activate: async () => {
                    activated = true;
                    try {
                      await exercise(adapter);
                    } catch (error) {
                      exerciseFailure = error;
                    }
                    // Stop after exercising the installed observer; no UI or IO phase runs.
                    throw Error("Intentional observer fixture completion.");
                  },
                }),
              },
              window: {
                onDidOpenTerminal: () => ({
                  dispose: () => {
                    disposed = true;
                  },
                }),
              },
            };
          if (name === "node:fs/promises")
            return { realpath: async (path: string) => path };
          if (name === "./native-editor-driver.cjs")
            return {
              readConfiguration: async () => config,
              consumerDiagnostic: () => ({ code: "FIXTURE_COMPLETION" }),
            };
          if (name === "./native-editor-reads.cjs")
            return {
              writeJson: async () => {},
              readRegular: () => {
                throw Error("Unexpected fixture file read.");
              },
            };
          if (
            name ===
            join(config.installedExtension, "dist/src/project_snapshot.js")
          )
            return snapshots;
          if (
            name ===
            join(config.installedExtension, "dist/src/process_adapter.js")
          )
            return adapter;
          return nativeRequire(name);
        },
      },
    );
    await expect(api.run!()).rejects.toThrow(
      "Native real-consumer acceptance failed",
    );
    expect(activated).toBe(true);
    expect(disposed).toBe(true);
    expect(adapter.runRehearsalJson).toBe(read);
    expect(adapter.runEngineShutdown).toBe(shutdown);
    expect(snapshots.inspectProject).toBe(inspect);
    if (exerciseFailure) throw exerciseFailure;
    return { forwarded, reply, shutdownCalls };
  };

  it("forwards database capabilities arguments and the exact upstream result unchanged", async () => {
    const options = Object.freeze({
      workspaceRoot: "/owned/consumer",
      command: Object.freeze(["database", "capabilities"]),
      expectedCommand: "database capabilities",
      configPath: "rehearsal.config.mjs",
      timeoutMs: 1234,
      signal: new AbortController().signal,
    });
    let returned: unknown;
    const result = await fixture(async (adapter) => {
      returned = await adapter.runRehearsalJson(options);
    });
    expect(result.forwarded).toHaveLength(1);
    expect(result.forwarded[0]).toBe(options);
    expect(result.forwarded[0]!.command).toBe(options.command);
    expect(returned).toBe(result.reply);
  });

  it("preserves an upstream read rejection without manufacturing a result", async () => {
    const failure = Error("Synthetic upstream refusal");
    const result = await fixture(async (adapter) => {
      await expect(
        adapter.runRehearsalJson({
          workspaceRoot: "/owned/consumer",
          command: ["doctor"],
          expectedCommand: "doctor",
        }),
      ).rejects.toBe(failure);
    }, failure);
    expect(result.forwarded).toHaveLength(1);
  });

  it("refuses unknown, mutating and command-mismatched requests before forwarding", async () => {
    const result = await fixture(async (adapter) => {
      for (const [expectedCommand, command] of [
        ["unknown read", ["unknown", "read"]],
        ["run", ["run"]],
        ["discard", ["discard"]],
        ["engine stop", ["engine", "stop"]],
        ["database capabilities", ["discard"]],
      ] as const)
        await expect(
          adapter.runRehearsalJson({
            workspaceRoot: "/owned/consumer",
            command,
            expectedCommand,
          }),
        ).rejects.toMatchObject({ code: "ERR_ASSERTION" });
      await expect(adapter.runEngineShutdown()).rejects.toThrow(
        "Read-only consumer verification refuses shutdown.",
      );
    });
    expect(result.forwarded).toEqual([]);
    expect(result.shutdownCalls).toBe(0);
  });
});
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
  it("retains the explicit Drizzle selector only in the existing migration-review scenario", () => {
    expect(
      parseNativeEditorAcceptanceArguments([
        ...args(),
        "--migration-kind=drizzle",
      ]).get("migration-kind"),
    ).toBe("drizzle");
    expect(
      parseNativeEditorAcceptanceArguments(args()).has("migration-kind"),
    ).toBe(false);
    for (const values of [
      [...args(), "--migration-kind=knex"],
      [...args(), "--migration-kind=drizzle", "--migration-kind=prisma"],
    ])
      expect(() => parseNativeEditorAcceptanceArguments(values)).toThrow();
    expect(() =>
      parseRealConsumerAcceptanceArguments([
        ...args(),
        "--migration-kind=drizzle",
      ]),
    ).toThrow();
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
