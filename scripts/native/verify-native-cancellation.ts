/** Opt-in native editor host; cancellation is the default, caller owns fixture setup. */
import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { constants, createReadStream } from "node:fs";
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
import {
  basename,
  dirname,
  isAbsolute,
  join,
  relative,
  resolve,
} from "node:path";
import { promisify } from "node:util";
import { setTimeout as delay } from "node:timers/promises";
import { assertArchiveContents } from "../verification/verify-private-vsix.js";
import { storageEnvironment } from "../../src/runtime/platform_runtime.js";
import {
  nativeStorageRoot,
  createNativeTemporaryDirectory,
} from "./native-development-storage.js";

const repository = resolve(__dirname, "../..");
const code =
  "/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code";
const electron = "/Applications/Visual Studio Code.app/Contents/MacOS/Code";
const execute = promisify(execFile);
const CURRENT_PUBLIC_VSIX_SHA =
  "468c17f604e65b1f64a726094a652126d1b696754833fb290c58ca4efc96cecd";
const HISTORICAL_PUBLIC_VSIX_SHA =
  "f2682714a037be5e335e471d44cd025af7dc4927f46cc87d8826cf8666c46631";
// Populate only after one reviewed local package has been frozen; never accept an arbitrary caller pin.
const HISTORICAL_PRIVATE_CONFIGURATION_GUIDANCE_SHA =
  "efeacf087f1bd2f15222a0e95c1f8add14e3d9ebbff98f34b80d76b9033855e5";
const CORE_SHA =
  "696e2289065023e109c25b812ae04d924bead0cf6c7ba34290de80063d699891";
const sha = (bytes: Uint8Array) =>
  createHash("sha256").update(bytes).digest("hex");
export type NativeScenario =
  | "cancellation"
  | "workbench-review"
  | "presentation-review"
  | "configuration-guidance"
  | "comparison-export";
