/** Opt-in native execution acceptance. Never uses the normal editor profile or a database. */
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import {
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { promisify } from "node:util";
import { assertArchiveContents } from "./verify-private-vsix.js";
import { storageEnvironment } from "../src/platform_runtime.js";
import {
  nativeStorageRoot,
  createNativeTemporaryDirectory,
} from "./native-development-storage.js";

const execute = promisify(execFile);
const repository = resolve(__dirname, "..");
const code =
  "/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code";
const electron = "/Applications/Visual Studio Code.app/Contents/MacOS/Code";
const previousSha256 =
  "a1b376a0aebf422292979fe7cb047cda8ffdcc2206a72e019d8427a1fc9f96b1";
const targetSha256 =
  "dec62d5474ade0c3d92d05dad9d1ee050e27e723e054336486673882f6c224d6";
const sha = (bytes: Uint8Array) =>
  createHash("sha256").update(bytes).digest("hex");

async function main() {
  const arguments_ = process.argv.slice(2);
  const prepareOnly = arguments_.at(-1) === "--prepare-only";
  if (prepareOnly) arguments_.pop();
  const [candidateArgument, candidateSha256, previousArgument, ...extra] =
    arguments_;
  assert.ok(candidateArgument && previousArgument && extra.length === 0);
  assert.match(candidateSha256 ?? "", /^[a-f0-9]{64}$/u);
  const candidate = resolve(candidateArgument);
  const previous = resolve(previousArgument);
  assert.equal(sha(await readFile(candidate)), candidateSha256);
  assert.equal(sha(await readFile(previous)), previousSha256);
  if (!prepareOnly) {
    const pressure = await execute(
      "/usr/sbin/sysctl",
      ["-n", "kern.memorystatus_vm_pressure_level"],
      {
        env: storageEnvironment(process.env),
        encoding: "utf8",
        timeout: 10_000,
        maxBuffer: 1024,
      },
    );
    assert.equal(
      Number(pressure.stdout.trim()),
      1,
      "Native verification deferred before fixture allocation: memory pressure is not normal.",
    );
  }
  await nativeStorageRoot();
  const evidence = await mkdtemp(
    join(repository, "test-results/automatic-execution-180."),
  );
  // Short, task-owned paths avoid macOS IPC socket-length limits.
  const temporary = await createNativeTemporaryDirectory("au-");
  const runtimeRoot = join(temporary, "frozen/extension");
  const projectRoot = join(temporary, "consumer");
  const emptyRoot = join(temporary, "empty");
  const userData = join(temporary, "user");
  const extensions = join(temporary, "extensions");
  const storagePath = join(temporary, "coordination");
  const harness = join(temporary, "harness");
  const resultPath = join(temporary, "native-result.json");
  const configPath = join(temporary, "verification.json");
  const workspace = join(temporary, "verification.code-workspace");
  const scriptCanaryPath = join(projectRoot, "INSTALL_SCRIPT_RAN");
  const configuration = {
    root: temporary,
    runtimeRoot,
    projectRoot,
    emptyRoot,
    resultPath,
    storagePath,
    scriptCanaryPath,
    extensionBefore: "0.1.11",
    extensionTarget: "0.1.12",
    cliBefore: "0.1.0-rc.8",
    cliTarget: "0.1.0-rc.9",
  };
  const environment: NodeJS.ProcessEnv = storageEnvironment(process.env);
  for (const key of ["HOME", "USER", "LOGNAME", "LANG", "LC_ALL", "TMPDIR"])
    if (process.env[key]) environment[key] = process.env[key];
  environment.PATH = `${dirname(process.execPath)}:/usr/bin:/bin:/usr/sbin:/sbin`;
  environment.NPM_CONFIG_USERCONFIG = join(temporary, "npm-user");
  environment.NPM_CONFIG_GLOBALCONFIG = join(temporary, "npm-global");
  environment.NPM_CONFIG_CACHE = join(temporary, "npm-cache");
  environment.NPM_CONFIG_REGISTRY = "https://registry.npmjs.org";
  environment.NPM_CONFIG_AUDIT = "false";
  environment.NPM_CONFIG_FUND = "false";
  environment.REHEARSAL_AUTO_VERIFY_CONFIG = configPath;
  const run = (command: string, args: string[], cwd = repository) =>
    execute(command, args, {
      cwd,
      env: environment,
      encoding: "utf8",
      timeout: 120_000,
      maxBuffer: 4 * 1024 * 1024,
    });
  let completed = false;
  try {
    for (const directory of [
      projectRoot,
      emptyRoot,
      join(userData, "User"),
      extensions,
      storagePath,
      harness,
      join(temporary, "shell"),
    ])
      await mkdir(directory, { recursive: true });
    await writeFile(environment.NPM_CONFIG_USERCONFIG!, "");
    await writeFile(environment.NPM_CONFIG_GLOBALCONFIG!, "");
    const archive = await run("/usr/bin/unzip", ["-Z1", candidate]);
    assertArchiveContents(archive.stdout.split(/\r?\n/u).filter(Boolean));
    await run("/usr/bin/unzip", [
      "-q",
      candidate,
      "-d",
      join(temporary, "frozen"),
    ]);
    const manifest = JSON.parse(
      await readFile(join(runtimeRoot, "package.json"), "utf8"),
    );
    assert.equal(manifest.publisher, "rehearsal-db");
    assert.equal(manifest.name, "rehearsal");
    const consumer = {
      name: "rehearsal-automatic-update-acceptance",
      version: "1.0.0",
      private: true,
      scripts: {
        postinstall:
          "node -e \"require('node:fs').writeFileSync('INSTALL_SCRIPT_RAN','unexpected')\"",
      },
      devDependencies: { "@rehearsal-db/core": configuration.cliBefore },
    };
    await writeFile(
      join(projectRoot, "package.json"),
      JSON.stringify(consumer, null, 2),
    );
    const initial = await run(
      "npm",
      ["install", "--ignore-scripts", "--no-audit", "--no-fund"],
      projectRoot,
    );
    await writeFile(join(evidence, "fixture-install.log"), initial.stdout);
    const cliManifest = JSON.parse(
      await readFile(
        join(projectRoot, "node_modules/@rehearsal-db/core/package.json"),
        "utf8",
      ),
    );
    const activity = await run(
      process.execPath,
      [
        join(
          projectRoot,
          "node_modules/@rehearsal-db/core",
          cliManifest.bin.rehearsal,
        ),
        "activity",
        "--json",
      ],
      projectRoot,
    );
    const publicActivity = JSON.parse(activity.stdout);
    assert.equal(publicActivity.data.state, "idle");
    await writeFile(
      join(evidence, "initial-activity.json"),
      JSON.stringify(publicActivity, null, 2),
    );
    await writeFile(configPath, JSON.stringify(configuration, null, 2));
    await writeFile(
      workspace,
      JSON.stringify({ folders: [{ path: emptyRoot }, { path: projectRoot }] }),
    );
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
        "terminal.integrated.shellIntegration.enabled": true,
        "terminal.integrated.profiles.osx": {
          "Isolated verification": { path: "/bin/zsh" },
        },
        "terminal.integrated.defaultProfile.osx": "Isolated verification",
        "terminal.integrated.env.osx": {
          ...storageEnvironment(environment),
          PATH: environment.PATH,
          ZDOTDIR: join(temporary, "shell"),
          NPM_CONFIG_USERCONFIG: environment.NPM_CONFIG_USERCONFIG,
          NPM_CONFIG_GLOBALCONFIG: environment.NPM_CONFIG_GLOBALCONFIG,
          NPM_CONFIG_CACHE: environment.NPM_CONFIG_CACHE,
          NPM_CONFIG_REGISTRY: environment.NPM_CONFIG_REGISTRY,
        },
      }),
    );
    await writeFile(
      join(harness, "package.json"),
      JSON.stringify({
        name: "automatic-updates",
        publisher: "rehearsal-verification",
        version: "0.0.0",
        private: true,
        engines: { vscode: "^1.101.0" },
        main: "./runner.cjs",
        activationEvents: ["onStartupFinished"],
        contributes: {
          configuration: {
            properties: {
              "rehearsal.automaticUpdates":
                manifest.contributes.configuration.properties[
                  "rehearsal.automaticUpdates"
                ],
            },
          },
        },
      }),
    );
    await copyFile(
      join(repository, "scripts/native-automatic-update-test.cjs"),
      join(harness, "runner.cjs"),
    );
    await writeFile(
      join(evidence, "configuration.json"),
      JSON.stringify({ ...configuration, candidate, candidateSha256 }, null, 2),
    );
    if (prepareOnly) {
      console.log(JSON.stringify({ status: "prepared", evidence, temporary }));
      return;
    }
    const pressure = Number(
      (
        await run("/usr/sbin/sysctl", [
          "-n",
          "kern.memorystatus_vm_pressure_level",
        ])
      ).stdout.trim(),
    );
    assert.equal(
      pressure,
      1,
      "Native verification deferred: macOS memory pressure is not normal. No extra editor was launched.",
    );
    await run(code, [
      "--user-data-dir",
      userData,
      "--extensions-dir",
      extensions,
      "--install-extension",
      previous,
    ]);
    console.log(`Native verification starting; evidence: ${evidence}`);
    const native = await execute(
      electron,
      [
        "--user-data-dir",
        userData,
        "--extensions-dir",
        extensions,
        `--extensionDevelopmentPath=${harness}`,
        `--extensionTestsPath=${join(harness, "runner.cjs")}`,
        "--skip-welcome",
        "--skip-release-notes",
        "--disable-updates",
        workspace,
      ],
      {
        env: environment,
        encoding: "utf8",
        timeout: 300_000,
        maxBuffer: 4 * 1024 * 1024,
      },
    );
    await writeFile(
      join(evidence, "native.log"),
      native.stdout + native.stderr,
    );
    const result = JSON.parse(await readFile(resultPath, "utf8"));
    assert.equal(result.status, "passed");
    const installed = await run(code, [
      "--user-data-dir",
      userData,
      "--extensions-dir",
      extensions,
      "--list-extensions",
      "--show-versions",
    ]);
    assert.ok(installed.stdout.includes("rehearsal-db.rehearsal@0.1.12"));
    // Verify every installed target runtime file against the official downloaded bytes.
    const target = join(extensions, "rehearsal-db.rehearsal-0.1.12");
    const { downloadVerifiedExtensionUpdate } = require(
      join(runtimeRoot, "dist/src/extension_update_artifact.js"),
    );
    const verified = await downloadVerifiedExtensionUpdate(
      "0.1.12",
      AbortSignal.timeout(30_000),
      {
        vscodeVersion: result.vscodeVersion,
        nodeVersion: result.nodeVersion,
      },
    );
    assert.equal(verified.sha256, targetSha256);
    const downloaded = join(temporary, "target.vsix");
    await writeFile(downloaded, verified.bytes);
    await run("/usr/bin/unzip", [
      "-q",
      downloaded,
      "-d",
      join(temporary, "target"),
    ]);
    let matched = 0;
    const compare = async (relativePath: string) => {
      for (const entry of await readdir(
        join(temporary, "target/extension", relativePath),
        { withFileTypes: true },
      )) {
        const path = join(relativePath, entry.name);
        if (entry.isDirectory()) await compare(path);
        else if (path !== "package.json") {
          assert.equal(
            sha(await readFile(join(target, path))),
            sha(await readFile(join(temporary, "target/extension", path))),
          );
          matched++;
        }
      }
    };
    await compare("");
    const installedManifest = JSON.parse(
      await readFile(join(target, "package.json"), "utf8"),
    );
    delete installedManifest.__metadata;
    assert.deepEqual(
      installedManifest,
      JSON.parse(
        await readFile(
          join(temporary, "target/extension/package.json"),
          "utf8",
        ),
      ),
    );
    result.installedExtensionFilesMatched = matched;
    result.targetSha256 = targetSha256;
    result.candidateSha256 = candidateSha256;
    result.cleanup =
      "Isolated editor exited; generated consumer/profile will be removed. Owner profile and databases were not targeted.";
    await writeFile(resultPath, JSON.stringify(result, null, 2));
    completed = true;
    console.log(
      JSON.stringify({ status: "passed", evidence, result }, null, 2),
    );
  } catch (error) {
    const failed = error as { stdout?: unknown; stderr?: unknown };
    if (typeof failed.stdout === "string" || typeof failed.stderr === "string")
      await writeFile(
        join(evidence, "native.log"),
        `${typeof failed.stdout === "string" ? failed.stdout : ""}${typeof failed.stderr === "string" ? failed.stderr : ""}`,
      );
    await writeFile(
      join(evidence, "failure.txt"),
      error instanceof Error ? error.message : String(error),
    );
    console.error(
      `Verification did not pass; preserved evidence: ${evidence}; fixture: ${temporary}`,
    );
    throw error;
  } finally {
    await copyFile(resultPath, join(evidence, "native-result.json")).catch(
      () => {},
    );
    // Never delete a failed/possibly active installation; retain it for diagnosis.
    if (completed) await rm(temporary, { recursive: true, force: true });
  }
}

if (require.main === module)
  void main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
