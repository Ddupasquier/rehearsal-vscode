/** Exact installed native panel/source companion; never a CLI or database runner. */
const assert = require("node:assert/strict");
const { createHash } = require("node:crypto");
const fs = require("node:fs/promises");
const path = require("node:path");
const { setTimeout: delay } = require("node:timers/promises");
const vscode = require("vscode");
const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
exports.activate = () => {};
const wait = async (condition) => {
  const end = Date.now() + 5000;
  while (!condition() && Date.now() < end) await delay(25);
  assert.ok(condition(), "Owned native transition did not complete.");
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

exports.run = async () => {
  const configPath = process.env.REHEARSAL_NATIVE_MIGRATION_CONFIG;
  assert.ok(configPath && path.isAbsolute(configPath));
  const config = JSON.parse(await fs.readFile(configPath, "utf8"));
  assert.equal(await fs.realpath(config.root), config.root);
  for (const field of ["workspace", "extensions", "resultPath", "activityPath"])
    within(config.root, config[field]);
  assert.equal(vscode.workspace.isTrusted, true);
  assert.equal(vscode.workspace.workspaceFolders?.length, 1);
  const folder = vscode.workspace.workspaceFolders[0],
    key = folder.uri.toString();
  assert.equal(folder.uri.fsPath, config.workspace);
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
  const { parseMigrationReviewPlan } = runtime("migration_review.js");
  const { parseMigrationInsights, migrationInsightIndex } = runtime(
    "migration_insights.js",
  );
  const { migrationSourceDocumentMatches } = runtime("migration_source.js");
  const { RehearsalWorkspacePanels } = runtime("workspace_panel.js");
  const bytes = await fs.readFile(config.activityPath);
  assert.ok(bytes.length <= 256 * 1024);
  assert.equal(sha(bytes), config.activitySha256);
  const fixture = JSON.parse(bytes.toString("utf8"));
  assert.equal(fixture.kind, "migration-insights-native-fixture");
  const plan = parseMigrationReviewPlan(fixture.plan);
  const report = parseMigrationInsights(
    fixture.insights,
    plan,
    fixture.coreVersion,
  );
  assert.ok(fixture.files.length && fixture.files.length <= 20);
  const sources = new Map();
  for (const file of fixture.files) {
    assert.match(
      file.path,
      /^database\/migrations\/\d{14}_[A-Za-z0-9_-]+\.sql$/u,
    );
    const source = path.join(config.workspace, file.path);
    within(config.workspace, source);
    const original = await fs.readFile(source);
    assert.equal(sha(original), file.sha256);
    assert.equal(original.toString("base64"), file.base64);
    sources.set(file.path, { source, original });
  }
  let openedTerminals = 0,
    phase = "panel",
    owner;
  const terminalListener = vscode.window.onDidOpenTerminal(
    () => openedTerminals++,
  );
  assert.equal(vscode.window.terminals.length, 0);
  const snapshots = new vscode.EventEmitter(),
    inspections = new vscode.EventEmitter(),
    actionEvents = new vscode.EventEmitter();
  let current = {
    workspaceName: "Private synthetic Insights verification",
    workspaceRoot: config.workspace,
    availability: "ready",
    version: fixture.coreVersion,
    activity: { schemaVersion: 1, state: "idle", operation: null, recent: [] },
    migrationReview: plan,
    migrationInsights: { state: "available", report },
  };
  const projects = {
    onDidUpdateSnapshot: snapshots.event,
    onDidChangeInspection: inspections.event,
    snapshotFor: (workspaceKey) => (workspaceKey === key ? current : undefined),
    inspectionStateFor: () => "idle",
    refreshWorkspace: async () =>
      snapshots.fire({ workspaceKey: key, snapshot: current }),
  };
  const actions = {
    onDidRecordActivity: actionEvents.event,
    registerWorkspace: () => "private-native-insights",
    releaseWorkspace: () => {},
    activityFor: () => [],
  };
  const state = new Map();
  const result = {
    status: "running",
    candidateSha256: config.candidateSha256,
    activitySha256: config.activitySha256,
    recordedCoreArtifactSha256: fixture.coreArtifactSha256,
    recordedCliVersion: fixture.coreVersion,
    vscodeVersion: vscode.version,
    nodeVersion: process.versions.node,
    scenario: "migration-insights",
    checks: [],
    limitations: [
      "Real installed VS Code API, production panel/source handlers and independently recorded public core plan/Insights; no new CLI, database or canonical activation.",
      "HTML assertions and host message dispatch do not prove rendered layout, webview event delivery, actual keyboard or assistive-technology behavior. Those remain separately pending.",
      "Only private synthetic copies are edited for deliberate dirty/changed-byte refusal. No owner profile, existing editor window, production or provider is targeted.",
    ],
  };
  try {
    owner = new RehearsalWorkspacePanels(
      extension.extensionUri,
      projects,
      actions,
      {
        get: (name) => state.get(name),
        update: async (name, value) => {
          state.set(name, value);
        },
      },
      config.version,
    );
    await owner.open(key);
    const panel = owner.panels.get(key);
    assert.ok(panel);
    await wait(() => panel.visible);
    await owner.handleMessage(panel, key, {
      type: "navigate",
      page: "migrations",
    });
    await projects.refreshWorkspace(key);
    const assertPrivate = () => {
      for (const value of [
        config.workspace,
        "PRIVATE_INSIGHTS_VALUE_CANARY",
        "private_insights_identifier_canary",
        "native_unicode_probe",
      ])
        assert.equal(panel.webview.html.includes(value), false);
    };
    assert.ok(panel.webview.html.includes("Static Migration Insights"));
    assert.ok(panel.webview.html.includes("Coverage is incomplete"));
    assertPrivate();
    result.checks.push(
      "fixed warnings and incomplete coverage render in production panel HTML without source/identifier canaries",
    );
    const index = [...migrationInsightIndex(report)];
    const native = index.filter(([, item]) =>
      /_(?:bom_lf|bom_crlf|bare_cr)\.sql$/u.test(item.entry.filename),
    );
    assert.equal(
      native.length,
      3,
      "Require independently observed BOM/LF, BOM/CRLF+astral and bare-CR inputs.",
    );
    for (const [findingId, item] of native) {
      phase = `source-${item.entry.version}`;
      const source = sources.get(item.entry.workspaceRelativePath);
      assert.ok(source);
      await owner.handleMessage(panel, key, {
        type: "openMigrationInsight",
        findingId,
      });
      const editor = vscode.window.activeTextEditor;
      assert.equal(editor?.document.uri.fsPath, source.source);
      assert.equal(editor.document.isDirty, false);
      assert.ok(
        migrationSourceDocumentMatches(
          source.original.toString("utf8"),
          editor.document.getText(),
        ),
      );
      assert.equal(editor.selection.active.line, item.finding.line - 1);
      assert.equal(editor.selection.active.character, item.finding.column - 1);
      assert.equal(sha(await fs.readFile(source.source)), item.entry.sha256);
      result.checks.push(
        `native exact-byte source and UTF-16 position ${item.finding.line}:${item.finding.column} passed for ${item.entry.version}`,
      );
    }
    const [findingId, item] = native[0],
      source = sources.get(item.entry.workspaceRelativePath);
    const document = await vscode.workspace.openTextDocument(
      vscode.Uri.file(source.source),
    );
    await vscode.window.showTextDocument(document);
    phase = "dirty-refusal";
    const edit = new vscode.WorkspaceEdit();
    edit.insert(
      document.uri,
      new vscode.Position(0, 0),
      "-- owned dirty refusal\n",
    );
    assert.equal(await vscode.workspace.applyEdit(edit), true);
    assert.equal(document.isDirty, true);
    const sentinel = await vscode.workspace.openTextDocument({
      language: "plaintext",
      content: "Owned native Insights sentinel",
    });
    await vscode.window.showTextDocument(sentinel, { preview: false });
    await owner.handleMessage(panel, key, {
      type: "openMigrationInsight",
      findingId,
    });
    assert.equal(
      vscode.window.activeTextEditor?.document.uri.toString(),
      sentinel.uri.toString(),
    );
    assert.equal(document.isDirty, true);
    assert.equal(sha(await fs.readFile(source.source)), item.entry.sha256);
    await vscode.window.showTextDocument(document);
    await vscode.commands.executeCommand("workbench.action.files.revert");
    assert.equal(document.isDirty, false);
    assert.equal(sha(await fs.readFile(source.source)), item.entry.sha256);
    result.checks.push(
      "dirty native buffer refused without opening/saving it; only the owned buffer was explicitly reverted",
    );
    phase = "changed-byte-refusal";
    await vscode.window.showTextDocument(sentinel, { preview: false });
    try {
      await fs.writeFile(
        source.source,
        Buffer.concat([
          source.original,
          Buffer.from("-- owned byte refusal\n"),
        ]),
      );
      await owner.handleMessage(panel, key, {
        type: "openMigrationInsight",
        findingId,
      });
      assert.equal(
        vscode.window.activeTextEditor?.document.uri.toString(),
        sentinel.uri.toString(),
      );
    } finally {
      await fs.writeFile(source.source, source.original);
    }
    result.checks.push(
      "changed disk bytes refused; owned exact source restored",
    );
    phase = "unavailable";
    current = { ...current, migrationInsights: { state: "unavailable" } };
    await owner.open(key);
    await wait(() => panel.visible);
    await projects.refreshWorkspace(key);
    assert.ok(
      panel.webview.html.includes("Static Migration Insights is unavailable"),
    );
    assert.ok(
      panel.webview.html.includes(
        "ordinary review and rehearsal controls are unchanged",
      ),
    );
    assert.equal(
      panel.webview.html.includes("data-open-migration-insight="),
      false,
    );
    assertPrivate();
    result.checks.push(
      "unavailable optional analysis removes source actions without blocking ordinary review",
    );
    phase = "preservation";
    for (const file of fixture.files)
      assert.equal(
        sha(await fs.readFile(sources.get(file.path).source)),
        file.sha256,
      );
    assert.equal(
      sha(await fs.readFile(config.activityPath)),
      config.activitySha256,
    );
    assert.equal(openedTerminals, 0);
    assert.equal(vscode.window.terminals.length, 0);
    result.status = "passed";
  } catch (error) {
    result.status = "failed";
    result.failurePhase = phase;
    result.failureLocation =
      typeof error?.stack === "string"
        ? (error.stack.match(/runner\.cjs:\d{1,7}:\d{1,5}/u)?.[0] ??
          "unavailable")
        : "unavailable";
    throw new Error(
      `Native Insights acceptance failed during ${phase}; private output withheld.`,
    );
  } finally {
    owner?.dispose();
    terminalListener.dispose();
    for (const event of [snapshots, inspections, actionEvents]) event.dispose();
    await fs.writeFile(
      config.resultPath,
      JSON.stringify(result, null, 2) + "\n",
      { mode: 0o600 },
    );
  }
};
