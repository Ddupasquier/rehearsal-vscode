import {
  mkdtemp,
  mkdir,
  readFile,
  writeFile,
  symlink,
  unlink,
  realpath,
  rename,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  AdapterError,
  editorEnvironment,
  resolveWorkspaceRehearsal,
  runRehearsalJson,
  runVersion,
  ownedProcessState,
  retireOwnedProcessGroup,
  assertInspectionPlatform,
  captureEnginePackageBinding,
  runEngineShutdown,
  engineLifecycleEnvironment,
} from "../../src/runtime/process_adapter.js";
import { lifecycleResult } from "./engine_lifecycle_fixture.js";

const roots: string[] = [];

const processIsRunning = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ESRCH") return false;
    throw error;
  }
};

const bounded = async <Value>(pending: Promise<Value>): Promise<Value> => {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      pending,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(
          () => reject(new Error("Owned process cleanup exceeded its bound.")),
          2000,
        );
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
};

const waitFor = async (
  predicate: () => boolean | Promise<boolean>,
  message: string,
): Promise<void> => {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (await predicate()) return;
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 10));
  }
  throw new Error(message);
};

const workspace = async (
  script: string,
  version = "9.9.9",
  rehearsalContracts?: Record<string, number>,
) => {
  const root = await mkdtemp(join(tmpdir(), "rehearsal-vscode-"));
  roots.push(root);
  const packageRoot = join(root, "node_modules/@rehearsal-db/core");
  await mkdir(packageRoot, { recursive: true });
  await writeFile(
    join(packageRoot, "package.json"),
    `${JSON.stringify({
      name: "@rehearsal-db/core",
      version,
      bin: { rehearsal: "cli.mjs" },
      ...(rehearsalContracts ? { rehearsalContracts } : {}),
    })}\n`,
  );
  await writeFile(join(packageRoot, "cli.mjs"), script);
  return root;
};

afterEach(async () => {
  const { rm } = await import("node:fs/promises");
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true })),
  );
});

