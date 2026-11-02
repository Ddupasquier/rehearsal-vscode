/** Native host/panel test. Run only via verify-native-migration-failure.ts. */
const assert = require("node:assert/strict");
const { createHash } = require("node:crypto");
const fs = require("node:fs/promises");
const path = require("node:path");
const { setTimeout: delay } = require("node:timers/promises");
const vscode = require("vscode");

exports.activate = () => {};
const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
const clone = (value) => JSON.parse(JSON.stringify(value));
const waitFor = async (condition) => {
  const deadline = Date.now() + 5000;
  while (!condition() && Date.now() < deadline) await delay(25);
  assert.equal(
    Boolean(condition()),
    true,
    "Owned native view transition did not complete.",
  );
};
const within = (root, file) => {
  const relative = path.relative(root, file);
  assert.ok(
    relative &&
      relative !== ".." &&
      !relative.startsWith(`..${path.sep}`) &&
      !path.isAbsolute(relative),
  );
};
const fixtureFiles = async (root, directory = "") => {
  const files = [];
  for (const entry of await fs.readdir(path.join(root, directory), {
    withFileTypes: true,
  })) {
    assert.equal(entry.isSymbolicLink(), false);
    const name = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await fixtureFiles(root, name)));
    else {
      assert.equal(entry.isFile(), true);
      files.push(name);
    }
  }
  return files.sort();
};