export function selectNativeScenario(
  value: unknown = "cancellation",
): NativeScenario {
  assert.ok(
    value === "cancellation" ||
      value === "workbench-review" ||
      value === "presentation-review" ||
      value === "configuration-guidance" ||
      value === "comparison-export",
    "Native scenario must be cancellation, workbench-review, presentation-review, configuration-guidance or comparison-export; script paths are not accepted.",
  );
  return value;
}
export interface NativeCandidate {
  readonly version: "0.1.22" | "0.1.23";
  readonly sha256: string;
  readonly distribution: "published" | "unreleased-private";
  readonly numericRefusal: "before-review" | "on-apply";
}
/** Exact reviewed artifacts only; an arbitrary caller checksum is not provenance. */
export function nativeCandidateForScenario(
  scenario: NativeScenario,
  expectedSha: unknown = CURRENT_PUBLIC_VSIX_SHA,
): NativeCandidate {
  selectNativeScenario(scenario);
  if (expectedSha === CURRENT_PUBLIC_VSIX_SHA)
    return Object.freeze({
      version: "0.1.23",
      sha256: CURRENT_PUBLIC_VSIX_SHA,
      distribution: "published",
      numericRefusal: "before-review",
    });
  if (
    ["cancellation", "workbench-review", "presentation-review"].includes(
      scenario,
    ) &&
    expectedSha === HISTORICAL_PUBLIC_VSIX_SHA
  )
    return Object.freeze({
      version: "0.1.22",
      sha256: HISTORICAL_PUBLIC_VSIX_SHA,
      distribution: "published",
      numericRefusal: "on-apply",
    });
  if (
    scenario === "configuration-guidance" &&
    expectedSha === HISTORICAL_PRIVATE_CONFIGURATION_GUIDANCE_SHA
  )
    return Object.freeze({
      version: "0.1.22",
      sha256: HISTORICAL_PRIVATE_CONFIGURATION_GUIDANCE_SHA,
      distribution: "unreleased-private",
      numericRefusal: "before-review",
    });
  assert.fail(
    "This scenario requires an exact reviewed native-companion artifact.",
  );
}
export function nativeCandidateShaForScenario(
  scenario: NativeScenario,
): string {
  return nativeCandidateForScenario(scenario).sha256;
}
export function nativeLeasedPorts(base: unknown): {
  database: number;
  application: number;
} {
  assert.ok(
    typeof base === "number" &&
      Number.isSafeInteger(base) &&
      base >= 1024 &&
      base <= 65535 - 28,
    "A valid unprivileged leased base with room for every companion port is required.",
  );
  return { database: base + 25, application: base + 28 };
}
const scenarioFiles: Readonly<Record<NativeScenario, string>> = Object.freeze({
  cancellation: "native-cancellation-test.cjs",
  "workbench-review": "native-workbench-review-test.cjs",
  "presentation-review": "native-workbench-review-test.cjs",
  "configuration-guidance": "native-workbench-review-test.cjs",
  "comparison-export": "native-comparison-export-test.cjs",
});
export function nativeZshInitialization(integrationPath: string): string {
  const expected = resolve(
    dirname(code),
    "../out/vs/workbench/contrib/terminal/common/scripts/shellIntegration-rc.zsh",
  );
  assert.equal(
    integrationPath,
    expected,
    "Shell integration must come from the selected installed VS Code application.",
  );
  // Official manual integration, confined to this disposable terminal profile.
  // Resolve before startup so no CLI/Node process is spawned by each shell.
  return `[[ "$TERM_PROGRAM" == "vscode" ]] && source '${integrationPath}'\n`;
}
export interface NativeProcessIdentity {
  pid: number;
  ppid: number;
  pgid: number;
  state?: string;
  started: string;
  executable: string;
}
type ProcessRows = Map<number, NativeProcessIdentity>;
const nativeProcesses = require("./native-editor-reads.cjs") as {
  processes(): Promise<ProcessRows>;
  same(
    left: NativeProcessIdentity,
    right: NativeProcessIdentity | undefined,
  ): boolean;
};
const nativeRecovery = require("./native-editor-recovery.cjs") as {
  shouldRetainNativeEditor(result: unknown): boolean;
};
interface NativeIdentityHistory {
  reason:
    | "root-unverified"
    | "root-identity-drift"
    | "descendant-identity-drift"
    | "unobserved-group-member"
    | "observation-failed"
    | "inventory-bound";
  expected: NativeProcessIdentity | null;
  observed: NativeProcessIdentity | null;
}
export interface NativeEditorCleanup {
  rootObserved: boolean;
  fallbackUsed: boolean;
  observationFailed: boolean;
  identityUncertain: boolean;
  signalFailed: boolean;
  observedRemainingBeforeFallback: NativeProcessIdentity[];
  remaining: NativeProcessIdentity[];
  unknown: NativeProcessIdentity[];
  awaitingReap: NativeProcessIdentity[];
  uncertaintyHistory: NativeIdentityHistory[];
  execTransitions: {
    before: NativeProcessIdentity;
    after: NativeProcessIdentity;
    verifiedParent: NativeProcessIdentity;
  }[];
  execTransitionsOmitted: number;
}
/** Captured ancestry grants cleanup authority; a numeric process group never does. */
export function createNativeEditorTracker(
  pid: number,
  executable: string,
  readProcesses: () => Promise<ProcessRows> = nativeProcesses.processes,
  platform: NodeJS.Platform = process.platform,
) {
  assert.ok(Number.isSafeInteger(pid) && pid > 0);
  const captured: ProcessRows = new Map();
  // Reap-only identities never grant ancestry or signal authority.
  const waitOnly: ProcessRows = new Map();
  const awaitingReap = (row: NativeProcessIdentity | undefined) =>
    row?.state?.startsWith("Z") === true ||
    (platform === "darwin" && row?.state?.includes("E") === true);
  const result: NativeEditorCleanup = {
    rootObserved: false,
    fallbackUsed: false,
    observationFailed: false,
    identityUncertain: false,
    signalFailed: false,
    observedRemainingBeforeFallback: [],
    remaining: [],
    unknown: [],
    awaitingReap: [],
    uncertaintyHistory: [],
    execTransitions: [],
    execTransitionsOmitted: 0,
  };
  const recordedUncertainty = new Set<string>();
  const note = (
    reason: NativeIdentityHistory["reason"],
    expected: NativeProcessIdentity | null,
    observed: NativeProcessIdentity | null,
  ) => {
    const key = `${reason}:${expected?.pid ?? observed?.pid ?? pid}`;
    if (
      !recordedUncertainty.has(key) &&
      result.uncertaintyHistory.length < 64
    ) {
      recordedUncertainty.add(key);
      result.uncertaintyHistory.push({ reason, expected, observed });
    }
  };
  const matches = (
    left: NativeProcessIdentity | undefined,
    right: NativeProcessIdentity | undefined,
  ) =>
    Boolean(
      left &&
      !waitOnly.has(left.pid) &&
      !awaitingReap(left) &&
      !awaitingReap(right) &&
      nativeProcesses.same(left, right) &&
      left.pgid === right?.pgid,
    );
  const observe = async () => {
    let rows: ProcessRows;
    try {
      rows = await readProcesses();
    } catch {
      result.observationFailed = true;
      note("observation-failed", null, null);
      throw new Error(
        "Owned native process observation failed; cleanup is unverified.",
      );
    }
    if (!result.rootObserved) {
      const root = rows.get(pid);
      if (
        root?.ppid === process.pid &&
        root.pgid === pid &&
        !awaitingReap(root) &&
        root.executable === basename(executable)
      ) {
        captured.set(pid, root);
        result.rootObserved = true;
      } else {
        result.identityUncertain = true;
        result.unknown = root ? [root] : [];
        note("root-unverified", null, root ?? null);
        return result;
      }
    }
    const current = new Map(
      [...captured]
        .filter(([, row]) => matches(row, rows.get(row.pid)))
        .map(([key]) => [key, rows.get(key)!]),
    );
    try {
      let changed = true;
      while (changed) {
        changed = false;
        for (const row of rows.values()) {
          // The root never changes identity. Descendant exec requires live ancestry,
          // the same birth time and group, not merely a reused numeric PID/group.
          if (
            awaitingReap(row) ||
            waitOnly.has(row.pid) ||
            row.pid === pid ||
            current.has(row.pid) ||
            !current.has(row.ppid)
          )
            continue;
          const previous = captured.get(row.pid);
          if (
            previous &&
            (previous.started !== row.started || previous.pgid !== row.pgid)
          )
            continue;
          if (!previous)
            assert.ok(
              captured.size + waitOnly.size < 256,
              "Owned native identity inventory exceeded its bound.",
            );
          if (previous && previous.executable !== row.executable) {
            if (result.execTransitions.length < 64)
              result.execTransitions.push({
                before: previous,
                after: row,
                verifiedParent: current.get(row.ppid)!,
              });
            else result.execTransitionsOmitted++;
          }
          captured.set(row.pid, row);
          current.set(row.pid, row);
          changed = true;
        }
      }
      result.awaitingReap = [];
      for (const row of rows.values()) {
        if (!awaitingReap(row)) continue;
        const previous = captured.get(row.pid) ?? waitOnly.get(row.pid);
        const proven = previous
          ? previous.started === row.started && previous.pgid === row.pgid
          : current.has(row.ppid);
        if (!proven) continue;
        if (!waitOnly.has(row.pid)) {
          assert.ok(
            captured.size + waitOnly.size < 256,
            "Owned native identity inventory exceeded its bound.",
          );
          waitOnly.set(row.pid, row);
        }
        result.awaitingReap.push(row);
      }
    } catch {
      result.observationFailed = true;
      note("inventory-bound", null, null);
      throw new Error("Owned native process inventory is unverified.");
    }
    const groups = new Set([...captured.values()].map((row) => row.pgid));
    result.remaining = [...captured.values()].filter((row) =>
      matches(row, rows.get(row.pid)),
    );
    // Zombies and macOS E (trying to exit) rows require captured birth/group or
    // current verified ancestry. They remain wait-only after reparenting and
    // never grant signal/ancestry authority, even if ps changes their comm name.
    const reaping = new Set(result.awaitingReap.map((row) => row.pid));
    result.unknown = [...rows.values()].filter(
      (row) =>
        (captured.has(row.pid) ||
          waitOnly.has(row.pid) ||
          groups.has(row.pgid)) &&
        !reaping.has(row.pid) &&
        !matches(captured.get(row.pid), row),
    );
    for (const row of result.unknown) {
      const previous = captured.get(row.pid) ?? waitOnly.get(row.pid) ?? null;
      note(
        previous
          ? row.pid === pid
            ? "root-identity-drift"
            : "descendant-identity-drift"
          : "unobserved-group-member",
        previous,
        row,
      );
    }
    result.identityUncertain ||= result.unknown.length > 0;
    return result;
  };
  const cleanup = async () => {
    try {
      await observe();
      result.observedRemainingBeforeFallback = [...result.remaining];
      for (const [signal, wait] of [
        ["SIGTERM", 2000],
        ["SIGKILL", 5000],
      ] as const) {
        if (
          result.observationFailed ||
          result.identityUncertain ||
          !result.remaining.length
        )
          break;
        result.fallbackUsed = true;
        for (const row of [...result.remaining].reverse()) {
          try {
            process.kill(row.pid, signal);
          } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== "ESRCH")
              result.signalFailed = true;
          }
        }
        const until = Date.now() + wait;
        do {
          await delay(100);
          await observe();
        } while (
          result.remaining.length &&
          !result.identityUncertain &&
          Date.now() < until
        );
      }
      await observe();
    } catch {
      result.observationFailed = true;
    }
    return result;
  };
  return { observe, cleanup };
}
/** Recovery/unknown finalization is read-only: never call the signalling cleanup. */
export async function nativeEditorCleanupForReport(
  report: unknown,
  tracker: Pick<
    ReturnType<typeof createNativeEditorTracker>,
    "observe" | "cleanup"
  >,
  retainEditor?: () => void,
): Promise<{
  cleanupSkippedForRecovery: boolean;
  observation: NativeEditorCleanup;
}> {
  const cleanupSkippedForRecovery =
    nativeRecovery.shouldRetainNativeEditor(report);
  if (cleanupSkippedForRecovery) retainEditor?.();
  return {
    cleanupSkippedForRecovery,
    observation: cleanupSkippedForRecovery
      ? await tracker.observe()
      : await tracker.cleanup(),
  };
}
function diagnostic(error: unknown) {
  const value = error as { code?: unknown; stack?: unknown } | null;
  const code =
    typeof value?.code === "string" &&
    /^[A-Z][A-Z0-9_]{0,63}$/u.test(value.code)
      ? value.code
      : typeof value?.code === "number" && Number.isSafeInteger(value.code)
        ? `EXIT_${value.code}`
        : "UNCLASSIFIED_ERROR";
  const location =
    typeof value?.stack === "string"
      ? value.stack.match(
          /verify-native-cancellation\.(?:ts|js):\d{1,7}:\d{1,5}/u,
        )?.[0]
      : undefined;
  return { code, location: location ?? "verify-native-cancellation" };
}
type RecordValue = Record<string, unknown>;
type Lease = { path: string; ownerSha256: string };
type PreservedFile = { path: string; sha256: string; mode: number };
interface Fixture {
  schemaVersion: 1;
  kind: "native-cancellation-fixture";
  projectRoot: string;
  configRelativePath: "rehearsal.config.mjs";
  coreTarballPath: string;
  coreArtifactSha256: string;
  coreVersion: "1.0.2";
  baselineGeneration: string;
  runtimeProjectId: string;
  pinnedDockerEndpoint: string;
  engineId: string;
  applicationUrl: string;
  healthUrl: string;
  summaryUrl: string;
  portLease: Lease & {
    sessionReceiptPath: string;
    sessionReceiptSha256: string;
  };
  heavyLease: Lease | null;
  preserveFiles: PreservedFile[];
  repeatDuringConfirmation: boolean;
}

