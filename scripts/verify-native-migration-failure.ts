/** Opt-in macOS panel acceptance; optional file-only CLI fixture, no database operation. */
import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { constants } from "node:fs";
import {
  copyFile,
  lstat,
  mkdir,
  mkdtemp,
  open,
  readFile,
  readdir,
  realpath,
  rm,
  writeFile,
} from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import { promisify } from "node:util";
import { setTimeout as delay } from "node:timers/promises";
import { assertArchiveContents } from "./verify-private-vsix.js";
import { storageEnvironment } from "../src/platform_runtime.js";
import {
  nativeStorageRoot,
  createNativeTemporaryDirectory,
} from "./native-development-storage.js";
import type { ActivityData } from "../src/contracts.js";
import type { MigrationFailureSource } from "../src/migration_failure_source.js";
import {
  nativeEngineLaunchMode,
  waitForNativeEngineResult,
} from "./native-engine-launch.js";
import { prepareNativeEngineConsumer } from "./native-engine-consumer.js";
import { parseNativeEngineFixture } from "./engine-lifecycle-fixture.js";
import { parseNativeInsightsFixture } from "./native-insights-fixture.js";
import {
  nativeConsumerFingerprint,
  prepareNativeConsumerRemoval,
  prepareNativeInsightsConsumer,
} from "./native-insights-consumer.js";

const execute = promisify(execFile);
const repository = resolve(__dirname, "..");
const code =
  "/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code";
const electron = "/Applications/Visual Studio Code.app/Contents/MacOS/Code";
const sha = (bytes: Uint8Array) =>
  createHash("sha256").update(bytes).digest("hex");

async function boundedInput(path: string, maximumBytes = 256 * 1024) {
  const handle = await open(
    path,
    constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
  );
  try {
    const stat = await handle.stat();
    assert.ok(stat.isFile() && stat.size <= maximumBytes);
    const bytes = Buffer.alloc(maximumBytes + 1);
    const { bytesRead } = await handle.read(bytes, 0, bytes.length, 0);
    assert.equal(bytesRead, stat.size);
    assert.equal((await handle.stat()).size, stat.size);
    return bytes.subarray(0, bytesRead);
  } finally {
    await handle.close();
  }
}

async function workspaceFiles(root: string, directory = ""): Promise<string[]> {
  const files: string[] = [];
  for (const entry of await readdir(join(root, directory), {
    withFileTypes: true,
  })) {
    assert.equal(entry.isSymbolicLink(), false);
    const name = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await workspaceFiles(root, name)));
    else {
      assert.equal(entry.isFile(), true);
      files.push(name);
    }
  }
  return files.sort();
}

async function runOwnedNative(
  args: string[],
  env: NodeJS.ProcessEnv,
  onClosed?: () => void,
  onStarted?: (pid: number) => Promise<void>,
  completeOnStarted = false,
) {
  // A new session gives this isolated editor its own process group. Never use a
  // name-based editor kill or signal the caller's/user's existing process group.
  const child = spawn(electron, args, {
    cwd: repository,
    env,
    detached: true,
    stdio: "ignore",
  });
  const exited = new Promise<number | null>((resolveExit, reject) => {
    child.once("error", reject);
    child.once("close", resolveExit);
  });
  const pid = child.pid;
  if (pid === undefined) {
    await exited;
    throw new Error("The owned native editor did not start.");
  }
  const groupExists = () => {
    try {
      process.kill(-pid, 0);
      return true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ESRCH") return false;
      throw error;
    }
  };
  const stopGroup = async () => {
    for (const [signal, waitMs] of [
      ["SIGTERM", 2000],
      ["SIGKILL", 5000],
    ] as const) {
      if (!groupExists()) return;
      try {
        process.kill(-pid, signal);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error;
      }
      const deadline = Date.now() + waitMs;
      while (groupExists() && Date.now() < deadline) await delay(50);
    }
    assert.equal(groupExists(), false, "Owned native process group remains.");
  };
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(
        () => reject(new Error("Owned native editor timed out.")),
        180000,
      );
    });
    await Promise.race([onStarted?.(pid), timeout]);
    if (completeOnStarted) {
      await stopGroup();
      await Promise.race([exited, timeout]);
    } else assert.equal(await Promise.race([exited, timeout]), 0);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
    // Also close children left after a successful Electron-parent exit. Only
    // the captured group created above is eligible for these bounded signals.
    await stopGroup();
    onClosed?.();
  }
}

