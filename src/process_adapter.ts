import { spawn } from "node:child_process";
import { constants } from "node:fs";
import { open, realpath, stat } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { performance } from "node:perf_hooks";
import { createHash } from "node:crypto";
import { parseEngineShutdownResult } from "./engine_lifecycle_contract.js";
import { infrastructureEnvironment } from "./platform_runtime.js";
import {
  ContractError,
  parseEnvelope,
  parseJson,
  parseVersionResult,
} from "./contracts.js";
import type {
  ErrorEnvelope,
  ResultEnvelope,
  VersionResult,
} from "./contracts.js";

const PACKAGE_NAME = "@rehearsal-db/core";
const DEFAULT_OUTPUT_LIMIT = 1024 * 1024;
const MAXIMUM_MANIFEST_BYTES = 1024 * 1024;

export type AdapterFailureCode =
  | "platform_unsupported"
  | "package_missing"
  | "package_link_external"
  | "package_invalid"
  | "config_outside_workspace"
  | "process_failed"
  | "output_limit"
  | "timeout"
  | "cancelled"
  | "invalid_cli_contract";

export class AdapterError extends Error {
  constructor(
    readonly code: AdapterFailureCode,
    message: string,
    readonly exitCode?: number,
  ) {
    super(message);
    this.name = "AdapterError";
  }
}

export class RehearsalCliError extends Error {
  constructor(
    readonly result: ErrorEnvelope,
    readonly exitCode: number,
  ) {
    super(result.error.message);
    this.name = "RehearsalCliError";
  }
}

export const assertInspectionPlatform = (
  platform: NodeJS.Platform = process.platform,
): void => {
  if (platform === "win32")
    throw new AdapterError(
      "platform_unsupported",
      "Native Windows Rehearsal inspection is not supported by this extension. Open VS Code with Remote - WSL in a WSL 2 Linux distribution, keep the project in that distribution's Linux home directory, and install Rehearsal in WSL. No inspection process was started.",
    );
};

interface PackageManifest {
  readonly name?: unknown;
  readonly version?: unknown;
  readonly bin?: unknown;
  readonly rehearsalContracts?: unknown;
}

export interface ResolvedRehearsal {
  readonly packageRoot: string;
  readonly manifestPath: string;
  readonly binPath: string;
  readonly version: string;
  readonly projectDiscoverySchema: 1 | null;
  readonly resourceInventorySchema: 1 | null;
  readonly resourceManagerSchema: 1 | null;
  readonly migrationReviewSchema: 1 | null;
  readonly migrationInsightsSchema: 1 | null;
  readonly configurationReviewSchema: 1 | null;
  readonly engineLifecycleSchema: 1 | null;
}

export interface RunOptions {
  readonly workspaceRoot: string;
  readonly command: readonly string[];
  readonly expectedCommand: string;
  readonly configPath?: string;
  readonly signal?: AbortSignal;
  readonly timeoutMs?: number;
  readonly outputLimitBytes?: number;
  readonly environment?: NodeJS.ProcessEnv;
}

export interface CliExecution<Data> {
  readonly result: ResultEnvelope<Data>;
  readonly exitCode: number;
}

const inside = (parent: string, child: string): boolean => {
  const path = relative(parent, child);
  return path === "" || (!path.startsWith(`..${sep}`) && path !== "..");
};

const binFromManifest = (bin: unknown): string | undefined => {
  const bounded = (value: unknown): string | undefined =>
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= 1000 &&
    !/[\x00-\x1f\x7f]/u.test(value)
      ? value
      : undefined;
  if (typeof bin === "string") return bounded(bin);
  if (bin && typeof bin === "object" && !Array.isArray(bin)) {
    const entry = (bin as Record<string, unknown>).rehearsal;
    return bounded(entry);
  }
  return undefined;
};

const pathExists = async (path: string): Promise<boolean> => {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
};

