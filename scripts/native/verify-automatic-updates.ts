/** Opt-in installed updater acceptance; existing Code, isolated storage, no database. */
import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { constants } from "node:fs";
import {
  copyFile,
  lstat,
  mkdir,
  open,
  readFile,
  readdir,
  realpath,
  rm,
  writeFile,
} from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { promisify } from "node:util";
import { setTimeout as delay } from "node:timers/promises";
import { validateExtensionUpdateArtifact } from "../../src/updates/automatic/extension_update_artifact.js";
import { comparePublishedVersions } from "../../src/updates/advisory/update_advisory.js";
import { storageEnvironment } from "../../src/runtime/transport/platform_runtime.js";
import {
  createNativeTemporaryDirectory,
  nativeStorageRoot,
} from "./native-development-storage.js";
import {
  createNativeEditorTracker,
  nativeEditorCleanupForReport,
} from "./verify-native-cancellation.js";
import {
  createNativeEditorIpcNamespace,
  unrefRetainedNativeEditorObserver,
} from "./verify-native-prisma-editor.js";

const execute = promisify(execFile);
const repository = resolve(__dirname, "../..");
const sha = (bytes: Uint8Array) =>
  createHash("sha256").update(bytes).digest("hex");
const ui = require("./native-update-ui.cjs") as {
  driveUpdateUi(options: {
    profile: string;
    root: string;
    evidence: string;
    interactive: boolean;
    signal: AbortSignal;
  }): Promise<unknown[]>;
};
const recovery = require("./native-editor-recovery.cjs") as {
  shouldRetainNativeEditor(report: unknown): boolean;
};
const fixtureEnvironment =
  require("./native-update-reservation-worker.cjs") as {
    nativeUpdateEnvironment(
      source: NodeJS.ProcessEnv,
      storage: NodeJS.ProcessEnv,
      platform: NodeJS.Platform,
      display?: boolean,
    ): NodeJS.ProcessEnv;
  };
export function automaticUpdateEnvironment(
  source: NodeJS.ProcessEnv,
  platform: NodeJS.Platform = process.platform,
): NodeJS.ProcessEnv {
  return fixtureEnvironment.nativeUpdateEnvironment(
    source,
    storageEnvironment(source, platform),
    platform,
    true,
  );
}
const preflightMemoryMessage =
  "Native updater verification deferred: macOS memory pressure is not normal. No test fixture was allocated; no extension was installed or native Code host launched. Retry when pressure is normal.";