async function main() {
  assert.equal(
    process.platform,
    "darwin",
    "This native harness requires the installed macOS VS Code.",
  );
  const [candidateInput, candidateSha, activityInput, sourceInput, ...extra] =
    process.argv.slice(2);
  assert.ok(
    candidateInput && activityInput && extra.length === 0,
    "Pass exact VSIX, full SHA-256, recorded public samples JSON and optionally its exact attempted SQL file.",
  );
  assert.match(candidateSha ?? "", /^[a-f0-9]{64}$/u);
  const candidate = resolve(candidateInput),
    activity = resolve(activityInput);
  assert.ok(
    (await lstat(candidate)).isFile() &&
      !(await lstat(candidate)).isSymbolicLink(),
  );
  const candidateBytes = await readFile(candidate);
  assert.equal(sha(candidateBytes), candidateSha);
  const activityBytes = await boundedInput(activity),
    activitySha = sha(activityBytes);
  const input = JSON.parse(activityBytes.toString("utf8"));
  const nativeInsights =
    input.kind === "migration-insights-native-fixture"
      ? parseNativeInsightsFixture(input)
      : null;
  const nativeEngine =
    input.kind === "engine-lifecycle-native-fixture"
      ? parseNativeEngineFixture(input)
      : null;
  const engineArtifact = nativeEngine
    ? process.env.REHEARSAL_NATIVE_ENGINE_CORE_ARTIFACT
    : undefined;
  if (nativeEngine) {
    assert.equal(nativeEngine.candidateSha256, candidateSha);
    assert.equal(sourceInput, undefined);
    const artifact = engineArtifact;
    assert.ok(
      artifact && resolve(artifact) === artifact,
      "Pass the exact recorded Core artifact for synthetic native provenance.",
    );
    assert.equal(
      sha(await boundedInput(artifact, 16 * 1024 * 1024)),
      nativeEngine.coreArtifactSha256,
    );
  }
  const engineUiReview = process.env.REHEARSAL_NATIVE_ENGINE_UI_REVIEW;
  assert.ok(
    engineUiReview === undefined || (engineUiReview === "1" && nativeEngine),
  );
  const uiReview = process.env.REHEARSAL_NATIVE_INSIGHTS_UI_REVIEW;
  const coreArtifactInput = process.env.REHEARSAL_NATIVE_INSIGHTS_CORE_ARTIFACT;
  const coreArtifact = coreArtifactInput ? resolve(coreArtifactInput) : null;
  const impactInput = process.env.REHEARSAL_NATIVE_IMPACT_ACTIVITY;
  const impactActivity = impactInput ? resolve(impactInput) : null;
  assert.ok(
    !impactActivity || nativeInsights,
    "Impact activity requires the private Insights companion.",
  );
  const impactBytes = impactActivity
    ? await boundedInput(impactActivity)
    : null;
  assert.ok(
    !coreArtifact || nativeInsights,
    "Canonical activation requires the private Insights fixture.",
  );
  if (coreArtifact)
    assert.equal(
      sha(await boundedInput(coreArtifact, 16 * 1024 * 1024)),
      nativeInsights!.coreArtifactSha256,
    );
  assert.ok(uiReview === undefined || uiReview === "1");
  assert.ok(
    !uiReview || nativeInsights,
    "UI review requires the private Insights fixture.",
  );
  assert.ok(
    !nativeInsights || !sourceInput,
    "Insights uses only its bound private synthetic files.",
  );
  const samples = input.kind === "migration-workbench-samples" ? input : null;
  if (samples) {
    assert.ok(activityBytes.length <= 64 * 1024);
    assert.deepEqual(
      Object.keys(samples).sort(),
      [
        "artifactSha256",
        "correctedActivity",
        "correctedBaseline",
        "correctedCandidates",
        "correctedDoctor",
        "correctedExplain",
        "correctedStatus",
        "failureActivity",
        "kind",
        "schemaVersion",
      ].sort(),
    );
    assert.equal(samples.schemaVersion, 1);
    assert.match(samples.artifactSha256, /^[a-f0-9]{64}$/u);
  }
  const envelope = samples?.failureActivity ?? input;
  if (!nativeInsights && !nativeEngine) {
    assert.equal(envelope.schemaVersion, 1);
    assert.equal(envelope.command, "activity");
    assert.equal(envelope.status, "success");
  }
  const sourceOriginal = sourceInput ? resolve(sourceInput) : null;
  const sourceBytes = sourceOriginal
    ? await boundedInput(sourceOriginal, 2 * 1024 * 1024)
    : null;
  if (sourceBytes)
    assert.ok(Buffer.from(sourceBytes.toString("utf8")).equals(sourceBytes));
  const environment: NodeJS.ProcessEnv = storageEnvironment(process.env);
  for (const key of ["HOME", "USER", "LOGNAME", "LANG", "LC_ALL", "TMPDIR"])
    if (process.env[key]) environment[key] = process.env[key];
  environment.PATH = `${dirname(process.execPath)}:/usr/bin:/bin:/usr/sbin:/sbin`;
  if (coreArtifact) environment.PATH += ":/opt/homebrew/bin:/usr/local/bin";
  const run = (command: string, args: string[], cwd = repository) =>
    execute(command, args, {
      cwd,
      env: environment,
      encoding: "utf8",
      timeout: 120000,
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
      "Native panel verification deferred: memory pressure is not normal.",
    );
  await normalPressure();
  await nativeStorageRoot();
  await mkdir(join(repository, "test-results"), { recursive: true });
  const evidence = await mkdtemp(
    join(repository, "test-results/native-migration-failure."),
  );
  // Short task-owned IPC/profile paths remain on the development volume.
  const temporary = await createNativeTemporaryDirectory("m-");
  const userData = join(temporary, "user"),
    extensions = join(temporary, "extensions"),
    workspace = join(temporary, "empty"),
    harness = join(temporary, "harness"),
    frozen = join(temporary, "frozen");
  const resultPath = join(temporary, "result.json"),
    configPath = join(temporary, "configuration.json"),
    activityCopy = join(temporary, "activity.json"),
    candidateCopy = join(temporary, "candidate.vsix");
  const preserveEngineScreenshots = async () => {
    if (!engineUiReview) return;
    await copyFile(
      join(temporary, "engine-ui-consent.json"),
      join(evidence, "engine-ui-consent.json"),
    ).catch(() => {});
    for (const name of [
      "engine-ui-unbound-review.json",
      "engine-ui-dashboard-visibility.json",
    ])
      await copyFile(join(temporary, name), join(evidence, name)).catch(
        () => {},
      );
    for (const theme of ["dark", "light", "high-contrast", "unbound"])
      await copyFile(
        join(temporary, `engine-ui-${theme}-return.json`),
        join(evidence, `engine-ui-${theme}-return.json`),
      ).catch(() => {});
    for (const theme of ["dark", "light", "high-contrast", "unbound"])
      for (const view of ["dashboard", "review", "returned"])
        await copyFile(
          join(temporary, `engine-ui-${theme}-${view}.png`),
          join(evidence, `engine-ui-${theme}-${view}.png`),
        ).catch(() => {});
  };
  let fixtureRemoved = false,
    nativeProcessGroupClosed = false,
    phase = "archive";
  let consumerFingerprint: string | undefined;
  let engineFingerprint: string | undefined;
  let copiedSource: {
    relativePath: string;
    sha256: string;
    operationId: string;
  } | null = null;
  try {
    await writeFile(candidateCopy, candidateBytes, { mode: 0o600, flag: "wx" });
    const archive = await run("/usr/bin/unzip", ["-Z1", candidateCopy]);
    assertArchiveContents(archive.stdout.split(/\r?\n/u).filter(Boolean));
    await run("/usr/bin/unzip", ["-q", candidateCopy, "-d", frozen]);
    const packageRoot = join(frozen, "extension"),
      manifest = JSON.parse(
        await readFile(join(packageRoot, "package.json"), "utf8"),
      );
    assert.equal(manifest.publisher, "rehearsal-db");
    assert.equal(manifest.name, "rehearsal-db");
    assert.equal(manifest.pricing, "Free");
    assert.match(manifest.version, /^\d+\.\d+\.\d+(?:-[A-Za-z0-9.-]+)?$/u);
    for (const directory of [
      join(userData, "User"),
      extensions,
      workspace,
      harness,
    ])
      await mkdir(directory, { recursive: true });
    if (nativeEngine)
      engineFingerprint = await prepareNativeEngineConsumer(
        workspace,
        temporary,
        nativeEngine,
      );
    if (nativeInsights) {
      for (const file of nativeInsights.files) {
        const target = join(workspace, file.path);
        assert.ok(target.startsWith(`${workspace}/`));
        await mkdir(dirname(target), { recursive: true });
        await writeFile(target, file.bytes, { mode: 0o600, flag: "wx" });
      }
    }
    if (coreArtifact && nativeInsights) {
      phase = "canonical-consumer";
      const npmConfig = join(temporary, "npm-userconfig");
      await writeFile(npmConfig, "", { mode: 0o600, flag: "wx" });
      environment.npm_config_userconfig = npmConfig;
      environment.npm_config_cache = join(temporary, "npm-cache");
      environment.NPM_CONFIG_CACHE = environment.npm_config_cache;
      consumerFingerprint = await prepareNativeInsightsConsumer({
        workspace,
        coreArtifact,
        coreVersion: nativeInsights.coreVersion,
        run,
      });
    }
    if (sourceBytes) {
      const { parseActivityData } = require(
        join(packageRoot, "dist/src/contracts.js"),
      ) as {
        parseActivityData(value: unknown): ActivityData;
      };
      const { parseMigrationFailureSource } = require(
        join(packageRoot, "dist/src/migration_failure_source.js"),
      ) as {
        parseMigrationFailureSource(value: unknown): MigrationFailureSource;
      };
      const matches =
        parseActivityData(envelope.data).recentFailures?.filter(
          (entry) =>
            entry.diagnostic.classification !== "unknown" &&
            entry.diagnostic.source?.sha256 === sha(sourceBytes),
        ) ?? [];
      assert.equal(matches.length, 1);
      const source = parseMigrationFailureSource(matches[0]!.diagnostic.source);
      assert.ok(source.workspaceRelativePath);
      const sourcePath = join(workspace, source.workspaceRelativePath);
      assert.ok(sourcePath.startsWith(`${workspace}/`));
      await mkdir(dirname(sourcePath), { recursive: true });
      await writeFile(sourcePath, sourceBytes, { mode: 0o600, flag: "wx" });
      copiedSource = {
        relativePath: source.workspaceRelativePath,
        sha256: source.sha256,
        operationId: matches[0]!.operationId,
      };
    }
    await writeFile(activityCopy, activityBytes, { mode: 0o600, flag: "wx" });
    if (impactBytes)
      await writeFile(join(temporary, "impact-activity.json"), impactBytes, {
        mode: 0o600,
        flag: "wx",
      });
    await writeFile(
      join(userData, "User/settings.json"),
      JSON.stringify({
        "security.workspace.trust.enabled": false,
        "telemetry.telemetryLevel": "off",
        "update.mode": "none",
        "extensions.autoUpdate": false,
        "extensions.autoCheckUpdates": false,
        "workbench.startupEditor": "none",
        ...(engineUiReview ? { "window.dialogStyle": "custom" } : {}),
        "rehearsal.openDashboardAutomatically": false,
        "rehearsal.automaticUpdates": { extension: false, cli: false },
        "terminal.integrated.enablePersistentSessions": false,
      }),
    );
    const launchMode = nativeEngineLaunchMode(engineUiReview === "1", harness);
    await writeFile(
      join(harness, "package.json"),
      JSON.stringify({
        name: "native-migration-failure",
        publisher: "rehearsal-verification",
        version: "0.0.0",
        private: true,
        engines: { vscode: "^1.101.0" },
        main: "./runner.cjs",
        ...(launchMode.activationEvents.length
          ? { activationEvents: launchMode.activationEvents }
          : {}),
      }),
    );
    await copyFile(
      join(
        repository,
        nativeEngine
          ? "scripts/native-engine-lifecycle-test.cjs"
          : nativeInsights
            ? "scripts/native-insights-test.cjs"
            : "scripts/native-migration-failure-test.cjs",
      ),
      join(harness, "runner.cjs"),
    );
    if (nativeEngine)
      await copyFile(
        join(repository, "scripts/native-engine-ui-contract.cjs"),
        join(harness, "native-engine-ui-contract.cjs"),
      );
    await writeFile(
      configPath,
      JSON.stringify({
        root: temporary,
        workspace,
        extensions,
        resultPath,
        activityPath: activityCopy,
        activitySha256: activitySha,
        candidateSha256: candidateSha,
        source: copiedSource,
        version: manifest.version,
        canonicalActivation: coreArtifact !== null,
        impactActivity: impactBytes
          ? {
              path: join(temporary, "impact-activity.json"),
              sha256: sha(impactBytes),
            }
          : null,
        uiReview: uiReview === "1",
        engineUiReview: engineUiReview === "1",
        phasePath: join(temporary, "phase.json"),
      }),
    );
    phase = "installation";
    await normalPressure();
    const isolated = [
      "--user-data-dir",
      userData,
      "--extensions-dir",
      extensions,
    ];
    assert.equal(sha(await readFile(candidateCopy)), candidateSha);
    await run(code, [...isolated, "--install-extension", candidateCopy]);
    const installed = join(
      extensions,
      `rehearsal-db.rehearsal-db-${manifest.version}`,
    );
    assert.ok(
      (await realpath(installed)).startsWith(`${await realpath(extensions)}/`),
    );
    let matched = 0;
    const compare = async (directory: string) => {
      for (const entry of await readdir(join(packageRoot, directory), {
        withFileTypes: true,
      })) {
        const name = join(directory, entry.name);
        if (entry.isDirectory()) await compare(name);
        else {
          assert.ok(entry.isFile());
          if (name === "package.json") {
            const actual = JSON.parse(
              await readFile(join(installed, name), "utf8"),
            );
            delete actual.__metadata;
            assert.deepEqual(actual, manifest);
          } else
            assert.equal(
              sha(await readFile(join(installed, name))),
              sha(await readFile(join(packageRoot, name))),
            );
          matched++;
        }
      }
    };
    await compare("");
    phase = "native-panel";
    await normalPressure();
    await runOwnedNative(
      [
        ...isolated,
        `--extensionDevelopmentPath=${harness}`,
        ...launchMode.testArguments,
        ...(engineUiReview
          ? [
              "--remote-debugging-address=127.0.0.1",
              "--remote-debugging-port=0",
            ]
          : []),
        "--skip-welcome",
        "--skip-release-notes",
        "--disable-updates",
        workspace,
      ],
      {
        ...environment,
        REHEARSAL_NATIVE_MIGRATION_CONFIG: configPath,
        ...(engineUiReview
          ? { REHEARSAL_NATIVE_ENGINE_NORMAL_ACTIVATION: "1" }
          : {}),
      },
      () => {
        nativeProcessGroupClosed = true;
      },
      async (pid) => {
        if (engineUiReview) {
          await run(process.execPath, [
            join(repository, "scripts/native-engine-ui-driver.cjs"),
            userData,
            temporary,
          ]);
          await waitForNativeEngineResult(
            resultPath,
            candidateSha!,
            activitySha,
          );
        }
        if (uiReview) {
          await writeFile(
            join(evidence, "ui-session.json"),
            JSON.stringify({
              pid,
              phasePath: join(temporary, "phase.json"),
            }),
            { mode: 0o600 },
          );
          console.log(
            JSON.stringify({ status: "native-ui-started", evidence }),
          );
        }
      },
      launchMode.completeOnStarted,
    );
    const result = JSON.parse(await readFile(resultPath, "utf8"));
    assert.equal(result.status, "passed");
    assert.equal(result.candidateSha256, candidateSha);
    assert.equal(result.activitySha256, activitySha);
    assert.equal(sha(await boundedInput(activity)), activitySha);
    assert.equal(sha(await readFile(candidate)), candidateSha);
    if (impactActivity && impactBytes)
      assert.equal(sha(await boundedInput(impactActivity)), sha(impactBytes));
    if (coreArtifact)
      assert.equal(
        sha(await boundedInput(coreArtifact, 16 * 1024 * 1024)),
        nativeInsights!.coreArtifactSha256,
      );
    if (nativeEngine && engineArtifact)
      assert.equal(
        sha(await boundedInput(engineArtifact, 16 * 1024 * 1024)),
        nativeEngine.coreArtifactSha256,
      );
    if (consumerFingerprint)
      assert.equal(
        await nativeConsumerFingerprint(workspace),
        consumerFingerprint,
      );
    else if (engineFingerprint)
      assert.equal(
        await nativeConsumerFingerprint(workspace),
        engineFingerprint,
      );
    else
      assert.deepEqual(
        await workspaceFiles(workspace),
        nativeInsights
          ? nativeInsights.files.map((file) => file.path).sort()
          : copiedSource
            ? [copiedSource.relativePath]
            : [],
      );
    if (nativeInsights)
      for (const file of nativeInsights.files)
        assert.equal(
          sha(await boundedInput(join(workspace, file.path))),
          file.sha256,
        );
    if (copiedSource) {
      assert.equal(
        sha(
          await boundedInput(
            join(workspace, copiedSource.relativePath),
            2 * 1024 * 1024,
          ),
        ),
        copiedSource.sha256,
      );
      assert.equal(
        sha(await boundedInput(sourceOriginal!, 2 * 1024 * 1024)),
        copiedSource.sha256,
      );
    }
    phase = "uninstall";
    await run(code, [
      ...isolated,
      "--uninstall-extension",
      "rehearsal-db.rehearsal-db",
    ]);
    const listed = await run(code, [
      ...isolated,
      "--list-extensions",
      "--show-versions",
    ]);
    assert.equal(
      listed.stdout
        .split(/\r?\n/u)
        .some((line) => line.startsWith("rehearsal-db.rehearsal-db@")),
      false,
    );
    phase = "cleanup";
    await preserveEngineScreenshots();
    await copyFile(resultPath, join(evidence, "native-result.json"));
    if (consumerFingerprint) await prepareNativeConsumerRemoval(workspace);
    await rm(temporary, { recursive: true, force: true });
    fixtureRemoved = true;
    await writeFile(
      join(evidence, "verification.json"),
      JSON.stringify(
        {
          ...result,
          installedFilesMatched: matched,
          cleanup:
            "owned native process group closed; exact extension uninstalled; owned profile removed",
          nativeProcessGroupClosed,
          fixtureRemoved,
          workspaceUnchanged: true,
          workspacePreservation: nativeEngine
            ? "The synthetic consumer package and immutable configuration file inventory and bytes match the initial fixture. No real Core or database operation was executed."
            : "Final file inventory and attempted-input bytes match the initial fixture; the deliberate source-byte refusal control was restored.",
        },
        null,
        2,
      ),
    );
    console.log(
      JSON.stringify({
        status: "passed",
        evidence,
        installedFilesMatched: matched,
        candidateSha256: candidateSha,
        activitySha256: activitySha,
      }),
    );
  } catch {
    await preserveEngineScreenshots();
    await copyFile(resultPath, join(evidence, "native-result.json")).catch(
      () => {},
    );
    await writeFile(
      join(evidence, "failure.json"),
      JSON.stringify(
        {
          status: "failed",
          phase,
          candidateSha256: candidateSha,
          activitySha256: activitySha,
          fixture: relative(dirname(repository), temporary),
          fixtureRemoved,
          nativeProcessGroupClosed,
          rawOutputIncluded: false,
        },
        null,
        2,
      ),
    );
    throw new Error(
      `Native migration panel verification failed during ${phase}; owned fixture ${fixtureRemoved ? "removed" : "retained"} and raw editor output withheld. Evidence: ${evidence}`,
    );
  }
}

if (require.main === module)
  void main().catch((error: unknown) => {
    console.error(
      error instanceof Error &&
        error.message.startsWith(
          "Native migration panel verification failed during ",
        )
        ? error.message
        : "Native migration panel verification failed during input validation or isolated setup; raw errors withheld.",
    );
    process.exitCode = 1;
  });