/** Read through a bounded handle and reject final or ancestor link escapes. */
const readPackageManifest = async (
  packageRoot: string,
  manifestPath: string,
): Promise<PackageManifest> => {
  const canonical = await realpath(manifestPath);
  if (!inside(packageRoot, canonical))
    throw new Error("manifest outside package");
  const handle = await open(
    canonical,
    constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
  );
  try {
    const details = await handle.stat();
    if (!details.isFile() || details.size > MAXIMUM_MANIFEST_BYTES)
      throw new Error("manifest exceeds bounded regular-file contract");
    const bytes = Buffer.alloc(MAXIMUM_MANIFEST_BYTES + 1);
    let offset = 0;
    while (offset < bytes.length) {
      const result = await handle.read(
        bytes,
        offset,
        bytes.length - offset,
        null,
      );
      if (!result.bytesRead) break;
      offset += result.bytesRead;
    }
    if (offset > MAXIMUM_MANIFEST_BYTES)
      throw new Error("manifest grew beyond bounded contract");
    const parsed: unknown = JSON.parse(
      bytes.subarray(0, offset).toString("utf8"),
    );
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
      throw new Error("manifest must be an object");
    return parsed as PackageManifest;
  } finally {
    await handle.close();
  }
};

const packageSearch = async (
  workspaceRoot: string,
): Promise<{
  readonly roots: readonly string[];
  readonly boundary: string;
}> => {
  const roots: string[] = [];
  let current = workspaceRoot;
  while (true) {
    roots.push(current);
    if (await pathExists(join(current, ".git"))) {
      return { roots, boundary: current };
    }
    const parent = dirname(current);
    if (parent === current) {
      // Without a repository boundary, borrowing a package from an arbitrary
      // ancestor would be surprising. Keep resolution local to the workspace.
      return { roots: [workspaceRoot], boundary: workspaceRoot };
    }
    current = parent;
  }
};

export const resolveWorkspaceRehearsal = async (
  workspaceRoot: string,
): Promise<ResolvedRehearsal> => {
  const root = await realpath(workspaceRoot);
  const search = await packageSearch(root);
  let declaredPackageRoot: string | undefined;
  for (const candidate of search.roots) {
    const packageRoot = join(
      candidate,
      "node_modules",
      "@rehearsal-db",
      "core",
    );
    if (await pathExists(join(packageRoot, "package.json"))) {
      declaredPackageRoot = packageRoot;
      break;
    }
  }
  if (!declaredPackageRoot) {
    throw new AdapterError(
      "package_missing",
      "Install @rehearsal-db/core in this workspace before opening its Rehearsal overview.",
    );
  }
  const boundary = await realpath(search.boundary);
  const packageRoot = await realpath(declaredPackageRoot);
  if (!inside(boundary, packageRoot)) {
    throw new AdapterError(
      "package_link_external",
      "The workspace Rehearsal package resolves outside its repository. Install a project-local package copy before refreshing.",
    );
  }
  const manifestPath = join(packageRoot, "package.json");
  let manifest: PackageManifest;
  try {
    manifest = await readPackageManifest(packageRoot, manifestPath);
  } catch {
    throw new AdapterError(
      "package_invalid",
      "The workspace Rehearsal package manifest could not be read.",
    );
  }
  if (manifest.name !== PACKAGE_NAME || typeof manifest.version !== "string") {
    throw new AdapterError(
      "package_invalid",
      "The workspace package at @rehearsal-db/core has invalid metadata.",
    );
  }
  const declaredBin = binFromManifest(manifest.bin);
  if (!declaredBin) {
    throw new AdapterError(
      "package_invalid",
      "The workspace Rehearsal package does not declare its public CLI.",
    );
  }
  const declaredBinPath = resolve(packageRoot, declaredBin);
  if (!inside(packageRoot, declaredBinPath)) {
    throw new AdapterError(
      "package_invalid",
      "The workspace Rehearsal package declares a CLI outside its package.",
    );
  }
  let binPath: string;
  try {
    binPath = await realpath(declaredBinPath);
    if (!inside(packageRoot, binPath))
      throw new Error("bin link outside package");
    const metadata = await stat(binPath);
    if (!metadata.isFile()) throw new Error("not a file");
  } catch {
    throw new AdapterError(
      "package_invalid",
      "The workspace Rehearsal CLI must resolve to a regular file inside its package.",
    );
  }
  const contracts =
    manifest.rehearsalContracts &&
    typeof manifest.rehearsalContracts === "object" &&
    !Array.isArray(manifest.rehearsalContracts)
      ? (manifest.rehearsalContracts as Record<string, unknown>)
      : {};
  return {
    packageRoot,
    manifestPath,
    binPath,
    version: manifest.version,
    projectDiscoverySchema: contracts.projectDiscovery === 1 ? 1 : null,
    resourceInventorySchema: contracts.resourceInventory === 1 ? 1 : null,
    resourceManagerSchema: contracts.resourceManager === 1 ? 1 : null,
    migrationReviewSchema: contracts.migrationReview === 1 ? 1 : null,
    migrationInsightsSchema: contracts.migrationInsights === 1 ? 1 : null,
    configurationReviewSchema: contracts.configurationReview === 1 ? 1 : null,
    engineLifecycleSchema: contracts.containerEngineLifecycle === 1 ? 1 : null,
  };
};

