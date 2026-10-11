import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  AdapterError,
  editorEnvironment,
  resolveWorkspaceRehearsal,
  runRehearsalJson,
  runVersion,
} from "../src/process_adapter.js";

const roots: string[] = [];

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
});
