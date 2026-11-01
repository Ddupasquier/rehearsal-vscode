import { execFile, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";

const repositoryRoot = resolve(__dirname, "../..");
/** VS Code itself exports VSCODE_CLI=1 as a marker, not an executable path. */
export const resolveVerificationVsCodeCli = (
  override: string | undefined,
): string => (override && override !== "1" ? override : "code");
const vscodeCli = resolveVerificationVsCodeCli(process.env.VSCODE_CLI);
const outputLimit = 4 * 1024 * 1024;

type ExtensionManifest = {
  name?: unknown;
  publisher?: unknown;
  version?: unknown;
  license?: unknown;
  preview?: unknown;
  pricing?: unknown;
};

type ProcessIdentity = {
  pid: number;
  ppid: number;
  pgid: number;
  started: string;
  executable: string;
};
const processTools = require("../native/native-editor-reads.cjs") as {
  processes: () => Promise<Map<number, ProcessIdentity>>;
  processArguments: () => string[];
  parseProcessRows: (value: string) => Map<number, ProcessIdentity>;
  same: (
    left: ProcessIdentity | undefined,
    right: ProcessIdentity | undefined,
  ) => boolean;
  collect: (
    rows: Map<number, ProcessIdentity>,
    captured: Map<number, ProcessIdentity>,
    roots: number[],
  ) => void;
};
const observeInstallationProcesses = (): Promise<
  Map<number, ProcessIdentity>
> =>
  new Promise((resolve, reject) => {
    // Trusted /bin/ps has no intended descendants; bound its own exact child too.
    const child = execFile(
      "/bin/ps",
      processTools.processArguments(),
      {
        encoding: "utf8",
        timeout: 200,
        killSignal: "SIGKILL",
        maxBuffer: 1024 * 1024,
      },
      (error, stdout) => {
        if (error) reject(new Error("Process sample unavailable."));
        else resolve(processTools.parseProcessRows(stdout));
      },
    );
    let exited = false;
    child.once("exit", () => {
      exited = true;
    });
    const retirement = setTimeout(() => {
      if (!exited && child.exitCode === null && child.signalCode === null)
        child.kill("SIGKILL");
      child.unref();
      for (const stream of [child.stdout, child.stderr])
        (stream as typeof stream & { unref?: () => void })?.unref?.();
    }, 300);
    child.once("close", () => clearTimeout(retirement));
  });
const settleWithin = <T>(
  promise: Promise<T>,
  milliseconds: number,
): Promise<{ settled: true; value: T } | { settled: false }> =>
  new Promise((resolve) => {
    const timer = setTimeout(() => resolve({ settled: false }), milliseconds);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve({ settled: true, value });
      },
      () => {
        clearTimeout(timer);
        resolve({ settled: false });
      },
    );
  });