export const editorEnvironment = (
  source: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
): NodeJS.ProcessEnv => ({
  ...infrastructureEnvironment(source, platform),
  NO_COLOR: "1",
  REHEARSAL_EDITOR_CLIENT: "1",
});

/** Preserve explicit lifecycle selectors for Core validation, including refusal signals. */
export const engineLifecycleEnvironment = (
  source: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv => {
  const environment = editorEnvironment(source);
  for (const key of [
    "DOCKER_TLS",
    "DOCKER_TLS_VERIFY",
    "DOCKER_CERT_PATH",
    "LIMA_HOME",
    "COLIMA_PROFILE",
    "REHEARSAL_USER_STATE_DIRECTORY",
  ])
    if (source[key] !== undefined) environment[key] = source[key];
  return environment;
};

const stopOwnedProcess = (
  child: ReturnType<typeof spawn>,
  signal: NodeJS.Signals,
) => {
  if (!child.pid) return;
  if (process.platform !== "win32") {
    try {
      process.kill(-child.pid, signal);
      return;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ESRCH") return;
      // Fall back only to the still-running direct process we started.
    }
  }
  if (child.exitCode === null && child.signalCode === null) {
    try {
      child.kill(signal);
    } catch {
      // Bounded group revalidation below reports any workload that remains.
    }
  }
};

type OwnedProcessState = "present" | "absent" | "unknown";

export const ownedProcessState = (
  child: Pick<ReturnType<typeof spawn>, "pid" | "exitCode" | "signalCode">,
  killImplementation: typeof process.kill = process.kill,
  platform: NodeJS.Platform = process.platform,
): OwnedProcessState => {
  if (!child.pid) return "absent";
  if (platform === "win32")
    return child.exitCode === null && child.signalCode === null
      ? "present"
      : "unknown";
  try {
    // The detached group's identity does not expire when its launcher exits.
    killImplementation(-child.pid, 0);
    return "present";
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "ESRCH"
      ? "absent"
      : "unknown";
  }
};

/** Unknown probes permit bounded read-only convergence, never another signal. */
export const retireOwnedProcessGroup = async ({
  probe,
  send,
  now = () => performance.now(),
  pause = (milliseconds) =>
    new Promise<void>((resolvePromise) =>
      setTimeout(resolvePromise, milliseconds),
    ),
}: {
  readonly probe: () => OwnedProcessState;
  readonly send: (signal: "SIGTERM" | "SIGKILL") => void;
  readonly now?: () => number;
  readonly pause?: (milliseconds: number) => Promise<void>;
}): Promise<void> => {
  const waitUntilGone = async (): Promise<OwnedProcessState> => {
    const deadline = now() + 500;
    let state = probe();
    while (state !== "absent" && now() < deadline) {
      await pause(10);
      state = probe();
    }
    return state;
  };
  let state = probe();
  if (state === "absent") return;
  if (state === "present") {
    send("SIGTERM");
    state = await waitUntilGone();
    if (state === "present") {
      send("SIGKILL");
      state = await waitUntilGone();
    }
  } else state = await waitUntilGone();
  if (state !== "absent")
    throw new AdapterError(
      "process_failed",
      "Owned Rehearsal inspection process-group cleanup is unverified; no further signals were sent. Review before retrying. No unrelated process was signalled.",
    );
};

const retireOwnedProcess = (child: ReturnType<typeof spawn>): Promise<void> => {
  return retireOwnedProcessGroup({
    probe: () => ownedProcessState(child),
    send: (signal) => stopOwnedProcess(child, signal),
  });
};

const runProcess = async ({
  binPath,
  arguments: arguments_,
  cwd,
  environment,
  signal,
  timeoutMs,
  outputLimitBytes,
  timeoutMessage,
}: {
  readonly binPath: string;
  readonly arguments: readonly string[];
  readonly cwd: string;
  readonly environment: NodeJS.ProcessEnv;
  readonly signal?: AbortSignal;
  readonly timeoutMs: number;
  readonly outputLimitBytes: number;
  readonly timeoutMessage: string;
}): Promise<{ stdout: string; stderrBytes: number; exitCode: number }> =>
  new Promise((resolvePromise, reject) => {
    if (signal?.aborted) {
      reject(new AdapterError("cancelled", "Rehearsal refresh was cancelled."));
      return;
    }
    const child = spawn(process.execPath, [binPath, ...arguments_], {
      cwd,
      env: {
        ...environment,
        // VS Code's extension host exposes its Electron helper as process.execPath.
        // This explicit, extension-owned flag makes that helper execute the public
        // Rehearsal CLI as Node without trusting an ambient override.
        ELECTRON_RUN_AS_NODE: "1",
      },
      shell: false,
      detached: process.platform !== "win32",
      stdio: ["ignore", "pipe", "pipe"],
    });
    const stdout: Buffer[] = [];
    let stdoutBytes = 0;
    let stderrBytes = 0;
    let settled = false;
    let reason: AdapterError | undefined;
    let retirement: Promise<void> | undefined;
    const retire = () => (retirement ??= retireOwnedProcess(child));
    const complete = async (code: number | null, failedToStart = false) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      signal?.removeEventListener("abort", onAbort);
      try {
        await retire();
        if (reason) reject(reason);
        else if (failedToStart)
          reject(
            new AdapterError(
              "process_failed",
              "The Rehearsal process could not start.",
            ),
          );
        else
          resolvePromise({
            stdout: Buffer.concat(stdout).toString("utf8"),
            stderrBytes,
            exitCode: code ?? 10,
          });
      } catch (error) {
        reject(reason ?? error);
      } finally {
        child.stdout.destroy();
        child.stderr.destroy();
      }
    };
    const stop = (error: AdapterError) => {
      if (settled) return;
      reason ??= error;
      void complete(null);
    };
    const timeout = setTimeout(
      () => stop(new AdapterError("timeout", timeoutMessage)),
      timeoutMs,
    );
    const onAbort = () =>
      stop(new AdapterError("cancelled", "Rehearsal refresh was cancelled."));
    signal?.addEventListener("abort", onAbort, { once: true });
    child.stdout.on("data", (chunk: Buffer) => {
      stdoutBytes += chunk.length;
      if (stdoutBytes > outputLimitBytes) {
        stop(
          new AdapterError(
            "output_limit",
            "Rehearsal returned more data than the editor can safely display.",
          ),
        );
        return;
      }
      stdout.push(chunk);
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderrBytes += chunk.length;
      if (stderrBytes > outputLimitBytes) {
        stop(
          new AdapterError(
            "output_limit",
            "Rehearsal diagnostic output exceeded the editor safety limit.",
          ),
        );
      }
    });
    child.once("error", () => void complete(null, true));
    child.once("exit", () => {
      // `close` may be held open by descendants that inherited a stdio pipe.
      // Retire this exact owned group even after its launcher has exited.
      void retire().catch(() => undefined);
    });
    child.once("close", (code) => void complete(code));
  });

