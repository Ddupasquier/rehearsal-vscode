/** Installed native recovery and historical installer component acceptance. */
const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const { createHash, randomUUID } = require("node:crypto");
const fs = require("node:fs/promises");
const path = require("node:path");
const { setTimeout: delay } = require("node:timers/promises");
const vscode = require("vscode");
const { readConfiguration } = require("./native-editor-driver.cjs");
const { readRegular, writeJson } = require("./native-editor-reads.cjs");
const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
const id = "rehearsal-db.rehearsal-db";
async function wait(check, milliseconds = 30000) {
  const end = Date.now() + milliseconds;
  do {
    const value = await check();
    if (value) return value;
    await delay(100);
  } while (Date.now() < end);
  throw Error("Owned native update observation incomplete.");
}
async function missing(file) {
  try {
    await fs.lstat(file);
    return false;
  } catch (error) {
    if (error.code === "ENOENT") return true;
    throw error;
  }
}
const updatePhases = new Set([
  "blocked-extensions",
  "returned-extensions",
  "blocked-settings",
  "returned-settings",
  "done",
]);
exports.publishUpdatePhase = async ({
  phase,
  root,
  write = writeJson,
  read = readRegular,
  now = Date.now,
  pause = delay,
}) => {
  assert.ok(updatePhases.has(phase));
  const nonce = randomUUID(),
    deadline = now() + 30000;
  await write(path.join(root, "phase.json"), { phase, nonce, deadline });
  if (phase === "done") return;
  while (now() < deadline) {
    try {
      const ack = JSON.parse(
        (await read(path.join(root, "ack.json"), 1024)).bytes.toString("utf8"),
      );
      if (now() < deadline && ack.phase === phase && ack.nonce === nonce)
        return;
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
    const remaining = deadline - now();
    if (remaining > 0) await pause(Math.min(100, remaining));
  }
  const error = Error("Owned native update phase acknowledgement incomplete.");
  error.code = "NATIVE_UPDATE_PHASE_TIMEOUT";
  throw error;
};
exports.run = async () => {
  const config = await readConfiguration();
  assert.equal(config.scenario, "automatic-updates");
  assert.ok(
    ["candidate", "historical-install", "historical-recovery"].includes(
      config.mode,
    ),
  );
  const extension = vscode.extensions.getExtension(id);
  assert.ok(
    extension && !vscode.extensions.getExtension("rehearsal-db.rehearsal"),
  );
  assert.equal(
    await fs.realpath(extension.extensionPath),
    config.installedPath,
  );
  assert.equal(extension.packageJSON.version, config.loadedVersion);
  assert.equal(vscode.workspace.isTrusted, true);
  assert.equal(vscode.workspace.workspaceFolders?.length, 1);
  const folder = vscode.workspace.workspaceFolders[0];
  assert.equal(folder.uri.fsPath, config.workspace);
  assert.deepEqual(await fs.readdir(config.workspace), []);
  await extension.activate();
  const load = (name) =>
    require(path.join(config.runtimeRoot, "dist/src", `${name}.js`));
  const api = load("extension_update_reservation");
  const { AutomaticExtensionInstaller } = load("extension_auto_update");
  const { createUpdateAdvisory } = load("update_advisory_host");
  const { readAutomaticUpdateSettings, saveAutomaticUpdateSettings } = load(
    "automatic_update_settings",
  );
  const installedState = () => {
    const current = vscode.extensions.getExtension(id);
    return api.readLoadedExtensionState(
      extension.extensionPath,
      config.loadedVersion,
      current?.extensionUri.fsPath,
      current?.packageJSON.version,
    );
  };
  const result = {
    status: "running",
    failurePhase: `${config.mode}-setup`,
    mode: config.mode,
    checks: [],
    candidateSha256: config.candidateSha256,
    loadedVersion: config.loadedVersion,
    vscodeVersion: vscode.version,
    nodeVersion: process.versions.node,
    limitations: [
      "Candidate full activation and historical installer component evidence are separate.",
      "Synthetic future release metadata is used only for a blocked candidate warning before any artifact download.",
      "Crash-state reservations are deliberately created by an exited test-owned process through the production API; this does not recreate a real VS Code crash.",
      "No database, CLI update, owner profile, full candidate-activation upgrade or assistive-technology behavior is exercised.",
    ],
  };
  const lockPath = path.join(config.storagePath, "extension-update.lock");
  let liveWorker, installer, advisory;
  let installationStarted = false,
    installationAccepted = false;
  const pendingWorkers = new Set();
  let terminals = 0;
  const terminalListener = vscode.window.onDidOpenTerminal(() => terminals++);
  const save = () => writeJson(config.resultPath, result);
  const release = async (reservation) => {
    assert.ok(reservation && (await reservation.owns()));
    await reservation.release();
    assert.ok(await missing(lockPath));
  };
  const acquire = (version, ready = async () => true) =>
    api.acquireExtensionUpdateReservation({
      storagePath: config.storagePath,
      version,
      installation: installedState,
      ready,
    });
  const worker = async (phase, targetVersion) => {
    const input = path.join(config.root, "reservation-worker.json");
    await writeJson(input, {
      root: config.fixtureRoot,
      runtimeRoot: config.runtimeRoot,
      storagePath: config.storagePath,
      loadedPath: extension.extensionPath,
      loadedVersion: config.loadedVersion,
      targetVersion,
      phase,
    });
    const workerEnvironment =
      require("./native-update-reservation-worker.cjs").nativeUpdateEnvironment(
        process.env,
        load("platform_runtime").storageEnvironment(process.env),
        process.platform,
      );
    const child = spawn(
      process.execPath,
      [path.join(__dirname, "native-update-reservation-worker.cjs"), input],
      {
        env: { ...workerEnvironment, ELECTRON_RUN_AS_NODE: "1" },
        stdio: ["pipe", "pipe", "pipe"],
      },
    );
    pendingWorkers.add(child);
    let stdout = "",
      exited = false,
      code,
      fault;
    child.on("error", (error) => {
      fault = error;
    });
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString("utf8");
      if (stdout.length > 1024)
        fault = Error("Worker output exceeded its bound.");
    });
    child.stderr.resume();
    const closed = new Promise((done) =>
      child.once("close", (value) => {
        exited = true;
        code = value;
        pendingWorkers.delete(child);
        done(value);
      }),
    );
    await wait(() => {
      if (fault) throw fault;
      if (exited && code !== 0) throw Error("Owned reservation worker failed.");
      return stdout.includes("\n");
    }, 15000);
    const receipt = JSON.parse(stdout.trim());
    assert.equal(receipt.ready, true);
    assert.equal(receipt.pid, child.pid);
    if (phase === "live") {
      assert.equal(exited, false);
      return { child, closed };
    }
    await wait(() => exited, 15000);
    assert.equal(code, 0);
    assert.equal(api.updateProcessState(receipt.pid), "stopped");
    return receipt;
  };
  const publish = (phase) =>
    exports.publishUpdatePhase({ phase, root: config.root });
  const failureStages = new Set([
    "historical-install",
    "historical-recovery",
    ...["extensions", "settings"].flatMap((destination) => [
      `advisory-check-${destination}`,
      `phase-ack-blocked-${destination}`,
      `advisory-resume-${destination}`,
      `workspace-return-${destination}`,
      `phase-ack-returned-${destination}`,
    ]),
  ]);
  const stage = async (phase) => {
    assert.ok(failureStages.has(phase));
    result.failurePhase = phase;
    await save();
  };

  try {
    await save();
    assert.deepEqual(readAutomaticUpdateSettings(), {
      extension: false,
      cli: false,
    });
    const loaded = await installedState();
    assert.ok(
      loaded,
      "Registered and actually loaded installation must agree initially.",
    );
    result.checks.push(
      "exact installed extension activated with its actual path/version",
    );
    if (config.mode === "candidate") {
      const future = config.futureVersion;
      await worker("preparing", future);
      await release(await acquire(future));
      result.checks.push(
        "exited preparing owner recovered against exact loaded candidate snapshot",
      );
      liveWorker = await worker("live", future);
      const liveBefore = sha((await readRegular(lockPath, 16384)).bytes);
      await assert.rejects(
        acquire(future),
        (error) => error.reason === "update-in-progress",
      );
      assert.equal(sha((await readRegular(lockPath, 16384)).bytes), liveBefore);
      liveWorker.child.stdin.end();
      assert.equal(await liveWorker.closed, 0);
      liveWorker = undefined;
      assert.ok(await missing(lockPath));
      result.checks.push(
        "live owner refused and reservation retained until its own release",
      );
      await worker("preparing", future);
      const canary = Buffer.from("foreign replacement reservation\n");
      await assert.rejects(
        acquire(future, async () => {
          await fs.rename(
            lockPath,
            path.join(config.root, "original-reservation.json"),
          );
          await fs.writeFile(lockPath, canary, { mode: 0o600, flag: "wx" });
          return true;
        }),
        (error) => ["lock-unverified", "lock-changed"].includes(error.reason),
      );
      assert.deepEqual((await readRegular(lockPath, 16384)).bytes, canary);
      // Preserve the negative fixture; remove no unverified reservation.
      await fs.rename(
        lockPath,
        path.join(config.root, "replacement-preserved.txt"),
      );
      const temp = path.join(config.root, "owned-update.vsix");
      await fs.writeFile(temp, "owned fixture", { flag: "wx", mode: 0o600 });
      const identity = api.updateFileIdentity(
        await fs.lstat(temp, { bigint: true }),
      );
      await fs.rename(temp, path.join(config.root, "original-update.vsix"));
      await fs.writeFile(temp, "foreign VSIX canary", {
        flag: "wx",
        mode: 0o600,
      });
      assert.equal(await api.removeOwnedUpdateFile(temp, identity), false);
      assert.equal(await fs.readFile(temp, "utf8"), "foreign VSIX canary");
      result.checks.push(
        "replacement reservation and temporary VSIX preserved by production helpers",
      );
      await fs.writeFile(lockPath, "malformed owned test reservation", {
        flag: "wx",
        mode: 0o600,
      });
      const malformedBefore = sha((await readRegular(lockPath, 16384)).bytes);
      const context = require("./native-editor-driver.cjs").context;
      assert.ok(context);
      await saveAutomaticUpdateSettings({ extension: true, cli: false });
      for (const destination of ["extensions", "settings"]) {
        advisory = createUpdateAdvisory({
          projects: {
            snapshotFor: () => ({
              availability: "package_missing",
              workspaceRoot: config.workspace,
              workspaceName: folder.name,
            }),
          },
          actions: {
            updatePackageVersion: async () =>
              assert.fail("Core update must not dispatch."),
          },
          state: context.workspaceState,
          version: config.loadedVersion,
          preview: true,
          extensionUri: extension.extensionUri,
          storagePath: config.storagePath,
          request: async (kind) =>
            kind === "extension"
              ? [
                  {
                    tag_name: `v${future}`,
                    draft: false,
                    prerelease: false,
                    html_url: `https://github.com/Ddupasquier/rehearsal-vscode/releases/tag/v${future}`,
                    assets: [
                      { name: `rehearsal-db-${future}.vsix` },
                      { name: "SHA256SUMS" },
                    ],
                  },
                ]
              : null,
        });
        await stage(`advisory-check-${destination}`);
        await advisory.check(folder.uri.toString());
        await stage(`phase-ack-blocked-${destination}`);
        await publish(`blocked-${destination}`);
        assert.equal(
          sha((await readRegular(lockPath, 16384)).bytes),
          malformedBefore,
        );
        assert.deepEqual(readAutomaticUpdateSettings(), {
          extension: true,
          cli: false,
        });
        await stage(`advisory-resume-${destination}`);
        await advisory.resumeAutomatic(folder.uri.toString());
        advisory.dispose();
        advisory = undefined;
        await stage(`workspace-return-${destination}`);
        await vscode.commands.executeCommand(
          "rehearsal.openWorkspace",
          folder.uri.toString(),
        );
        await wait(() => {
          const tab = vscode.window.tabGroups.activeTabGroup.activeTab;
          return (
            tab?.input instanceof vscode.TabInputWebview &&
            /Rehearsal/u.test(tab.label)
          );
        });
        await stage(`phase-ack-returned-${destination}`);
        await publish(`returned-${destination}`);
      }
      result.checks.push(
        "synthetic future metadata blocked before download; native recovery actions, unchanged opt-ins and return to installed Rehearsal observed",
      );
    } else if (config.mode === "historical-install") {
      await worker("preparing", config.targetVersion);
      installer = new AutomaticExtensionInstaller({
        storagePath: config.storagePath,
        loadedVersion: config.loadedVersion,
        loadedExtensionPath: extension.extensionPath,
        preview: true,
      });
      await stage("historical-install");
      installationStarted = true;
      assert.equal(
        await installer.install(
          config.targetVersion,
          () =>
            !readAutomaticUpdateSettings().extension &&
            !readAutomaticUpdateSettings().cli,
          async () => true,
        ),
        true,
      );
      installationAccepted = true;
      assert.ok(await missing(lockPath));
      assert.deepEqual(await fs.readdir(config.storagePath), []);
      result.checks.push(
        "explicitly authorized candidate installer component recovered preparing reservation and real VS Code accepted default official verified target; installed extension automatic settings remained off",
      );
      await worker("installer-dispatched", config.targetVersion);
      const pendingBefore = sha((await readRegular(lockPath, 16384)).bytes);
      await assert.rejects(
        acquire(config.targetVersion),
        (error) => error.reason === "installation-unconfirmed",
      );
      assert.equal(
        sha((await readRegular(lockPath, 16384)).bytes),
        pendingBefore,
      );
      result.checks.push(
        "deliberate exited dispatched fixture retained while old version remains loaded; actual installer completion does not claim target activation",
      );
    } else {
      await stage("historical-recovery");
      assert.equal(config.loadedVersion, config.targetVersion);
      await release(await acquire(config.targetVersion));
      result.checks.push(
        "after owned profile restart, actual loaded official target proves safe dispatched-reservation recovery",
      );
    }
    assert.equal(terminals, 0);
    assert.deepEqual(await fs.readdir(config.workspace), []);
    await publish("done");
    result.status = "passed";
    delete result.failurePhase;
  } catch (error) {
    result.status = "failed";
    try {
      const settings = readAutomaticUpdateSettings();
      result.expectedOptinsMatch =
        settings.extension === (config.mode === "candidate") &&
        settings.cli === false;
    } catch {
      result.expectedOptinsMatch = null;
    }
    if (installationStarted && !installationAccepted)
      result.recoveryRequired = true;
    result.failureCode =
      error.code === "ERR_ASSERTION"
        ? "ASSERTION_FAILED"
        : "NATIVE_UPDATE_ACCEPTANCE_FAILED";
    throw error;
  } finally {
    advisory?.dispose();
    installer?.dispose();
    terminalListener.dispose();
    if (liveWorker) {
      // Let only this captured child's own release path run; unknown closure retains recovery.
      liveWorker.child.stdin.end();
      try {
        await Promise.race([
          liveWorker.closed,
          delay(5000).then(() => {
            throw Error();
          }),
        ]);
      } catch {
        result.recoveryRequired = true;
      }
    }
    if (pendingWorkers.size > 0) result.recoveryRequired = true;
    await saveAutomaticUpdateSettings({ extension: false, cli: false }).catch(
      () => {
        result.recoveryRequired = true;
      },
    );
    await save();
  }
};