export type InstallationCommandReceipt = {
  index: number;
  scope: "observed-posix-group" | "windows-direct-child";
  pid: number | null;
  pgid: number | null;
  phase: "spawned" | "finished";
  exitCode: number | null;
  signal: string | null;
  exited: boolean;
  closed: boolean;
  group: "unknown" | "present" | "absent";
  reason:
    | "running"
    | "exit"
    | "deadline"
    | "output-limit"
    | "spawn-failed"
    | "cancelled"
    | "observation-failed";
};
/** One lifecycle owner for CLI verification, never a GUI launcher or arbitrary group reaper. */
export const createInstallationCommandRunner = ({
  cwd,
  environment,
  persist,
  timeoutMs = 120000,
  maximumBytes = outputLimit,
  observe = observeInstallationProcesses,
  platform = process.platform,
}: {
  cwd: string;
  environment: NodeJS.ProcessEnv;
  persist: (receipts: readonly InstallationCommandReceipt[]) => Promise<void>;
  timeoutMs?: number;
  maximumBytes?: number;
  observe?: () => Promise<Map<number, ProcessIdentity>>;
  platform?: NodeJS.Platform;
}) => {
  if (!["darwin", "linux", "win32"].includes(platform))
    throw new Error(
      "CLI process identity verification is unavailable on this platform.",
    );
  if (
    !Number.isSafeInteger(timeoutMs) ||
    timeoutMs < 10 ||
    timeoutMs > 120000 ||
    !Number.isSafeInteger(maximumBytes) ||
    maximumBytes < 64 ||
    maximumBytes > outputLimit
  )
    throw new Error("Invalid bounded installation command limits.");
  const receipts: InstallationCommandReceipt[] = [];
  let active = false;
  const run = async (
    command: string,
    arguments_: string[],
  ): Promise<{ stdout: string; stderr: string }> => {
    if (active) throw new Error("Installation commands must be serial.");
    active = true;
    const child = spawn(command, arguments_, {
      cwd,
      env: environment,
      detached: platform !== "win32",
      stdio: ["ignore", "pipe", "pipe"],
    });
    const receipt: InstallationCommandReceipt = {
      index: receipts.length,
      scope:
        platform === "win32" ? "windows-direct-child" : "observed-posix-group",
      pid: child.pid ?? null,
      pgid: platform === "win32" ? null : (child.pid ?? null),
      phase: "spawned",
      exitCode: null,
      signal: null,
      exited: false,
      closed: false,
      group: "unknown",
      reason: "running",
    };
    receipts.push(receipt);
    const captured = new Map<number, ProcessIdentity>();
    let stdout = Buffer.alloc(0),
      stderr = Buffer.alloc(0),
      interrupted = false;
    const deadline = performance.now() + timeoutMs;
    const interrupt = (reason: InstallationCommandReceipt["reason"]) => {
      interrupted = true;
      if (receipt.reason === "running") receipt.reason = reason;
      // ChildProcess tracks this exact live child; never signal a closed/exited/reused PID.
      if (
        !receipt.exited &&
        !receipt.closed &&
        child.exitCode === null &&
        child.signalCode === null
      ) {
        try {
          child.kill("SIGTERM");
        } catch {
          receipt.group = "unknown";
        }
      }
    };
    const onSignal = () => interrupt("cancelled");
    for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"] as const)
      process.on(signal, onSignal);
    child.once("error", () => {
      receipt.reason = "spawn-failed";
    });
    child.once("exit", (code, signal) => {
      receipt.exited = true;
      receipt.exitCode = code;
      receipt.signal = signal;
    });
    child.once("close", (code, signal) => {
      receipt.closed = true;
      receipt.exitCode = code;
      receipt.signal = signal;
    });
    const append = (which: "stdout" | "stderr", bytes: Buffer) => {
      const existing = which === "stdout" ? stdout : stderr;
      if (existing.length + bytes.length > maximumBytes)
        return interrupt("output-limit");
      if (which === "stdout") stdout = Buffer.concat([existing, bytes]);
      else stderr = Buffer.concat([existing, bytes]);
    };
    child.stdout.on("data", (bytes: Buffer) => append("stdout", bytes));
    child.stderr.on("data", (bytes: Buffer) => append("stderr", bytes));
    const timer = setTimeout(() => interrupt("deadline"), timeoutMs);
    let latestRows = new Map<number, ProcessIdentity>();
    let pendingObservation: Promise<Map<number, ProcessIdentity>> | null = null;
    let pendingPersistence: Promise<void> | null = null;
    const persistBounded = async () => {
      if (!pendingPersistence) {
        const current = Promise.resolve().then(() => persist(receipts));
        pendingPersistence = current;
        void current.then(
          () => {
            if (pendingPersistence === current) pendingPersistence = null;
          },
          () => {
            if (pendingPersistence === current) pendingPersistence = null;
          },
        );
      }
      // This bounds waiting, not physical filesystem/kernel completion. Uncertainty retains the profile.
      if (!(await settleWithin(pendingPersistence, 1000)).settled)
        throw new Error("Lifecycle persistence unconfirmed.");
    };
    const inspect = async () => {
      // Keep bounded direct-child Windows execution; no maintained descendant observer exists.
      if (platform === "win32") {
        receipt.group = "unknown";
        return true;
      }
      try {
        if (!pendingObservation) {
          const current = Promise.resolve().then(observe);
          pendingObservation = current;
          void current.then(
            () => {},
            () => {
              if (pendingObservation === current) pendingObservation = null;
            },
          );
        }
        const current = pendingObservation;
        const sample = await settleWithin(current, 100);
        if (!sample.settled) {
          receipt.group = "unknown";
          return false;
        }
        pendingObservation = null;
        const rows = sample.value;
        latestRows = rows;
        const root = child.pid ? rows.get(child.pid) : undefined;
        const previous = child.pid ? captured.get(child.pid) : undefined;
        if (previous && root && !processTools.same(previous, root)) {
          receipt.group = "unknown";
          return false;
        }
        processTools.collect(
          rows,
          captured,
          child.pid && !receipt.exited ? [child.pid] : [],
        );
        receipt.group =
          child.pid && [...rows.values()].some((row) => row.pgid === child.pid)
            ? "present"
            : child.pid
              ? "absent"
              : "unknown";
        return true;
      } catch {
        receipt.group = "unknown";
        return false;
      }
    };
    let failed = false;
    try {
      // Persist exact direct-child PID/PGID before any exit/closure assertion can throw.
      await persistBounded();
      while (!receipt.closed && !interrupted) {
        await inspect();
        if (performance.now() >= deadline) interrupt("deadline");
        if (!receipt.closed && !interrupted) await delay(25);
      }
    } catch {
      failed = true;
      interrupt("observation-failed");
    } finally {
      // Every post-spawn failure shares this cleanup path, including persistence failure.
      const cleanupStarted = performance.now();
      const closureDeadline = cleanupStarted + 3000;
      let killedChild = false;
      do {
        const known = await inspect();
        if (
          receipt.closed &&
          (platform === "win32" || (receipt.group === "absent" && known))
        )
          break;
        if (interrupted) {
          // The captured ChildProcess is authoritative only until its known exit.
          if (
            !killedChild &&
            performance.now() >= cleanupStarted + 1000 &&
            !receipt.exited &&
            !receipt.closed &&
            child.exitCode === null &&
            child.signalCode === null
          ) {
            killedChild = true;
            try {
              child.kill("SIGKILL");
            } catch {
              receipt.group = "unknown";
            }
          }
          if (known && platform !== "win32") {
            for (const identity of [...captured.values()].reverse()) {
              if (
                identity.pid === child.pid ||
                !processTools.same(identity, latestRows.get(identity.pid))
              )
                continue;
              try {
                process.kill(
                  identity.pid,
                  performance.now() >= cleanupStarted + 1500
                    ? "SIGKILL"
                    : "SIGTERM",
                );
              } catch (error) {
                if ((error as NodeJS.ErrnoException).code !== "ESRCH")
                  receipt.group = "unknown";
              }
            }
          }
        }
        await delay(25);
      } while (performance.now() < closureDeadline);
      clearTimeout(timer);
      for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"] as const)
        process.off(signal, onSignal);
      if (receipt.reason === "running")
        receipt.reason =
          platform !== "win32" && receipt.group === "unknown"
            ? "observation-failed"
            : "exit";
      receipt.phase = "finished";
      if (!receipt.closed) {
        // Explicit uncertainty retention must not leave this verifier's event loop hostage
        // to inherited pipes. Do not destroy streams or claim descendant cleanup.
        child.unref();
        for (const stream of [child.stdout, child.stderr])
          (stream as typeof stream & { unref?: () => void }).unref?.();
      }
      try {
        await persistBounded();
      } catch {
        failed = true;
      }
      active = !(
        receipt.exited &&
        receipt.closed &&
        (platform === "win32" || receipt.group === "absent")
      );
    }
    if (
      failed ||
      receipt.reason !== "exit" ||
      receipt.exitCode !== 0 ||
      receipt.signal !== null ||
      !receipt.exited ||
      !receipt.closed ||
      (platform !== "win32" && receipt.group !== "absent")
    )
      throw new Error(
        "Bounded installation command failed or closure is unconfirmed; its private profile and lifecycle receipt are retained.",
      );
    return { stdout: stdout.toString("utf8"), stderr: stderr.toString("utf8") };
  };
  return { run, receipts };
};

