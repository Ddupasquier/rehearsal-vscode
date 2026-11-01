/** Native companion runner. No API/notification mocks; invoke only through its launcher. */
const assert = require("node:assert/strict");
const { spawn, execFile } = require("node:child_process");
const { randomUUID } = require("node:crypto");
const fs = require("node:fs/promises");
const path = require("node:path");
const { promisify } = require("node:util");
const { setTimeout: delay } = require("node:timers/promises");
const vscode = require("vscode");
const execute = promisify(execFile);
const {
  processes,
  same,
  collect,
  writeJson,
  createReadClient,
} = require("./native-editor-reads.cjs");

function diagnostic(error) {
  const code =
    typeof error?.code === "string" &&
    /^[A-Z][A-Z0-9_]{0,63}$/u.test(error.code)
      ? error.code
      : typeof error?.code === "number" && Number.isSafeInteger(error.code)
        ? `EXIT_${error.code}`
        : "UNCLASSIFIED_ERROR";
  const location =
    typeof error?.stack === "string"
      ? error.stack.match(
          /(?:native-cancellation-test|runner)\.cjs:(\d{1,7}):(\d{1,5})/u,
        )
      : undefined;
  return {
    code,
    location: location
      ? `native-cancellation-test.cjs:${location[1]}:${location[2]}`
      : "native-cancellation-test",
  };
}

