import { spawn } from "node:child_process";
import { readFile, realpath, stat } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
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

export type AdapterFailureCode =
  | "package_missing"
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

interface PackageManifest {
  readonly name?: unknown;
  readonly version?: unknown;
  readonly bin?: unknown;
}

export interface ResolvedRehearsal {
  readonly packageRoot: string;
  readonly manifestPath: string;
  readonly binPath: string;
  readonly version: string;
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
  if (typeof bin === "string") return bin;
  if (bin && typeof bin === "object" && !Array.isArray(bin)) {
    const entry = (bin as Record<string, unknown>).rehearsal;
    return typeof entry === "string" ? entry : undefined;
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
      "package_invalid",
      "The workspace Rehearsal package resolves outside its repository.",
    );
  }
  const manifestPath = join(packageRoot, "package.json");
  let manifest: PackageManifest;
  try {
    manifest = JSON.parse(
      await readFile(manifestPath, "utf8"),
    ) as PackageManifest;
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
  const binPath = resolve(packageRoot, declaredBin);
  if (!inside(packageRoot, binPath)) {
    throw new AdapterError(
      "package_invalid",
      "The workspace Rehearsal package declares a CLI outside its package.",
    );
  }
  try {
    const metadata = await stat(binPath);
    if (!metadata.isFile()) throw new Error("not a file");
  } catch {
    throw new AdapterError(
      "package_invalid",
      "The workspace Rehearsal CLI file is missing.",
    );
  }
  return { packageRoot, manifestPath, binPath, version: manifest.version };
};

const ALLOWED_ENVIRONMENT = new Set([
  "COLIMA_HOME",
  "DOCKER_CONFIG",
  "DOCKER_CONTEXT",
  "DOCKER_HOST",
  "HOME",
  "LANG",
  "LC_ALL",
  "PATH",
  "TMPDIR",
  "USER",
  "XDG_CONFIG_HOME",
  "XDG_DATA_HOME",
  "XDG_RUNTIME_DIR",
]);

export const editorEnvironment = (
  source: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv => ({
  ...Object.fromEntries(
    Object.entries(source).filter(
      ([key, value]) => ALLOWED_ENVIRONMENT.has(key) && value !== undefined,
    ),
  ),
  NO_COLOR: "1",
  REHEARSAL_EDITOR_CLIENT: "1",
});

const stopOwnedProcess = (
  child: ReturnType<typeof spawn>,
  signal: NodeJS.Signals,
) => {
  if (!child.pid || child.exitCode !== null) return;
  if (process.platform !== "win32") {
    try {
      process.kill(-child.pid, signal);
      return;
    } catch {
      // Fall back to the direct process below.
    }
  }
  child.kill(signal);
};

const runProcess = async ({
  binPath,
  arguments: arguments_,
  cwd,
  environment,
  signal,
  timeoutMs,
  outputLimitBytes,
}: {
  readonly binPath: string;
  readonly arguments: readonly string[];
  readonly cwd: string;
  readonly environment: NodeJS.ProcessEnv;
  readonly signal?: AbortSignal;
  readonly timeoutMs: number;
  readonly outputLimitBytes: number;
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
    const stop = (error: AdapterError) => {
      reason ??= error;
      stopOwnedProcess(child, "SIGTERM");
      setTimeout(() => stopOwnedProcess(child, "SIGKILL"), 500).unref();
    };
    const timeout = setTimeout(
      () =>
        stop(new AdapterError("timeout", "Rehearsal inspection timed out.")),
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
    child.once("error", () => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      signal?.removeEventListener("abort", onAbort);
      reject(
        reason ??
          new AdapterError(
            "process_failed",
            "The Rehearsal process could not start.",
          ),
      );
    });
    child.once("close", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      signal?.removeEventListener("abort", onAbort);
      if (reason) {
        reject(reason);
        return;
      }
      resolvePromise({
        stdout: Buffer.concat(stdout).toString("utf8"),
        stderrBytes,
        exitCode: code ?? 10,
      });
    });
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
  options: Pick<RunOptions, "signal" | "environment"> = {},
): Promise<VersionResult> => {
  const resolved = await resolveWorkspaceRehearsal(workspaceRoot);
  const execution = await runProcess({
    binPath: resolved.binPath,
    arguments: ["--version", "--json"],
    cwd: workspaceRoot,
    environment: editorEnvironment(options.environment),
    ...(options.signal ? { signal: options.signal } : {}),
    timeoutMs: 5_000,
    outputLimitBytes: DEFAULT_OUTPUT_LIMIT,
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
  const execution = await runProcess({
    binPath: resolved.binPath,
    arguments: arguments_,
    cwd: options.workspaceRoot,
    environment: editorEnvironment(options.environment),
    ...(options.signal ? { signal: options.signal } : {}),
    timeoutMs: options.timeoutMs ?? 60_000,
    outputLimitBytes: options.outputLimitBytes ?? DEFAULT_OUTPUT_LIMIT,
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
