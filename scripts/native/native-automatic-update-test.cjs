/** Native VS Code integration runner. Run only through verify-automatic-updates.ts. */
const assert = require("node:assert/strict");
const { createHash } = require("node:crypto");
const fs = require("node:fs/promises");
const path = require("node:path");
const vscode = require("vscode");

let extensionContext;
exports.activate = (context) => {
  extensionContext = context;
  return { context };
};

const pause = (milliseconds) =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));
const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");
const within = (root, target) => {
  const relative = path.relative(root, target);
  assert.ok(relative && !relative.startsWith(`..${path.sep}`));
  assert.ok(relative !== ".." && !path.isAbsolute(relative));
};
const absent = async (file) => {
  try {
    await fs.lstat(file);
    return false;
  } catch (error) {
    if (error.code === "ENOENT") return true;
    throw error;
  }
};
const waitFor = async (check, milliseconds, label) => {
  const deadline = Date.now() + milliseconds;
  do {
    const result = await check();
    if (result) return result;
    await pause(100);
  } while (Date.now() < deadline);
  throw new Error(`Timed out waiting for ${label}; completion is unverified.`);
};
const bounded = async (action, milliseconds, label) => {
  let timer;
  try {
    return await Promise.race([
      action(),
      new Promise((_, reject) => {
        timer = setTimeout(
          () => reject(new Error(`${label} exceeded its bounded deadline.`)),
          milliseconds,
        );
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
};

exports.run = async () => {
  const configPath = process.env.REHEARSAL_AUTO_VERIFY_CONFIG;
  assert.ok(configPath, "An isolated verification configuration is required.");
  const config = JSON.parse(await fs.readFile(configPath, "utf8"));
  const required = [
    "root",
    "runtimeRoot",
    "emptyRoot",
    "projectRoot",
    "resultPath",
    "storagePath",
  ];
  for (const name of required)
    assert.ok(
      typeof config[name] === "string" && path.isAbsolute(config[name]),
    );
  assert.notEqual(config.root, path.parse(config.root).root);
  assert.equal(await fs.realpath(config.root), config.root);
  for (const name of required.filter((name) => name !== "root"))
    within(config.root, config[name]);
  assert.equal(config.extensionBefore, "0.1.11");
  assert.equal(config.extensionTarget, "0.1.12");
  assert.equal(config.cliBefore, "0.1.0-rc.8");
  assert.equal(config.cliTarget, "0.1.0-rc.9");
  assert.equal(vscode.workspace.isTrusted, true);
  const folders = vscode.workspace.workspaceFolders ?? [];
  assert.equal(
    folders.length,
    2,
    "Only the two disposable folders may be open.",
  );
  const folderFor = (root) => folders.find(({ uri }) => uri.fsPath === root);
  const consumer = folderFor(config.projectRoot);
  const empty = folderFor(config.emptyRoot);
  assert.ok(consumer && empty && consumer.uri.scheme === "file");
  assert.equal(await fs.realpath(config.projectRoot), config.projectRoot);
  assert.deepEqual(await fs.readdir(config.emptyRoot), []);
  assert.ok(
    (await fs.readdir(config.projectRoot)).every(
      (name) =>
        !name.startsWith(".env") && !name.startsWith("rehearsal.config"),
    ),
    "The disposable package consumer must not have database configuration.",
  );
  const installedExtension = vscode.extensions.getExtension(
    "rehearsal-db.rehearsal",
  );
  assert.equal(installedExtension?.packageJSON.version, config.extensionBefore);
  const companion = await vscode.extensions
    .getExtension("rehearsal-verification.automatic-updates")
    ?.activate();
  extensionContext = companion?.context ?? extensionContext;
  assert.ok(
    extensionContext,
    "The isolated companion extension did not activate.",
  );
  const runtime = (name) =>
    require(path.join(config.runtimeRoot, "dist", "src", name));
  const { runVersion, runRehearsalJson } = runtime("process_adapter.js");
  const { parseActivityData } = runtime("contracts.js");
  const { readUpdateProjectIdentity } = runtime("update_identity.js");
  const { createUpdateAdvisory } = runtime("update_advisory_host.js");
  const { RehearsalWorkspaceActions } = runtime("workspace_actions.js");
  const { fetchUpdateMetadata, parseCoreUpdate } =
    runtime("update_advisory.js");
  const { readAutomaticUpdateSettings, saveAutomaticUpdateSettings } = runtime(
    "automatic_update_settings.js",
  );
  const key = consumer.uri.toString();
  const emptyKey = empty.uri.toString();
  const result = {
    status: "running",
    startedAt: new Date().toISOString(),
    vscodeVersion: vscode.version,
    nodeVersion: process.versions.node,
    runtimeRoot: config.runtimeRoot,
    checks: [],
    limitations: [
      "Exact candidate updater modules execute in a companion native extension host, not the candidate's complete activation path.",
      "Official historical releases exercise compatible upgrades without publishing a new release or changing the owner's installation.",
      "Native extension installation acceptance is checked separately against the installed disk bytes by the parent runner.",
      "No database configuration, migrations, runtime lifecycle, or hosted database operation is exercised.",
    ],
  };
  const saveResult = () =>
    fs.writeFile(config.resultPath, `${JSON.stringify(result, null, 2)}\n`);
  const output = vscode.window.createOutputChannel(
    "Rehearsal automatic update verification",
    { log: true },
  );
  let actions;
  let advisory;
  let listener;
  let terminal;
  let ended;
  const commandEvents = [];
  let snapshot;
  const inspectConsumer = async () => {
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
      workspaceName: consumer.name,
      workspaceRoot: config.projectRoot,
      availability: "not_ready",
      version: version.version,
      activity,
    };
  };
  const missing = {
    workspaceName: empty.name,
    workspaceRoot: config.emptyRoot,
    availability: "package_missing",
  };
  const projects = {
    snapshotFor: (workspaceKey) =>
      workspaceKey === key
        ? snapshot
        : workspaceKey === emptyKey
          ? missing
          : undefined,
    refreshWorkspace: async (workspaceKey) => {
      if (workspaceKey === key) await inspectConsumer();
    },
    publishOperationActivity: () => {},
  };
  const manifestPath = path.join(config.projectRoot, "package.json");
  const canary =
    config.scriptCanaryPath ??
    path.join(config.projectRoot, "INSTALL_SCRIPT_RAN");
  within(config.projectRoot, canary);
  try {
    await saveResult();
    await inspectConsumer();
    assert.equal(snapshot.version, config.cliBefore);
    const before = await readUpdateProjectIdentity(
      config.projectRoot,
      config.cliBefore,
    );
    assert.equal(before.origin, "registry");
    assert.equal(before.dependencyGroup, "devDependencies");
    assert.ok(await absent(canary));
    actions = new RehearsalWorkspaceActions(
      projects,
      output,
      extensionContext.workspaceState,
    );

    // The genuinely empty folder prevents unrelated newer core metadata from
    // opening a manual compatibility review during this extension-only phase.
    await saveAutomaticUpdateSettings({ extension: true, cli: false });
    assert.deepEqual(readAutomaticUpdateSettings(), {
      extension: true,
      cli: false,
    });
    const releases = [];
    advisory = createUpdateAdvisory({
      projects,
      actions,
      state: extensionContext.workspaceState,
      version: installedExtension.packageJSON.version,
      preview: true,
      extensionUri: vscode.Uri.file(config.runtimeRoot),
      storagePath: config.storagePath,
      onExtensionRelease: (_, evidence) => releases.push(evidence),
    });
    await bounded(
      () => advisory.check(emptyKey),
      60000,
      "live automatic extension installation",
    );
    assert.ok(
      releases.some(
        (release) =>
          release.status === "checked" &&
          release.latestVersion === config.extensionTarget,
      ),
    );
    assert.ok(
      await absent(path.join(config.storagePath, "extension-update.lock")),
    );
    result.checks.push({
      name: "live-extension-automatic-queue",
      status: "completed",
      from: config.extensionBefore,
      to: config.extensionTarget,
      metadata:
        "Default live official GitHub metadata and artifact downloader; no injected network, activity or installer response.",
      diskVerification: "required-by-parent",
    });
    advisory.dispose();
    advisory = undefined;
    await saveResult();

    // Current latest is a different compatibility series. The separately checked
    // official beta tag supplies an actual published same-series test target.
    const abort = new AbortController();
    const metadata = await bounded(
      () => fetchUpdateMetadata("corePreview", abort.signal),
      15000,
      "official compatible CLI metadata",
    ).finally(() => abort.abort());
    assert.equal(parseCoreUpdate(metadata), config.cliTarget);
    const verifyIdentity = async () => {
      if (!readAutomaticUpdateSettings().cli) return false;
      const current = await readUpdateProjectIdentity(
        config.projectRoot,
        config.cliBefore,
      );
      return (
        current.origin === "registry" &&
        current.fingerprint === before.fingerprint &&
        current.version === before.version &&
        current.dependencyGroup === before.dependencyGroup
      );
    };
    const update = () =>
      actions.updatePackageVersion(
        key,
        config.cliBefore,
        config.cliTarget,
        verifyIdentity,
        "devDependencies",
        {
          automatic: true,
          coordinationDirectory: path.join(
            config.storagePath,
            "cli-update-coordination",
          ),
        },
      );
    const manifestBefore = await fs.readFile(manifestPath);
    const terminalCount = vscode.window.terminals.length;
    await saveAutomaticUpdateSettings({ extension: false, cli: false });
    assert.equal(await update(), false);
    assert.equal(vscode.window.terminals.length, terminalCount);
    assert.equal(
      digest(await fs.readFile(manifestPath)),
      digest(manifestBefore),
    );
    result.checks.push({
      name: "revoked-cli-consent",
      status: "passed",
      dispatched: false,
    });

    await saveAutomaticUpdateSettings({ extension: false, cli: true });
    assert.deepEqual(readAutomaticUpdateSettings(), {
      extension: false,
      cli: true,
    });
    const document = await vscode.workspace.openTextDocument(
      vscode.Uri.file(manifestPath),
    );
    await vscode.window.showTextDocument(document, { preview: false });
    const edit = new vscode.WorkspaceEdit();
    edit.insert(
      document.uri,
      document.positionAt(document.getText().length),
      "\n",
    );
    assert.equal(await vscode.workspace.applyEdit(edit), true);
    assert.equal(document.isDirty, true);
    try {
      assert.equal(await update(), false);
      assert.equal(vscode.window.terminals.length, terminalCount);
      assert.equal(
        digest(await fs.readFile(manifestPath)),
        digest(manifestBefore),
      );
      result.checks.push({
        name: "dirty-manifest-deferral",
        status: "passed",
        dispatched: false,
      });
    } finally {
      assert.equal(
        vscode.window.activeTextEditor?.document.uri.toString(),
        document.uri.toString(),
      );
      await vscode.commands.executeCommand("workbench.action.files.revert");
      assert.equal(document.isDirty, false);
      assert.equal(
        digest(await fs.readFile(manifestPath)),
        digest(manifestBefore),
      );
    }
    await saveResult();

    listener = vscode.window.onDidEndTerminalShellExecution((event) => {
      const command = event.execution.commandLine.value;
      if (!command.includes(`@rehearsal-db/core@${config.cliTarget}`)) return;
      terminal = event.terminal;
      ended = { exitCode: event.exitCode, command };
      commandEvents.push(ended);
    });
    assert.equal(
      await update(),
      true,
      "The real automatic CLI command did not dispatch.",
    );
    await waitFor(() => ended, 120000, "native npm shell execution completion");
    assert.equal(
      ended.exitCode,
      0,
      "Native npm did not report successful completion.",
    );
    assert.equal(commandEvents.length, 1);
    for (const argument of [
      "--save-dev",
      "--save-exact",
      "--ignore-scripts",
      "--no-audit",
      "--no-fund",
      "--registry=https://registry.npmjs.org",
      "--@rehearsal-db:registry=https://registry.npmjs.org",
    ])
      assert.ok(
        ended.command.includes(argument),
        `Missing exact npm argument ${argument}`,
      );
    await waitFor(
      () =>
        actions
          .activityFor(key)
          .find(
            (entry) =>
              entry.label === "Update Rehearsal" &&
              entry.outcome === "completed" &&
              entry.exitCode === 0,
          ),
      15000,
      "the production completed-activity receipt",
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
    const after = await readUpdateProjectIdentity(
      config.projectRoot,
      config.cliTarget,
    );
    assert.equal(after.origin, "registry");
    assert.equal(after.version, config.cliTarget);
    assert.equal(after.dependencyGroup, "devDependencies");
    assert.ok(
      await absent(canary),
      "An install lifecycle script unexpectedly ran.",
    );
    const leaseRoot = path.join(
      config.storagePath,
      "cli-update-coordination",
      "package-update-leases",
    );
    assert.deepEqual(await fs.readdir(leaseRoot), []);
    result.checks.push({
      name: "native-compatible-cli-automatic-execution",
      status: "passed",
      from: config.cliBefore,
      to: config.cliTarget,
      targetMetadata:
        "Live official npm beta metadata, separately validated before direct production updatePackageVersion invocation.",
      exitCode: ended.exitCode,
      command: ended.command,
      registryIdentity: after.origin,
      dependencyGroup: after.dependencyGroup,
      scriptCanaryAbsent: true,
      leaseReleased: true,
      completedActivityReceipt: true,
    });
    result.status = "passed";
  } catch (error) {
    result.status = "failed";
    result.error = error instanceof Error ? error.message : String(error);
    throw error;
  } finally {
    advisory?.dispose();
    listener?.dispose();
    // Only close a terminal whose actual native completion was observed.
    if (ended && ended.exitCode !== undefined) terminal?.dispose();
    actions?.dispose();
    await saveAutomaticUpdateSettings({ extension: false, cli: false }).catch(
      () => {},
    );
    output.dispose();
    result.finishedAt = new Date().toISOString();
    await saveResult();
  }
};