function object(value: unknown, keys: readonly string[]): RecordValue {
  assert.ok(value && typeof value === "object" && !Array.isArray(value));
  const record = value as RecordValue;
  assert.deepEqual(
    Object.keys(record).sort(),
    [...keys].sort(),
    "Fixture fields differ from the closed companion contract.",
  );
  return record;
}
async function regular(path: string, maximumBytes: number) {
  assert.ok(isAbsolute(path));
  assert.equal(
    await realpath(path),
    path,
    "Input must use its canonical path.",
  );
  const handle = await open(
    path,
    constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
  );
  try {
    const before = await handle.stat();
    assert.ok(before.isFile() && before.size <= maximumBytes);
    const bytes = Buffer.alloc(before.size + 1);
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
    assert.ok(
      length === before.size &&
        after.size === before.size &&
        after.mtimeMs === before.mtimeMs,
    );
    return bytes.subarray(0, length);
  } finally {
    await handle.close();
  }
}
function within(root: string, file: string) {
  const part = relative(root, file);
  assert.ok(
    part && part !== ".." && !part.startsWith("../") && !isAbsolute(part),
    "Owned path escaped its root.",
  );
}
async function directory(path: string) {
  assert.ok(isAbsolute(path));
  assert.equal(await realpath(path), path);
  const entry = await lstat(path);
  assert.ok(entry.isDirectory() && !entry.isSymbolicLink());
}
function hashValue(value: unknown): asserts value is string {
  assert.ok(typeof value === "string" && /^[a-f0-9]{64}$/u.test(value));
}
async function inventory(root: string) {
  const files: string[] = [];
  let entries = 0;
  const visit = async (part: string, depth: number) => {
    assert.ok(depth <= 20);
    for (const entry of await readdir(join(root, part), {
      withFileTypes: true,
    })) {
      assert.ok(
        ++entries <= 2000 && !entry.isSymbolicLink(),
        "Installed inventory exceeded its bound or contains a symlink.",
      );
      const next = join(part, entry.name);
      if (entry.isDirectory()) await visit(next, depth + 1);
      else {
        assert.ok(entry.isFile());
        files.push(next);
      }
    }
  };
  await directory(root);
  await visit("", 0);
  return files.sort();
}
function lease(value: unknown): Lease {
  const entry = object(value, ["path", "ownerSha256"]);
  assert.ok(typeof entry.path === "string" && isAbsolute(entry.path));
  hashValue(entry.ownerSha256);
  return entry as unknown as Lease;
}
function parseFixture(input: unknown): Fixture {
  const value = object(input, [
    "schemaVersion",
    "kind",
    "projectRoot",
    "configRelativePath",
    "coreTarballPath",
    "coreArtifactSha256",
    "coreVersion",
    "baselineGeneration",
    "runtimeProjectId",
    "pinnedDockerEndpoint",
    "engineId",
    "applicationUrl",
    "healthUrl",
    "summaryUrl",
    "portLease",
    "heavyLease",
    "preserveFiles",
    "repeatDuringConfirmation",
  ]);
  assert.equal(value.schemaVersion, 1);
  assert.equal(value.kind, "native-cancellation-fixture");
  assert.equal(value.coreVersion, "1.0.2");
  assert.equal(value.coreArtifactSha256, CORE_SHA);
  assert.equal(value.configRelativePath, "rehearsal.config.mjs");
  for (const key of ["projectRoot", "coreTarballPath"])
    assert.ok(typeof value[key] === "string" && isAbsolute(value[key]));
  assert.ok(
    typeof value.baselineGeneration === "string" &&
      /^[A-Za-z0-9-]{1,120}$/u.test(value.baselineGeneration),
  );
  assert.ok(
    typeof value.runtimeProjectId === "string" &&
      /^rtl-[a-f0-9]{10}-postgresql-rehearsal$/u.test(value.runtimeProjectId),
  );
  assert.ok(
    typeof value.pinnedDockerEndpoint === "string" &&
      /^unix:\/\/\/[A-Za-z0-9_./-]{1,240}\.sock$/u.test(
        value.pinnedDockerEndpoint,
      ),
  );
  assert.ok(
    !value.pinnedDockerEndpoint
      .slice("unix://".length)
      .split("/")
      .includes(".."),
  );
  assert.ok(
    typeof value.engineId === "string" &&
      /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/u.test(value.engineId),
  );
  assert.equal(typeof value.repeatDuringConfirmation, "boolean");
  const port = object(value.portLease, [
    "path",
    "ownerSha256",
    "sessionReceiptPath",
    "sessionReceiptSha256",
  ]);
  lease({ path: port.path, ownerSha256: port.ownerSha256 });
  assert.ok(
    typeof port.sessionReceiptPath === "string" &&
      isAbsolute(port.sessionReceiptPath),
  );
  hashValue(port.sessionReceiptSha256);
  if (value.heavyLease !== null) lease(value.heavyLease);
  assert.ok(
    Array.isArray(value.preserveFiles) &&
      value.preserveFiles.length > 1 &&
      value.preserveFiles.length <= 64,
  );
  const paths = new Set<string>();
  for (const raw of value.preserveFiles) {
    const file = object(raw, ["path", "sha256", "mode"]);
    assert.ok(
      typeof file.path === "string" &&
        /^[A-Za-z0-9_./-]{1,240}$/u.test(file.path),
    );
    assert.ok(
      !isAbsolute(file.path) &&
        !file.path.split("/").includes("..") &&
        !paths.has(file.path),
    );
    assert.ok(
      !/(?:^|\/)node_modules(?:\/|$)|(?:^|\/)\.env(?:\.|$)|\.env$/u.test(
        file.path,
      ),
      "Environment files are not companion inputs.",
    );
    paths.add(file.path);
    hashValue(file.sha256);
    assert.ok(
      Number.isInteger(file.mode) &&
        Number(file.mode) >= 0 &&
        Number(file.mode) <= 0o777,
    );
  }
  assert.ok(paths.has("rehearsal.config.mjs"));
  assert.ok(
    [...paths].some(
      (path) => path.startsWith(".rehearsal/") && !path.includes("/runtime"),
    ),
    "A preserved baseline file is required.",
  );
  return value as unknown as Fixture;
}