const validatedConfigArgument = async (
  workspaceRoot: string,
  configPath: string | undefined,
): Promise<string | undefined> => {
  if (!configPath) return undefined;
  if (isAbsolute(configPath)) {
    throw new AdapterError(
      "config_outside_workspace",
      "Use a project-relative Rehearsal configuration path.",
    );
  }
  const root = await realpath(workspaceRoot);
  const target = resolve(root, configPath);
  if (!inside(root, target)) {
    throw new AdapterError(
      "config_outside_workspace",
      "The Rehearsal configuration must stay inside its workspace folder.",
    );
  }
  return configPath;
};

export const runVersion = async (
  workspaceRoot: string,
  options: Pick<RunOptions, "signal" | "environment" | "timeoutMs"> = {},
): Promise<VersionResult> => {
  assertInspectionPlatform();
  const timeoutMs = options.timeoutMs ?? 90_000;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 300_000)
    throw new AdapterError(
      "invalid_cli_contract",
      "Version inspection needs a bounded timeout of at most 300 seconds.",
    );
  const resolved = await resolveWorkspaceRehearsal(workspaceRoot);
  const execution = await runProcess({
    binPath: resolved.binPath,
    arguments: ["--version", "--json"],
    cwd: workspaceRoot,
    environment: editorEnvironment(options.environment),
    ...(options.signal ? { signal: options.signal } : {}),
    timeoutMs,
    outputLimitBytes: DEFAULT_OUTPUT_LIMIT,
    timeoutMessage: `The Rehearsal version check took longer than ${Math.ceil(timeoutMs / 1000)} seconds.`,
  });
  if (execution.exitCode !== 0) {
    throw new AdapterError(
      "process_failed",
      "The workspace Rehearsal version check failed.",
      execution.exitCode,
    );
  }
  const version = parseVersionResult(parseJson(execution.stdout));
  if (version.version !== resolved.version) {
    throw new AdapterError(
      "invalid_cli_contract",
      "The Rehearsal manifest and CLI report different versions.",
    );
  }
  return version;
};