export const canRemoveInstallationProfile = (
  uninstallConfirmed: boolean,
  receipts: readonly InstallationCommandReceipt[],
): boolean =>
  uninstallConfirmed &&
  receipts.length > 0 &&
  receipts.every(
    (receipt) =>
      receipt.reason === "exit" &&
      receipt.exitCode === 0 &&
      receipt.signal === null &&
      receipt.exited &&
      receipt.closed &&
      receipt.group === "absent",
  );

export const assertArchiveContents = (entries: readonly string[]): void => {
  const required = [
    "[Content_Types].xml",
    "extension.vsixmanifest",
    "extension/package.json",
    "extension/dist/src/extension.js",
    "extension/readme.md",
    "extension/LICENSE.txt",
    "extension/PRIVACY.md",
    "extension/SECURITY.md",
    "extension/SUPPORT.md",
    "extension/changelog.md",
    "extension/media/rehearsal.svg",
    "extension/media/rehearsal-readme.png",
    "extension/media/workspace.css",
  ];
  for (const path of required) {
    if (!entries.includes(path)) {
      throw new Error(`Packaged extension is missing ${path}.`);
    }
  }

  const publicFiles = new Set(required);
  const unexpected = entries.filter(
    (path) =>
      !publicFiles.has(path) &&
      !/^extension\/dist\/src\/[a-z][a-z0-9_]*\.js$/u.test(path),
  );
  if (unexpected.length > 0 || new Set(entries).size !== entries.length) {
    throw new Error(
      "Packaged extension contains unexpected or duplicate files outside the public runtime allowlist.",
    );
  }
};