exports.run = async () => {
  const config = JSON.parse(
    await fs.readFile(process.env.REHEARSAL_NATIVE_CANCELLATION_CONFIG, "utf8"),
  );
  const fixture = config.fixture;
  const result = {
    status: "running",
    checks: [],
    terminalEvents: [],
    vscodeVersion: vscode.version,
    nodeVersion: process.versions.node,
  };
  let phase = "initialization",
    terminal,
    execution,
    terminalPid,
    terminalIdentity,
    sentinel,
    sentinelIdentity,
    monitor;
  let terminalClosed = false,
    sentinelClosed = false,
    collecting,
    observationFailure;
  const descendants = new Map(),
    readChildren = new Map();
  const listeners = [];
  const environment = {};
  for (const key of [
    "HOME",
    "USER",
    "LOGNAME",
    "LANG",
    "LC_ALL",
    "TMPDIR",
    "PATH",
  ])
    if (process.env[key]) environment[key] = process.env[key];
  environment.ELECTRON_RUN_AS_NODE = "1";
  environment.DOCKER_HOST = fixture.pinnedDockerEndpoint;
  const assertEngine = async () => {
    const value = await execute(
      "docker",
      ["--host", fixture.pinnedDockerEndpoint, "info", "--format", "{{.ID}}"],
      { env: environment, encoding: "utf8", timeout: 10000, maxBuffer: 16384 },
    );
    assert.equal(
      value.stdout.trim(),
      fixture.engineId,
      "The pinned local engine identity changed.",
    );
  };
  const publish = async (name, instruction) => {
    phase = name;
    const nonce = randomUUID();
    await writeJson(config.phasePath, {
      schemaVersion: 1,
      phase: name,
      nonce,
      instruction,
      updatedAt: new Date().toISOString(),
    });
    return nonce;
  };
  const acknowledge = async (nonce, action, timeoutMs = 180000) => {
    const until = Date.now() + timeoutMs;
    while (Date.now() < until) {
      try {
        const stat = await fs.lstat(config.controlPath);
        assert.ok(stat.isFile() && !stat.isSymbolicLink() && stat.size <= 4096);
        const value = JSON.parse(await fs.readFile(config.controlPath, "utf8"));
        assert.deepEqual(
          Object.keys(value).sort(),
          ["action", "nonce", "schemaVersion"].sort(),
        );
        if (
          value.schemaVersion === 1 &&
          value.nonce === nonce &&
          value.action === action
        )
          return;
      } catch (error) {
        if (error.code !== "ENOENT" && !(error instanceof SyntaxError))
          throw error;
      }
      await delay(200);
    }
    throw new Error("Operator phase acknowledgement timed out.");
  };
  const sample = async () => {
    if (!terminalPid) return;
    const rows = await processes();
    collect(
      rows,
      descendants,
      same(terminalIdentity, rows.get(terminalPid)) ? [terminalPid] : [],
    );
  };
  let publicJson;
  let parseEnvelope, parseActivityData, parseStatusData;
  const activity = async () =>
    parseActivityData(await publicJson(["activity"]));
  const status = async () => {
    const data = parseStatusData(await publicJson(["status"]));
    const targets = "targets" in data ? data.targets : [data];
    assert.equal(targets.length, 1);
    const runtime = targets[0].runtimeStatus;
    assert.equal(runtime.runtimeTarget, "postgresql");
    assert.equal(runtime.projectId, fixture.runtimeProjectId);
    assert.equal(runtime.baselineGenerationId, fixture.baselineGeneration);
    assert.equal(runtime.verifiedRuntimeAvailable, true);
    return {
      state: runtime.state,
      baselineGenerationId: runtime.baselineGenerationId,
      candidateSha256: runtime.candidateSha256,
      verifiedRuntimeAvailable: runtime.verifiedRuntimeAvailable,
    };
  };
  const reachable = async (url, summary = false) => {
    try {
      const response = await fetch(url, {
        redirect: "error",
        signal: AbortSignal.timeout(3000),
      });
      if (!summary) {
        await response.body?.cancel();
        return true;
      }
      assert.equal(response.status, 200);
      assert.ok(response.body);
      const reader = response.body.getReader(),
        chunks = [];
      let size = 0;
      try {
        while (true) {
          const part = await reader.read();
          if (part.done) break;
          size += part.value.byteLength;
          assert.ok(size <= 4096, "Synthetic summary exceeded its bound.");
          chunks.push(Buffer.from(part.value));
        }
      } finally {
        await reader.cancel().catch(() => {});
        reader.releaseLock();
      }
      const value = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      assert.deepEqual(value, {
        ok: true,
        accounts: 1,
        entries: 10000,
        documents: 2,
      });
      return true;
    } catch (error) {
      if (summary) throw error;
      return false;
    }
  };
  const waitFor = async (predicate, timeoutMs = 60000) => {
    const until = Date.now() + timeoutMs;
    while (Date.now() < until) {
      assert.equal(
        observationFailure,
        undefined,
        "Native event/process observation failed.",
      );
      if (await predicate()) return;
      await delay(500);
    }
    throw new Error("Bounded native observation did not complete.");
  };
  try {
    assert.equal(vscode.workspace.isTrusted, true);
    assert.equal(vscode.workspace.workspaceFolders?.length, 1);
    const folder = vscode.workspace.workspaceFolders[0],
      key = folder.uri.toString();
    assert.equal(folder.uri.fsPath, fixture.projectRoot);
    assert.equal(vscode.window.terminals.length, 0);
    assert.equal(
      vscode.extensions.getExtension("rehearsal-db.rehearsal"),
      undefined,
    );
    const extension = vscode.extensions.getExtension(
      "rehearsal-db.rehearsal-db",
    );
    assert.ok(extension);
    assert.equal(extension.packageJSON.version, config.candidate.version);
    assert.ok(
      extension.extensionPath.startsWith(`${config.extensions}${path.sep}`),
    );
    ({ parseEnvelope, parseActivityData, parseStatusData } = require(
      path.join(extension.extensionPath, "dist/src/contracts.js"),
    ));
    ({ publicJson } = createReadClient({
      config,
      environment,
      parseEnvelope,
      readChildren,
    }));
    await assertEngine();
    const metadata = await publicJson(["configuration"]);
    assert.equal(metadata.path, fixture.configRelativePath);
    assert.equal(
      metadata.sourceSha256,
      fixture.preserveFiles.find(
        (file) => file.path === fixture.configRelativePath,
      ).sha256,
    );
    const plan = await publicJson(["explain"]);
    assert.equal(plan.environment.target, "postgresql");
    assert.equal(plan.environment.projectId, fixture.runtimeProjectId);
    assert.equal(plan.environment.ports.database, config.expectedDatabasePort);
    assert.equal(
      new URL(plan.environment.applicationUrl).href,
      new URL(fixture.applicationUrl).href,
    );
    assert.equal(plan.environment.hostedAccess, "disabled");
    assert.equal(plan.environment.outboundNetwork, "deny");
    assert.equal(plan.baseline.generationId, fixture.baselineGeneration);
    assert.equal(plan.lifecycle.open, "keep-until-stop");
    assert.equal(plan.application.readiness.url, fixture.healthUrl);
    result.configurationBound = {
      sourceSha256: metadata.sourceSha256,
      provider: "postgresql",
      projectId: fixture.runtimeProjectId,
      baselineGeneration: fixture.baselineGeneration,
      engineId: fixture.engineId,
    };
    assert.equal((await activity()).state, "idle");
    result.runtimeBefore = await status();
    assert.ok(["running", "stopped"].includes(result.runtimeBefore.state));
    assert.equal(
      await reachable(fixture.healthUrl),
      false,
      "Reserved application address is already responding; nothing was stopped.",
    );
    const nonce = await publish(
      "setup-await-operator",
      "This isolated profile has both automatic-update flags off. If metadata consent appears, choose Don't Ask Again in the real UI. Then write {schemaVersion:1,nonce:<this nonce>,action:'begin-open'} to control.json. No notification is mocked or approved by this driver.",
    );
    await extension.activate();
    await acknowledge(nonce, "begin-open");
    result.updateConsent =
      "operator acknowledged setup; no consent was granted by this companion; native choice requires operator evidence";
    assert.equal(extension.isActive, true);
    await vscode.commands.executeCommand("rehearsal.refresh");
    await vscode.commands.executeCommand("rehearsal.openWorkspace", key);
    await waitFor(
      () =>
        vscode.window.tabGroups.all
          .flatMap((group) => group.tabs)
          .some(
            (tab) =>
              tab.input instanceof vscode.TabInputWebview &&
              /Rehearsal/u.test(tab.label),
          ),
      5000,
    );
    listeners.push(
      vscode.window.onDidOpenTerminal((opened) => {
        if (terminal) {
          observationFailure = "unexpected-extra-terminal";
          return;
        }
        terminal = opened;
        result.terminalEvents.push({
          event: "opened",
          at: new Date().toISOString(),
        });
      }),
    );
    listeners.push(
      vscode.window.onDidStartTerminalShellExecution((event) => {
        if (event.terminal !== terminal) return;
        execution = event.execution;
        result.terminalEvents.push({
          event: "exact-execution-started",
          at: new Date().toISOString(),
        });
      }),
    );
    listeners.push(
      vscode.window.onDidEndTerminalShellExecution((event) => {
        if (event.terminal !== terminal || event.execution !== execution)
          return;
        result.terminalEvents.push({
          event: "exact-execution-ended",
          exitCode: event.exitCode ?? null,
          at: new Date().toISOString(),
        });
      }),
    );
    listeners.push(
      vscode.window.onDidCloseTerminal((closed) => {
        if (closed !== terminal) return;
        terminalClosed = true;
        result.terminalEvents.push({
          event: "closed",
          at: new Date().toISOString(),
        });
      }),
    );
    sentinel = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], {
      env: environment,
      detached: true,
      stdio: "ignore",
    });
    sentinel.on("error", () => {});
    sentinel.once("close", () => {
      sentinelClosed = true;
    });
    assert.ok(sentinel.pid);
    await waitFor(async () => {
      sentinelIdentity = (await processes()).get(sentinel.pid);
      return Boolean(sentinelIdentity);
    }, 5000);
    await writeJson(path.join(config.evidence, "sentinel-identity.json"), {
      kind: "owned-cancellation-sentinel",
      identity: sentinelIdentity,
    });
    await publish(
      "open-preview-requested",
      "Approve Open Sandbox only in the real native preview. The command is dispatched through the canonical registered action.",
    );
    await assertEngine();
    const opening = vscode.commands.executeCommand(
      "rehearsal.treeAction",
      key,
      "openSandbox",
    );
    await waitFor(() => Boolean(terminal), 180000);
    await opening;
    terminalPid = await terminal.processId;
    assert.ok(Number.isSafeInteger(terminalPid) && terminalPid > 1);
    terminalIdentity = (await processes()).get(terminalPid);
    assert.ok(
      terminalIdentity,
      "Actual terminal process identity is unavailable.",
    );
    await sample();
    monitor = setInterval(() => {
      if (!collecting)
        collecting = sample()
          .catch(() => {
            observationFailure = "process-observation-failed";
          })
          .finally(() => {
            collecting = undefined;
          });
    }, 500);
    let busy;
    await waitFor(async () => {
      const value = await activity();
      if (
        value.state !== "busy" ||
        value.operation?.kind !== "open" ||
        value.operation.progress?.currentStage?.phase !==
          "interactive-session" ||
        value.operation.progress.currentStage.state !== "running"
      )
        return false;
      busy = value;
      return true;
    });
    assert.ok(
      execution,
      "Shell integration did not expose the actual owned execution.",
    );
    await reachable(fixture.healthUrl, true);
    await reachable(fixture.summaryUrl, true);
    await sample();
    assert.ok(
      descendants.size >= 3,
      "No sufficient real terminal/CLI/application descendant lineage was observed.",
    );
    const operationId = busy.operation.progress.operationId;
    result.operation = {
      kind: "open",
      operationId,
      startedAt: busy.operation.startedAt,
      phase: "interactive-session",
    };
    const cancelNonce = await publish(
      "ready-for-activity-cancel",
      fixture.repeatDuringConfirmation
        ? "Click Activity's Cancel editor-started operation in the real UI. While its confirmation is OPEN, write {schemaVersion:1,nonce:<this nonce>,action:'repeat-pending'} to control.json. Do not approve until phase becomes repeat-dispatched."
        : "Click Activity's Cancel editor-started operation, then approve Cancel Operation in the real native confirmation. This driver does not click or approve it.",
    );
    if (fixture.repeatDuringConfirmation) {
      await acknowledge(cancelNonce, "repeat-pending");
      await Promise.race([
        vscode.commands.executeCommand(
          "rehearsal.treeAction",
          key,
          "cancelOwnedOperation",
        ),
        delay(1000).then(() => {
          throw new Error("Repeated pending cancellation did not coalesce.");
        }),
      ]);
      result.repeatedPendingCommandReturned = true;
      await publish(
        "repeat-dispatched",
        "The second real command returned while the first native confirmation remains operator-owned. Approve Cancel Operation in the original native confirmation now. A single visible dialog requires operator evidence.",
      );
    }
    let finalActivity;
    await waitFor(async () => {
      const value = await activity();
      if (value.state !== "idle") return false;
      const receipt = value.recent?.find(
        (entry) =>
          entry.kind === "open" && entry.progress.operationId === operationId,
      );
      if (
        !receipt ||
        !["completed", "cancelled"].includes(receipt.progress.state)
      )
        return false;
      finalActivity = {
        state: value.state,
        operationId,
        outcome: receipt.progress.state,
        events: receipt.progress.events.map((entry) => entry.code),
      };
      const rows = await processes();
      return (
        terminalClosed &&
        [...descendants.values()].every(
          (row) => !same(row, rows.get(row.pid)),
        ) &&
        !(await reachable(fixture.healthUrl))
      );
    }, 60000);
    clearInterval(monitor);
    monitor = undefined;
    if (collecting) await collecting;
    const rows = await processes();
    assert.ok(
      [...descendants.values()].every((row) => !same(row, rows.get(row.pid))),
    );
    assert.equal(same(sentinelIdentity, rows.get(sentinel.pid)), true);
    result.sentinelPreserved = true;
    result.ownedDescendantsGone = true;
    result.capturedProcesses = [...descendants.values()];
    result.finalActivity = finalActivity;
    result.runtimeAfter = await status();
    assert.equal(result.runtimeAfter.state, "running");
    assert.equal(
      result.runtimeAfter.candidateSha256,
      result.runtimeBefore.candidateSha256,
    );
    const terminalsBeforeRepeat = vscode.window.terminals.length;
    await vscode.commands.executeCommand(
      "rehearsal.treeAction",
      key,
      "cancelOwnedOperation",
    );
    assert.equal(vscode.window.terminals.length, terminalsBeforeRepeat);
    assert.equal((await activity()).state, "idle");
    assert.equal(
      same(sentinelIdentity, (await processes()).get(sentinel.pid)),
      true,
    );
    result.repeatedAfterCleanup = true;
    await assertEngine();
    result.editorOutcomeLimit =
      "Only actual shell events are recorded. Terminal closure alone must remain Unverified; no editor receipt is invented or patched.";
    result.checks.push(
      "actual installed canonical activation/controller and native dashboard",
      "real editor-owned Open session, public busy interactive phase and synthetic application summary",
      "actual terminal closure, matching public final operation and captured descendants gone",
      "unrelated sentinel survives cancellation and repeated post-cleanup request",
      "read-only final runtime status retains expected generation and migration digest",
    );
    result.status = "passed";
    await publish(
      "passed",
      "Native API/public core checks passed. Capture any real UI observations separately. Caller retains ownership of the prepared fixture and leases.",
    );
  } catch (error) {
    result.status = "failed";
    result.failurePhase = phase;
    result.diagnostic = diagnostic(error);
    result.failure =
      "A bounded native/public-state predicate failed; raw terminal/child output is withheld.";
    throw new Error("Native cancellation companion failed.");
  } finally {
    if (monitor) clearInterval(monitor);
    if (collecting) await collecting.catch(() => {});
    try {
      for (const listener of listeners) listener.dispose();
      if (terminal && !terminalClosed) terminal.dispose();
      // Failure recovery is separate from the product predicates above. Never turn
      // fallback termination into evidence that Activity cancellation succeeded.
      const observed = await processes();
      const pending = new Map([...readChildren, ...descendants]);
      result.ownedProcessesBeforeFallback = [...pending.values()].filter(
        (row) => same(row, observed.get(row.pid)),
      );
      if (result.ownedProcessesBeforeFallback.length) {
        result.status = "failed";
        for (const signal of ["SIGTERM", "SIGKILL"]) {
          const rows = await processes();
          collect(rows, pending, []);
          for (const row of [...pending.values()].reverse())
            if (same(row, rows.get(row.pid))) {
              try {
                process.kill(row.pid, signal);
              } catch (error) {
                if (error.code !== "ESRCH") throw error;
              }
            }
          await delay(500);
        }
      }
      const rows = await processes();
      result.ownedProcessesAfterFallback = [...pending.values()].filter((row) =>
        same(row, rows.get(row.pid)),
      );
      result.ownedReadProcessesRemaining = [...readChildren.values()].filter(
        (row) => same(row, rows.get(row.pid)),
      );
      result.ownedOperationProcessesRemaining = [
        ...descendants.values(),
      ].filter((row) => same(row, rows.get(row.pid)));
      if (
        result.ownedProcessesAfterFallback.length ||
        result.ownedReadProcessesRemaining.length ||
        result.ownedOperationProcessesRemaining.length ||
        observationFailure
      )
        result.status = "failed";
    } catch {
      result.status = "failed";
      result.cleanupObservationFailed = true;
    }
    // Independent of process-table availability: this is the directly spawned
    // ChildProcess, not a guessed PID. Only its actual close event proves cleanup.
    try {
      if (sentinel && !sentinelClosed)
        for (const signal of ["SIGTERM", "SIGKILL"]) {
          if (sentinelClosed) break;
          sentinel.kill(signal);
          const until = Date.now() + 1000;
          while (!sentinelClosed && Date.now() < until) await delay(100);
        }
      result.sentinelCleanedUp = !sentinel || sentinelClosed;
      if (!result.sentinelCleanedUp) result.status = "failed";
    } catch {
      result.status = "failed";
      result.sentinelCleanedUp = false;
    }
    await writeJson(config.resultPath, result);
  }
};