describe("workspace process adapter", () => {
  it("refuses native Windows inspection before any package or process can be used", () => {
    expect(() => assertInspectionPlatform("win32")).toThrowError(
      expect.objectContaining({
        code: "platform_unsupported",
        message: expect.stringContaining("WSL 2 Linux distribution"),
      }),
    );
    expect(() => assertInspectionPlatform("darwin")).not.toThrow();
    expect(() => assertInspectionPlatform("linux")).not.toThrow();
  });
  it("does not mistake an exited Windows launcher for verified descendant cleanup", () => {
    const kill = vi.fn(() => true as const);
    expect(
      ownedProcessState(
        { pid: 4321, exitCode: 0, signalCode: null },
        kill,
        "win32",
      ),
    ).toBe("unknown");
    expect(
      ownedProcessState(
        { pid: 4321, exitCode: null, signalCode: "SIGTERM" },
        kill,
        "win32",
      ),
    ).toBe("unknown");
    expect(
      ownedProcessState(
        { pid: 4321, exitCode: null, signalCode: null },
        kill,
        "win32",
      ),
    ).toBe("present");
    expect(kill).not.toHaveBeenCalled();
  });
  it.skipIf(process.platform === "win32")(
    "classifies exact owned-group EPERM as unknown, never as absence or permission to signal",
    () => {
      const child = { pid: 4321, exitCode: 0, signalCode: null };
      const denied = vi.fn(() => {
        throw Object.assign(new Error("PRIVATE_PROBE_CANARY"), {
          code: "EPERM",
        });
      });
      expect(ownedProcessState(child, denied)).toBe("unknown");
      expect(denied).toHaveBeenCalledWith(-4321, 0);
      expect(
        ownedProcessState(child, () => {
          throw Object.assign(new Error("absent"), { code: "ESRCH" });
        }),
      ).toBe("absent");
      expect(ownedProcessState(child, () => true)).toBe("present");
    },
  );

  it.skipIf(process.platform === "win32")(
    "accepts transient post-KILL EPERM only after a bounded read-only ESRCH proof",
    async () => {
      const child = { pid: 4321, exitCode: 0, signalCode: null };
      let clock = 0;
      let phase = "initial";
      let afterKillProbes = 0;
      const send = vi.fn((signal: "SIGTERM" | "SIGKILL") => {
        phase = signal;
      });
      await retireOwnedProcessGroup({
        probe: () =>
          ownedProcessState(child, () => {
            if (phase === "SIGKILL")
              throw Object.assign(new Error("PRIVATE_PROBE_CANARY"), {
                code: afterKillProbes++ === 0 ? "EPERM" : "ESRCH",
              });
            return true;
          }),
        send,
        now: () => clock,
        pause: async (milliseconds) => {
          clock += milliseconds;
        },
      });
      expect(send.mock.calls.map(([signal]) => signal)).toEqual([
        "SIGTERM",
        "SIGKILL",
      ]);
      expect(afterKillProbes).toBe(2);
      expect(clock).toBe(510);
    },
  );

  it("reprobes an initially unknown group read-only and succeeds only when absence becomes proven", async () => {
    let probes = 0;
    let clock = 0;
    const send = vi.fn();
    await retireOwnedProcessGroup({
      probe: () => (++probes < 3 ? "unknown" : "absent"),
      send,
      now: () => clock,
      pause: async (milliseconds) => {
        clock += milliseconds;
      },
    });
    expect(send).not.toHaveBeenCalled();
    expect(probes).toBe(3);
    expect(clock).toBe(10);
  });

  for (const unknownAt of ["initial", "SIGTERM", "SIGKILL"]) {
    it(`refuses persistent unknown ownership at ${unknownAt} without further signals or false cleanup success`, async () => {
      let phase = "initial";
      let clock = 0;
      const send = vi.fn((signal: "SIGTERM" | "SIGKILL") => {
        phase = signal;
      });
      await expect(
        retireOwnedProcessGroup({
          probe: () => (phase === unknownAt ? "unknown" : "present"),
          send,
          now: () => clock,
          pause: async (milliseconds) => {
            clock += milliseconds;
          },
        }),
      ).rejects.toMatchObject({
        code: "process_failed",
        message: expect.stringContaining("cleanup is unverified"),
      });
      expect(send.mock.calls.map(([signal]) => signal)).toEqual(
        unknownAt === "initial"
          ? []
          : unknownAt === "SIGTERM"
            ? ["SIGTERM"]
            : ["SIGTERM", "SIGKILL"],
      );
      expect(clock).toBe(unknownAt === "SIGKILL" ? 1000 : 500);
    });
  }

  it("fails closed when the package is absent", async () => {
    const root = await mkdtemp(join(tmpdir(), "rehearsal-vscode-missing-"));
    roots.push(root);
    await expect(resolveWorkspaceRehearsal(root)).rejects.toMatchObject({
      code: "package_missing",
    });
  });

  it("uses the declared workspace CLI without a shell", async () => {
    const root = await workspace(`
if (process.argv.includes("--version") && process.env.ELECTRON_RUN_AS_NODE === "1") console.log(JSON.stringify({name:"@rehearsal-db/core",version:"9.9.9"}));
else process.exit(10);
`);
    await expect(runVersion(root)).resolves.toEqual({
      name: "@rehearsal-db/core",
      version: "9.9.9",
    });
  });

  it("honors an explicit bounded version timeout and still terminates a nonresponding owned CLI", async () => {
    const root = await workspace("setInterval(() => {}, 1000);");
    await expect(runVersion(root, { timeoutMs: 50 })).rejects.toMatchObject({
      code: "timeout",
    });
    for (const timeoutMs of [0, -1, NaN, Infinity, 300001])
      await expect(runVersion(root, { timeoutMs })).rejects.toMatchObject({
        code: "invalid_cli_contract",
      });
  });

  it("rejects a missing bin and a manifest/CLI version mismatch", async () => {
    const missing = await workspace(`console.log("{}");`);
    const manifestPath = join(
      missing,
      "node_modules/@rehearsal-db/core/package.json",
    );
    await writeFile(
      manifestPath,
      `${JSON.stringify({ name: "@rehearsal-db/core", version: "9.9.9", bin: { rehearsal: "missing.mjs" } })}\n`,
    );
    await expect(resolveWorkspaceRehearsal(missing)).rejects.toMatchObject({
      code: "package_invalid",
    });

    const mismatched = await workspace(`
console.log(JSON.stringify({name:"@rehearsal-db/core",version:"8.8.8"}));
`);
    await expect(runVersion(mismatched)).rejects.toMatchObject({
      code: "invalid_cli_contract",
    });
  });

  it("refuses final and ancestor CLI symlinks outside the installed package", async () => {
    const root = await workspace(`console.log("{}");`);
    const packageRoot = join(root, "node_modules/@rehearsal-db/core");
    const external = join(root, "external");
    await mkdir(external);
    await writeFile(
      join(external, "cli.mjs"),
      `console.log("PRIVATE_CANARY");`,
    );
    await unlink(join(packageRoot, "cli.mjs"));
    await symlink(join(external, "cli.mjs"), join(packageRoot, "cli.mjs"));
    await expect(resolveWorkspaceRehearsal(root)).rejects.toMatchObject({
      code: "package_invalid",
    });
    await unlink(join(packageRoot, "cli.mjs"));
    await symlink(external, join(packageRoot, "linked"));
    await writeFile(
      join(packageRoot, "package.json"),
      JSON.stringify({
        name: "@rehearsal-db/core",
        version: "9.9.9",
        bin: { rehearsal: "linked/cli.mjs" },
      }),
    );
    await expect(resolveWorkspaceRehearsal(root)).rejects.toMatchObject({
      code: "package_invalid",
    });
  });

  it("identifies an external package link without executing it or exposing its path", async () => {
    const external = await workspace(`console.log("{}");`);
    const canary = join(external, "PRIVATE_EXECUTION_CANARY");
    const externalPackage = join(external, "node_modules/@rehearsal-db/core");
    await writeFile(
      join(externalPackage, "cli.mjs"),
      `import { writeFileSync } from "node:fs";
writeFileSync(${JSON.stringify(canary)}, "must not execute");
console.log(JSON.stringify({name:"@rehearsal-db/core",version:"9.9.9"}));`,
    );
    const consumer = await mkdtemp(
      join(tmpdir(), "rehearsal-vscode-consumer-"),
    );
    roots.push(consumer);
    await mkdir(join(consumer, "node_modules/@rehearsal-db"), {
      recursive: true,
    });
    await symlink(
      externalPackage,
      join(consumer, "node_modules/@rehearsal-db/core"),
      process.platform === "win32" ? "junction" : "dir",
    );
    const expected = {
      code: "package_link_external",
      message:
        "The workspace Rehearsal package resolves outside its repository. Install a project-local package copy before refreshing.",
    };
    await expect(resolveWorkspaceRehearsal(consumer)).rejects.toMatchObject(
      expected,
    );
    if (process.platform !== "win32")
      await expect(runVersion(consumer)).rejects.toMatchObject(expected);
    await expect(readFile(canary)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("accepts a package-root link contained by the same repository", async () => {
    const repository = await workspace(
      `console.log(JSON.stringify({name:"@rehearsal-db/core",version:"9.9.9"}));`,
    );
    await mkdir(join(repository, ".git"));
    await mkdir(join(repository, "packages"));
    const packageRoot = join(repository, "packages/core");
    const installed = join(repository, "node_modules/@rehearsal-db/core");
    await rename(installed, packageRoot);
    await symlink(
      packageRoot,
      installed,
      process.platform === "win32" ? "junction" : "dir",
    );
    const nested = join(repository, "projects/app");
    await mkdir(nested, { recursive: true });
    await expect(resolveWorkspaceRehearsal(nested)).resolves.toMatchObject({
      packageRoot: await realpath(packageRoot),
      version: "9.9.9",
    });
    if (process.platform !== "win32")
      await expect(runVersion(nested)).resolves.toMatchObject({
        version: "9.9.9",
      });
  });

  it("accepts package-internal CLI links through their verified canonical path", async () => {
    const root = await workspace(
      `console.log(JSON.stringify({name:"@rehearsal-db/core",version:"9.9.9"}));`,
    );
    const packageRoot = join(root, "node_modules/@rehearsal-db/core");
    await mkdir(join(packageRoot, "dist"));
    await writeFile(
      join(packageRoot, "dist/cli.mjs"),
      await readFile(join(packageRoot, "cli.mjs")),
    );
    await unlink(join(packageRoot, "cli.mjs"));
    await symlink("dist/cli.mjs", join(packageRoot, "cli.mjs"));
    expect((await resolveWorkspaceRehearsal(root)).binPath).toBe(
      await realpath(join(packageRoot, "dist/cli.mjs")),
    );
    await expect(runVersion(root)).resolves.toMatchObject({ version: "9.9.9" });
  });

  it("refuses oversized, non-object and external linked manifests without revealing their content", async () => {
    const root = await workspace(`console.log("{}");`);
    const packageRoot = join(root, "node_modules/@rehearsal-db/core");
    const manifestPath = join(packageRoot, "package.json");
    for (const contents of [
      " ".repeat(1024 * 1024 + 1),
      "null",
      "[]",
      '{"PRIVATE_CANARY":broken}',
    ]) {
      await writeFile(manifestPath, contents);
      await expect(resolveWorkspaceRehearsal(root)).rejects.toMatchObject({
        code: "package_invalid",
        message: "The workspace Rehearsal package manifest could not be read.",
      });
    }
    const external = join(root, "external-package.json");
    await writeFile(
      external,
      JSON.stringify({
        name: "@rehearsal-db/core",
        version: "9.9.9",
        bin: { rehearsal: "cli.mjs" },
      }),
    );
    await unlink(manifestPath);
    await symlink(external, manifestPath);
    await expect(resolveWorkspaceRehearsal(root)).rejects.toMatchObject({
      code: "package_invalid",
    });
  });

  it("supports a repository-local package hoisted above a nested workspace", async () => {
    const repository = await workspace(`
if (process.argv.includes("--version")) console.log(JSON.stringify({name:"@rehearsal-db/core",version:"9.9.9"}));
`);
    await mkdir(join(repository, ".git"));
    const nested = join(repository, "projects", "postgresql");
    await mkdir(nested, { recursive: true });
    const resolved = await resolveWorkspaceRehearsal(nested);
    expect(resolved.version).toBe("9.9.9");
    await expect(runVersion(nested)).resolves.toMatchObject({
      version: "9.9.9",
    });
  });

  it("advertises only the supported project-discovery manifest contract", async () => {
    const supported = await workspace(
      `console.log(JSON.stringify({name:"@rehearsal-db/core",version:"9.9.9"}));`,
      "9.9.9",
      { projectDiscovery: 1 },
    );
    const unsupported = await workspace(
      `console.log(JSON.stringify({name:"@rehearsal-db/core",version:"9.9.9"}));`,
      "9.9.9",
      { projectDiscovery: 2 },
    );

    await expect(resolveWorkspaceRehearsal(supported)).resolves.toMatchObject({
      projectDiscoverySchema: 1,
    });
    await expect(resolveWorkspaceRehearsal(unsupported)).resolves.toMatchObject(
      {
        projectDiscoverySchema: null,
      },
    );
  });

  it.each([undefined, 1, 2])(
    "advertises static migration inspection only for explicit schema %s",
    async (schema) => {
      const root = await workspace(
        "",
        "9.9.9",
        schema === undefined ? {} : { migrationInsights: schema },
      );
      expect(
        (await resolveWorkspaceRehearsal(root)).migrationInsightsSchema,
      ).toBe(schema === 1 ? 1 : null);
    },
  );

  it("keeps larger static JSON bounded separately from the ordinary one-MiB command limit", async () => {
    const root = await workspace(
      `console.log(JSON.stringify({schemaVersion:1,rehearsalVersion:"9.9.9",command:"inspect insights",status:"success",startedAt:new Date(0).toISOString(),durationMs:1,warnings:[],data:{fixture:"x".repeat(1100000)}}));`,
    );
    const options = {
      workspaceRoot: root,
      command: ["inspect", "insights"],
      expectedCommand: "inspect insights",
    };
    await expect(runRehearsalJson(options)).rejects.toMatchObject({
      code: "output_limit",
    });
    expect(
      (
        await runRehearsalJson<{ fixture: string }>({
          ...options,
          outputLimitBytes: 8 * 1024 * 1024,
        })
      ).result.data.fixture.length,
    ).toBe(1100000);
  });

  it("accepts doctor not-ready exit 1 and preserves explicit config arguments", async () => {
    const root = await workspace(`
const config = process.argv.find((value) => value.startsWith("--config="));
console.log(JSON.stringify({schemaVersion:1,rehearsalVersion:"9.9.9",command:"doctor",status:"not_ready",startedAt:new Date(0).toISOString(),durationMs:1,warnings:[],data:{state:"NOT READY",checks:[],config}}));
process.exitCode=1;
`);
    const execution = await runRehearsalJson<{
      state: string;
      config: string;
    }>({
      workspaceRoot: root,
      command: ["doctor"],
      expectedCommand: "doctor",
      configPath: "infrastructure/rehearsal/rehearsal.config.mjs",
    });
    expect(execution.exitCode).toBe(1);
    expect(execution.result.data.config).toBe(
      "--config=infrastructure/rehearsal/rehearsal.config.mjs",
    );
  });

  it("does not pass hosted credentials into the read-only process", () => {
    const environment = editorEnvironment({
      PATH: "/usr/bin",
      HOME: "/safe/home",
      DATABASE_URL: "postgres://private.example/secret",
      SUPABASE_SERVICE_ROLE_KEY: "private",
    });
    expect(environment.PATH).toBe("/usr/bin");
    expect(environment.HOME).toBe("/safe/home");
    expect(environment.DATABASE_URL).toBeUndefined();
    expect(environment.SUPABASE_SERVICE_ROLE_KEY).toBeUndefined();
  });

  it("refuses absolute and escaping configuration paths", async () => {
    const root = await workspace(`console.log("{}");`);
    for (const configPath of ["/tmp/rehearsal.config.mjs", "../outside.mjs"]) {
      await expect(
        runRehearsalJson({
          workspaceRoot: root,
          command: ["doctor"],
          expectedCommand: "doctor",
          configPath,
        }),
      ).rejects.toMatchObject({ code: "config_outside_workspace" });
    }
  });

  it("bounds output and cancels the complete owned process", async () => {
    const noisy = await workspace(`console.log("x".repeat(4096));`);
    await expect(
      runRehearsalJson({
        workspaceRoot: noisy,
        command: ["doctor"],
        expectedCommand: "doctor",
        outputLimitBytes: 128,
      }),
    ).rejects.toMatchObject({ code: "output_limit" });

    const waiting = await workspace(`
import {spawn} from "node:child_process";
import {writeFileSync} from "node:fs";
const child = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], {stdio: "ignore"});
writeFileSync(new URL("../../../owned-child.pid", import.meta.url), String(child.pid));
setInterval(() => {}, 1000);
`);
    const controller = new AbortController();
    const pending = runRehearsalJson({
      workspaceRoot: waiting,
      command: ["doctor"],
      expectedCommand: "doctor",
      signal: controller.signal,
    });
    const childPidPath = join(waiting, "owned-child.pid");
    await waitFor(
      async () =>
        readFile(childPidPath, "utf8")
          .then(() => true)
          .catch(() => false),
      "The owned child did not start.",
    );
    const childPid = Number.parseInt(await readFile(childPidPath, "utf8"), 10);
    controller.abort();
    await expect(pending).rejects.toMatchObject({ code: "cancelled" });
    await waitFor(() => {
      try {
        process.kill(childPid, 0);
        return false;
      } catch (error) {
        return (error as NodeJS.ErrnoException).code === "ESRCH";
      }
    }, "Cancellation left the extension-owned child process running.");

    await expect(
      runRehearsalJson({
        workspaceRoot: waiting,
        command: ["doctor"],
        expectedCommand: "doctor",
        timeoutMs: 20,
      }),
    ).rejects.toMatchObject({
      code: "timeout",
      message: "The Rehearsal doctor check took longer than 1 second.",
    });
  });

  it("rejects malformed or mismatched JSON without exposing process output", async () => {
    const root = await workspace(`console.log('{"private":"canary"');`);
    try {
      await runRehearsalJson({
        workspaceRoot: root,
        command: ["doctor"],
        expectedCommand: "doctor",
      });
      throw new Error("Expected malformed JSON to fail.");
    } catch (error) {
      expect(error).toBeInstanceOf(AdapterError);
      expect(String(error)).not.toContain("canary");
    }
  });

  for (const inheritStdio of [true, false]) {
    it.skipIf(process.platform === "win32")(
      inheritStdio
        ? "cancels a TERM-resistant owned descendant after its launcher exits without stopping an unrelated sibling"
        : "retires closed-stdio owned descendants before a successful inspection settles",
      async () => {
        const root = await workspace(`
import {spawn} from "node:child_process";
import {existsSync,writeFileSync} from "node:fs";
import {fileURLToPath} from "node:url";
writeFileSync(new URL("../../../launcher.pid",import.meta.url),String(process.pid));
const path=fileURLToPath(new URL("../../../resistant-child.pid",import.meta.url));
spawn(process.execPath,["-e",${JSON.stringify('process.on("SIGTERM",()=>{});require("node:fs").writeFileSync(process.argv[1],String(process.pid));setInterval(()=>{},1000);')},path],{stdio:${inheritStdio ? '["ignore","inherit","inherit"]' : '"ignore"'}});
const ready=setInterval(()=>{
  if(!existsSync(path))return;
  clearInterval(ready);
  console.log(JSON.stringify({name:"@rehearsal-db/core",version:"9.9.9"}));
  process.exit(0);
},5);
`);
        const sibling = spawn(
          process.execPath,
          ["-e", "setInterval(()=>{},1000);"],
          { detached: true, stdio: "ignore", env: {} },
        );
        const siblingExit = new Promise<void>((resolvePromise) =>
          sibling.once("exit", () => resolvePromise()),
        );
        const controller = new AbortController();
        let launcherPid: number | undefined;
        let childPid: number | undefined;
        const observed = runVersion(root, {
          timeoutMs: 3000,
          signal: controller.signal,
        }).then(
          (result) => ({ result, error: undefined }),
          (error: unknown) => ({ result: undefined, error }),
        );
        try {
          await waitFor(async () => {
            try {
              launcherPid = Number(
                await readFile(join(root, "launcher.pid"), "utf8"),
              );
              childPid = Number(
                await readFile(join(root, "resistant-child.pid"), "utf8"),
              );
              return (
                Number.isSafeInteger(launcherPid) &&
                launcherPid > 1 &&
                Number.isSafeInteger(childPid) &&
                childPid > 1
              );
            } catch {
              return false;
            }
          }, "The owned launcher and descendant did not become ready.");
          await waitFor(
            () => !processIsRunning(launcherPid!),
            "The fixture launcher did not exit independently of its child.",
          );
          if (inheritStdio) controller.abort();
          const outcome = await bounded(observed);
          if (inheritStdio)
            expect(outcome.error).toMatchObject({ code: "cancelled" });
          else {
            expect(outcome.error).toBeUndefined();
            expect(outcome.result).toMatchObject({ version: "9.9.9" });
          }
          expect(processIsRunning(childPid!)).toBe(false);
          expect(sibling.pid).toBeDefined();
          expect(processIsRunning(sibling.pid!)).toBe(true);
        } finally {
          controller.abort();
          // Fixture-owned identities only: never inspect or signal unrelated groups.
          if (launcherPid !== undefined && launcherPid > 1) {
            try {
              process.kill(-launcherPid, "SIGKILL");
            } catch (error) {
              if ((error as NodeJS.ErrnoException).code !== "ESRCH")
                throw error;
            }
          }
          sibling.kill("SIGKILL");
          await bounded(siblingExit);
          await bounded(observed);
        }
      },
    );
  }
});

describe.skipIf(process.platform === "win32")(
  "approved VM JSON transport",
  () => {
    const script = (data: unknown, status: string, exitCode: number) =>
      `import assert from 'node:assert/strict';assert.deepEqual(process.argv.slice(2),['engine','stop','--json','--confirm-engine-stop=${"b".repeat(64)}']);console.log(${JSON.stringify(JSON.stringify({ schemaVersion: 1, rehearsalVersion: "1.4.0-dev.1", command: "engine stop", status, data }))});process.exitCode=${exitCode};`;
    it("parses the exact confirmed public result without a terminal", async () => {
      const root = await workspace(
        script(lifecycleResult(), "success", 0),
        "1.4.0-dev.1",
        { containerEngineLifecycle: 1 },
      );
      const packageBinding = await captureEnginePackageBinding(root),
        dispatched = vi.fn();
      const result = await runEngineShutdown({
        workspaceRoot: root,
        confirmationDigest: "b".repeat(64),
        packageBinding,
        onDispatched: dispatched,
      });
      expect(result.confirmed).toEqual({
        profileStopped: true,
        vmProcessAbsent: true,
      });
      expect(dispatched).toHaveBeenCalledOnce();
    });
    it.each([
      {
        data: {
          ...lifecycleResult(),
          status: "refused",
          reason: "review-changed",
          confirmed: { profileStopped: false, vmProcessAbsent: false },
        },
        status: "error",
        exitCode: 1,
      },
      {
        data: {
          ...lifecycleResult(),
          status: "cancelled",
          reason: "cancelled-before-dispatch",
          confirmed: { profileStopped: false, vmProcessAbsent: false },
        },
        status: "error",
        exitCode: 130,
      },
      {
        data: {
          ...lifecycleResult(),
          status: "already-stopped",
          reason: "profile-stopped",
          confirmed: { profileStopped: true, vmProcessAbsent: false },
        },
        status: "not_ready",
        exitCode: 1,
      },
    ])(
      "retains typed $status/$exitCode shutdown evidence",
      async ({ data, status, exitCode }) => {
        const root = await workspace(
          script(data, status, exitCode),
          "1.4.0-dev.1",
          { containerEngineLifecycle: 1 },
        );
        const result = await runEngineShutdown({
          workspaceRoot: root,
          confirmationDigest: "b".repeat(64),
          packageBinding: await captureEnginePackageBinding(root),
        });
        expect(result.status).toBe(data.status);
        expect(result.confirmed).toEqual(data.confirmed);
      },
    );
    it("rejects exit-zero without consistent positive proof", async () => {
      const root = await workspace(
        script(
          {
            ...lifecycleResult(),
            status: "refused",
            reason: "review-changed",
            confirmed: { profileStopped: false, vmProcessAbsent: false },
          },
          "success",
          0,
        ),
        "1.4.0-dev.1",
        { containerEngineLifecycle: 1 },
      );
      await expect(
        runEngineShutdown({
          workspaceRoot: root,
          confirmationDigest: "b".repeat(64),
          packageBinding: await captureEnginePackageBinding(root),
        }),
      ).rejects.toThrow(/contradicts/u);
    });
    it("rejects changed executable identity and pre-cancellation before child dispatch", async () => {
      const root = await workspace(
          script(lifecycleResult(), "success", 0),
          "1.4.0-dev.1",
          { containerEngineLifecycle: 1 },
        ),
        packageBinding = await captureEnginePackageBinding(root),
        dispatched = vi.fn();
      await writeFile(
        join(root, "node_modules/@rehearsal-db/core/cli.mjs"),
        "throw Error('must not execute');",
      );
      await expect(
        runEngineShutdown({
          workspaceRoot: root,
          confirmationDigest: "b".repeat(64),
          packageBinding,
          onDispatched: dispatched,
        }),
      ).rejects.toThrow(/changed/u);
      expect(dispatched).not.toHaveBeenCalled();
      const controller = new AbortController();
      controller.abort();
      await expect(
        runEngineShutdown({
          workspaceRoot: root,
          confirmationDigest: "b".repeat(64),
          packageBinding: await captureEnginePackageBinding(root),
          signal: controller.signal,
          onDispatched: dispatched,
        }),
      ).rejects.toThrow();
      expect(dispatched).not.toHaveBeenCalled();
    });
  },
);

it.skipIf(process.platform === "win32")(
  "engine JSON preserves refusal and shared-coordination selectors without forwarding credentials",
  async () => {
    const source = {
      DOCKER_CONTEXT: "colima",
      DOCKER_TLS_VERIFY: "1",
      DOCKER_CERT_PATH: "/private-certificate-location",
      COLIMA_PROFILE: "other-profile",
      LIMA_HOME: "/external/custom-lima",
      REHEARSAL_USER_STATE_DIRECTORY: "/external/shared-state",
      DATABASE_PASSWORD: "SECRET",
    };
    const env = engineLifecycleEnvironment(source);
    for (const [key, value] of Object.entries(source))
      if (key !== "DATABASE_PASSWORD") expect(env[key]).toBe(value);
    expect(env.DATABASE_PASSWORD).toBeUndefined();
    const root = await workspace(
      `console.log(JSON.stringify({schemaVersion:1,rehearsalVersion:'1.4.0-dev.1',command:'engine status',status:'success',startedAt:'2026-10-25T00:00:00Z',durationMs:1,warnings:[],data:{tls:process.env.DOCKER_TLS_VERIFY,profile:process.env.COLIMA_PROFILE,shared:process.env.REHEARSAL_USER_STATE_DIRECTORY,secretPresent:process.env.DATABASE_PASSWORD!==undefined}}));`,
      "1.4.0-dev.1",
      { containerEngineLifecycle: 1 },
    );
    const result = await runRehearsalJson({
      workspaceRoot: root,
      command: ["engine", "status"],
      expectedCommand: "engine status",
      environment: source,
    });
    expect(result.result.data).toEqual({
      tls: "1",
      profile: "other-profile",
      shared: "/external/shared-state",
      secretPresent: false,
    });
  },
);
