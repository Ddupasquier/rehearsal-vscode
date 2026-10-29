/** Genuine read-only legacy Supabase consumer through the installed canonical extension. */
const assert = require("node:assert/strict");
const path = require("node:path");
const fs = require("node:fs/promises");
const { createHash } = require("node:crypto");
const { setTimeout: delay } = require("node:timers/promises");
const vscode = require("vscode");
const { readConfiguration } = require("./native-editor-driver.cjs");
const { readRegular, writeJson } = require("./native-editor-reads.cjs");
const wait = async (check, budgetMs = 60000) => {
  const end = Date.now() + budgetMs;
  while (Date.now() < end) {
    if (await check()) return;
    await delay(100);
  }
  throw Error("Owned real-consumer observation incomplete.");
};
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const snapshotIdentity = (s) => ({
  version: s.version,
  availability: s.availability,
  activity: s.activity?.state,
  configuration: s.configurationMetadata?.sourceSha256 ?? null,
  baseline: {
    generationId: s.baseline?.generationId,
    formatVersion: s.baseline?.formatVersion ?? null,
    rows: s.baseline?.rowCount,
    tables: s.baseline?.tableCount,
    migrations: s.baseline?.migrationCount,
    dataSha256: s.baseline?.dataSha256 ?? null,
    historySha256: s.baseline?.migrationHistorySha256 ?? null,
  },
  reviewTargets: s.reviewTargets,
  candidateSha256: s.migrationReview?.candidateSha256,
  candidateCount: s.migrationReview?.candidateCount,
});
exports.run = async () => {
  const config = await readConfiguration();
  assert.equal(config.scenario, "real-consumer");
  assert.equal(vscode.workspace.isTrusted, true);
  assert.equal(vscode.workspace.workspaceFolders?.length, 1);
  const folder = vscode.workspace.workspaceFolders[0];
  assert.equal(folder.uri.scheme, "file");
  assert.equal(folder.uri.authority, "");
  assert.equal(folder.uri.fsPath, config.workspace);
  const extension = vscode.extensions.getExtension("rehearsal-db.rehearsal-db");
  assert.ok(extension);
  assert.equal(extension.packageJSON.version, config.version);
  assert.equal(
    await fs.realpath(extension.extensionPath),
    config.installedExtension,
  );
  const runtime = (name) =>
    require(path.join(extension.extensionPath, "dist/src", name));
  const snapshots = runtime("project_snapshot.js"),
    adapter = runtime("process_adapter.js"),
    inspect = snapshots.inspectProject,
    read = adapter.runRehearsalJson,
    shutdown = adapter.runEngineShutdown;
  const allowed = new Set([
    "engine status",
    "inspect configuration",
    "activity",
    "doctor",
    "discover",
    "explain",
    "inspect baseline",
    "candidates",
    "status",
    "resources",
    "environments",
    "inspect plan",
    "inspect insights",
    "configuration",
  ]);
  let latest,
    snapshotReads = 0,
    terminalCount = 0,
    mutationCalls = 0,
    phase = "activation";
  const commands = [];
  snapshots.inspectProject = async (...args) => {
    const result = await inspect(...args);
    if (args[0].workspaceRoot === config.workspace) {
      latest = result;
      snapshotReads++;
    }
    return result;
  };
  adapter.runRehearsalJson = async (options) => {
    if (options.workspaceRoot === config.workspace) {
      assert.ok(
        allowed.has(options.expectedCommand) &&
          options.command.join(" ") === options.expectedCommand,
      );
      commands.push(options.expectedCommand);
    }
    return read(options);
  };
  adapter.runEngineShutdown = async () => {
    mutationCalls++;
    throw Error("Read-only consumer verification refuses shutdown.");
  };
  const listener = vscode.window.onDidOpenTerminal(() => terminalCount++);
  try {
    await extension.activate();
    await vscode.commands.executeCommand("rehearsal.refresh");
    await wait(() => latest);
    assert.equal(latest.version, config.coreVersion);
    assert.equal(latest.discovery?.source, "core");
    assert.ok(latest.discovery.profile);
    assert.equal(latest.availability, "ready");
    assert.equal(latest.activity?.state, "idle");
    assert.ok(
      latest.baseline && [1, 2].includes(latest.baseline.formatVersion ?? 1),
    );
    assert.equal(latest.migrationReview?.targets.length, 2);
    assert.deepEqual(
      latest.migrationReview.targets.map((t) => t.name),
      ["primary", "publication-api"],
    );
    assert.ok(
      latest.migrationReview.targets.every(
        (t) => t.provider === "supabase" && t.migrationTool === undefined,
      ),
    );
    assert.equal(latest.migrationInsights?.state, "available");
    const before = snapshotIdentity(latest),
      plan = latest.migrationReview;
    const finding = [
      ...runtime("migration_insights.js").migrationInsightIndex(
        latest.migrationInsights.report,
      ),
    ].find(
      ([, item]) =>
        item.entry.workspaceRelativePath &&
        runtime("migration_source.js").isSafeMigrationFilename(
          item.entry.filename,
        ),
    );
    assert.ok(
      finding,
      "A genuinely reviewed pending SQL finding is required in the disposable fixture.",
    );
    const [findingId, item] = finding,
      source = {
        filename: item.entry.filename,
        sha256: item.entry.sha256,
        workspaceRelativePath: item.entry.workspaceRelativePath,
      };
    const exact = await runtime("migration_source.js").readExactMigrationInput(
      config.workspace,
      source,
    );
    await vscode.commands.executeCommand(
      "rehearsal.openWorkspace",
      folder.uri.toString(),
    );
    phase = "keyboard-pages-and-source";
    await writeJson(config.phasePath, {
      state: "ready",
      consumerReview: true,
      findingId,
      workspaceName: latest.workspaceName,
    });
    // Page navigation and screenshots belong to the UI's existing 180-second
    // budget; do not spend the focused source-opening budget before activation.
    phase = "keyboard-pages";
    await wait(async () => {
      try {
        const ready = await readRegular(
          path.join(path.dirname(config.phasePath), "ui-source-ready.json"),
        );
        const value = JSON.parse(ready.bytes.toString("utf8"));
        return (
          value.state === "source-control-ready" &&
          value.findingId === findingId
        );
      } catch (error) {
        if (error.code === "ENOENT") return false;
        throw error;
      }
    }, 180000);
    phase = "exact-source-opening";
    await wait(
      () => vscode.window.activeTextEditor?.document.uri.fsPath === exact.path,
    );
    const editor = vscode.window.activeTextEditor;
    assert.equal(editor.document.uri.scheme, "file");
    assert.equal(editor.document.uri.authority, "");
    assert.equal(editor.document.uri.query, "");
    assert.equal(editor.document.uri.fragment, "");
    assert.equal(editor.document.isDirty, false);
    assert.equal(editor.selection.active.line, item.finding.line - 1);
    assert.equal(editor.selection.active.character, item.finding.column - 1);
    assert.equal(
      runtime("migration_source.js").migrationSourceDocumentMatches(
        exact.text,
        editor.document.getText(),
      ),
      true,
    );
    const afterRead = await runtime(
      "migration_source.js",
    ).readExactMigrationInput(config.workspace, source);
    assert.equal(afterRead.identity, exact.identity);
    assert.equal(
      hash((await readRegular(exact.path, 2 * 1024 * 1024)).bytes),
      source.sha256,
    );
    assert.equal(latest.migrationReview.candidateSha256, plan.candidateSha256);
    await writeJson(config.phasePath, { state: "source-observed" });
    await wait(async () => {
      try {
        return (
          JSON.parse(
            (
              await readRegular(path.join(config.root, "ui-done.json"), 4096)
            ).bytes.toString(),
          ).complete === true
        );
      } catch {
        return false;
      }
    });
    phase = "return-dashboard";
    await vscode.commands.executeCommand(
      "rehearsal.openWorkspace",
      folder.uri.toString(),
    );
    await writeJson(config.phasePath, { state: "dashboard-returned" });
    await wait(async () => {
      try {
        return (
          JSON.parse(
            (
              await readRegular(
                path.join(config.root, "consumer-returned-done.json"),
                4096,
              )
            ).bytes.toString(),
          ).complete === true
        );
      } catch {
        return false;
      }
    });
    const priorReads = snapshotReads;
    phase = "fresh-read-only-reconciliation";
    await writeJson(config.phasePath, {
      state: "refresh-requested",
      at: Date.now(),
    });
    await vscode.commands.executeCommand("rehearsal.refresh");
    await writeJson(config.phasePath, {
      state: "refresh-completed",
      at: Date.now(),
    });
    await wait(() => snapshotReads > priorReads);
    assert.deepEqual(snapshotIdentity(latest), before);
    for (const required of [
      "engine status",
      "inspect configuration",
      "activity",
      "doctor",
      "explain",
      "inspect baseline",
      "candidates",
      "status",
      "inspect plan",
      "inspect insights",
    ])
      assert.ok(commands.includes(required));
    assert.ok(
      commands.includes("resources") || commands.includes("environments"),
    );
    assert.equal(terminalCount, 0);
    assert.equal(vscode.window.terminals.length, 0);
    assert.equal(mutationCalls, 0);
    await writeJson(config.resultPath, {
      status: "passed",
      scenario: config.scenario,
      candidateSha256: config.candidateSha256,
      coreArtifactSha256: config.coreArtifactSha256,
      coreVersion: config.coreVersion,
      extensionVersion: config.version,
      vscodeVersion: vscode.version,
      baselineFormat: latest.baseline.formatVersion ?? 1,
      baselineRows: latest.baseline.rowCount,
      targetCount: 2,
      candidateSha256Observed: plan.candidateSha256,
      candidateCount: plan.candidateCount,
      sourceSha256: source.sha256,
      line: item.finding.line,
      column: item.finding.column,
      terminalCount,
      mutationCalls,
      commands: [...new Set(commands)],
      snapshotBeforeAfterSha256: hash(JSON.stringify(before)),
      checks: [
        "genuine-ready-two-supabase-contract",
        "seven-real-keyboard-pages",
        "clean-exact-reviewed-sql-position",
        "return-to-dashboard",
        "fresh-public-snapshot-identity-preserved",
        "zero-editor-database-mutations",
      ],
      limitations: [
        "Read-only installed native acceptance. Physical database/volume contents, full application/browser behavior, Google identity and other platforms remain separate evidence.",
        "Screenshots require independent visual review; no synthetic acknowledgements replace actual keyboard or native document observations.",
      ],
    });
  } catch {
    await writeJson(config.resultPath, {
      status: "failed",
      scenario: config.scenario,
      phase,
      candidateSha256: config.candidateSha256,
      coreArtifactSha256: config.coreArtifactSha256,
      observed: {
        version:
          typeof latest?.version === "string" &&
          /^\d+\.\d+\.\d+(?:-[A-Za-z0-9.-]+)?$/u.test(latest.version)
            ? latest.version
            : null,
        ready: latest?.availability === "ready",
        idle: latest?.activity?.state === "idle",
        targetCount: latest?.migrationReview?.targets?.length ?? null,
        baselineFormat: latest?.baseline?.formatVersion ?? null,
        insightsAvailable: latest?.migrationInsights?.state === "available",
        sourceCommands: [...new Set(commands)],
      },
      terminalCount,
      mutationCalls,
    });
    throw Error(
      "Native real-consumer acceptance failed; private output withheld.",
    );
  } finally {
    listener.dispose();
    snapshots.inspectProject = inspect;
    adapter.runRehearsalJson = read;
    adapter.runEngineShutdown = shutdown;
  }
};
