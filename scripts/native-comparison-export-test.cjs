/** Real installed comparison/export flow; Save dialogs are never mocked. */
const assert = require("node:assert/strict");
const { randomUUID, createHash } = require("node:crypto");
const fs = require("node:fs/promises");
const path = require("node:path");
const { setTimeout: delay } = require("node:timers/promises");
const vscode = require("vscode");
const { readConfiguration } = require("./native-editor-driver.cjs");
const {
  createReadClient,
  readRegular,
  writeJson,
} = require("./native-editor-reads.cjs");
const { verifyComparisonExport } = require("./native-comparison-evidence.cjs");

const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
async function waitFor(check, timeoutMs = 60000) {
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    if (await check()) return;
    await delay(200);
  }
  throw new Error("Native comparison/export observation timed out.");
}
async function absent(file) {
  try {
    await fs.lstat(file);
  } catch (error) {
    if (error.code === "ENOENT") return;
    throw error;
  }
  assert.fail("An expected-absent owned report destination already exists.");
}
function diagnostic(error) {
  return {
    code:
      typeof error?.code === "string" &&
      /^[A-Z][A-Z0-9_]{0,63}$/u.test(error.code)
        ? error.code
        : "UNCLASSIFIED_ERROR",
    location:
      typeof error?.stack === "string"
        ? (error.stack.match(
            /native-comparison-export-test\.cjs:\d{1,7}:\d{1,5}/u,
          )?.[0] ?? "native-comparison-export-test")
        : "native-comparison-export-test",
  };
}

