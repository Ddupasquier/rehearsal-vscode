/** Real canonical extension activation; observes public results without replacing them. */
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const { createHash } = require("node:crypto");
const { setTimeout: delay } = require("node:timers/promises");
const vscode = require("vscode");
const { readConfiguration } = require("./native-editor-driver.cjs");
const { readRegular, writeJson } = require("./native-editor-reads.cjs");
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
async function wait(check) {
  const end = Date.now() + 60000;
  while (Date.now() < end) {
    if (await check()) return;
    await delay(100);
  }
  throw Error("Native migration observation incomplete.");
}
const diagnosticCodes = new Set([
  "platform_unsupported",
  "package_missing",
  "package_link_external",
  "package_invalid",
  "config_outside_workspace",
  "process_failed",
  "output_limit",
  "timeout",
  "cancelled",
  "invalid_cli_contract",
  "unexpected_extension_failure",
]);
const diagnosticCode = (value) =>
  diagnosticCodes.has(value) ? value : value == null ? null : "unclassified";
const enumValue = (value, allowed) => (allowed.includes(value) ? value : null);
exports.snapshotObservation = (latest) => ({
  availability: enumValue(latest?.availability, [
    "ready",
    "error",
    "not_ready",
    "package_missing",
    "untrusted",
    "unsupported",
  ]),
  version:
    typeof latest?.version === "string" &&
    latest.version.length <= 80 &&
    /^\d+\.\d+\.\d+(?:-[A-Za-z0-9.-]+)?$/u.test(latest.version)
      ? latest.version
      : null,
  errorCode: diagnosticCode(latest?.error?.code),
  activity: enumValue(latest?.activity?.state, ["idle", "busy", "unknown"]),
  readiness: enumValue(latest?.readiness?.state, ["READY", "NOT READY"]),
  baselineFormat: [1, 2, 3, 4, 5].includes(latest?.baseline?.formatVersion)
    ? latest.baseline.formatVersion
    : null,
  hasNativeBinding: Boolean(latest?.baseline?.nativeMigrations),
  insightsAvailable: latest?.migrationInsights?.state === "available",
});
exports.knexReviewedCandidate = (plan) => {
  const entries = plan.targets
    .flatMap((target) => target.entries)
    .filter(
      (entry) =>
        entry.status === "candidate" &&
        entry.nativeIdentity?.kind === "knex" &&
        entry.nativeIdentity.name === entry.filename &&
        /^[A-Za-z0-9][A-Za-z0-9_-]{0,185}\.cjs$/u.test(entry.filename),
    );
  assert.ok(
    entries.length > 0,
    "Require a genuine reviewed Knex candidate source.",
  );
  return entries[0];
};
exports.run = async () => {
  const config = await readConfiguration();
  const migrationKind = config.migrationKind ?? "prisma";
  assert.ok(["prisma", "drizzle", "knex"].includes(migrationKind));
  assert.equal(config.scenario, migrationKind + "-review");
  assert.equal(process.platform, "linux");
  assert.equal(process.arch, "x64");
  assert.equal(vscode.workspace.isTrusted, true);
  assert.equal(vscode.workspace.workspaceFolders.length, 1);
  const folder = vscode.workspace.workspaceFolders[0];
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
  const snapshotRuntime = runtime("project_snapshot.js"),
    original = snapshotRuntime.inspectProject,
    processRuntime = runtime("process_adapter.js"),
    originalJson = processRuntime.runRehearsalJson;
  let sourceDispatches = 0,
    sourceObservation;
  if (migrationKind !== "prisma")
    processRuntime.runRehearsalJson = async (...args) => {
      const selected =
        args[0].workspaceRoot === config.workspace &&
        args[0].expectedCommand === "inspect source";
      if (selected) sourceDispatches++;
      const result = await originalJson(...args);
      if (selected) sourceObservation = { command: args[0].command, result };
      return result;
    };
  let latest,
    phase = "activation",
    terminalCount = 0;
  const listener = vscode.window.onDidOpenTerminal(() => terminalCount++);
  const commands = [],
    parserFailures = [],
    restore = [];
  const adapter = runtime("process_adapter.js"),
    publicRead = adapter.runRehearsalJson;
  const commandNames = [
    "activity",
    "discover",
    "doctor",
    "status",
    "explain",
    "candidates",
    "inspect baseline",
    "inspect plan",
    "inspect insights",
    "inspect source",
    "inspect config",
    "inspect configuration",
    "configuration",
    "resources",
    "environments",
    "engine status",
  ];
  adapter.runRehearsalJson = async (...args) => {
    const command = commandNames.includes(args[0]?.expectedCommand)
      ? args[0].expectedCommand
      : "other";
    try {
      const result = await publicRead(...args);
      if (commands.length < 64)
        commands.push({
          command,
          status: enumValue(result?.result?.status, [
            "success",
            "not_ready",
            "error",
          ]),
          errorCode: diagnosticCode(result?.result?.error?.code),
          exitCode: Number.isInteger(result?.exitCode) ? result.exitCode : null,
        });
      return result;
    } catch (error) {
      if (commands.length < 64)
        commands.push({
          command,
          status: "threw",
          errorCode: diagnosticCode(error?.code ?? error?.result?.error?.code),
          exitCode: Number.isInteger(error?.exitCode) ? error.exitCode : null,
        });
      throw error;
    }
  };
  restore.push(() => {
    adapter.runRehearsalJson = publicRead;
  });
  const parsers = {
    "contracts.js": [
      "parseEnvelope",
      "parseVersionResult",
      "parseActivityData",
      "parseProjectDiscoveryData",
      "parseStatusData",
      "parseResourceInventoryData",
    ],
    "review_contract.js": [
      "parseReviewTargets",
      "parseBaselineInspectionData",
      "parseBaselineScopeReview",
      "parseAuthenticationReview",
    ],
    "migration_review.js": [
      "parseMigrationReviewPlan",
      "parsePrismaMigrationToolBinding",
      "assertMatchingMigrationCandidates",
    ],
    "shape_contract.js": ["parseBaselineShapeData"],
    "configuration_contract.js": ["parseConfigurationMetadata"],
    "migration_insights.js": ["parseMigrationInsights"],
  };
  for (const [moduleName, names] of Object.entries(parsers)) {
    const module = runtime(moduleName);
    for (const name of names) {
      const originalParser = module[name];
      if (typeof originalParser !== "function") continue;
      module[name] = (...args) => {
        try {
          return originalParser(...args);
        } catch (error) {
          if (parserFailures.length < 16) {
            const frame =
              typeof error?.stack === "string"
                ? error.stack.match(
                    /(?:\/|\\)(contracts|review_contract|migration_review|shape_contract|configuration_contract|migration_insights|project_snapshot|process_adapter)\.js:(\d{1,7}):(\d{1,6})/u,
                  )
                : null;
            parserFailures.push({
              module: moduleName,
              parser: name,
              errorCode: diagnosticCode(error?.code),
              location: frame ? `${frame[1]}.js:${frame[2]}:${frame[3]}` : null,
            });
          }
          throw error;
        }
      };
      restore.push(() => {
        module[name] = originalParser;
      });
    }
  }

  snapshotRuntime.inspectProject = async (...args) => {
    const result = await original(...args);
    if (args[0].workspaceRoot === config.workspace) latest = result;
    return result;
  };
  try {
    await extension.activate();
    await vscode.commands.executeCommand("rehearsal.refresh");
    await wait(() => latest);
    assert.equal(latest.availability, "ready");
    assert.equal(latest.activity.state, "idle");
    assert.equal(latest.version, config.coreVersion);
    assert.equal(
      latest.baseline.formatVersion,
      migrationKind === "knex" ? 5 : migrationKind === "drizzle" ? 4 : 3,
    );
    assert.ok(latest.baseline.nativeMigrations);
    const plan = latest.migrationReview;
    assert.equal(plan.schemaVersion, 1);
    assert.ok(
      plan.targets.every(
        (target) =>
          target.provider === "postgresql" &&
          target.migrationTool?.kind === migrationKind,
      ),
    );
    if (migrationKind === "knex") {
      assert.notEqual(
        latest.migrationInsights.state,
        "available",
        "SQL Insights must not analyze Knex JavaScript.",
      );
      const entry = exports.knexReviewedCandidate(plan);
      const sourceId = runtime(
        "migration_source_review.js",
      ).migrationSourceReviewId(plan, entry);
      await vscode.commands.executeCommand(
        "rehearsal.openWorkspace",
        folder.uri.toString(),
      );
      phase = "knex-reviewed-input";
      await writeJson(config.phasePath, {
        state: "ready",
        sourceId,
        filename: entry.filename,
        workspaceName: latest.workspaceName,
        reviewedCodeOnly: true,
      });
      await wait(
        () =>
          sourceDispatches === 1 &&
          sourceObservation &&
          path.basename(
            vscode.window.activeTextEditor?.document.uri.fsPath ?? "",
          ) === entry.filename,
      );
      assert.equal(sourceDispatches, 1);
      assert.ok(sourceObservation);
      assert.equal(sourceObservation.result.result.status, "success");
      assert.equal(
        sourceObservation.result.result.rehearsalVersion,
        config.coreVersion,
      );
      assert.deepEqual(
        sourceObservation.command,
        runtime("migration_source_review.js").reviewedMigrationSourceCommand(
          plan,
          entry,
        ),
      );
      const reference = runtime(
        "migration_source_review.js",
      ).parseReviewedMigrationSource(
        sourceObservation.result.result.data,
        plan,
        entry,
      );
      const source = {
        filename: entry.filename,
        sha256: entry.sha256,
        workspaceRelativePath: reference.workspaceRelativePath,
      };
      const exact = await runtime(
        "migration_source.js",
      ).readExactMigrationInput(config.workspace, source, "knex");
      assert.equal(
        vscode.window.activeTextEditor?.document.uri.fsPath,
        exact.path,
      );
      assert.equal(reference.filename, source.filename);
      assert.equal(reference.sha256, source.sha256);
      assert.equal(reference.candidateSha256, plan.candidateSha256);
      const editor = vscode.window.activeTextEditor;
      assert.equal(editor.document.uri.scheme, "file");
      assert.equal(editor.document.uri.authority, "");
      assert.equal(editor.document.isDirty, false);
      assert.equal(editor.selection.active.line, 0);
      assert.equal(editor.selection.active.character, 0);
      assert.equal(
        runtime("migration_source.js").migrationSourceDocumentMatches(
          exact.text,
          editor.document.getText(),
        ),
        true,
      );
      const rechecked = await runtime(
        "migration_source.js",
      ).readExactMigrationInput(config.workspace, source, "knex");
      assert.equal(rechecked.identity, exact.identity);
      assert.equal(
        hash((await readRegular(exact.path, 8 * 1024 * 1024)).bytes),
        source.sha256,
      );
      await writeJson(config.phasePath, { state: "reviewed-input-observed" });
      await wait(async () => {
        try {
          return (
            JSON.parse(
              (
                await readRegular(
                  path.join(config.root, "reviewed-ui-done.json"),
                  4096,
                )
              ).bytes.toString(),
            ).complete === true
          );
        } catch {
          return false;
        }
      });
      assert.equal(vscode.window.activeTextEditor, editor);
      assert.equal(editor.document.isDirty, false);
      await vscode.commands.executeCommand(
        "workbench.action.closeActiveEditor",
      );
      await vscode.commands.executeCommand(
        "rehearsal.openWorkspace",
        folder.uri.toString(),
      );
      assert.equal(
        latest.migrationReview.candidateSha256,
        plan.candidateSha256,
      );
      assert.equal(terminalCount, 0);
      assert.equal(vscode.window.terminals.length, 0);
      assert.ok(
        vscode.workspace.textDocuments.every((document) => !document.isDirty),
      );
      assert.ok(commands.every((command) => command.command !== "other"));
      await writeJson(config.phasePath, { state: "reviewed-code-returned" });
      await wait(async () => {
        try {
          const value = JSON.parse(
            (
              await readRegular(path.join(config.root, "ui-done.json"), 4096)
            ).bytes.toString(),
          );
          return value.complete === true && value.overview === true;
        } catch {
          return false;
        }
      });
      await writeJson(config.resultPath, {
        status: "passed",
        scenario: config.scenario,
        candidateSha256: config.candidateSha256,
        coreArtifactSha256: config.coreArtifactSha256,
        coreVersion: latest.version,
        vscodeVersion: vscode.version,
        baselineFormat: 5,
        migrationKind,
        nativeIdentity: entry.nativeIdentity,
        baselineCutoff: latest.baseline.migrationCutoff,
        candidateCount: plan.candidateCount,
        filename: source.filename,
        sourceSha256: source.sha256,
        terminalCount,
        sourceDispatches,
        overviewReturned: true,
        dirtyDocuments: 0,
        insightsAvailable: false,
        reviewedInput: {
          candidateSha256: plan.candidateSha256,
          nativeIdentity: entry.nativeIdentity,
          filename: source.filename,
          sha256: source.sha256,
          clean: true,
          line: 0,
          column: 0,
        },
        checks: [
          "canonical-ready-native-contract",
          "real-reviewed-code-button-public-cli-root-binding",
          "clean-exact-reviewed-code-at-file-top",
          "return-to-overview",
          "no-editor-terminal-or-dirty-document",
        ],
        limitations: [
          "Knex input read as text only; no JavaScript execution, SQL Insights or failure-position attribution. Core owns genuine database and worker isolation qualification.",
        ],
      });
      return;
    }
    assert.equal(latest.migrationInsights.state, "available");
    const report = latest.migrationInsights.report;
    const finding = [
      ...runtime("migration_insights.js").migrationInsightIndex(report),
    ].find(
      ([, item]) =>
        item.entry.workspaceRelativePath &&
        (migrationKind === "drizzle"
          ? item.entry.nativeIdentity?.kind === "drizzle" &&
            item.entry.filename === `${item.entry.nativeIdentity.tag}.sql`
          : /^\d{14}_[A-Za-z0-9_-]+\/migration\.sql$/u.test(
              item.entry.filename,
            )),
    );
    assert.ok(
      finding,
      "Require a genuine candidate native SQL finding for navigation.",
    );
    const [findingId, item] = finding;
    const source = {
      filename: item.entry.filename,
      sha256: item.entry.sha256,
      workspaceRelativePath: item.entry.workspaceRelativePath,
    };
    const exact = await runtime("migration_source.js").readExactMigrationInput(
      config.workspace,
      source,
      migrationKind === "drizzle",
    );
    await vscode.commands.executeCommand(
      "rehearsal.openWorkspace",
      folder.uri.toString(),
    );
    const reviewedEntry =
      migrationKind === "drizzle"
        ? plan.targets
            .flatMap((target) => target.entries)
            .find(
              (entry) =>
                entry.filename === source.filename &&
                entry.sha256 === source.sha256 &&
                runtime("native_migration_contract.js").sameDrizzleIdentity(
                  entry.nativeIdentity,
                  item.entry.nativeIdentity,
                ),
            )
        : undefined;
    if (migrationKind === "drizzle") assert.ok(reviewedEntry);
    const sourceId = reviewedEntry
      ? runtime("migration_source_review.js").migrationSourceReviewId(
          plan,
          reviewedEntry,
        )
      : undefined;
    phase = "rendered-source";
    await writeJson(config.phasePath, {
      state: "ready",
      findingId,
      ...(sourceId ? { sourceId } : {}),
      filename: source.filename,
      workspaceName: latest.workspaceName,
    });
    if (migrationKind === "drizzle") {
      phase = "reviewed-input";
      await wait(
        () =>
          sourceDispatches === 1 &&
          vscode.window.activeTextEditor?.document.uri.fsPath === exact.path,
      );
      assert.equal(sourceDispatches, 1);
      assert.ok(sourceObservation);
      assert.equal(sourceObservation.result.result.status, "success");
      assert.equal(
        sourceObservation.result.result.rehearsalVersion,
        config.coreVersion,
      );
      assert.deepEqual(
        sourceObservation.command,
        runtime("migration_source_review.js").reviewedMigrationSourceCommand(
          plan,
          reviewedEntry,
        ),
      );
      const reference = runtime(
        "migration_source_review.js",
      ).parseReviewedMigrationSource(
        sourceObservation.result.result.data,
        plan,
        reviewedEntry,
      );
      assert.equal(
        reference.candidateSha256,
        latest.migrationReview.candidateSha256,
      );
      assert.equal(reference.filename, source.filename);
      assert.equal(reference.sha256, source.sha256);
      const reviewedEditor = vscode.window.activeTextEditor;
      assert.equal(reviewedEditor.document.uri.scheme, "file");
      assert.equal(reviewedEditor.document.uri.authority, "");
      assert.equal(reviewedEditor.document.isDirty, false);
      assert.equal(reviewedEditor.selection.active.line, 0);
      assert.equal(reviewedEditor.selection.active.character, 0);
      assert.equal(
        runtime("migration_source.js").migrationSourceDocumentMatches(
          exact.text,
          reviewedEditor.document.getText(),
        ),
        true,
      );
      const rechecked = await runtime(
        "migration_source.js",
      ).readExactMigrationInput(config.workspace, source, true);
      assert.equal(rechecked.identity, exact.identity);
      assert.equal(
        hash((await readRegular(exact.path, 2 * 1024 * 1024)).bytes),
        source.sha256,
      );
      await writeJson(config.phasePath, { state: "reviewed-input-observed" });
      await wait(async () => {
        try {
          return (
            JSON.parse(
              (
                await readRegular(
                  path.join(config.root, "reviewed-ui-done.json"),
                  4096,
                )
              ).bytes.toString(),
            ).complete === true
          );
        } catch {
          return false;
        }
      });
      assert.equal(vscode.window.activeTextEditor, reviewedEditor);
      assert.equal(reviewedEditor.document.isDirty, false);
      await vscode.commands.executeCommand(
        "workbench.action.closeActiveEditor",
      );
      await wait(
        () =>
          vscode.window.activeTextEditor?.document.uri.fsPath !== exact.path,
      );
      await vscode.commands.executeCommand(
        "rehearsal.openWorkspace",
        folder.uri.toString(),
      );
      assert.equal(
        latest.migrationReview.candidateSha256,
        plan.candidateSha256,
      );
      await writeJson(config.phasePath, { state: "finding-ready" });
      phase = "static-finding";
    }
    await wait(
      () => vscode.window.activeTextEditor?.document.uri.fsPath === exact.path,
    );
    const editor = vscode.window.activeTextEditor;
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
    assert.equal(
      hash((await readRegular(exact.path, 2 * 1024 * 1024)).bytes),
      source.sha256,
    );
    if (migrationKind === "drizzle") assert.equal(sourceDispatches, 1);
    assert.equal(terminalCount, 0);
    assert.equal(vscode.window.terminals.length, 0);
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
    await writeJson(config.resultPath, {
      status: "passed",
      scenario: config.scenario,
      candidateSha256: config.candidateSha256,
      coreArtifactSha256: config.coreArtifactSha256,
      coreVersion: latest.version,
      vscodeVersion: vscode.version,
      baselineFormat: latest.baseline.formatVersion,
      migrationKind,
      ...(migrationKind === "drizzle"
        ? {
            nativeIdentity: item.entry.nativeIdentity,
            baselineCutoff: latest.baseline.migrationCutoff,
          }
        : {}),
      candidateCount: plan.candidateCount,
      filename: source.filename,
      sourceSha256: source.sha256,
      line: item.finding.line,
      column: item.finding.column,
      terminalCount,
      sourceDispatches,
      ...(migrationKind === "drizzle"
        ? {
            reviewedInput: {
              candidateSha256: plan.candidateSha256,
              nativeIdentity: reviewedEntry.nativeIdentity,
              filename: source.filename,
              sha256: source.sha256,
              clean: true,
              line: 0,
              column: 0,
            },
          }
        : {}),
      checks: [
        "canonical-ready-native-contract",
        ...(migrationKind === "drizzle"
          ? [
              "real-reviewed-input-button-public-cli-root-binding",
              "clean-exact-reviewed-input-at-file-top",
            ]
          : []),
        "real-rendered-keyboard-source-navigation",
        "clean-exact-native-sql-and-position",
      ],
      limitations: [
        "Read-only installed Linux editor acceptance; no Editor database mutation or VM shutdown. Screenshots require separate visual review.",
      ],
    });
  } catch {
    await writeJson(config.resultPath, {
      status: "failed",
      scenario: config.scenario,
      phase,
      candidateSha256: config.candidateSha256,
      coreArtifactSha256: config.coreArtifactSha256,
      observed: { ...exports.snapshotObservation(latest), sourceDispatches },
      commands,
      parserFailures,
      terminalCount,
    });
    throw Error("Native migration review failed; private output withheld.");
  } finally {
    snapshotRuntime.inspectProject = original;
    for (const revert of restore.reverse()) revert();
    if (migrationKind !== "prisma")
      processRuntime.runRehearsalJson = originalJson;
    listener.dispose();
  }
};