async function main() {
  assert.equal(
    process.platform,
    "darwin",
    "This companion requires native macOS VS Code.",
  );
  const [vsixInput, expectedSha, fixtureInput, scenarioInput, ...extra] =
    process.argv.slice(2);
  const scenario = selectNativeScenario(scenarioInput);
  const candidate = nativeCandidateForScenario(scenario, expectedSha);
  const candidateSha = candidate.sha256;
  const windowTitle =
    scenario === "cancellation"
      ? "Rehearsal cancellation verification"
      : "Rehearsal workbench review verification";
  assert.ok(
    vsixInput && fixtureInput && extra.length === 0,
    "Pass exact VSIX, its full SHA-256, prepared fixture JSON and optional allowlisted scenario.",
  );
  assert.equal(expectedSha, candidateSha);
  const fixturePath = resolve(fixtureInput);
  const fixtureBytes = await regular(fixturePath, 64 * 1024);
  const fixture = parseFixture(JSON.parse(fixtureBytes.toString("utf8")));
  await directory(fixture.projectRoot);
  const sessionBytes = await regular(
    fixture.portLease.sessionReceiptPath,
    128 * 1024,
  );
  assert.equal(sha(sessionBytes), fixture.portLease.sessionReceiptSha256);
  const session = JSON.parse(sessionBytes.toString("utf8"));
  assert.equal(session.schemaVersion, 1);
  assert.equal(session.kind, "manual-postgresql");
  assert.equal(session.persistentPortLease, true);
  assert.equal(session.portLease, fixture.portLease.path);
  assert.equal(
    join(session.workspace, "projects/postgresql"),
    fixture.projectRoot,
  );
  await directory(session.workspace);
  assert.equal(session.artifact.sha256, CORE_SHA);
  assert.equal(session.bindings.targetPostgresql, fixture.runtimeProjectId);
  const assertLease = async (owned: Lease) => {
    await directory(owned.path);
    const bytes = await regular(join(owned.path, "owner.json"), 16 * 1024);
    assert.equal(sha(bytes), owned.ownerSha256);
    return JSON.parse(bytes.toString("utf8"));
  };
  const portOwner = await assertLease(fixture.portLease);
  assert.equal(portOwner.purpose, "manual-postgresql");
  assert.equal(portOwner.persistent, true);
  assert.equal(portOwner.workspace, session.workspace);
  assert.equal(portOwner.receipt, fixture.portLease.sessionReceiptPath);
  assert.equal(portOwner.base, session.bindings.base);
  const ports = nativeLeasedPorts(session.bindings.base);
  const expectedDatabasePort = ports.database;
  const expectedApplicationPort = ports.application;
  if (fixture.heavyLease) await assertLease(fixture.heavyLease);
  const urls = [
    fixture.applicationUrl,
    fixture.healthUrl,
    fixture.summaryUrl,
  ].map((value) => {
    const url = new URL(value);
    assert.equal(url.protocol, "http:");
    assert.equal(url.hostname, "127.0.0.1");
    assert.ok(!url.username && !url.password && !url.search && !url.hash);
    assert.equal(Number(url.port), expectedApplicationPort);
    return url;
  });
  assert.deepEqual(
    urls.map((url) => url.pathname),
    ["/", "/health", "/summary"],
  );
  const environment: NodeJS.ProcessEnv = storageEnvironment(process.env);
  for (const name of [
    "HOME",
    "USER",
    "LOGNAME",
    "LANG",
    "LC_ALL",
    "TMPDIR",
    "PATH",
  ])
    if (process.env[name]) environment[name] = process.env[name];
  environment.DOCKER_HOST = fixture.pinnedDockerEndpoint;
  const run = (command: string, args: string[]) =>
    execute(command, args, {
      cwd: repository,
      env: environment,
      encoding: "utf8",
      timeout: 120_000,
      maxBuffer: 4 * 1024 * 1024,
    });
  const assertEngine = async () => {
    assert.ok(
      (
        await lstat(fixture.pinnedDockerEndpoint.slice("unix://".length))
      ).isSocket(),
    );
    assert.equal(
      (
        await execute(
          "docker",
          [
            "--host",
            fixture.pinnedDockerEndpoint,
            "info",
            "--format",
            "{{.ID}}",
          ],
          {
            env: environment,
            encoding: "utf8",
            timeout: 10_000,
            maxBuffer: 16 * 1024,
          },
        )
      ).stdout.trim(),
      fixture.engineId,
      "The pinned local engine identity changed.",
    );
  };
  const pressure = async () =>
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
      "Normal macOS memory pressure is required; no override is supported.",
    );
  const interactiveDesktop = async () => {
    const { stdout } = await run("/usr/bin/osascript", [
      "-l",
      "JavaScript",
      "-e",
      'ObjC.import("AppKit"); ObjC.unwrap($.NSWorkspace.sharedWorkspace.frontmostApplication.bundleIdentifier);',
    ]);
    assert.ok(
      stdout.trim() && stdout.trim() !== "com.apple.loginwindow",
      "Unlock the Mac normally before this real native UI observation; no lock-screen bypass is supported.",
    );
  };
  const preserve = async () => {
    let totalBytes = 0;
    for (const file of fixture.preserveFiles) {
      const absolute = resolve(fixture.projectRoot, file.path);
      within(fixture.projectRoot, absolute);
      assert.equal(await realpath(absolute), absolute);
      const stat = await lstat(absolute);
      assert.ok(
        stat.isFile() &&
          !stat.isSymbolicLink() &&
          stat.size <= 64 * 1024 * 1024,
      );
      totalBytes += stat.size;
      assert.ok(
        totalBytes <= 256 * 1024 * 1024,
        "Prepared fixture preservation exceeds the small PostgreSQL companion bound.",
      );
      assert.equal(stat.mode & 0o777, file.mode);
      const digest = createHash("sha256");
      for await (const chunk of createReadStream(absolute))
        digest.update(chunk);
      assert.equal(digest.digest("hex"), file.sha256);
    }
    assert.equal(sha(await regular(fixturePath, 64 * 1024)), sha(fixtureBytes));
    assert.equal(
      sha(await regular(fixture.portLease.sessionReceiptPath, 128 * 1024)),
      fixture.portLease.sessionReceiptSha256,
    );
    await assertLease(fixture.portLease);
    if (fixture.heavyLease) await assertLease(fixture.heavyLease);
  };
  await preserve();
  await assertEngine();
  await interactiveDesktop();
  const coreBytes = await regular(fixture.coreTarballPath, 16 * 1024 * 1024);
  assert.equal(sha(coreBytes), CORE_SHA);
  let coreRoot: string | undefined;
  for (let root = fixture.projectRoot; ; root = dirname(root)) {
    const candidate = join(root, "node_modules/@rehearsal-db/core");
    try {
      await directory(candidate);
      coreRoot = candidate;
      break;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    assert.notEqual(
      root,
      session.workspace,
      "No repository-local prepared core package exists.",
    );
    within(session.workspace, root);
  }
  assert.ok(coreRoot);
  within(session.workspace, coreRoot);
  const coreManifest = JSON.parse(
    (await regular(join(coreRoot, "package.json"), 64 * 1024)).toString("utf8"),
  );
  assert.equal(coreManifest.name, "@rehearsal-db/core");
  assert.equal(coreManifest.version, "1.0.2");
  assert.equal(coreManifest.bin.rehearsal, "dist/src/cli/rehearsal.mjs");
  const coreFiles = (
    await run("/usr/bin/tar", ["-tzf", fixture.coreTarballPath])
  ).stdout
    .trim()
    .split("\n");
  assert.ok(
    coreFiles.length > 0 &&
      coreFiles.length <= 1000 &&
      new Set(coreFiles).size === coreFiles.length,
  );
  for (const file of coreFiles) {
    assert.ok(
      /^package\/[A-Za-z0-9_./-]+$/u.test(file) &&
        !file.split("/").includes(".."),
    );
    const relativePath = file.slice("package/".length);
    const installed = resolve(coreRoot, relativePath);
    within(coreRoot, installed);
    const packed = await execute(
      "/usr/bin/tar",
      ["-xOf", fixture.coreTarballPath, file],
      {
        env: environment,
        encoding: "buffer",
        timeout: 10_000,
        maxBuffer: 8 * 1024 * 1024,
      },
    );
    assert.equal(
      sha(await regular(installed, 8 * 1024 * 1024)),
      sha(packed.stdout),
    );
  }
  assert.deepEqual(
    await inventory(coreRoot),
    coreFiles.map((file) => file.slice("package/".length)).sort(),
    "Installed core contains extra/missing files.",
  );
  const vsix = resolve(vsixInput);
  const vsixBytes = await regular(vsix, 16 * 1024 * 1024);
  assert.equal(sha(vsixBytes), candidateSha);
  await pressure();
  await nativeStorageRoot();
  await mkdir(join(repository, "test-results"), { recursive: true });
  const evidence = await mkdtemp(
    join(repository, `test-results/native-${scenario}.`),
  );
  const temporary = await createNativeTemporaryDirectory("c-");
  const user = join(temporary, "user"),
    extensions = join(temporary, "extensions"),
    harness = join(temporary, "harness"),
    frozen = join(temporary, "frozen"),
    shell = join(temporary, "shell");
  const resultPath = join(evidence, "native-result.json"),
    phasePath = join(evidence, "phase.json"),
    controlPath = join(evidence, "control.json");
  let phase = "archive",
    nativeClosed = false,
    uninstalled = false,
    preserved = false,
    editorTerminationForCleanup = false,
    editorRecoveryRequested = false,
    editorRetainedForRecovery = false,
    success = false;
  let nativeEditorCleanup: NativeEditorCleanup | undefined;
  try {
    const copiedVsix = join(temporary, "candidate.vsix");
    await writeFile(copiedVsix, vsixBytes, { mode: 0o400, flag: "wx" });
    assertArchiveContents(
      (await run("/usr/bin/unzip", ["-Z1", copiedVsix])).stdout
        .trim()
        .split("\n"),
    );
    await run("/usr/bin/unzip", ["-q", copiedVsix, "-d", frozen]);
    const manifest = JSON.parse(
      (
        await regular(join(frozen, "extension/package.json"), 64 * 1024)
      ).toString("utf8"),
    );
    assert.equal(
      `${manifest.publisher}.${manifest.name}@${manifest.version}`,
      `rehearsal-db.rehearsal-db@${candidate.version}`,
    );
    assert.equal(manifest.pricing, "Free");
    for (const path of [join(user, "User"), extensions, harness, shell])
      await mkdir(path, { recursive: true });
    const integrationPath = (
      await run(code, ["--locate-shell-integration-path", "zsh"])
    ).stdout.trim();
    const shellInitialization = nativeZshInitialization(integrationPath);
    assert.equal(await realpath(integrationPath), integrationPath);
    await regular(integrationPath, 256 * 1024);
    await writeFile(join(shell, ".zshrc"), shellInitialization, {
      mode: 0o600,
      flag: "wx",
    });
    await writeFile(
      join(user, "User/settings.json"),
      JSON.stringify({
        "security.workspace.trust.enabled": false,
        "telemetry.telemetryLevel": "off",
        "update.mode": "none",
        "extensions.autoUpdate": false,
        "extensions.autoCheckUpdates": false,
        "typescript.disableAutomaticTypeAcquisition": true,
        "js/ts.tsserver.automaticTypeAcquisition.enabled": false,
        "workbench.startupEditor": "none",
        "window.title": windowTitle,
        "rehearsal.openDashboardAutomatically": false,
        "rehearsal.automaticUpdates": { extension: false, cli: false },
        "terminal.integrated.enablePersistentSessions": false,
        "terminal.integrated.shellIntegration.enabled": false,
        "terminal.integrated.profiles.osx": {
          "Rehearsal verification": {
            path: "/bin/zsh",
            args: ["-i"],
            env: {
              ...storageEnvironment(environment),
              ZDOTDIR: shell,
              DOCKER_HOST: fixture.pinnedDockerEndpoint,
              DOCKER_CONTEXT: null,
              DOCKER_TLS_VERIFY: null,
              DOCKER_CERT_PATH: null,
              DOCKER_API_VERSION: null,
            },
          },
        },
        "terminal.integrated.defaultProfile.osx": "Rehearsal verification",
      }),
      { mode: 0o600 },
    );
    await writeFile(
      join(harness, "package.json"),
      JSON.stringify({
        name: "native-editor-verification",
        publisher: "rehearsal-verification",
        version: "0.0.0",
        private: true,
        engines: { vscode: "^1.101.0" },
        activationEvents: ["onStartupFinished"],
        main: "./native-editor-driver.cjs",
      }),
      { mode: 0o600 },
    );
    await copyFile(
      join(repository, "scripts/native/native-editor-driver.cjs"),
      join(harness, "native-editor-driver.cjs"),
    );
    await copyFile(
      join(repository, "scripts/native/native-editor-reads.cjs"),
      join(harness, "native-editor-reads.cjs"),
    );
    await copyFile(
      join(repository, "scripts/native/native-editor-recovery.cjs"),
      join(harness, "native-editor-recovery.cjs"),
    );
    await copyFile(
      join(repository, "scripts", scenarioFiles[scenario]),
      join(harness, scenarioFiles[scenario]),
    );
    if (scenario === "comparison-export")
      await copyFile(
        join(repository, "scripts/native/native-comparison-evidence.cjs"),
        join(harness, "native-comparison-evidence.cjs"),
      );
    const configPath = join(temporary, "configuration.json");
    await writeFile(
      configPath,
      JSON.stringify({
        root: temporary,
        extensions,
        fixture,
        scenario,
        candidate,
        expectedDatabasePort,
        expectedApplicationPort,
        coreBin: join(coreRoot, coreManifest.bin.rehearsal),
        evidence,
        resultPath,
        phasePath,
        controlPath,
      }),
      { mode: 0o600 },
    );
    const isolated = ["--user-data-dir", user, "--extensions-dir", extensions];
    phase = "installation";
    await pressure();
    await run(code, [...isolated, "--install-extension", copiedVsix]);
    const installed = join(
      extensions,
      `rehearsal-db.rehearsal-db-${candidate.version}`,
    );
    let matched = 0,
      installerMetadataMatched = 0;
    phase = "installation-payload";
    const compare = async (part = "") => {
      for (const entry of await readdir(join(frozen, "extension", part), {
        withFileTypes: true,
      })) {
        assert.equal(entry.isSymbolicLink(), false);
        const file = join(part, entry.name);
        if (entry.isDirectory()) await compare(file);
        else {
          assert.ok(entry.isFile());
          if (file === "package.json") {
            const value = JSON.parse(
              (await regular(join(installed, file), 64 * 1024)).toString(
                "utf8",
              ),
            );
            delete value.__metadata;
            assert.deepEqual(value, manifest);
          } else
            assert.equal(
              sha(await regular(join(installed, file), 8 * 1024 * 1024)),
              sha(
                await regular(join(frozen, "extension", file), 8 * 1024 * 1024),
              ),
            );
          matched++;
        }
      }
    };
    await compare();
    phase = "installation-inventory";
    const installedFiles = await inventory(installed);
    if (installedFiles.includes(".vsixmanifest")) {
      phase = "installation-metadata";
      assert.equal(
        sha(await regular(join(installed, ".vsixmanifest"), 64 * 1024)),
        sha(await regular(join(frozen, "extension.vsixmanifest"), 64 * 1024)),
        "VS Code installer metadata differs from the frozen VSIX manifest.",
      );
      installerMetadataMatched = 1;
    }
    phase = "installation-inventory";
    assert.deepEqual(
      installedFiles.filter((file) => file !== ".vsixmanifest"),
      await inventory(join(frozen, "extension")),
      "Installed extension contains extra/missing files.",
    );
    await preserve();
    await assertEngine();
    await pressure();
    await interactiveDesktop();
    phase = "native";
    console.log(
      JSON.stringify({
        evidence,
        scenario,
        phasePath,
        controlPath,
        windowTitle,
        instruction:
          "Use real native UI only. Decline metadata checks if offered; see phase.json before writing the matching control acknowledgement.",
      }),
    );
    const child = spawn(
      electron,
      [
        ...isolated,
        `--extensionDevelopmentPath=${harness}`,
        "--force-renderer-accessibility",
        "--skip-welcome",
        "--skip-release-notes",
        "--disable-updates",
        fixture.projectRoot,
      ],
      {
        cwd: repository,
        env: {
          ...environment,
          REHEARSAL_NATIVE_CANCELLATION_CONFIG: configPath,
        },
        detached: true,
        stdio: "ignore",
      },
    );
    const pid = child.pid;
    assert.ok(pid);
    let childClosed = false,
      observingFinalization = true,
      childExitCode: number | null = null;
    let onNativeError: (error: Error) => void = () => {};
    let onNativeClose: (code: number | null) => void = () => {};
    const closed = new Promise<number | null>((resolveExit, reject) => {
      onNativeError = reject;
      onNativeClose = (code) => {
        childClosed = true;
        childExitCode = code;
        resolveExit(code);
      };
      child.once("error", onNativeError);
      child.once("close", onNativeClose);
    });
    const tracker = createNativeEditorTracker(pid, electron);
    const observeFinalization = async () => {
      while (observingFinalization && !childClosed) {
        const observation = await tracker.observe();
        assert.equal(
          observation.identityUncertain,
          false,
          "Owned native identity changed or is unknown.",
        );
        try {
          const result = JSON.parse(
            (await regular(resultPath, 256 * 1024)).toString("utf8"),
          );
          if (result.driverFinalized === true) {
            assert.ok(["passed", "failed"].includes(result.status));
            return "finalized" as const;
          }
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
        }
        await delay(200);
      }
      return "exited" as const;
    };
    let timer: ReturnType<typeof setTimeout> | undefined;
    let interrupt: (() => void) | undefined;
    let finalization: Promise<"finalized" | "exited"> | undefined;
    const interrupted = new Promise<never>((_, reject) => {
      interrupt = () =>
        reject(new Error("Owned native companion was interrupted."));
      process.once("SIGINT", interrupt);
      process.once("SIGTERM", interrupt);
    });
    try {
      const initial = await tracker.observe();
      assert.equal(
        initial.rootObserved && !initial.identityUncertain,
        true,
        "Owned native root identity is unverified.",
      );
      finalization = observeFinalization();
      const outcome = await Promise.race([
        finalization,
        closed.then(() => "exited" as const),
        interrupted,
        new Promise<never>((_, reject) => {
          timer = setTimeout(
            () => reject(new Error("Owned native companion timed out.")),
            scenario === "presentation-review" ? 900_000 : 600_000,
          );
        }),
      ]);
      if (outcome === "finalized" && !childClosed)
        await Promise.race([closed, delay(2500)]);
      if (childClosed) assert.equal(childExitCode, 0);
    } finally {
      observingFinalization = false;
      await finalization?.catch(() => undefined);
      if (timer) clearTimeout(timer);
      if (interrupt) {
        process.removeListener("SIGINT", interrupt);
        process.removeListener("SIGTERM", interrupt);
      }
      phase = "native-cleanup";
      let finalizedReport: unknown;
      try {
        finalizedReport = JSON.parse(
          (await regular(resultPath, 256 * 1024)).toString("utf8"),
        );
      } catch {
        // No trustworthy clean finalization means no forced editor cleanup.
      }
      editorRecoveryRequested =
        nativeRecovery.shouldRetainNativeEditor(finalizedReport);
      editorRetainedForRecovery = editorRecoveryRequested && !childClosed;
      const cleanup = await nativeEditorCleanupForReport(
        finalizedReport,
        tracker,
        () => {
          // Retain the actual window and private profile, but retire our own wait
          // listeners/handle so the failed launcher does not remain a hidden daemon.
          child.removeListener("error", onNativeError);
          child.removeListener("close", onNativeClose);
          child.unref();
        },
      );
      nativeEditorCleanup = cleanup.observation;
      editorTerminationForCleanup = nativeEditorCleanup.fallbackUsed;
      if (cleanup.cleanupSkippedForRecovery)
        throw new Error(
          "The owned isolated editor/profile is retained for explicit recovery; no editor cleanup was attempted.",
        );
      if (!childClosed) await Promise.race([closed, delay(5000)]);
      // Observe absence after the real close, not merely a successful signal probe.
      try {
        nativeEditorCleanup = await tracker.observe();
      } catch {
        nativeEditorCleanup.observationFailed = true;
      }
      nativeClosed =
        childClosed &&
        nativeEditorCleanup.rootObserved &&
        !nativeEditorCleanup.observationFailed &&
        !nativeEditorCleanup.identityUncertain &&
        !nativeEditorCleanup.signalFailed &&
        nativeEditorCleanup.remaining.length === 0 &&
        nativeEditorCleanup.awaitingReap.length === 0 &&
        nativeEditorCleanup.unknown.length === 0;
      assert.equal(
        nativeClosed,
        true,
        "Owned native editor close/descendant identities remain unverified.",
      );
    }
    phase = "native-result";
    const result = JSON.parse(
      (await regular(resultPath, 256 * 1024)).toString("utf8"),
    );
    assert.equal(result.status, "passed");
    assert.equal(result.driverFinalized, true);
    assert.equal(result.scenario, scenario);
    if (scenario === "cancellation") {
      assert.equal(result.ownedDescendantsGone, true);
      assert.equal(result.sentinelPreserved, true);
      assert.equal(result.sentinelCleanedUp, true);
    } else {
      if (scenario === "comparison-export")
        assert.equal(result.comparisonExportPassed, true);
      else assert.equal(result.workbenchReviewPassed, true);
      assert.equal(result.ownedReadProcessesGone, true);
      assert.equal(result.configurationRestored, true);
      assert.equal(result.baselineGenerationPreserved, true);
      assert.equal(result.noTerminalCommandsStarted, true);
    }
    await preserve();
    preserved = true;
    await assertEngine();
    phase = "uninstall";
    await run(code, [
      ...isolated,
      "--uninstall-extension",
      "rehearsal-db.rehearsal-db",
    ]);
    uninstalled = true;
    assert.ok(
      !(
        await run(code, [...isolated, "--list-extensions", "--show-versions"])
      ).stdout.includes("rehearsal-db.rehearsal-db@"),
    );
    await writeFile(
      join(evidence, "verification.json"),
      JSON.stringify(
        {
          status: "passed",
          scenario,
          candidateSha256: candidateSha,
          candidateVersion: candidate.version,
          candidateDistribution: candidate.distribution,
          coreSha256: CORE_SHA,
          installedExtensionFilesMatched: matched,
          installedExtensionMetadataFilesMatched: installerMetadataMatched,
          installedCoreFilesMatched: coreFiles.length,
          fixtureInputSha256: sha(fixtureBytes),
          nativeProcessGroupClosed: nativeClosed,
          nativeEditorCleanup,
          editorTerminationForCleanup,
          editorRecoveryRequested,
          editorRetainedForRecovery,
          uninstalled,
          preservedFilesAndLeases: preserved,
          fixtureAndLeasesRetained: true,
          native: result,
          limitations: [
            "Real installed extension and public CLI; no snapshot/client/confirmation injection. Root performs real UI confirmations.",
            "API command dispatch and control acknowledgements are not proof of a rendered click, subjective layout, accessibility or owner acceptance.",
            "An Open session can close gracefully with completed core history. This does not prove mid-migration rollback.",
            "After the real driver and its cleanup have finalized, the isolated editor receives normal Close Window. A remaining macOS app process is terminated only as recorded harness cleanup, not as Activity cancellation evidence.",
            "Terminal closure without an exact shell exit remains unverified, never an invented cancelled/successful receipt.",
            "Any offered update-consent prompt requires a real operator choice in the isolated profile; the control acknowledgement does not prove that a prompt appeared or was declined. No packet-capture certification is claimed.",
            "The externally prepared PostgreSQL runtime, baseline, privacy key, workspace and leases remain owned by the caller. No stop/reset/discard or lease release is performed by this companion.",
          ],
        },
        null,
        2,
      ) + "\n",
      { mode: 0o600 },
    );
    success = true;
  } catch (error) {
    await writeFile(
      join(evidence, "failure.json"),
      JSON.stringify(
        {
          status: "failed",
          scenario,
          candidateSha256: candidateSha,
          candidateVersion: candidate.version,
          candidateDistribution: candidate.distribution,
          phase,
          diagnostic: diagnostic(error),
          nativeProcessGroupClosed: nativeClosed,
          nativeEditorCleanup,
          editorTerminationForCleanup,
          editorRecoveryRequested,
          editorRetainedForRecovery,
          uninstalled,
          preservationRechecked: preserved,
          retainedFixture: temporary,
          fixtureAndLeasesRetained: true,
          instruction: editorRecoveryRequested
            ? "The owned isolated editor/profile may contain unsaved or unknown work. Inspect and save that work explicitly before any editor termination, uninstall or profile cleanup. No forced editor cleanup was attempted. Caller owns reconciliation and fixture/lease cleanup."
            : "Inspect retained native-result/phase files; no raw child stderr or terminal output was retained. Caller owns reconciliation and fixture cleanup.",
        },
        null,
        2,
      ) + "\n",
      { mode: 0o600 },
    );
    throw new Error(
      "Native cancellation verification failed; bounded evidence and the owned fixture are retained.",
    );
  } finally {
    if (success) await rm(temporary, { recursive: true, force: true });
  }
}

if (require.main === module)
  void main().catch((error: unknown) => {
    console.error(
      "Native cancellation companion did not pass; inspect its bounded evidence. No fixture/lease cleanup success is implied.",
      JSON.stringify({ phase: "launcher", diagnostic: diagnostic(error) }),
    );
    process.exitCode = 1;
  });