export class AutomaticUpdatePreflightMemoryPressureError extends Error {
  constructor() {
    super(preflightMemoryMessage);
  }
}
export function assertAutomaticUpdateMemoryPressure(
  value: number,
  phase: "preflight" | "allocated",
): void {
  if (value !== 1 && phase === "preflight")
    throw new AutomaticUpdatePreflightMemoryPressureError();
  assert.equal(
    value,
    1,
    "Native updater acceptance requires normal macOS memory pressure.",
  );
}
export function automaticUpdateFailureMessage(error: unknown): string {
  return error instanceof AutomaticUpdatePreflightMemoryPressureError
    ? preflightMemoryMessage
    : "Native updater acceptance did not pass. Review the exact inputs and retained verification reports; unknown fixture state was preserved.";
}
const names = [
  "candidate",
  "candidate-sha",
  "previous",
  "previous-sha",
  "target",
  "target-sha",
  "code",
  "electron",
  "electron-sha",
  "code-version",
] as const;
export function parseAutomaticUpdateAcceptanceArguments(
  values: readonly string[],
): ReadonlyMap<string, string> {
  const args = new Map<string, string>();
  for (const value of values) {
    const match = /^--([a-z-]+)=(.+)$/u.exec(value);
    assert.ok(
      match &&
        (names as readonly string[]).includes(match[1]!) &&
        !args.has(match[1]!),
      "Supply each exact updater acceptance input once.",
    );
    args.set(match[1]!, match[2]!);
  }
  assert.equal(args.size, names.length);
  for (const name of ["candidate", "previous", "target", "code", "electron"])
    assert.ok(isAbsolute(args.get(name)!));
  for (const name of [
    "candidate-sha",
    "previous-sha",
    "target-sha",
    "electron-sha",
  ])
    assert.match(args.get(name)!, /^[a-f0-9]{64}$/u);
  assert.match(args.get("code-version")!, /^\d+\.\d+\.\d+$/u);
  return args;
}
export function assertAutomaticUpdateVersions(
  candidate: string,
  previous: string,
  target: string,
) {
  assert.equal(
    comparePublishedVersions(target, previous),
    1,
    "The official target must be newer than the actual previous installation.",
  );
  assert.ok(
    [0, 1].includes(comparePublishedVersions(candidate, target) ?? -1),
    "The candidate must include at least the selected historical target's version.",
  );
}
export function automaticUpdateRuntimeRoot(
  mode: string,
  installedPath: string,
  frozenCandidatePath: string,
): string {
  assert.ok(
    ["candidate", "historical-install", "historical-recovery"].includes(mode),
  );
  assert.ok(
    isAbsolute(installedPath) &&
      isAbsolute(frozenCandidatePath) &&
      installedPath !== frozenCandidatePath,
  );
  return mode === "candidate" ? installedPath : frozenCandidatePath;
}
export function assertAutomaticUpdateExecutablePair(
  code: string,
  electron: string,
  platform: string,
): void {
  assert.ok(isAbsolute(code) && isAbsolute(electron));
  if (platform === "darwin")
    assert.equal(
      dirname(electron),
      resolve(dirname(code), "../../../MacOS"),
      "Code CLI and the hash-pinned application executable must share their canonical bundle.",
    );
  else {
    assert.equal(platform, "linux");
    assert.equal(electron, resolve(dirname(code), "../code"));
  }
}
export function automaticUpdateInstalledManifest(
  expected: Buffer,
  installed: Buffer,
): void {
  const original = JSON.parse(expected.toString("utf8"));
  const actual = JSON.parse(installed.toString("utf8"));
  delete actual.__metadata;
  assert.deepEqual(actual, original);
}
export function assertAutomaticUpdateReportBinding(
  report: unknown,
  expected: {
    mode: string;
    candidateSha256: string;
    loadedVersion: string;
    vscodeVersion: string;
  },
): void {
  assert.ok(
    report &&
      typeof report === "object" &&
      !recovery.shouldRetainNativeEditor(report),
  );
  const value = report as Record<string, unknown>;
  assert.ok(value.status === "passed" || value.status === "failed");
  assert.equal(value.scenario, "automatic-updates");
  for (const name of [
    "mode",
    "candidateSha256",
    "loadedVersion",
    "vscodeVersion",
  ] as const)
    assert.equal(value[name], expected[name]);
  assert.ok(
    Array.isArray(value.checks) &&
      value.checks.every((check: unknown) => typeof check === "string"),
  );
}
export function assertAutomaticUpdateFinalization(
  report: unknown,
  expected: {
    mode: string;
    candidateSha256: string;
    loadedVersion: string;
    vscodeVersion: string;
  },
): void {
  assertAutomaticUpdateReportBinding(report, expected);
  const value = report as Record<string, unknown>;
  assert.equal(value.status, "passed");
  assert.ok((value.checks as unknown[]).length > 0);
}