export const runRehearsalJson = async <Data>(
  options: RunOptions,
): Promise<CliExecution<Data>> => {
  assertInspectionPlatform();
  const resolved = await resolveWorkspaceRehearsal(options.workspaceRoot);
  const config = await validatedConfigArgument(
    options.workspaceRoot,
    options.configPath,
  );
  const arguments_ = [
    ...options.command,
    "--json",
    ...(config ? [`--config=${config}`] : []),
  ];
  const timeoutSeconds = Math.ceil((options.timeoutMs ?? 60_000) / 1_000);
  const execution = await runProcess({
    binPath: resolved.binPath,
    arguments: arguments_,
    cwd: options.workspaceRoot,
    environment:
      options.command.length === 2 &&
      options.command[0] === "engine" &&
      ["status", "stop"].includes(options.command[1] ?? "")
        ? engineLifecycleEnvironment(options.environment)
        : editorEnvironment(options.environment),
    ...(options.signal ? { signal: options.signal } : {}),
    timeoutMs: options.timeoutMs ?? 60_000,
    outputLimitBytes: options.outputLimitBytes ?? DEFAULT_OUTPUT_LIMIT,
    timeoutMessage: `The Rehearsal ${options.expectedCommand} check took longer than ${timeoutSeconds} ${timeoutSeconds === 1 ? "second" : "seconds"}.`,
  });
  let parsed: ReturnType<typeof parseEnvelope<Data>>;
  try {
    parsed = parseEnvelope<Data>(
      parseJson(execution.stdout),
      options.expectedCommand,
    );
  } catch (error) {
    if (error instanceof ContractError) {
      throw new AdapterError("invalid_cli_contract", error.message);
    }
    throw error;
  }
  if (parsed.status === "error") {
    throw new RehearsalCliError(parsed, execution.exitCode);
  }
  if (
    execution.exitCode !== 0 &&
    !(execution.exitCode === 1 && parsed.status === "not_ready")
  ) {
    throw new AdapterError(
      "process_failed",
      "Rehearsal returned an unexpected exit status.",
      execution.exitCode,
    );
  }
  return { result: parsed, exitCode: execution.exitCode };
};

