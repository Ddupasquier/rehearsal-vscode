/** Real npm integration with a headless editor adapter; not native VS Code proof. */
const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const { createHash } = require("node:crypto");
const fs = require("node:fs/promises");
const Module = require("node:module");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
const waitFor = async (check, label, milliseconds = 15000) => {
  const deadline = Date.now() + milliseconds;
  do {
    const value = await check();
    if (value) return value;
    await new Promise((resolve) => setTimeout(resolve, 50));
  } while (Date.now() < deadline);
  throw new Error(`${label} remained unverified after its deadline.`);
};
const inside = (root, target) => {
  const relative = path.relative(root, target);
  assert.ok(
    relative &&
      relative !== ".." &&
      !relative.startsWith(`..${path.sep}`) &&
      !path.isAbsolute(relative),
  );
};
class Emitter {
  constructor() {
    this.listeners = new Set();
  }
  event = (listener) => {
    this.listeners.add(listener);
    return { dispose: () => this.listeners.delete(listener) };
  };
  fire(value) {
    for (const listener of this.listeners) listener(value);
  }
  dispose() {
    this.listeners.clear();
  }
}
const absent = async (file) => {
  try {
    await fs.lstat(file);
    return false;
  } catch (error) {
    if (error.code === "ENOENT") return true;
    throw error;
  }
};