/** Persist the exact bound cleanup observation before any guard failure escapes. */
export async function recordAutomaticUpdateCleanup(input: {
  evidence: string;
  mode: "candidate" | "historical-install" | "historical-recovery";
  candidateSha256: string;
  loadedVersion: string;
  vscodeVersion: string;
  nativeReport: unknown;
  ui: unknown[];
  cleanup: Awaited<ReturnType<typeof nativeEditorCleanupForReport>>;
}) {
  assert.ok(
    ["candidate", "historical-install", "historical-recovery"].includes(
      input.mode,
    ),
  );
  assertAutomaticUpdateReportBinding(input.nativeReport, input);
  const bytes =
    JSON.stringify(
      {
        schemaVersion: 1,
        scope: "native-updater-cleanup-observation",
        status: "observed",
        mode: input.mode,
        candidateSha256: input.candidateSha256,
        loadedVersion: input.loadedVersion,
        vscodeVersion: input.vscodeVersion,
        nativeReport: input.nativeReport,
        ui: input.ui,
        cleanup: input.cleanup,
      },
      null,
      2,
    ) + "\n";
  let failure: unknown;
  // The tracker owns a live mutable observation: snapshot and check it in one turn.
  try {
    assert.equal(input.cleanup.cleanupSkippedForRecovery, false);
    assert.equal(input.cleanup.observation.rootObserved, true);
    assert.equal(input.cleanup.observation.signalFailed, false);
    assert.equal(input.cleanup.observation.identityUncertain, false);
    assert.equal(input.cleanup.observation.observationFailed, false);
    assert.deepEqual(input.cleanup.observation.remaining, []);
    assert.deepEqual(input.cleanup.observation.unknown, []);
    assert.deepEqual(input.cleanup.observation.awaitingReap, []);
  } catch (error) {
    failure = error;
  }
  try {
    await writeFile(join(input.evidence, `${input.mode}-cleanup.json`), bytes, {
      mode: 0o600,
      flag: "wx",
    });
  } catch (retention) {
    if (failure)
      throw new AggregateError(
        [failure, retention],
        "Native cleanup failed and its bound observation could not be retained.",
      );
    throw retention;
  }
  if (failure) throw failure;
}
async function regular(
  path: string,
  maximum = 8 * 1024 * 1024,
): Promise<Buffer> {
  assert.equal(await realpath(path), path);
  const handle = await open(
    path,
    constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
  );
  try {
    const before = await handle.stat({ bigint: true });
    assert.ok(
      before.isFile() &&
        before.nlink === 1n &&
        before.size > 0n &&
        before.size <= BigInt(maximum),
    );
    const bytes = Buffer.alloc(Number(before.size) + 1);
    let length = 0;
    while (length < bytes.length) {
      const next = await handle.read(
        bytes,
        length,
        bytes.length - length,
        length,
      );
      if (!next.bytesRead) break;
      length += next.bytesRead;
    }
    const after = await handle.stat({ bigint: true });
    const leaf = await lstat(path, { bigint: true });
    for (const key of [
      "dev",
      "ino",
      "birthtimeNs",
      "ctimeNs",
      "mtimeNs",
      "size",
    ] as const) {
      assert.equal(before[key], after[key]);
      assert.equal(after[key], leaf[key]);
    }
    assert.equal(length, Number(before.size));
    return bytes.subarray(0, length);
  } finally {
    await handle.close();
  }
}
async function inventory(root: string): Promise<string[]> {
  const files: string[] = [];
  const visit = async (part: string, depth: number) => {
    assert.ok(depth <= 16 && files.length <= 512);
    for (const entry of await readdir(join(root, part), {
      withFileTypes: true,
    })) {
      assert.ok(!entry.isSymbolicLink());
      const name = join(part, entry.name);
      if (entry.isDirectory()) await visit(name, depth + 1);
      else {
        assert.ok(entry.isFile());
        files.push(name);
      }
    }
  };
  await visit("", 0);
  return files.sort();
}
export async function assertAutomaticUpdateInstalledPayload(
  expected: string,
  installed: string,
): Promise<number> {
  assert.equal(await realpath(installed), installed);
  const files = await inventory(expected);
  assert.deepEqual(
    (await inventory(installed)).filter((name) => name !== ".vsixmanifest"),
    files,
  );
  assert.equal(
    sha(await regular(join(installed, ".vsixmanifest"))),
    sha(await regular(join(dirname(expected), "extension.vsixmanifest"))),
  );
  for (const file of files) {
    const a = await regular(join(expected, file)),
      b = await regular(join(installed, file));
    if (file === "package.json") automaticUpdateInstalledManifest(a, b);
    else assert.equal(sha(a), sha(b));
  }
  return files.length;
}
async function wait<T>(
  check: () => Promise<T | false | null | undefined>,
  milliseconds: number,
): Promise<T> {
  const deadline = Date.now() + milliseconds;
  do {
    const value = await check();
    if (value) return value;
    await delay(100);
  } while (Date.now() < deadline);
  throw Error("Owned native updater acceptance incomplete; retain recovery.");
}
export async function runAutomaticUpdateAcceptance(
  values: readonly string[] = process.argv.slice(2),
) {
  const args = parseAutomaticUpdateAcceptanceArguments(values),
    get = (name: string) => args.get(name)!;
  assert.ok(
    process.platform === "darwin" || process.platform === "linux",
    "Native updater acceptance currently supports existing macOS/Linux Code only.",
  );
  await nativeStorageRoot();
  const approved = await realpath(process.env.REHEARSAL_DEVELOPMENT_ROOT!);
  const inside = (path: string) => {
    const part = relative(approved, path);
    assert.ok(
      part &&
        part !== ".." &&
        !part.startsWith(`..${sep}`) &&
        !isAbsolute(part),
    );
  };
  for (const name of ["candidate", "previous", "target"]) {
    inside(get(name));
    assert.equal(await realpath(get(name)), get(name));
  }
  for (const name of ["code", "electron"])
    assert.equal(await realpath(get(name)), get(name));
  assertAutomaticUpdateExecutablePair(
    get("code"),
    get("electron"),
    process.platform,
  );
  const electronBytes = await regular(get("electron"), 256 * 1024 * 1024);
  assert.equal(sha(electronBytes), get("electron-sha"));
  const environment = automaticUpdateEnvironment(process.env);
  const run = (
    command: string,
    arguments_: string[],
    selectedEnvironment = environment,
  ) =>
    execute(command, arguments_, {
      cwd: repository,
      env: selectedEnvironment,
      encoding: "utf8",
      timeout: 120000,
      maxBuffer: 4 * 1024 * 1024,
    });
  const codeVersion = (await run(get("code"), ["--version"])).stdout
    .trim()
    .split(/\r?\n/u)[0];
  assert.equal(codeVersion, get("code-version"));
  const pressure = async (phase: "preflight" | "allocated") => {
    if (process.platform === "darwin")
      assertAutomaticUpdateMemoryPressure(
        Number(
          (
            await run("/usr/sbin/sysctl", [
              "-n",
              "kern.memorystatus_vm_pressure_level",
            ])
          ).stdout.trim(),
        ),
        phase,
      );
  };
  await pressure("preflight");
  const archives = await Promise.all(
    ["candidate", "previous", "target"].map(async (name) => {
      const bytes = await regular(get(name));
      assert.equal(sha(bytes), get(`${name}-sha`));
      const unzip = await run("unzip", [
        "-p",
        get(name),
        "extension/package.json",
      ]);
      const manifest = JSON.parse(unzip.stdout) as { version: string };
      validateExtensionUpdateArtifact(
        bytes,
        manifest.version,
        get(`${name}-sha`),
        {
          vscodeVersion: get("code-version"),
          nodeVersion: process.versions.node,
        },
      );
      return { name, bytes, version: manifest.version };
    }),
  );
  const candidate = archives[0]!,
    previous = archives[1]!,
    target = archives[2]!;
  assertAutomaticUpdateVersions(
    candidate.version,
    previous.version,
    target.version,
  );
  const parts = candidate.version.split(".").map(Number);
  assert.ok(
    parts.length === 3 &&
      parts.every(Number.isSafeInteger) &&
      parts[2]! < Number.MAX_SAFE_INTEGER,
  );
  const futureVersion = `${parts[0]}.${parts[1]}.${parts[2]! + 1}`;
  // Allocation happens only after exact inputs, safe archive contents and runtime are verified.
  const reportRoot = join(repository, "test-results");
  await mkdir(reportRoot, { recursive: true, mode: 0o700 });
  assert.equal(await realpath(reportRoot), reportRoot);
  const root = await createNativeTemporaryDirectory("au-");
  const evidence = await import("node:fs/promises").then(({ mkdtemp }) =>
    mkdtemp(join(reportRoot, "automatic-updates-231.")),
  );
  let complete = false;
  const report: Record<string, unknown> = {
    status: "running",
    candidateSha256: get("candidate-sha"),
    candidateVersion: candidate.version,
    previousVersion: previous.version,
    previousSha256: get("previous-sha"),
    targetVersion: target.version,
    targetSha256: get("target-sha"),
    codeVersion,
    electronSha256: get("electron-sha"),
    lanes: [],
    limitations: [
      "No complete candidate-activation upgrade is claimed.",
      "Candidate warning uses explicitly synthetic higher release metadata only before reservation refusal.",
      "Historical installer component uses an actual previous loaded version and default official verified downloader.",
      "No database, CLI package installation, normal profile, forced owner reload or native Windows acceptance.",
    ],
  };
  const lanes: unknown[] = [];
  const completedPortFiles = new Map<string, Buffer>();
  const namespaces = new Map<
    string,
    { directory: string; dev: bigint; ino: bigint; birthtimeNs: bigint }
  >();
  try {
    for (const archive of archives) {
      const directory = join(root, archive.name);
      await mkdir(directory, { mode: 0o700 });
      const file = join(directory, "frozen.vsix");
      await writeFile(file, archive.bytes, { flag: "wx", mode: 0o400 });
      await run("unzip", ["-q", file, "-d", join(directory, "archive")]);
    }
    const runtimeRoot = join(root, "candidate/archive/extension");
    const lane = async (
      mode: "candidate" | "historical-install" | "historical-recovery",
    ) => {
      const selected =
        mode === "candidate"
          ? candidate
          : mode === "historical-install"
            ? previous
            : target;
      const laneRoot = join(
        root,
        mode === "candidate" ? "candidate-host" : "historical-host",
      );
      const profile = join(laneRoot, "user"),
        extensions = join(laneRoot, "extensions"),
        workspace = join(laneRoot, "empty");
      const harness = join(laneRoot, "harness"),
        storagePath = join(laneRoot, "coordination");
      for (const directory of [
        profile,
        join(profile, "User"),
        extensions,
        workspace,
        harness,
        storagePath,
      ])
        await mkdir(directory, { mode: 0o700, recursive: true });
      let laneEnvironment = environment;
      if (process.platform === "linux") {
        let owned = namespaces.get(profile);
        if (!owned) {
          const namespace = await createNativeEditorIpcNamespace(
            approved,
            profile,
            get("code-version"),
          );
          const metadata = await lstat(namespace.directory, { bigint: true });
          owned = {
            directory: namespace.directory,
            dev: metadata.dev,
            ino: metadata.ino,
            birthtimeNs: metadata.birthtimeNs,
          };
          namespaces.set(profile, owned);
          await writeFile(
            join(evidence, `${mode}-ipc.json`),
            JSON.stringify(namespace.receipt),
            { mode: 0o600 },
          );
        }
        laneEnvironment = { ...environment, XDG_RUNTIME_DIR: owned.directory };
      }
      await writeFile(
        join(profile, "User/settings.json"),
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
        { mode: 0o600 },
      );
      for (const file of [
        "native-editor-driver.cjs",
        "native-editor-recovery.cjs",
        "native-editor-reads.cjs",
        "native-automatic-update-test.cjs",
        "native-update-reservation-worker.cjs",
      ])
        await copyFile(join(__dirname, file), join(harness, file));
      await writeFile(
        join(harness, "package.json"),
        JSON.stringify({
          name: "owned-native-updates",
          publisher: "rehearsal-local-acceptance",
          version: "0.0.0",
          private: true,
          engines: { vscode: "^1.101.0" },
          main: "native-editor-driver.cjs",
          activationEvents: ["onStartupFinished"],
        }),
        { mode: 0o600 },
      );
      const isolated = [
        "--user-data-dir",
        profile,
        "--extensions-dir",
        extensions,
      ];
      if (mode !== "historical-recovery")
        await run(
          get("code"),
          [
            ...isolated,
            "--install-extension",
            join(root, selected.name, "frozen.vsix"),
          ],
          laneEnvironment,
        );
      const installedPath = join(
        extensions,
        `rehearsal-db.rehearsal-db-${selected.version}`,
      );
      const installedFiles = await assertAutomaticUpdateInstalledPayload(
        join(root, selected.name, "archive/extension"),
        installedPath,
      );
      const resultPath = join(evidence, `${mode}.json`),
        configPath = join(laneRoot, "config.json");
      await writeFile(
        configPath,
        JSON.stringify({
          scenario: "automatic-updates",
          mode,
          root: laneRoot,
          fixtureRoot: root,
          evidence,
          resultPath,
          runtimeRoot: automaticUpdateRuntimeRoot(
            mode,
            installedPath,
            runtimeRoot,
          ),
          workspace,
          storagePath,
          installedPath,
          loadedVersion: selected.version,
          targetVersion: target.version,
          futureVersion,
          candidateSha256: get("candidate-sha"),
        }),
        { mode: 0o600 },
      );
      await writeFile(
        join(laneRoot, "phase.json"),
        JSON.stringify({ phase: "starting" }),
        { mode: 0o600 },
      );
      await pressure("allocated");
      const portFile = join(profile, "DevToolsActivePort");
      try {
        const stale = await regular(portFile, 256);
        const previousPort = completedPortFiles.get(profile);
        assert.ok(
          previousPort,
          "An unrecognized pre-existing debug endpoint must be preserved.",
        );
        assert.deepEqual(stale, previousPort);
        await rm(portFile);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
      const child = spawn(
        get("electron"),
        [
          ...isolated,
          `--extensionDevelopmentPath=${harness}`,
          "--remote-debugging-address=127.0.0.1",
          "--remote-debugging-port=0",
          "--disable-updates",
          "--skip-welcome",
          "--skip-release-notes",
          "--new-window",
          workspace,
        ],
        {
          cwd: repository,
          env: {
            ...laneEnvironment,
            REHEARSAL_NATIVE_CANCELLATION_CONFIG: configPath,
          },
          detached: true,
          stdio: ["ignore", "ignore", "pipe"],
        },
      );
      child.once("error", () => {});
      child.stderr?.resume();
      assert.ok(child.pid);
      const tracker = createNativeEditorTracker(child.pid, get("electron"));
      let exited = false,
        exitCode: number | null = null,
        exitSignal: NodeJS.Signals | null = null,
        childError: Error | undefined,
        observing = false;
      child.once("error", (error) => {
        childError = error;
      });
      child.once("close", (code, signal) => {
        exited = true;
        exitCode = code;
        exitSignal = signal;
      });
      await tracker.observe();
      const observation = setInterval(() => {
        if (!observing) {
          observing = true;
          void tracker.observe().finally(() => {
            observing = false;
          });
        }
      }, 200);
      observation.unref();
      const abort = new AbortController();
      const uiPromise = ui.driveUpdateUi({
        profile,
        root: laneRoot,
        evidence,
        interactive: mode === "candidate",
        signal: abort.signal,
      });
      // Attach rejection handling immediately while the driver and actual host run together.
      let uiFailure: unknown;
      const uiDone = uiPromise.catch((error: unknown) => {
        uiFailure = error;
        return [];
      });
      let nativeReport: Record<string, unknown> | undefined;
      try {
        nativeReport = await wait(async () => {
          if (childError) throw childError;
          if (uiFailure) throw uiFailure;
          try {
            const value = JSON.parse(
              await readFile(resultPath, "utf8"),
            ) as Record<string, unknown>;
            if (value.driverFinalized === true) return value;
          } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
          }
          if (exited)
            throw Error("Native updater host exited without finalization.");
          return null;
        }, 180000);
        if (recovery.shouldRetainNativeEditor(nativeReport))
          throw Error("Native updater recovery remains unconfirmed.");
        assertAutomaticUpdateReportBinding(nativeReport, {
          mode,
          candidateSha256: get("candidate-sha"),
          loadedVersion: selected.version,
          vscodeVersion: get("code-version"),
        });
        if (nativeReport.status !== "passed") abort.abort();
        const observedUi = await uiDone;
        const cleanup = await nativeEditorCleanupForReport(
          nativeReport,
          tracker,
        );
        await recordAutomaticUpdateCleanup({
          evidence,
          mode,
          nativeReport,
          ui: observedUi,
          cleanup,
          candidateSha256: get("candidate-sha"),
          loadedVersion: selected.version,
          vscodeVersion: get("code-version"),
        });
        await wait(async () => exited, 15000);
        assertAutomaticUpdateFinalization(nativeReport, {
          mode,
          candidateSha256: get("candidate-sha"),
          loadedVersion: selected.version,
          vscodeVersion: get("code-version"),
        });
        if (uiFailure) throw uiFailure;
        assert.ok(
          exitCode === 0 ||
            (exitCode === null &&
              ["SIGTERM", "SIGKILL"].includes(exitSignal ?? "")),
          "The clean owned host must exit normally or through verified owned cleanup.",
        );
        try {
          completedPortFiles.set(profile, await regular(portFile, 256));
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
        }
        const finalFiles =
          mode === "historical-install"
            ? await assertAutomaticUpdateInstalledPayload(
                join(root, "target/archive/extension"),
                join(extensions, `rehearsal-db.rehearsal-db-${target.version}`),
              )
            : await assertAutomaticUpdateInstalledPayload(
                join(root, selected.name, "archive/extension"),
                installedPath,
              );
        const evidenceRow = {
          mode,
          installedFiles,
          finalFiles,
          nativeReport,
          ui: observedUi,
          cleanup,
        };
        lanes.push(evidenceRow);
        return evidenceRow;
      } finally {
        clearInterval(observation);
        abort.abort();
        await uiDone;
        // Unknown/dirty/missing finalization never grants signalling or fixture deletion.
        if (!exited) {
          unrefRetainedNativeEditorObserver(child);
        }
      }
    };
    await lane("candidate");
    await lane("historical-install");
    await lane("historical-recovery");
    for (const owned of namespaces.values()) {
      const current = await lstat(owned.directory, { bigint: true });
      assert.ok(
        current.isDirectory() &&
          !current.isSymbolicLink() &&
          current.dev === owned.dev &&
          current.ino === owned.ino &&
          current.birthtimeNs === owned.birthtimeNs,
      );
      await rm(owned.directory, { recursive: true, force: false });
    }
    report.status = "passed";
    report.lanes = lanes;
    complete = true;
  } catch (error) {
    report.status = "failed";
    report.lanes = lanes;
    report.failureCode =
      (error as NodeJS.ErrnoException).code === "ERR_ASSERTION"
        ? "ASSERTION_FAILED"
        : "NATIVE_UPDATE_ACCEPTANCE_FAILED";
    throw error;
  } finally {
    report.fixture = complete
      ? "removed after verified clean completion"
      : root;
    report.retainedIpcNamespaces = complete
      ? []
      : [...namespaces.values()].map((value) => value.directory);
    await writeFile(
      join(evidence, "verification.json"),
      JSON.stringify(report, null, 2) + "\n",
      { mode: 0o600 },
    );
    if (complete) await rm(root, { recursive: true, force: false });
    console.log(
      JSON.stringify({
        status: report.status,
        evidence,
        fixtureRetained: !complete,
      }),
    );
  }
}
if (require.main === module)
  void runAutomaticUpdateAcceptance().catch((error: unknown) => {
    console.error(automaticUpdateFailureMessage(error));
    process.exitCode = 1;
  });