/** A review binds its installed manifest and executable; paths never enter the webview. */
export const captureEnginePackageBinding = async (
  workspaceRoot: string,
): Promise<string> => {
  const resolved = await resolveWorkspaceRehearsal(workspaceRoot);
  if (resolved.engineLifecycleSchema !== 1)
    throw new AdapterError(
      "invalid_cli_contract",
      "Update Rehearsal before reviewing VM shutdown.",
    );
  const fingerprints = [];
  for (const [path, maximum] of [
    [resolved.manifestPath, MAXIMUM_MANIFEST_BYTES],
    [resolved.binPath, 2 * 1024 * 1024],
  ] as const) {
    const handle = await open(
      path,
      constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
    );
    try {
      const before = await handle.stat();
      if (!before.isFile() || before.size > maximum)
        throw new Error("Unbounded package input.");
      const bytes = Buffer.alloc(maximum + 1);
      let length = 0;
      while (length < bytes.length) {
        const part = await handle.read(
          bytes,
          length,
          bytes.length - length,
          null,
        );
        if (!part.bytesRead) break;
        length += part.bytesRead;
      }
      const after = await handle.stat();
      if (
        length !== before.size ||
        length > maximum ||
        before.dev !== after.dev ||
        before.ino !== after.ino ||
        before.mtimeMs !== after.mtimeMs ||
        before.ctimeMs !== after.ctimeMs ||
        after.size !== before.size
      )
        throw new Error("Package changed.");
      fingerprints.push({
        path,
        dev: before.dev,
        ino: before.ino,
        size: before.size,
        mtime: before.mtimeMs,
        ctime: before.ctimeMs,
        sha256: createHash("sha256")
          .update(bytes.subarray(0, length))
          .digest("hex"),
      });
    } finally {
      await handle.close();
    }
  }
  return createHash("sha256")
    .update(
      JSON.stringify({
        root: resolved.packageRoot,
        version: resolved.version,
        fingerprints,
      }),
    )
    .digest("hex");
};

/** Explicitly approved VM shutdown needs its typed outcome, including nonzero replies. */
export const runEngineShutdown = async (options: {
  workspaceRoot: string;
  confirmationDigest: string;
  packageBinding: string;
  signal?: AbortSignal;
  onDispatched?: () => void;
}) => {
  assertInspectionPlatform();
  if (
    !/^[a-f0-9]{64}$/u.test(options.confirmationDigest) ||
    (await captureEnginePackageBinding(options.workspaceRoot)) !==
      options.packageBinding
  )
    throw new AdapterError(
      "invalid_cli_contract",
      "The reviewed Rehearsal package changed. Refresh and review VM shutdown again.",
    );
  options.signal?.throwIfAborted();
  const resolved = await resolveWorkspaceRehearsal(options.workspaceRoot);
  options.onDispatched?.();
  const execution = await runProcess({
    binPath: resolved.binPath,
    arguments: [
      "engine",
      "stop",
      "--json",
      `--confirm-engine-stop=${options.confirmationDigest}`,
    ],
    cwd: options.workspaceRoot,
    environment: engineLifecycleEnvironment(),
    ...(options.signal ? { signal: options.signal } : {}),
    timeoutMs: 120_000,
    outputLimitBytes: DEFAULT_OUTPUT_LIMIT,
    timeoutMessage:
      "VM shutdown did not return a verified outcome within 120 seconds. Refresh the engine state.",
  });
  const raw = parseJson(execution.stdout);
  if (!raw || typeof raw !== "object" || Array.isArray(raw))
    throw new AdapterError(
      "invalid_cli_contract",
      "The VM shutdown outcome could not be verified. Refresh the engine state.",
    );
  const envelope = raw as Record<string, unknown>;
  if (
    envelope.schemaVersion !== 1 ||
    envelope.command !== "engine stop" ||
    envelope.rehearsalVersion !== resolved.version ||
    !["success", "error", "not_ready"].includes(String(envelope.status))
  )
    throw new AdapterError(
      "invalid_cli_contract",
      "The VM shutdown outcome could not be verified. Refresh the engine state.",
    );
  const result = parseEngineShutdownResult(envelope.data);
  const confirmed =
    (result.status === "stopped" || result.status === "already-stopped") &&
    result.confirmed.profileStopped &&
    result.confirmed.vmProcessAbsent;
  const partial =
    result.status === "already-stopped" &&
    result.confirmed.profileStopped &&
    !result.confirmed.vmProcessAbsent;
  if (
    confirmed
      ? execution.exitCode !== 0 || envelope.status !== "success"
      : partial
        ? execution.exitCode !== 1 || envelope.status !== "not_ready"
        : ![1, 130].includes(execution.exitCode) || envelope.status !== "error"
  )
    throw new AdapterError(
      "invalid_cli_contract",
      "The VM shutdown outcome contradicts its command result. Refresh the engine state.",
    );
  if (
    (await captureEnginePackageBinding(options.workspaceRoot)) !==
    options.packageBinding
  )
    throw new AdapterError(
      "invalid_cli_contract",
      "The Rehearsal package changed during VM shutdown. Its outcome needs a fresh inspection.",
    );
  return result;
};