async function main() {
  assert.equal(
    process.argv.length,
    3,
    "Supply exactly the prepared verification config path.",
  );
  const config = JSON.parse(await fs.readFile(process.argv[2], "utf8"));
  for (const name of ["root", "runtimeRoot", "projectRoot", "storagePath"])
    assert.ok(
      typeof config[name] === "string" && path.isAbsolute(config[name]),
    );
  assert.notEqual(config.root, path.parse(config.root).root);
  assert.equal(await fs.realpath(config.root), config.root);
  for (const name of ["runtimeRoot", "projectRoot", "storagePath"])
    inside(config.root, config[name]);
  assert.equal(await fs.realpath(config.projectRoot), config.projectRoot);
  assert.equal(config.cliBefore, "0.1.0-rc.8");
  assert.equal(config.cliTarget, "0.1.0-rc.9");
  assert.ok(
    (await fs.readdir(config.projectRoot)).every(
      (name) =>
        !name.startsWith(".env") && !name.startsWith("rehearsal.config"),
    ),
  );
  const environment = {};
  for (const name of ["HOME", "USER", "LOGNAME", "LANG", "LC_ALL", "TMPDIR"])
    if (process.env[name]) environment[name] = process.env[name];
  environment.PATH = `${path.dirname(process.execPath)}:/usr/bin:/bin:/usr/sbin:/sbin`;
  environment.NPM_CONFIG_USERCONFIG = path.join(config.root, "npm-user");
  environment.NPM_CONFIG_GLOBALCONFIG = path.join(config.root, "npm-global");
  environment.NPM_CONFIG_CACHE = path.join(config.root, "npm-cache");
  environment.NPM_CONFIG_REGISTRY = "https://registry.npmjs.org";
  environment.NPM_CONFIG_AUDIT = "false";
  environment.NPM_CONFIG_FUND = "false";
  // The production activity adapter inherits this process's environment. Strip
  // unrelated credentials/options here too, not merely from the npm child.
  for (const name of Object.keys(process.env))
    if (!(name in environment)) delete process.env[name];
  for (const [name, value] of Object.entries(environment))
    process.env[name] = value;
  for (const file of [
    environment.NPM_CONFIG_USERCONFIG,
    environment.NPM_CONFIG_GLOBALCONFIG,
  ])
    assert.equal(
      await fs.readFile(file, "utf8"),
      "",
      "Prepared npm configuration must be empty.",
    );

  const uri = (file) => ({
    scheme: "file",
    fsPath: file,
    path: file,
    toString: () => pathToFileURL(file).href,
  });
  const folder = {
    name: "Disposable automatic-update consumer",
    uri: uri(config.projectRoot),
    index: 0,
  };
  const key = folder.uri.toString();
  const events = Object.fromEntries(
    ["folders", "close", "start", "end", "integration"].map((name) => [
      name,
      new Emitter(),
    ]),
  );
  const terminals = [];
  const executions = [];
  const settingsPath = path.join(config.root, "headless-user-settings.json");
  const activityPath = path.join(config.root, "headless-workspace-state.json");
  let automatic = { extension: false, cli: false };
  const documents = [];
  const outputLines = [];
  let child;
  let childClosed = true;
  let terminalResult;
  const adapter = {
    EventEmitter: Emitter,
    ThemeIcon: class {
      constructor(id) {
        this.id = id;
      }
    },
    ConfigurationTarget: { Global: 1 },
    Uri: { file: uri },
    workspace: {
      isTrusted: true,
      workspaceFolders: [folder],
      textDocuments: documents,
      onDidChangeWorkspaceFolders: events.folders.event,
      getConfiguration: (section) => {
        assert.equal(section, "rehearsal");
        return {
          inspect: (name) => {
            assert.equal(name, "automaticUpdates");
            return { globalValue: automatic };
          },
          update: async (name, value, scope) => {
            assert.equal(name, "automaticUpdates");
            assert.equal(scope, 1);
            automatic = { ...value };
            await fs.writeFile(settingsPath, JSON.stringify(automatic));
          },
        };
      },
    },
    window: {
      terminals,
      onDidCloseTerminal: events.close.event,
      onDidStartTerminalShellExecution: events.start.event,
      onDidEndTerminalShellExecution: events.end.event,
      onDidChangeTerminalShellIntegration: events.integration.event,
      showInformationMessage: async () => undefined,
      showWarningMessage: async () => {
        throw new Error(
          "Unexpected interactive approval in the automatic path.",
        );
      },
      showErrorMessage: async () => {
        throw new Error("Unexpected editor error notification.");
      },
      createTerminal: (options) => {
        assert.equal(options.cwd.toString(), key);
        const terminal = {
          exitStatus: undefined,
          show: () => {
            throw new Error("Automatic update must not steal terminal focus.");
          },
          sendText: () => {
            throw new Error("Unverified terminal fallback is forbidden.");
          },
          dispose: () => {
            assert.equal(
              childClosed,
              true,
              "Do not close a terminal with an unknown npm outcome.",
            );
            terminal.exitStatus = { code: 0 };
            events.close.fire(terminal);
          },
          shellIntegration: {
            cwd: folder.uri,
            executeCommand: (command, args) => {
              assert.equal(command, "npm");
              assert.equal(
                executions.length,
                0,
                "Only one real npm update may execute.",
              );
              assert.ok(
                args.includes(`@rehearsal-db/core@${config.cliTarget}`),
              );
              for (const flag of [
                "--save-dev",
                "--save-exact",
                "--ignore-scripts",
                "--no-audit",
                "--no-fund",
                "--registry=https://registry.npmjs.org",
                "--@rehearsal-db:registry=https://registry.npmjs.org",
              ])
                assert.ok(
                  args.includes(flag),
                  `Missing production npm flag ${flag}`,
                );
              child = spawn(command, args, {
                cwd: config.projectRoot,
                env: environment,
                detached: true,
                stdio: ["ignore", "pipe", "pipe"],
              });
              childClosed = false;
              const execution = {
                child,
                commandLine: { value: [command, ...args].join(" ") },
              };
              executions.push({
                command,
                arguments: [...args],
                pid: child.pid,
              });
              let bytes = 0;
              const collect = (chunk) => {
                bytes += chunk.length;
                if (bytes <= 1024 * 1024)
                  outputLines.push(chunk.toString("utf8"));
              };
              child.stdout.on("data", collect);
              child.stderr.on("data", collect);
              let killTimer;
              const deadline = setTimeout(() => {
                if (!childClosed && child.pid) {
                  terminalResult = {
                    error:
                      "Owned npm exceeded 120 seconds; group termination requested.",
                  };
                  try {
                    process.kill(-child.pid, "SIGTERM");
                  } catch {}
                  killTimer = setTimeout(() => {
                    if (!childClosed) {
                      try {
                        process.kill(-child.pid, "SIGKILL");
                      } catch {}
                    }
                  }, 2000);
                }
              }, 120000);
              child.on("error", (error) => {
                terminalResult = { error: error.message };
              });
              child.on("close", (code, signal) => {
                childClosed = true;
                clearTimeout(deadline);
                clearTimeout(killTimer);
                terminalResult = {
                  ...terminalResult,
                  code,
                  signal,
                  pid: child.pid,
                  outputBytes: bytes,
                };
                events.end.fire({
                  terminal,
                  execution,
                  exitCode: code === null ? undefined : code,
                });
              });
              queueMicrotask(() => events.start.fire({ terminal, execution }));
              return execution;
            },
          },
        };
        terminals.push(terminal);
        return terminal;
      },
    },
  };
  const runtimeDirectory = path.join(config.runtimeRoot, "dist", "src");
  const originalLoad = Module._load;
  let Actions,
    runVersion,
    runRehearsalJson,
    parseActivityData,
    readIdentity,
    parseCoreUpdate,
    fetchUpdateMetadata,
    readSettings,
    saveSettings;
  try {
    Module._load = function (request, parent, isMain) {
      if (request === "vscode") {
        assert.ok(
          parent?.filename?.startsWith(`${runtimeDirectory}${path.sep}`),
          "Only exact frozen candidate modules may receive the adapter.",
        );
        return adapter;
      }
      return originalLoad.call(this, request, parent, isMain);
    };
    const load = (name) => require(path.join(runtimeDirectory, name));
    Actions = load("workspace_actions.js").RehearsalWorkspaceActions;
    ({ runVersion, runRehearsalJson } = load("process_adapter.js"));
    ({ parseActivityData } = load("contracts.js"));
    readIdentity = load("update_identity.js").readUpdateProjectIdentity;
    ({ parseCoreUpdate, fetchUpdateMetadata } = load("update_advisory.js"));
    ({
      readAutomaticUpdateSettings: readSettings,
      saveAutomaticUpdateSettings: saveSettings,
    } = load("automatic_update_settings.js"));
  } finally {
    Module._load = originalLoad;
  }

  const resultPath = path.join(config.root, "headless-cli-result.json");
  const result = {
    status: "running",
    environment: "Headless host adapter, NOT native VS Code shell API proof",
    startedAt: new Date().toISOString(),
    nodeVersion: process.versions.node,
    checks: [],
    limitations: [
      "Editor configuration, documents, event dispatch and terminal shell integration are a scoped host adapter.",
      "npm, public CLI activity, provenance, filesystem writes and completion are actual processes/results.",
      "Native VS Code shell integration, full extension activation and extension VSIX installation remain separate checks.",
    ],
  };
  const persist = () =>
    fs.writeFile(resultPath, `${JSON.stringify(result, null, 2)}\n`);
  const state = new Map();
  const memento = {
    get: (name) => state.get(name),
    update: async (name, value) => {
      state.set(name, value);
      await fs.writeFile(
        activityPath,
        JSON.stringify(Object.fromEntries(state)),
      );
    },
  };
  const log = Object.fromEntries(
    ["info", "warn", "error"].map((level) => [
      level,
      (line) => {
        if (outputLines.length < 200) outputLines.push(`${level}: ${line}\n`);
      },
    ]),
  );
  let snapshot;
  const inspect = async () => {
    const version = await runVersion(config.projectRoot, { timeoutMs: 15000 });
    const execution = await runRehearsalJson({
      workspaceRoot: config.projectRoot,
      command: ["activity"],
      expectedCommand: "activity",
      timeoutMs: 15000,
    });
    const activity = parseActivityData(execution.result.data);
    assert.equal(activity.state, "idle");
    snapshot = {
      workspaceName: folder.name,
      workspaceRoot: config.projectRoot,
      availability: "not_ready",
      version: version.version,
      activity,
    };
  };
  const provider = {
    snapshotFor: (selected) => (selected === key ? snapshot : undefined),
    refreshWorkspace: inspect,
    publishOperationActivity: () => {},
  };
  let actions;
  try {
    await persist();
    await inspect();
    assert.equal(snapshot.version, config.cliBefore);
    const before = await readIdentity(config.projectRoot, config.cliBefore);
    assert.equal(before.origin, "registry");
    assert.equal(before.dependencyGroup, "devDependencies");
    const canary =
      config.scriptCanaryPath ??
      path.join(config.projectRoot, "INSTALL_SCRIPT_RAN");
    inside(config.projectRoot, canary);
    assert.ok(await absent(canary));
    const abort = new AbortController();
    const deadline = setTimeout(() => abort.abort(), 15000);
    let metadata;
    try {
      metadata = await fetchUpdateMetadata("corePreview", abort.signal);
    } finally {
      clearTimeout(deadline);
      abort.abort();
    }
    assert.equal(parseCoreUpdate(metadata), config.cliTarget);
    const verify = async () => {
      if (!readSettings().cli) return false;
      const current = await readIdentity(config.projectRoot, config.cliBefore);
      return (
        current.origin === "registry" &&
        current.fingerprint === before.fingerprint &&
        current.version === before.version &&
        current.dependencyGroup === before.dependencyGroup
      );
    };
    actions = new Actions(provider, log, memento);
    const update = () =>
      actions.updatePackageVersion(
        key,
        config.cliBefore,
        config.cliTarget,
        verify,
        "devDependencies",
        {
          automatic: true,
          coordinationDirectory: path.join(config.storagePath, "headless-cli"),
        },
      );
    const manifestPath = path.join(config.projectRoot, "package.json");
    const beforeHash = sha(await fs.readFile(manifestPath));
    await saveSettings({ extension: false, cli: false });
    assert.equal(await update(), false);
    assert.equal(executions.length, 0);
    assert.equal(sha(await fs.readFile(manifestPath)), beforeHash);
    result.checks.push({
      name: "revoked-consent",
      status: "passed",
      npmProcesses: 0,
    });
    await saveSettings({ extension: false, cli: true });
    documents.push({ uri: uri(manifestPath), isDirty: true });
    assert.equal(await update(), false);
    assert.equal(executions.length, 0);
    assert.equal(sha(await fs.readFile(manifestPath)), beforeHash);
    documents.length = 0;
    result.checks.push({
      name: "dirty-manifest-deferral",
      status: "passed",
      npmProcesses: 0,
    });
    await persist();
    assert.equal(
      await update(),
      true,
      "Production automatic command did not dispatch.",
    );
    await waitFor(
      () => childClosed && terminalResult,
      "actual npm child completion",
      125000,
    );
    assert.equal(terminalResult.error, undefined);
    assert.equal(terminalResult.signal, null);
    assert.equal(terminalResult.code, 0);
    assert.equal(executions.length, 1);
    await waitFor(
      () =>
        actions
          .activityFor(key)
          .some(
            (entry) => entry.outcome === "completed" && entry.exitCode === 0,
          ),
      "completed production activity receipt",
    );
    const manifest = JSON.parse(await fs.readFile(manifestPath, "utf8"));
    assert.equal(
      manifest.devDependencies["@rehearsal-db/core"],
      config.cliTarget,
    );
    assert.equal(manifest.dependencies?.["@rehearsal-db/core"], undefined);
    assert.equal(
      manifest.optionalDependencies?.["@rehearsal-db/core"],
      undefined,
    );
    const after = await readIdentity(config.projectRoot, config.cliTarget);
    assert.equal(after.origin, "registry");
    assert.equal(after.version, config.cliTarget);
    assert.equal(after.dependencyGroup, "devDependencies");
    assert.ok(await absent(canary));
    assert.deepEqual(
      await fs.readdir(
        path.join(config.storagePath, "headless-cli", "package-update-leases"),
      ),
      [],
    );
    result.checks.push({
      name: "real-npm-execution",
      status: "passed",
      from: config.cliBefore,
      to: config.cliTarget,
      executions,
      completion: terminalResult,
      registryIdentity: after.origin,
      exactDependencyGroup: after.dependencyGroup,
      lifecycleScriptNotRun: true,
      leaseReleased: true,
      completedReceipt: true,
    });
    result.status = "passed";
  } catch (error) {
    result.status = "failed";
    result.error = error instanceof Error ? error.message : String(error);
    throw error;
  } finally {
    if (childClosed) for (const terminal of terminals) terminal.dispose();
    actions?.dispose();
    await saveSettings({ extension: false, cli: false }).catch(() => {});
    await fs.writeFile(
      path.join(config.root, "headless-cli.log"),
      outputLines.join(""),
    );
    result.finishedAt = new Date().toISOString();
    await persist();
  }
  console.log(
    JSON.stringify({
      status: result.status,
      resultPath,
      evidenceType: result.environment,
    }),
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