const main = async (): Promise<void> => {
  const temporaryRoot = await mkdtemp(
    resolve(tmpdir(), "rehearsal-vscode-private-install-"),
  );
  await chmod(temporaryRoot, 0o700);
  const environment = { ...process.env };
  for (const key of ["VSCODE_IPC_HOOK_CLI", "VSCODE_PORTABLE"])
    delete environment[key];
  const lifecycle = createInstallationCommandRunner({
    cwd: repositoryRoot,
    environment,
    persist: async (receipts) => {
      await writeFile(
        resolve(temporaryRoot, "command-lifecycle.json"),
        JSON.stringify({ schemaVersion: 1, receipts }, null, 2) + "\n",
        { mode: 0o600 },
      );
    },
  });
  const run = lifecycle.run;
  let uninstallConfirmed = false;
  const suppliedCandidate = process.argv[2];
  const previousCandidate = process.argv[3]
    ? resolve(process.cwd(), process.argv[3]!)
    : undefined;
  const expectedManifest = JSON.parse(
    await readFile(resolve(repositoryRoot, "package.json"), "utf8"),
  ) as ExtensionManifest;
  const expectedIdentity = `${String(expectedManifest.publisher)}.${String(expectedManifest.name)}@${String(expectedManifest.version)}`;
  const vsixPath = suppliedCandidate
    ? resolve(process.cwd(), suppliedCandidate)
    : resolve(
        temporaryRoot,
        `rehearsal-${String(expectedManifest.version)}.vsix`,
      );
  const userDataPath = resolve(temporaryRoot, "user-data");
  const extensionsPath = resolve(temporaryRoot, "extensions");

  try {
    if (!suppliedCandidate) {
      await run("npm", ["run", "package:vsix", "--", "--out", vsixPath]);
    }

    const archive = await readFile(vsixPath);
    const sha256 = createHash("sha256").update(archive).digest("hex");
    const { stdout: archiveOutput } = await run("unzip", ["-Z1", vsixPath]);
    const entries = archiveOutput.split(/\r?\n/u).filter(Boolean);
    assertArchiveContents(entries);

    const { stdout: manifestOutput } = await run("unzip", [
      "-p",
      vsixPath,
      "extension/package.json",
    ]);
    const manifest = JSON.parse(manifestOutput) as ExtensionManifest;
    if (
      manifest.publisher !== expectedManifest.publisher ||
      manifest.name !== expectedManifest.name ||
      manifest.version !== expectedManifest.version ||
      manifest.license !== "SEE LICENSE IN LICENSE" ||
      manifest.preview !== true ||
      manifest.pricing !== "Free"
    ) {
      throw new Error(
        `Packaged extension metadata does not match ${expectedIdentity}.`,
      );
    }

    let upgradeFrom: string | null = null;
    if (previousCandidate) {
      const { stdout: previousManifestOutput } = await run("unzip", [
        "-p",
        previousCandidate,
        "extension/package.json",
      ]);
      const previousManifest = JSON.parse(
        previousManifestOutput,
      ) as ExtensionManifest;
      upgradeFrom = `${String(previousManifest.publisher)}.${String(previousManifest.name)}@${String(previousManifest.version)}`;
      if (
        previousManifest.publisher !== expectedManifest.publisher ||
        previousManifest.name !== expectedManifest.name ||
        previousManifest.version === expectedManifest.version
      ) {
        throw new Error(
          "The previous VSIX must have the same extension identity and a different version.",
        );
      }
      await run(vscodeCli, [
        "--user-data-dir",
        userDataPath,
        "--extensions-dir",
        extensionsPath,
        "--install-extension",
        previousCandidate,
        "--force",
      ]);
    }

    await run(vscodeCli, [
      "--user-data-dir",
      userDataPath,
      "--extensions-dir",
      extensionsPath,
      "--install-extension",
      vsixPath,
      "--force",
    ]);
    const { stdout: installedOutput } = await run(vscodeCli, [
      "--user-data-dir",
      userDataPath,
      "--extensions-dir",
      extensionsPath,
      "--list-extensions",
      "--show-versions",
    ]);
    const installed = installedOutput
      .split(/\r?\n/u)
      .map((entry) => entry.trim())
      .filter(Boolean);
    if (!installed.includes(expectedIdentity)) {
      throw new Error(
        `Isolated VS Code installation did not report ${expectedIdentity} (received: ${installed.join(", ") || "nothing"}).`,
      );
    }

    await run(vscodeCli, [
      "--user-data-dir",
      userDataPath,
      "--extensions-dir",
      extensionsPath,
      "--uninstall-extension",
      `${String(expectedManifest.publisher)}.${String(expectedManifest.name)}`,
    ]);
    const { stdout: uninstalledOutput } = await run(vscodeCli, [
      "--user-data-dir",
      userDataPath,
      "--extensions-dir",
      extensionsPath,
      "--list-extensions",
      "--show-versions",
    ]);
    const afterUninstall = uninstalledOutput
      .split(/\r?\n/u)
      .map((entry) => entry.trim())
      .filter(Boolean);
    if (
      afterUninstall.some((entry) =>
        entry.startsWith(
          `${String(expectedManifest.publisher)}.${String(expectedManifest.name)}@`,
        ),
      )
    ) {
      throw new Error("Isolated VS Code uninstall left Rehearsal installed.");
    }

    uninstallConfirmed = true;
    console.log(
      JSON.stringify(
        {
          status: "passed",
          extension: expectedIdentity,
          sha256,
          bytes: archive.byteLength,
          files: entries.length,
          candidate: suppliedCandidate
            ? vsixPath
            : "generated for verification",
          upgradeFrom,
          vscodeCli,
          commandLifecycle: lifecycle.receipts,
          processCleanupScope:
            process.platform === "win32"
              ? "direct-child-only-descendants-unverified-profile-retained"
              : "observed-owned-posix-groups",
          isolation: {
            userData: true,
            extensions: true,
            uninstall: true,
          },
        },
        null,
        2,
      ),
    );
  } finally {
    if (canRemoveInstallationProfile(uninstallConfirmed, lifecycle.receipts))
      await rm(temporaryRoot, { recursive: true, force: true });
    else
      console.error(
        `Private verification profile retained for recovery: ${temporaryRoot}`,
      );
  }
};

if (require.main === module)
  void main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
