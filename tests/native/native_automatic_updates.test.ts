import { describe, expect, it } from "vitest";
import { execFile, spawn } from "node:child_process";
import { createRequire } from "node:module";
import {
  mkdtemp,
  mkdir,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { runInNewContext } from "node:vm";
import {
  assertAutomaticUpdateInstalledPayload,
  assertAutomaticUpdateExecutablePair,
  assertAutomaticUpdateFinalization,
  assertAutomaticUpdateReportBinding,
  assertAutomaticUpdateVersions,
  automaticUpdateInstalledManifest,
  automaticUpdateRuntimeRoot,
  automaticUpdateEnvironment,
  assertAutomaticUpdateMemoryPressure,
  automaticUpdateFailureMessage,
  AutomaticUpdatePreflightMemoryPressureError,
  parseAutomaticUpdateAcceptanceArguments,
} from "../../scripts/native/verify-automatic-updates.js";
import {
  acquireExtensionUpdateReservation,
  readLoadedExtensionState,
  updateProcessState,
} from "../../src/updates/automatic/extension_update_reservation.js";

const nativeRequire = createRequire(__filename);
const ui = nativeRequire("../../scripts/native/native-update-ui.cjs") as {
  notificationButtonProbe(label: string): string;
  parseOwnedDevtoolsPort(value: unknown): string;
};
const fixtureEnvironment = nativeRequire(
  "../../scripts/native/native-update-reservation-worker.cjs",
) as {
  nativeUpdateEnvironment(
    source: NodeJS.ProcessEnv,
    storage: NodeJS.ProcessEnv,
    platform: NodeJS.Platform,
    display?: boolean,
  ): NodeJS.ProcessEnv;
};
const exactArguments = () =>
  ["candidate", "previous", "target", "code", "electron"]
    .map((name) => `--${name}=/owned/${name}`)
    .concat([
      ...["candidate", "previous", "target", "electron"].map(
        (name) => `--${name}-sha=${"a".repeat(64)}`,
      ),
      "--code-version=1.143.0",
    ]);
const buffer = (value: unknown) => Buffer.from(JSON.stringify(value));
const manifest = {
  publisher: "rehearsal-db",
  name: "rehearsal-db",
  version: "0.1.27",
};

describe("native updater preflight memory refusal", () => {
  it.each([2, 4, 0, NaN])(
    "keeps preflight pressure %s fail-closed with accurate no-allocation guidance",
    (value) => {
      let failure: unknown;
      try {
        assertAutomaticUpdateMemoryPressure(value, "preflight");
      } catch (error) {
        failure = error;
      }
      expect(failure).toBeInstanceOf(
        AutomaticUpdatePreflightMemoryPressureError,
      );
      const message = automaticUpdateFailureMessage(failure);
      expect(message).toContain("macOS memory pressure is not normal");
      expect(message).toContain("No test fixture was allocated");
      expect(message).toContain(
        "no extension was installed or native Code host launched",
      );
      expect(message).not.toContain("retained verification reports");
    },
  );
  it("continues only at the existing exact normal pressure level in either stage", () => {
    for (const phase of ["preflight", "allocated"] as const)
      expect(() => assertAutomaticUpdateMemoryPressure(1, phase)).not.toThrow();
  });
  it("keeps allocated-stage pressure refusal and recovery guidance separate", () => {
    let failure: unknown;
    try {
      assertAutomaticUpdateMemoryPressure(2, "allocated");
    } catch (error) {
      failure = error;
    }
    expect(failure).toBeInstanceOf(Error);
    expect(failure).not.toBeInstanceOf(
      AutomaticUpdatePreflightMemoryPressureError,
    );
    expect(automaticUpdateFailureMessage(failure)).toContain(
      "unknown fixture state was preserved",
    );
    expect(automaticUpdateFailureMessage(failure)).not.toContain(
      "No test fixture was allocated",
    );
  });
  it("never classifies arbitrary error text as preflight authority or dumps raw errors", () => {
    const failure = new Error("PRIVATE_CANARY No test fixture was allocated");
    expect(automaticUpdateFailureMessage(failure)).toContain(
      "unknown fixture state was preserved",
    );
    expect(automaticUpdateFailureMessage(failure)).not.toContain(
      "PRIVATE_CANARY",
    );
    const known = new AutomaticUpdatePreflightMemoryPressureError();
    known.message = "PRIVATE_CANARY";
    expect(automaticUpdateFailureMessage(known)).toContain(
      "No test fixture was allocated",
    );
    expect(automaticUpdateFailureMessage(known)).not.toContain(
      "PRIVATE_CANARY",
    );
  });
});

describe("native updater child environment boundary", () => {
  const identity = {
    HOME: "/identity-home",
    USER: "fixture-user",
    LOGNAME: "fixture-user",
    LANG: "en_US.UTF-8",
    LC_ALL: "en_US.UTF-8",
    PATH: "/maintained/bin:/usr/bin:/bin",
  };
  const storage = {
    TMPDIR: "/approved/tmp",
    TMP: "/approved/tmp",
    TEMP: "/approved/tmp",
    NODE_COMPILE_CACHE: "/approved/compile-cache",
    NPM_CONFIG_CACHE: "/approved/npm-cache",
    NPM_CONFIG_LOGS_DIR: "/approved/npm-logs",
  };
  const display = {
    DISPLAY: ":99",
    XAUTHORITY: "/session/owned.xauthority",
    DBUS_SESSION_BUS_ADDRESS: "unix:path=/session/bus",
  };
  const forbidden = {
    NODE_PATH: "ENV_CANARY",
    NODE_OPTIONS: "ENV_CANARY",
    NPM_TOKEN: "ENV_CANARY",
    npm_config__authToken: "ENV_CANARY",
    NPM_CONFIG_USERCONFIG: "ENV_CANARY",
    NPM_CONFIG_GLOBALCONFIG: "ENV_CANARY",
    NPM_CONFIG_REGISTRY: "ENV_CANARY",
    GITHUB_TOKEN: "ENV_CANARY",
    GH_TOKEN: "ENV_CANARY",
    AWS_SECRET_ACCESS_KEY: "ENV_CANARY",
    SSH_AUTH_SOCK: "ENV_CANARY",
    DOCKER_HOST: "ENV_CANARY",
    DOCKER_CONTEXT: "ENV_CANARY",
    DOCKER_CONFIG: "ENV_CANARY",
    COLIMA_HOME: "ENV_CANARY",
    REHEARSAL_DATABASE_URL: "ENV_CANARY",
    REHEARSAL_DEVELOPMENT_ROOT: "ENV_CANARY",
    REHEARSAL_EDITOR_TEST_ROOT: "ENV_CANARY",
    REHEARSAL_NATIVE_CANCELLATION_CONFIG: "ENV_CANARY",
    REHEARSAL_USER_STATE_DIRECTORY: "/approved/unrelated-state",
    VSCODE_IPC_HOOK_CLI: "ENV_CANARY",
    ELECTRON_RUN_AS_NODE: "ENV_CANARY",
    XDG_RUNTIME_DIR: "ENV_CANARY",
    XDG_CONFIG_HOME: "ENV_CANARY",
    XDG_DATA_HOME: "ENV_CANARY",
    WAYLAND_DISPLAY: "ENV_CANARY",
    OTHER_PRIVATE_VALUE: "ENV_CANARY",
  };
  it.each(["darwin", "linux"] as const)(
    "retains only needed %s identity/storage/display values from synthetic parent data",
    (platform) => {
      const source = Object.freeze({
        ...identity,
        ...storage,
        ...display,
        ...forbidden,
      });
      const before = { ...source };
      const selected = automaticUpdateEnvironment(source, platform);
      expect(selected).toEqual({
        ...identity,
        ...storage,
        ...(platform === "linux" ? display : {}),
      });
      expect(JSON.stringify(selected)).not.toContain("ENV_CANARY");
      expect(source).toEqual(before);
    },
  );
  it("keeps reservation workers narrower than the GUI host and ignores unrelated validated storage selectors", () => {
    const selected = fixtureEnvironment.nativeUpdateEnvironment(
      { ...identity, ...display, ...forbidden },
      {
        ...storage,
        REHEARSAL_USER_STATE_DIRECTORY: "/approved/unrelated-state",
        DOCKER_HOST: "ENV_CANARY",
      },
      "linux",
    );
    expect(selected).toEqual({ ...identity, ...storage });
    expect(selected).not.toHaveProperty("DISPLAY");
    expect(selected).not.toHaveProperty("XDG_RUNTIME_DIR");
    expect(JSON.stringify(selected)).not.toContain("ENV_CANARY");
  });
  it("preserves maintained storage refusal rather than falling back for invalid cache or temp paths", () => {
    expect(() =>
      automaticUpdateEnvironment(
        { ...identity, ...storage, TMPDIR: "relative-temp" },
        "darwin",
      ),
    ).toThrow("Storage overrides must be absolute");
    expect(() =>
      automaticUpdateEnvironment(
        { ...identity, ...storage, npm_config_cache: "/conflicting/cache" },
        "linux",
      ),
    ).toThrow("Conflicting or invalid storage overrides");
  });
});

describe("native updater exact-input and installed-byte boundaries", () => {
  it("executes candidate checks directly from installed bytes and historical fixes from the frozen candidate", () => {
    const installed = "/owned/extensions/canonical-0.1.27",
      frozen = "/owned/candidate/archive/extension";
    expect(automaticUpdateRuntimeRoot("candidate", installed, frozen)).toBe(
      installed,
    );
    for (const mode of ["historical-install", "historical-recovery"])
      expect(automaticUpdateRuntimeRoot(mode, installed, frozen)).toBe(frozen);
    expect(() =>
      automaticUpdateRuntimeRoot("arbitrary-module", installed, frozen),
    ).toThrow();
    expect(() =>
      automaticUpdateRuntimeRoot("candidate", installed, installed),
    ).toThrow();
    expect(() =>
      automaticUpdateRuntimeRoot("candidate", "relative", frozen),
    ).toThrow();
  });
  it("binds the actual hash-pinned macOS executable to its Code bundle without guessing its name", () => {
    const cli =
      "/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code";
    expect(() =>
      assertAutomaticUpdateExecutablePair(
        cli,
        "/Applications/Visual Studio Code.app/Contents/MacOS/Electron",
        "darwin",
      ),
    ).not.toThrow();
    expect(() =>
      assertAutomaticUpdateExecutablePair(
        cli,
        "/Applications/Other.app/Contents/MacOS/Electron",
        "darwin",
      ),
    ).toThrow();
    expect(() =>
      assertAutomaticUpdateExecutablePair(
        "/owned/code/bin/code",
        "/owned/code/code",
        "linux",
      ),
    ).not.toThrow();
    expect(() =>
      assertAutomaticUpdateExecutablePair(
        "/owned/code/bin/code",
        "/foreign/code",
        "linux",
      ),
    ).toThrow();
    expect(() =>
      assertAutomaticUpdateExecutablePair(
        "/owned/code/bin/code",
        "/owned/code/code",
        "win32",
      ),
    ).toThrow();
  });
  const expected = {
    mode: "candidate",
    candidateSha256: "a".repeat(64),
    loadedVersion: "0.1.27",
    vscodeVersion: "1.143.0",
  };
  const finalized = () => ({
    ...expected,
    status: "passed",
    scenario: "automatic-updates",
    checks: ["observed"],
    driverFinalized: true,
    recoveryRequired: false,
    editorRecovery: {
      schemaVersion: 1,
      retainEditor: false,
      dirtyDocumentCount: 0,
      dirtyDocumentCountTruncated: false,
      reason: "clean",
    },
  });
  it("accepts only clean finalization bound to this exact candidate and native lane", () => {
    expect(() =>
      assertAutomaticUpdateFinalization(finalized(), expected),
    ).not.toThrow();
  });
  it("binds a clean failed report before permitting cleanup while refusing unsafe or foreign reports", () => {
    expect(() =>
      assertAutomaticUpdateReportBinding(
        { ...finalized(), status: "failed", checks: [] },
        expected,
      ),
    ).not.toThrow();
    expect(() =>
      assertAutomaticUpdateReportBinding(
        { ...finalized(), candidateSha256: "b".repeat(64) },
        expected,
      ),
    ).toThrow();
    expect(() =>
      assertAutomaticUpdateReportBinding(
        { ...finalized(), recoveryRequired: true },
        expected,
      ),
    ).toThrow();
  });
  it.each([
    { candidateSha256: "b".repeat(64) },
    { mode: "historical-install" },
    { loadedVersion: "0.1.26" },
    { vscodeVersion: "1.1.0" },
    { scenario: "constructor" },
    { status: "failed" },
    { checks: [] },
    { driverFinalized: false },
    { recoveryRequired: true },
    {
      editorRecovery: {
        schemaVersion: 1,
        retainEditor: false,
        dirtyDocumentCount: 1,
        dirtyDocumentCountTruncated: false,
        reason: "clean",
      },
    },
  ])("refuses foreign, incomplete, failed or unsafe finalization", (change) => {
    expect(() =>
      assertAutomaticUpdateFinalization(
        { ...finalized(), ...change },
        expected,
      ),
    ).toThrow();
  });
  it("accepts the complete explicit artifact/runtime set without adding launch switches", () => {
    expect(parseAutomaticUpdateAcceptanceArguments(exactArguments()).size).toBe(
      10,
    );
  });
  it.each([
    (values: string[]) => values.slice(1),
    (values: string[]) => [...values, values[0]!],
    (values: string[]) => [...values, "--user-data-dir=/owner"],
    (values: string[]) =>
      values.map((value) =>
        value.startsWith("--candidate=") ? "--candidate=relative.vsix" : value,
      ),
    (values: string[]) =>
      values.map((value) =>
        value.startsWith("--candidate-sha=") ? "--candidate-sha=bad" : value,
      ),
    (values: string[]) =>
      values.map((value) =>
        value.startsWith("--code-version=") ? "--code-version=latest" : value,
      ),
  ])("refuses missing, duplicate, foreign and unpinned arguments", (mutate) => {
    expect(() =>
      parseAutomaticUpdateAcceptanceArguments(mutate(exactArguments())),
    ).toThrow();
  });
  it("keeps a genuine newer official target separate from the candidate version", () => {
    expect(() =>
      assertAutomaticUpdateVersions("0.1.27", "0.1.26", "0.1.27"),
    ).not.toThrow();
    expect(() =>
      assertAutomaticUpdateVersions("0.1.28", "0.1.26", "0.1.27"),
    ).not.toThrow();
    for (const values of [
      ["0.1.27", "0.1.27", "0.1.27"],
      ["0.1.26", "0.1.25", "0.1.27"],
      ["0.1.27", "invalid", "0.1.27"],
    ])
      expect(() =>
        assertAutomaticUpdateVersions(values[0]!, values[1]!, values[2]!),
      ).toThrow();
  });
  it("allows only VS Code's installation metadata outside the exact packaged manifest", () => {
    expect(() =>
      automaticUpdateInstalledManifest(
        buffer(manifest),
        buffer({ ...manifest, __metadata: { installedTimestamp: 1 } }),
      ),
    ).not.toThrow();
    for (const value of [
      { ...manifest, version: "0.1.28" },
      { ...manifest, extra: true },
      { ...manifest, name: "rehearsal" },
    ])
      expect(() =>
        automaticUpdateInstalledManifest(buffer(manifest), buffer(value)),
      ).toThrow();
  });
  it("compares actual payload contents, extra files and native manifest bytes", async () => {
    const root = await mkdtemp(join(tmpdir(), "native-update-payload-"));
    const expected = join(root, "archive/extension"),
      installed = join(root, "installed");
    try {
      await mkdir(expected, { recursive: true });
      await mkdir(installed);
      await writeFile(
        join(root, "archive/extension.vsixmanifest"),
        "exact native identity",
      );
      await writeFile(
        join(installed, ".vsixmanifest"),
        "exact native identity",
      );
      await writeFile(join(expected, "package.json"), buffer(manifest));
      await writeFile(
        join(installed, "package.json"),
        buffer({ ...manifest, __metadata: {} }),
      );
      await writeFile(join(expected, "runtime.js"), "exact runtime");
      await writeFile(join(installed, "runtime.js"), "exact runtime");
      expect(
        await assertAutomaticUpdateInstalledPayload(expected, installed),
      ).toBe(2);
      await writeFile(join(installed, "runtime.js"), "modified runtime");
      await expect(
        assertAutomaticUpdateInstalledPayload(expected, installed),
      ).rejects.toThrow();
      await writeFile(join(installed, "runtime.js"), "exact runtime");
      await writeFile(join(installed, "unexpected.js"), "extra");
      await expect(
        assertAutomaticUpdateInstalledPayload(expected, installed),
      ).rejects.toThrow();
      await rm(join(installed, "unexpected.js"));
      await writeFile(join(installed, ".vsixmanifest"), "wrong identity");
      await expect(
        assertAutomaticUpdateInstalledPayload(expected, installed),
      ).rejects.toThrow();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

describe("owned workbench UI refusal", () => {
  it("permits only a validated localhost browser endpoint", () => {
    expect(
      ui.parseOwnedDevtoolsPort("12345\n/devtools/browser/owned-123\n"),
    ).toBe("ws://127.0.0.1:12345/devtools/browser/owned-123");
    for (const value of [
      "0\n/devtools/browser/id",
      "65536\n/devtools/browser/id",
      "123\nws://foreign/id",
      "123\n/devtools/browser/id\nextra",
      null,
    ])
      expect(() => ui.parseOwnedDevtoolsPort(value)).toThrow();
  });
  it.each(["Open Extensions", "Update Settings"])(
    "focuses exactly one visible %s button on the recovery warning",
    (label) => {
      const document: {
        activeElement?: unknown;
        querySelectorAll?: () => unknown[];
      } = {};
      const button = (visible: boolean) => ({
        disabled: false,
        textContent: label,
        getAttribute: () => null,
        getBoundingClientRect: () => ({ width: visible ? 100 : 0, height: 20 }),
        focus() {
          document.activeElement = this;
        },
      });
      const visible = button(true),
        hidden = button(false);
      let items = [visible, hidden];
      document.querySelectorAll = () => [
        {
          textContent:
            "Automatic Rehearsal extension updates need recovery review; the unverified reservation was preserved.",
          getBoundingClientRect: () => ({ width: 100, height: 100 }),
          querySelectorAll: () => items,
        },
      ];
      expect(
        runInNewContext(ui.notificationButtonProbe(label), { document }),
      ).toBe(true);
      expect(document.activeElement).toBe(visible);
      items = [hidden];
      document.activeElement = undefined;
      expect(
        runInNewContext(ui.notificationButtonProbe(label), { document }),
      ).toBe(false);
      items = [visible, button(true)];
      expect(
        runInNewContext(ui.notificationButtonProbe(label), { document }),
      ).toBe(false);
      expect(document.activeElement).toBeUndefined();
    },
  );
  it("rejects caller-selected arbitrary UI actions", () => {
    expect(() => ui.notificationButtonProbe("Delete Everything")).toThrow();
  });
});

async function workerFixture(
  phase: "preparing" | "installer-dispatched" | "live",
) {
  const root = await mkdtemp(join(tmpdir(), "native-update-worker-"));
  const runtimeRoot = join(root, "runtime"),
    storagePath = join(root, "storage"),
    loadedPath = join(root, "installed");
  await mkdir(join(runtimeRoot, "dist/src"), { recursive: true });
  await mkdir(storagePath);
  await mkdir(loadedPath);
  // The child uses the real production API through the already-installed TS loader.
  await writeFile(
    join(runtimeRoot, "dist/src/extension_update_reservation.js"),
    `module.exports=require(${JSON.stringify(resolve(__dirname, "../../src/updates/automatic/extension_update_reservation.ts"))});`,
  );
  await writeFile(join(loadedPath, "package.json"), buffer(manifest));
  const config = {
    root,
    runtimeRoot,
    storagePath,
    loadedPath,
    loadedVersion: "0.1.27",
    targetVersion: "0.1.28",
    phase,
  };
  const input = join(root, "worker.json");
  await writeFile(input, buffer(config));
  const arguments_ = [
    "--import",
    "tsx",
    resolve(
      __dirname,
      "../../scripts/native/native-update-reservation-worker.cjs",
    ),
    input,
  ];
  const acquire = () =>
    acquireExtensionUpdateReservation({
      storagePath,
      version: "0.1.28",
      installation: () =>
        readLoadedExtensionState(loadedPath, "0.1.27", loadedPath, "0.1.27"),
      ready: async () => true,
    });
  return {
    root,
    input,
    config,
    arguments_,
    acquire,
    lock: join(storagePath, "extension-update.lock"),
  };
}
describe("production-written native crash-state fixtures", () => {
  it("creates a genuinely exited preparing owner that the unchanged installation can recover", async () => {
    const fixture = await workerFixture("preparing");
    try {
      const output = await promisify(execFile)(
        process.execPath,
        fixture.arguments_,
        { timeout: 20000, maxBuffer: 4096 },
      );
      const receipt = JSON.parse(output.stdout) as {
        pid: number;
        ready: boolean;
      };
      expect(receipt.ready).toBe(true);
      expect(updateProcessState(receipt.pid)).toBe("stopped");
      expect(JSON.parse(await readFile(fixture.lock, "utf8"))).toMatchObject({
        pid: receipt.pid,
        phase: "preparing",
      });
      const reservation = await fixture.acquire();
      expect(await reservation?.owns()).toBe(true);
      await reservation?.release();
      await expect(readFile(fixture.lock)).rejects.toHaveProperty(
        "code",
        "ENOENT",
      );
    } finally {
      await rm(fixture.root, { recursive: true, force: true });
    }
  }, 25000);
  it("keeps a genuinely exited dispatched owner unconfirmed against the old loaded state", async () => {
    const fixture = await workerFixture("installer-dispatched");
    try {
      await promisify(execFile)(process.execPath, fixture.arguments_, {
        timeout: 20000,
        maxBuffer: 4096,
      });
      const bytes = await readFile(fixture.lock);
      await expect(fixture.acquire()).rejects.toHaveProperty(
        "reason",
        "installation-unconfirmed",
      );
      expect(await readFile(fixture.lock)).toEqual(bytes);
    } finally {
      await rm(fixture.root, { recursive: true, force: true });
    }
  }, 25000);
  it("keeps a live child reservation until that child's own release path runs", async () => {
    const fixture = await workerFixture("live");
    const child = spawn(process.execPath, fixture.arguments_, {
      stdio: ["pipe", "pipe", "pipe"],
    });
    child.stderr.resume();
    const closed = new Promise<number | null>((done) =>
      child.once("close", done),
    );
    try {
      await new Promise<void>((done, fail) => {
        let text = "";
        const timer = setTimeout(
          () => fail(Error("Fixture did not become ready.")),
          20000,
        );
        child.once("error", (error) => {
          clearTimeout(timer);
          fail(error);
        });
        child.stdout.on("data", (chunk: Buffer) => {
          text += chunk.toString();
          if (text.includes("\n")) {
            clearTimeout(timer);
            done();
          }
        });
      });
      const before = await readFile(fixture.lock);
      await expect(fixture.acquire()).rejects.toHaveProperty(
        "reason",
        "update-in-progress",
      );
      expect(await readFile(fixture.lock)).toEqual(before);
      child.stdin.end();
      expect(await closed).toBe(0);
      await expect(readFile(fixture.lock)).rejects.toHaveProperty(
        "code",
        "ENOENT",
      );
    } finally {
      child.stdin.end();
      await closed;
      await rm(fixture.root, { recursive: true, force: true });
    }
  }, 25000);
  it.each(["escaped", "symlink"])(
    "refuses %s storage before writing a reservation",
    async (kind) => {
      const fixture = await workerFixture("preparing");
      const outside = await mkdtemp(join(tmpdir(), "native-update-outside-"));
      try {
        if (kind === "escaped") fixture.config.storagePath = outside;
        else {
          await symlink(outside, join(fixture.root, "linked-storage"));
          fixture.config.storagePath = join(fixture.root, "linked-storage");
        }
        await writeFile(fixture.input, buffer(fixture.config));
        await expect(
          promisify(execFile)(process.execPath, fixture.arguments_, {
            timeout: 20000,
            maxBuffer: 4096,
          }),
        ).rejects.toHaveProperty("code", 1);
        await expect(
          readFile(join(outside, "extension-update.lock")),
        ).rejects.toHaveProperty("code", "ENOENT");
      } finally {
        await rm(fixture.root, { recursive: true, force: true });
        await rm(outside, { recursive: true, force: true });
      }
    },
    25000,
  );
});
