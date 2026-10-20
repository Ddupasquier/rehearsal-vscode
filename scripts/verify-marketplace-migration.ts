/** Native identity acceptance; isolated profiles only, with no CLI/database project. */
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import {
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { promisify } from "node:util";
import { assertArchiveContents } from "./verify-private-vsix.js";

const execute = promisify(execFile);
const repository = resolve(__dirname, "..");
const code =
  "/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code";
const electron = "/Applications/Visual Studio Code.app/Contents/MacOS/Code";
const sha = (bytes: Uint8Array) =>
  createHash("sha256").update(bytes).digest("hex");

async function main() {
  const [candidateInput, candidateSha, legacyInput, legacySha, ...extra] =
    process.argv.slice(2);
  assert.ok(candidateInput && legacyInput && extra.length === 0);
  assert.match(candidateSha ?? "", /^[a-f0-9]{64}$/u);
  assert.match(legacySha ?? "", /^[a-f0-9]{64}$/u);
  const candidate = resolve(candidateInput);
  const legacy = resolve(legacyInput);
  assert.equal(sha(await readFile(candidate)), candidateSha);
  assert.equal(sha(await readFile(legacy)), legacySha);
  const evidence = await mkdtemp(
    join(repository, "test-results/marketplace-migration."),
  );
  // Keep IPC paths short and every generated profile on the development volume.
  const temporary = await mkdtemp(join(dirname(repository), ".mp-migrate-"));
  const environment: NodeJS.ProcessEnv = {};
  for (const key of ["HOME", "USER", "LOGNAME", "LANG", "LC_ALL", "TMPDIR"])
    if (process.env[key]) environment[key] = process.env[key];
  environment.PATH = `${dirname(process.execPath)}:/usr/bin:/bin:/usr/sbin:/sbin`;
  const run = (command: string, args: string[]) =>
    execute(command, args, {
      cwd: repository,
      env: environment,
      encoding: "utf8",
      timeout: 120_000,
      maxBuffer: 4 * 1024 * 1024,
    });
  const normalPressure = async () =>
    assert.equal(
      Number(
        (
          await run("/usr/sbin/sysctl", [
            "-n",
            "kern.memorystatus_vm_pressure_level",
          ])
        ).stdout.trim(),
      ),
      1,
      "Native identity verification deferred: macOS memory pressure is not normal.",
    );
  let completed = false;
  try {
    for (const [archive, name, version] of [
      [candidate, "rehearsal-db", "0.1.19"],
      [legacy, "rehearsal", "0.1.18"],
    ]) {
      const contents = await run("/usr/bin/unzip", ["-Z1", archive!]);
      assertArchiveContents(contents.stdout.split(/\r?\n/u).filter(Boolean));
      const result = await run("/usr/bin/unzip", [
        "-p",
        archive!,
        "extension/package.json",
      ]);
      const manifest = JSON.parse(result.stdout);
      assert.equal(manifest.publisher, "rehearsal-db");
      assert.equal(manifest.name, name);
      assert.equal(manifest.version, version);
      assert.equal(manifest.pricing, "Free");
    }
    await normalPressure();
    const results: unknown[] = [];
    for (const mode of ["fresh", "coexistence"] as const) {
      const root = join(temporary, mode);
      const userData = join(root, "user");
      const extensions = join(root, "extensions");
      const workspace = join(root, "empty");
      const harness = join(root, "harness");
      const resultPath = join(root, "result.json");
      const configPath = join(root, "configuration.json");
      for (const directory of [
        join(userData, "User"),
        extensions,
        workspace,
        harness,
      ])
        await mkdir(directory, { recursive: true });
      await writeFile(
        join(userData, "User/settings.json"),
        JSON.stringify({
          "security.workspace.trust.enabled": false,
          "telemetry.telemetryLevel": "off",
          "update.mode": "none",
          "extensions.autoUpdate": false,
          "extensions.autoCheckUpdates": false,
          "workbench.startupEditor": "none",
          "rehearsal.openDashboardAutomatically": false,
          "rehearsal.automaticUpdates": { extension: false, cli: false },
          "terminal.integrated.enablePersistentSessions": false,
        }),
      );
      await writeFile(
        join(harness, "package.json"),
        JSON.stringify({
          name: "marketplace-migration",
          publisher: "rehearsal-verification",
          version: "0.0.0",
          private: true,
          engines: { vscode: "^1.101.0" },
          main: "./runner.cjs",
        }),
      );
      await copyFile(
        join(repository, "scripts/native-marketplace-migration-test.cjs"),
        join(harness, "runner.cjs"),
      );
      await writeFile(
        configPath,
        JSON.stringify({ root, mode, workspace, extensions, resultPath }),
      );
      const isolated = [
        "--user-data-dir",
        userData,
        "--extensions-dir",
        extensions,
      ];
      if (mode === "coexistence")
        await run(code, [...isolated, "--install-extension", legacy]);
      await run(code, [...isolated, "--install-extension", candidate]);
      await normalPressure();
      console.log(`Native identity check: ${mode}; evidence: ${evidence}`);
      try {
        const native = await execute(
          electron,
          [
            ...isolated,
            `--extensionDevelopmentPath=${harness}`,
            `--extensionTestsPath=${join(harness, "runner.cjs")}`,
            "--skip-welcome",
            "--skip-release-notes",
            "--disable-updates",
            workspace,
          ],
          {
            cwd: repository,
            env: {
              ...environment,
              REHEARSAL_MIGRATION_VERIFY_CONFIG: configPath,
            },
            encoding: "utf8",
            timeout: 300_000,
            maxBuffer: 4 * 1024 * 1024,
          },
        );
        await writeFile(
          join(evidence, `${mode}.log`),
          native.stdout + native.stderr,
        );
      } catch (error) {
        const output = error as { stdout?: string; stderr?: string };
        await writeFile(
          join(evidence, `${mode}.log`),
          `${output.stdout ?? ""}${output.stderr ?? ""}`,
        );
        throw error;
      } finally {
        await copyFile(resultPath, join(evidence, `${mode}.json`)).catch(
          () => {},
        );
      }
      const result = JSON.parse(await readFile(resultPath, "utf8"));
      assert.equal(result.status, "passed");
      assert.equal(result.mode, mode);
      results.push(result);
    }
    await writeFile(
      join(evidence, "verification.json"),
      JSON.stringify(
        { status: "passed", candidateSha, legacySha, results },
        null,
        2,
      ),
    );
    completed = true;
    console.log(
      JSON.stringify({ status: "passed", evidence, results }, null, 2),
    );
  } catch (error) {
    await writeFile(
      join(evidence, "failure.txt"),
      error instanceof Error ? error.message : String(error),
    );
    console.error(`Preserved verification evidence: ${evidence}; ${temporary}`);
    throw error;
  } finally {
    if (completed) await rm(temporary, { recursive: true, force: true });
  }
}

if (require.main === module)
  void main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