exports.run = async () => {
  const configPath = process.env.REHEARSAL_NATIVE_MIGRATION_CONFIG;
  assert.ok(configPath);
  const config = JSON.parse(await fs.readFile(configPath, "utf8"));
  assert.ok(
    path.isAbsolute(config.root) &&
      config.root !== path.parse(config.root).root,
  );
  assert.equal(await fs.realpath(config.root), config.root);
  for (const key of ["workspace", "extensions", "resultPath", "activityPath"])
    within(config.root, config[key]);
  assert.equal(vscode.workspace.isTrusted, true);
  assert.equal(vscode.workspace.workspaceFolders?.length, 1);
  const folder = vscode.workspace.workspaceFolders[0],
    key = folder.uri.toString();
  assert.equal(folder.uri.fsPath, config.workspace);
  assert.equal(vscode.window.terminals.length, 0);
  const extension = vscode.extensions.getExtension("rehearsal-db.rehearsal-db");
  assert.ok(extension);
  assert.equal(extension.packageJSON.version, config.version);
  within(
    await fs.realpath(config.extensions),
    await fs.realpath(extension.extensionPath),
  );
  assert.equal(
    vscode.extensions.getExtension("rehearsal-db.rehearsal"),
    undefined,
  );
  const runtime = (file) =>
    require(path.join(extension.extensionPath, "dist/src", file));
  const { parseActivityData, parseEnvelope } = runtime("contracts.js");
  const { inspectProject } = runtime("project_snapshot.js");
  const { workspaceExecutionState } = runtime("workspace_view_state.js");
  const { RehearsalWorkspacePanels } = runtime("workspace_panel.js");
  const inputBytes = await fs.readFile(config.activityPath);
  assert.ok(inputBytes.length <= 256 * 1024);
  assert.equal(sha(inputBytes), config.activitySha256);
  const input = JSON.parse(inputBytes.toString("utf8"));
  const samples = input.kind === "migration-workbench-samples" ? input : null;
  if (samples) {
    assert.ok(inputBytes.length <= 64 * 1024);
    assert.deepEqual(
      Object.keys(samples).sort(),
      [
        "artifactSha256",
        "correctedActivity",
        "correctedBaseline",
        "correctedCandidates",
        "correctedDoctor",
        "correctedExplain",
        "correctedStatus",
        "failureActivity",
        "kind",
        "schemaVersion",
      ].sort(),
    );
    assert.equal(samples.schemaVersion, 1);
    assert.match(samples.artifactSha256, /^[a-f0-9]{64}$/u);
  }
  const envelope = samples?.failureActivity ?? input;
  assert.equal(envelope.command, "activity");
  assert.equal(envelope.status, "success");
  assert.match(
    envelope.rehearsalVersion,
    /^\d+\.\d+\.\d+(?:-[A-Za-z0-9.-]+)?$/u,
  );
  const recorded = parseActivityData(envelope.data);
  assert.equal(recorded.state, "idle");
  const recognized = recorded.recentFailures?.find(
    (entry) =>
      entry.diagnostic.classification !== "unknown" &&
      (!config.source || entry.operationId === config.source.operationId),
  );
  assert.ok(
    recognized,
    "Recorded public activity must contain a recognized migration diagnosis.",
  );
  const receipt = recorded.recent?.find(
    (entry) => entry.progress.operationId === recognized.operationId,
  );
  assert.ok(receipt && receipt.progress.state === "failed");
  let sourcePath = null,
    sourceBytes = null;
  if (config.source) {
    const source = recognized.diagnostic.source;
    assert.ok(source?.workspaceRelativePath);
    assert.equal(source.workspaceRelativePath, config.source.relativePath);
    assert.equal(source.sha256, config.source.sha256);
    assert.equal(source.line, null);
    assert.equal(source.column, null);
    sourcePath = path.join(config.workspace, source.workspaceRelativePath);
    within(config.workspace, sourcePath);
    sourceBytes = await fs.readFile(sourcePath);
    assert.ok(sourceBytes.length <= 2 * 1024 * 1024);
    assert.equal(sha(sourceBytes), source.sha256);
  }
  const expectedFiles = config.source ? [config.source.relativePath] : [];
  assert.deepEqual(await fixtureFiles(config.workspace), expectedFiles);
  const recordedSample = {
    schemaVersion: 1,
    state: "idle",
    operation: null,
    recent: [clone(receipt)],
    recentFailures: [clone(recognized)],
  };
  const unknownSample = clone(recordedSample),
    unknownId = sha(
      Buffer.from(
        `${recognized.operationId}:controlled-unknown-native-fixture`,
      ),
    );
  unknownSample.recent[0].progress.operationId = unknownId;
  unknownSample.recentFailures[0] = {
    operationId: unknownId,
    diagnostic: {
      schemaVersion: 1,
      provider: recognized.diagnostic.provider,
      classification: "unknown",
      sqlState: null,
      evidence: "unavailable",
      summary:
        "The failure could not be classified from recognized provider SQLSTATE evidence. It is not a confirmed syntax error.",
      suggestions: [
        "Review the exact candidate locally and its database requirements. Do not assume syntax, data or permissions are the cause.",
        "No automatic SQL change or retry was performed. The failure itself does not prove rollback or cleanup; inspect runtime status before retrying.",
      ],
    },
  };
  const result = {
    status: "running",
    candidateSha256: config.candidateSha256,
    activitySha256: config.activitySha256,
    recordedCliVersion: envelope.rehearsalVersion,
    recordedCoreArtifactSha256: samples?.artifactSha256 ?? null,
    vscodeVersion: vscode.version,
    nodeVersion: process.versions.node,
    checks: [],
    coverage: {
      sourceLink: "not_requested",
      correctedWorkbench: "not_requested",
    },
    limitations: [
      "Real VS Code API and production panel/document HTML refresh only; no rendered DOM, human visual, keyboard or assistive-technology proof.",
      "Recognized diagnosis uses recorded public CLI activity. Unknown is a controlled fixed-contract variant, not another observed provider execution.",
      "A minimal event-emitting projects/actions consumer drives production panel ownership; complete canonical activation and real project inspection are not certified.",
      "Corrected workbench data, when supplied, uses recorded public envelopes through the production inspector's injected client; it is not a new CLI/database execution or full native activation.",
      "No CLI, terminal, database operation, owner profile or existing window is targeted. The source refusal control changes/restores only the owned fixture copy.",
    ],
  };
  let phase = "recorded-activity",
    openedTerminals = 0,
    owner;
  const terminalListener = vscode.window.onDidOpenTerminal(
    () => openedTerminals++,
  );
  const snapshots = new vscode.EventEmitter(),
    inspections = new vscode.EventEmitter(),
    actionEvents = new vscode.EventEmitter();
  const state = new Map();
  let current, replayInspection;
  const projects = {
    onDidUpdateSnapshot: snapshots.event,
    onDidChangeInspection: inspections.event,
    snapshotFor: (workspaceKey) => (workspaceKey === key ? current : undefined),
    inspectionStateFor: () => "idle",
    refreshWorkspace: async () => {
      current = replayInspection
        ? await replayInspection()
        : {
            ...current,
            activity: parseActivityData(clone(current.activity)),
          };
      snapshots.fire({ workspaceKey: key, snapshot: current });
    },
  };
  const actions = {
    onDidRecordActivity: actionEvents.event,
    registerWorkspace: () => "native-migration-verification",
    releaseWorkspace: () => {},
    activityFor: () => [],
  };
  const memento = {
    get: (name) => state.get(name),
    update: async (name, value) => {
      if (value === undefined) state.delete(name);
      else state.set(name, value);
    },
  };
  const publish = (activity) => {
    current = {
      workspaceName: "Native migration verification",
      workspaceRoot: config.workspace,
      availability: "not_ready",
      version: envelope.rehearsalVersion,
      activity: parseActivityData(clone(activity)),
    };
    snapshots.fire({ workspaceKey: key, snapshot: current });
  };
  const panelFor = () => {
    // Inspect this test's owned panel, without a shipping product test hook.
    const panel = owner.panels.get(key);
    assert.ok(panel);
    return panel;
  };
  const assertSafe = (panel) => {
    for (const value of [
      config.workspace,
      "MIGRATION_SQL_CANARY_RDB186",
      "MIGRATION_SECRET_CANARY_RDB186",
      "NATIVE_MIGRATION_PRIVATE_SQL_CANARY",
    ])
      assert.equal(
        panel.webview.html.includes(value),
        false,
        "Private fixture data must not enter panel HTML.",
      );
  };
  try {
    await fs.writeFile(config.resultPath, JSON.stringify(result, null, 2));
    publish(recordedSample);
    owner = new RehearsalWorkspacePanels(
      extension.extensionUri,
      projects,
      actions,
      memento,
      config.version,
    );
    await owner.open(key);
    const first = panelFor();
    await waitFor(() => first.visible);
    // Send the same closed navigation message to the host handler. This is not
    // a claim of keyboard input or webview-client message delivery.
    await owner.handleMessage(first, key, {
      type: "navigate",
      page: "activity",
    });
    // Host navigation records page state; a real snapshot refresh renders that
    // page into document HTML. Client-side DOM navigation is not simulated here.
    await projects.refreshWorkspace(key);
    assert.ok(
      first.webview.html.includes(
        'id="activity" class="workspace-page workspace-page--active"',
      ),
    );
    assert.ok(first.webview.html.includes(recognized.diagnostic.summary));
    assert.ok(
      first.webview.html.includes(`SQLSTATE ${recognized.diagnostic.sqlState}`),
    );
    assertSafe(first);
    phase = "recognized-refresh";
    await projects.refreshWorkspace(key);
    assert.equal(panelFor(), first);
    assert.ok(first.webview.html.includes(recognized.diagnostic.summary));
    assertSafe(first);
    result.checks.push(
      "recorded recognized diagnosis survives production snapshot refresh on the same native panel",
    );
    if (sourcePath) {
      phase = "exact-source-open";
      await owner.handleMessage(first, key, {
        type: "openMigrationFailure",
        operationId: recognized.operationId,
      });
      const editor = vscode.window.activeTextEditor;
      assert.ok(editor);
      assert.equal(editor.document.uri.scheme, "file");
      assert.equal(editor.document.uri.fsPath, sourcePath);
      assert.equal(editor.document.isDirty, false);
      assert.equal(
        sha(Buffer.from(editor.document.getText())),
        config.source.sha256,
      );
      assert.equal(sha(await fs.readFile(sourcePath)), config.source.sha256);
      phase = "changed-source-refusal";
      const sentinel = await vscode.workspace.openTextDocument({
        language: "plaintext",
        content: "Owned migration verification sentinel",
      });
      await vscode.window.showTextDocument(sentinel, { preview: false });
      try {
        await fs.writeFile(
          sourcePath,
          Buffer.concat([
            sourceBytes,
            Buffer.from("\n-- native changed-byte refusal control\n"),
          ]),
        );
        const changedSha = sha(await fs.readFile(sourcePath));
        assert.notEqual(changedSha, config.source.sha256);
        await owner.handleMessage(first, key, {
          type: "openMigrationFailure",
          operationId: recognized.operationId,
        });
        assert.equal(
          vscode.window.activeTextEditor?.document.uri.toString(),
          sentinel.uri.toString(),
        );
        assert.equal(sha(await fs.readFile(sourcePath)), changedSha);
      } finally {
        await fs.writeFile(sourcePath, sourceBytes);
      }
      assert.equal(sha(await fs.readFile(sourcePath)), config.source.sha256);
      result.coverage.sourceLink = "passed";
      result.checks.push(
        "production host opens only the recorded exact migration bytes, refuses changed bytes without opening them, and leaves SQL positions unknown; owned source copy restored",
      );
      // Source review has hidden the webview; reveal it before snapshot updates.
      await owner.open(key);
      await waitFor(() => first.visible);
    }
    phase = "unknown-refresh";
    publish(unknownSample);
    await projects.refreshWorkspace(key);
    assert.ok(
      first.webview.html.includes("It is not a confirmed syntax error."),
    );
    assert.ok(first.webview.html.includes("SQLSTATE unavailable"));
    assert.equal(
      first.webview.html.includes(recognized.diagnostic.summary),
      false,
    );
    assertSafe(first);
    result.checks.push(
      "legitimate unavailable evidence stays unknown and replaces the old recognized explanation",
    );
    phase = "reopen";
    first.dispose();
    await waitFor(() => !owner.panels.has(key));
    await owner.open(key);
    const second = panelFor();
    await waitFor(() => second.visible);
    assert.notEqual(second, first);
    await owner.handleMessage(second, key, {
      type: "navigate",
      page: "activity",
    });
    await projects.refreshWorkspace(key);
    assert.ok(
      second.webview.html.includes("It is not a confirmed syntax error."),
    );
    await projects.refreshWorkspace(key);
    assert.ok(second.webview.html.includes("SQLSTATE unavailable"));
    assertSafe(second);
    result.checks.push(
      "native panel close/reopen and another refresh retain core-supplied unknown evidence",
    );
    phase = "malformed-redaction";
    for (const mutate of [
      (value) => {
        value.recentFailures[0].diagnostic.sql =
          "NATIVE_MIGRATION_PRIVATE_SQL_CANARY";
      },
      (value) => {
        value.recentFailures[0].diagnostic.summary =
          "NATIVE_MIGRATION_PRIVATE_SQL_CANARY";
      },
      (value) => {
        value.recentFailures[0].operationId = "f".repeat(64);
      },
    ]) {
      const invalid = clone(unknownSample);
      mutate(invalid);
      let rejected = false;
      try {
        parseActivityData(invalid);
      } catch (error) {
        rejected = true;
        assert.equal(
          String(error?.message).includes(
            "NATIVE_MIGRATION_PRIVATE_SQL_CANARY",
          ),
          false,
        );
      }
      assert.equal(
        rejected,
        true,
        "Malformed diagnosis must be rejected without a raw-output fallback.",
      );
      assertSafe(second);
    }
    result.checks.push(
      "extra SQL, unsafe summary and mismatched attribution refuse without leaking the marker or changing valid panel evidence",
    );
    if (samples) {
      phase = "corrected-workbench";
      const commands = {
        activity: samples.correctedActivity,
        doctor: samples.correctedDoctor,
        explain: samples.correctedExplain,
        status: samples.correctedStatus,
        candidates: samples.correctedCandidates,
        "inspect baseline": samples.correctedBaseline,
      };
      for (const [command, value] of Object.entries(commands)) {
        assert.equal(value.rehearsalVersion, envelope.rehearsalVersion);
        assert.equal(value.command, command);
        assert.equal(value.status, "success");
        assert.equal(Object.hasOwn(value.data, "output"), false);
      }
      replayInspection = () =>
        inspectProject({
          workspaceName: "Recorded corrected database-only tutorial",
          workspaceRoot: config.workspace,
          trusted: true,
          client: {
            version: async () => ({
              name: "@rehearsal-db/core",
              version: envelope.rehearsalVersion,
            }),
            command: async ({ expectedCommand }) => {
              assert.ok(Object.hasOwn(commands, expectedCommand));
              return {
                result: parseEnvelope(
                  clone(commands[expectedCommand]),
                  expectedCommand,
                ),
                exitCode: 0,
              };
            },
          },
        });
      current = await replayInspection();
      assert.equal(current.availability, "ready");
      assert.equal(current.readiness.state, "READY");
      assert.equal(current.activity.state, "idle");
      assert.equal(current.candidates.count, 0);
      assert.equal(current.runtime.state, "running");
      const execution = workspaceExecutionState(current);
      assert.equal(execution.command, "idle");
      assert.equal(execution.applicationMode, "database_only");
      assert.equal(execution.proofConfigured, true);
      assert.equal(execution.lastRun.progress.state, "completed");
      assert.equal(execution.proof, "recorded_pass");
      snapshots.fire({ workspaceKey: key, snapshot: current });
      await owner.handleMessage(second, key, {
        type: "navigate",
        page: "overview",
      });
      await projects.refreshWorkspace(key);
      const overview = second.webview.html.match(
        /<section id="overview"[\s\S]*?<\/section>/u,
      )?.[0];
      assert.ok(overview);
      for (const text of [
        "Last rehearsal completed",
        "No Rehearsal command is active",
        "CLI proof passed (recorded)",
        "configured for database-only testing",
        "Verify database",
      ])
        assert.ok(overview.includes(text));
      for (const text of [
        "Ready to rehearse",
        "Configure application launch",
        "Configure application proof",
        "Rehearsal command running",
      ])
        assert.equal(overview.includes(text), false);
      assertSafe(second);
      await projects.refreshWorkspace(key);
      assert.ok(second.webview.html.includes("CLI proof passed (recorded)"));
      result.coverage.correctedWorkbench = "passed";
      result.checks.push(
        "actual recorded corrected public envelopes pass the production inspector and native panel refresh: idle completed run, separately running database, zero pending migrations and recorded CLI proof; no browser setup recommendation",
      );
    }
    phase = "preservation";
    assert.equal(openedTerminals, 0);
    assert.equal(vscode.window.terminals.length, 0);
    assert.deepEqual(await fixtureFiles(config.workspace), expectedFiles);
    if (sourcePath)
      assert.equal(sha(await fs.readFile(sourcePath)), config.source.sha256);
    assert.equal(
      sha(await fs.readFile(config.activityPath)),
      config.activitySha256,
    );
    result.checks.push(
      "no terminal was created; fixture file inventory, exact attempted source copy and recorded input bytes remain unchanged",
    );
    result.status = "passed";
  } catch {
    result.status = "failed";
    result.failurePhase = phase;
    throw new Error(
      `Native migration panel acceptance failed during ${phase}; raw errors withheld.`,
    );
  } finally {
    owner?.dispose();
    terminalListener.dispose();
    for (const event of [snapshots, inspections, actionEvents]) event.dispose();
    await fs.writeFile(
      config.resultPath,
      `${JSON.stringify(result, null, 2)}\n`,
    );
  }
};