exports.run = async () => {
  const config = await readConfiguration(),
    fixture = config.fixture;
  assert.equal(config.scenario, "comparison-export");
  assert.equal(config.candidate.version, "0.1.23");
  assert.equal(config.candidate.distribution, "published");
  const sourcePath = path.join(fixture.projectRoot, fixture.configRelativePath);
  const original = await readRegular(sourcePath);
  const startedAt = Date.now(),
    token = randomUUID();
  const destinations = {
    cancelled: path.join(config.evidence, `cancelled-${token}.json`),
    json: path.join(config.evidence, `comparison-${token}.json`),
    markdown: path.join(config.evidence, `comparison-${token}.md`),
  };
  for (const file of Object.values(destinations)) await absent(file);
  const result = {
    status: "running",
    scenario: config.scenario,
    checks: [],
    operatorAcknowledgements: [],
    terminalEvents: [],
    vscodeVersion: vscode.version,
    nodeVersion: process.versions.node,
    limitations: [
      "Phase acknowledgements coordinate actual UI actions; they do not prove rendering, native Save-dialog appearance, clicks, keyboard operation, themes or accessibility. Record separate direct silent UI observations and screenshots for those claims.",
      "This exact installed PostgreSQL fixture compares one primary environment with two reviewed baseline generations. Incompatible providers, legacy schemas and large histories retain their separate deterministic contract tests, not new native proof.",
      "Exports are unsigned local readiness/baseline evidence, not proof that application behavior or a rehearsal passed. Known private fixture values are checked for exclusion; broad redaction remains independently tested by the production report-owner suite.",
      "No terminal command, SQL, database lifecycle, provider login, upload, Windows or screen-reader operation is requested by this scenario.",
    ],
  };
  const terminalEvent = (name) => {
    if (result.terminalEvents.length < 64) result.terminalEvents.push(name);
    else result.unexpectedTerminalOverflow = true;
  };
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
  let phase = "initialization",
    reads,
    originalBaseline,
    originalCandidates,
    defaultJsonDestination,
    failure;
  const ownedExports = [],
    disposables = [];
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
  const acknowledge = async (nonce, action) => {
    await waitFor(async () => {
      try {
        const { bytes } = await readRegular(config.controlPath, 4096);
        const value = JSON.parse(bytes.toString("utf8"));
        assert.deepEqual(
          Object.keys(value).sort(),
          ["action", "nonce", "schemaVersion"].sort(),
        );
        return (
          value.schemaVersion === 1 &&
          value.nonce === nonce &&
          value.action === action
        );
      } catch (error) {
        if (error.code === "ENOENT" || error instanceof SyntaxError)
          return false;
        throw error;
      }
    }, 180000);
    result.operatorAcknowledgements.push({
      phase,
      action,
      at: new Date().toISOString(),
      provesVisibleAction: false,
    });
  };
  const unchanged = async () => {
    const observed = await readRegular(sourcePath);
    assert.equal(observed.stat.dev, original.stat.dev);
    assert.equal(observed.stat.ino, original.stat.ino);
    assert.deepEqual(observed.bytes, original.bytes);
    assert.equal(observed.stat.mode & 0o777, original.stat.mode & 0o777);
    const open = vscode.workspace.textDocuments.find(
      (item) => item.uri.fsPath === sourcePath,
    );
    assert.notEqual(open?.isDirty, true);
    if (open && !open.isClosed)
      assert.equal(open.getText(), original.bytes.toString("utf8"));
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
    assert.ok(
      extension?.extensionPath.startsWith(`${config.extensions}${path.sep}`),
    );
    assert.equal(extension.packageJSON.version, config.candidate.version);
    const owners = {
      ...require(
        path.join(
          extension.extensionPath,
          "dist/src/environment_comparison.js",
        ),
      ),
      ...require(
        path.join(extension.extensionPath, "dist/src/verification_report.js"),
      ),
    };
    defaultJsonDestination = path.join(
      fixture.projectRoot,
      owners.verificationReportFilename(folder.name, "json"),
    );
    await absent(defaultJsonDestination);
    const { parseEnvelope, parseActivityData } = require(
      path.join(extension.extensionPath, "dist/src/contracts.js"),
    );
    const { parseBaselineInspectionData } = require(
      path.join(extension.extensionPath, "dist/src/review_contract.js"),
    );
    reads = createReadClient({
      config,
      environment,
      parseEnvelope,
      readChildren: new Map(),
    });
    assert.equal(
      parseActivityData(await reads.publicJson(["activity"])).state,
      "idle",
    );
    originalBaseline = parseBaselineInspectionData(
      await reads.publicJson(["inspect", "baseline"]),
      "postgresql",
    );
    assert.equal(originalBaseline.generationId, fixture.baselineGeneration);
    assert.equal(originalBaseline.rowCount, 10003);
    assert.equal(originalBaseline.generations.length, 2);
    const retained = originalBaseline.generations.find((item) => !item.active);
    assert.ok(retained && retained.rowCount === 3 && retained.tableCount === 3);
    originalCandidates = await reads.publicJson(["candidates"]);
    const expected = {
      coreVersion: fixture.coreVersion,
      extensionVersion: config.candidate.version,
      baselineGeneration: fixture.baselineGeneration,
      baselineDataSha256: originalBaseline.dataSha256,
      candidateDigest: originalCandidates.candidateSha256,
      leftId: "target:primary",
      rightId: `baseline:${retained.generationId}`,
      startedAt,
      finishedAt: Date.now(),
      withheld: [
        sourcePath,
        fixture.projectRoot,
        fixture.pinnedDockerEndpoint,
        fixture.applicationUrl,
        fixture.healthUrl,
        fixture.summaryUrl,
      ],
    };
    disposables.push(
      vscode.window.onDidOpenTerminal(() => terminalEvent("opened")),
      vscode.window.onDidStartTerminalShellExecution(() =>
        terminalEvent("execution-started"),
      ),
    );
    const setup = await publish(
      "comparison-setup",
      "Decline metadata checks if offered in the actual isolated UI; automatic updates are off. Acknowledge action 'begin-comparison' once the actual editor is visible. This is not consent on your behalf.",
    );
    await extension.activate();
    await acknowledge(setup, "begin-comparison");
    await vscode.commands.executeCommand("rehearsal.refresh");
    await vscode.commands.executeCommand("rehearsal.openWorkspace", key);
    const first = await publish(
      "comparison-active",
      `In Activity & reports choose First: primary environment; Second: ${fixture.baselineGeneration} (active baseline). Inspect the actual equal and unavailable facts and their limits. Capture a screenshot and then acknowledge action 'active-compared'.`,
    );
    await acknowledge(first, "active-compared");
    const second = await publish(
      "comparison-retained",
      `Choose Second: ${retained.generationId} (retained baseline), keeping First: primary environment. Inspect Database rows: different, 10003 / 3; unavailable values must not be zero or passed. Capture the actual rendered comparison, then acknowledge action 'retained-compared'. Keep this pair selected through both exports.`,
    );
    await acknowledge(second, "retained-compared");
    const cancel = await publish(
      "export-cancel",
      `Click the actual Export JSON button. Inspect the actual native Save dialog, set its destination to ${destinations.cancelled}, then click Cancel. Capture the dialog before cancellation and acknowledge action 'export-cancelled' afterward. Do not accept any overwrite prompt.`,
    );
    await acknowledge(cancel, "export-cancelled");
    for (const file of Object.values(destinations)) await absent(file);
    await absent(defaultJsonDestination);
    await unchanged();
    result.cancelledDestinationsAbsent = true;
    for (const [format, label] of [
      ["json", "JSON"],
      ["markdown", "Markdown"],
    ]) {
      const file = destinations[format];
      const nonce = await publish(
        `export-${format}`,
        `Click the actual Export ${label} button and choose exactly this explicit owned destination in the real Save dialog: ${file}. Save once without an overwrite prompt; capture the actual dialog/action and acknowledge action 'report-saved' after it closes. Do not edit the exported file.`,
      );
      await acknowledge(nonce, "report-saved");
      const observed = await readRegular(file, 256 * 1024);
      ownedExports.push({
        file,
        dev: observed.stat.dev,
        ino: observed.stat.ino,
        sha256: sha(observed.bytes),
      });
      await unchanged();
    }
    const json = await readRegular(destinations.json, 256 * 1024);
    const markdown = await readRegular(destinations.markdown, 256 * 1024);
    result.exportEvidence = verifyComparisonExport(
      json.bytes.toString("utf8"),
      markdown.bytes.toString("utf8"),
      { ...expected, finishedAt: Date.now() },
      owners,
    );
    result.exportSha256 = {
      json: sha(json.bytes),
      markdown: sha(markdown.bytes),
    };
    result.exportEvidenceFiles = {
      json: path.basename(destinations.json),
      markdown: path.basename(destinations.markdown),
    };
    result.checks.push(
      "real explicit-destination files read back as matching production JSON/Markdown aggregate reports",
      "cancelled owned destinations remained absent",
      "versions, exact baseline/candidate digests,14facts and explicit manual limits retained",
    );
    assert.equal(
      parseActivityData(await reads.publicJson(["activity"])).state,
      "idle",
    );
    result.status = "passed";
  } catch (error) {
    failure = error;
    result.status = "failed";
    result.failurePhase = phase;
    result.diagnostic = diagnostic(error);
  } finally {
    try {
      for (const owned of ownedExports.reverse()) {
        const open = vscode.workspace.textDocuments.find(
          (item) => item.uri.fsPath === owned.file,
        );
        assert.notEqual(
          open?.isDirty,
          true,
          "Unsaved report edit preserved for recovery.",
        );
        const observed = await readRegular(owned.file, 256 * 1024);
        assert.equal(observed.stat.dev, owned.dev);
        assert.equal(observed.stat.ino, owned.ino);
        assert.equal(
          sha(observed.bytes),
          owned.sha256,
          "Changed report preserved for recovery.",
        );
      }
      await absent(destinations.cancelled);
      if (defaultJsonDestination) await absent(defaultJsonDestination);
      for (const file of [destinations.json, destinations.markdown])
        if (!ownedExports.some((owned) => owned.file === file))
          await absent(file);
      if (result.status === "passed") assert.equal(ownedExports.length, 2);
      result.exportsRetainedForEvidence = ownedExports.length === 2;
      await unchanged();
      result.configurationRestored = true;
      for (const file of fixture.preserveFiles) {
        const observed = await readRegular(
          path.join(fixture.projectRoot, file.path),
          8 * 1024 * 1024,
        );
        assert.equal(sha(observed.bytes), file.sha256);
        assert.equal(observed.stat.mode & 0o777, file.mode);
      }
      if (reads && originalBaseline) {
        const finalBaseline = await reads.publicJson(["inspect", "baseline"]);
        assert.equal(finalBaseline.generationId, originalBaseline.generationId);
        assert.equal(finalBaseline.dataSha256, originalBaseline.dataSha256);
        assert.deepEqual(
          finalBaseline.generations,
          originalBaseline.generations,
        );
        assert.deepEqual(
          await reads.publicJson(["candidates"]),
          originalCandidates,
        );
        result.baselineGenerationPreserved = true;
      }
      result.noTerminalCommandsStarted =
        result.terminalEvents.length === 0 &&
        vscode.window.terminals.length === 0;
      assert.equal(result.noTerminalCommandsStarted, true);
      assert.notEqual(result.unexpectedTerminalOverflow, true);
    } catch (error) {
      result.status = "failed";
      result.recoveryRequired = true;
      result.cleanupDiagnostic = diagnostic(error);
      result.cleanupLimitation =
        "Unknown disk or unsaved report/configuration edits were retained; later preservation checks may have been skipped. Retain this owned fixture for explicit recovery.";
    }
    if (reads) {
      result.readCleanup = await reads.cleanup();
      result.ownedReadProcessesGone =
        result.readCleanup.remaining.length === 0 &&
        !result.readCleanup.fallbackUsed &&
        !result.readCleanup.observationFailed &&
        !result.readCleanup.closeObservationFailed &&
        result.readCleanup.failedReads === 0;
      if (!result.ownedReadProcessesGone) result.status = "failed";
    }
    for (const disposable of disposables) disposable.dispose();
    result.comparisonExportPassed =
      result.status === "passed" &&
      result.cancelledDestinationsAbsent === true &&
      result.exportsRetainedForEvidence === true &&
      result.configurationRestored === true &&
      result.baselineGenerationPreserved === true &&
      result.ownedReadProcessesGone === true &&
      result.noTerminalCommandsStarted === true;
    if (!result.comparisonExportPassed) result.status = "failed";
    await writeJson(config.resultPath, result);
  }
  if (result.status !== "passed")
    throw (
      failure ??
      new Error("Native comparison/export preservation was inconclusive.")
    );
};
