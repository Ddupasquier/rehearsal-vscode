import {
  mkdtemp,
  mkdir,
  readFile,
  writeFile,
  symlink,
  unlink,
  realpath,
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
} from "../src/process_adapter.js";

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
