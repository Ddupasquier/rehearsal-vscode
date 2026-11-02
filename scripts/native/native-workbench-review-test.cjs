/** Real installed workbench observations. Operator actions are never injected or mocked. */
const assert = require("node:assert/strict");
const { randomUUID, createHash } = require("node:crypto");
const fs = require("node:fs/promises");
const path = require("node:path");
const { setTimeout: delay } = require("node:timers/promises");
const vscode = require("vscode");
const { readConfiguration } = require("./native-editor-driver.cjs");
const {
  createReadClient,
  readRegular: regular,
  writeJson,
} = require("./native-editor-reads.cjs");

const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
async function waitFor(check, timeoutMs = 60000) {
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    if (await check()) return;
    await delay(200);
  }
  throw new Error("Native workbench observation timed out.");
}
const tabs = () => vscode.window.tabGroups.all.flatMap((group) => group.tabs);
const reviews = () =>
  tabs().filter(
    (tab) =>
      tab.input instanceof vscode.TabInputWebview &&
      tab.label === "Review configuration changes · Rehearsal",
  );
const projectTab = () =>
  tabs().find(
    (tab) =>
      tab.input instanceof vscode.TabInputWebview &&
      /Rehearsal/u.test(tab.label) &&
      !tab.label.startsWith("Review configuration changes"),
  );
function replaceOne(source, expression, replacement) {
  assert.equal([...source.matchAll(expression)].length, 1);
  return source.replace(expression, replacement);
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
            /native-workbench-review-test\.cjs:\d{1,7}:\d{1,5}/u,
          )?.[0] ?? "native-workbench-review-test")
        : "native-workbench-review-test",
  };
}

exports.run = async () => {
  const config = await readConfiguration(),
    fixture = config.fixture;
  assert.ok(
    [
      "workbench-review",
      "presentation-review",
      "configuration-guidance",
    ].includes(config.scenario),
  );
  const presentationOnly = config.scenario === "presentation-review";
  const guidanceOnly = config.scenario === "configuration-guidance";
  const invalidBeforeReview =
    config.candidate.numericRefusal === "before-review";
  const sourcePath = path.join(fixture.projectRoot, fixture.configRelativePath);
  const original = await regular(sourcePath),
    originalText = original.bytes.toString("utf8");
  const sourceIdentity = { dev: original.stat.dev, ino: original.stat.ino };
  const retentionText = replaceOne(
    originalText,
    /retainBaselineGenerations: 2,/gu,
    "retainBaselineGenerations: 3,",
  );
  assert.equal(
    new URL(fixture.applicationUrl).port,
    String(config.expectedApplicationPort),
    "This prepared endpoint scenario requires its exact leased port.",
  );
  const concurrentMarker =
    "// Native workbench review: owned concurrent-save marker.";
  assert.equal(originalText.includes(concurrentMarker), false);
  const concurrentText = `${originalText}${originalText.endsWith("\n") ? "" : "\n"}${concurrentMarker}`;
  const allowedSources = new Set([originalText, retentionText, concurrentText]);
  const result = {
    status: "running",
    scenario: config.scenario,
    checks: [],
    operatorAcknowledgements: [],
    terminalEvents: [],
    configurationSaveEvents: [],
    vscodeVersion: vscode.version,
    nodeVersion: process.versions.node,
    limitations: [
      "Control acknowledgements coordinate real UI actions; they are not rendered, keyboard, focus, theme or assistive-technology proof.",
      "Passing scope is review-tab lifecycle, exact saved/read-back configuration, preserved known concurrent edit, invalid-proposal source preservation, recovery and unchanged public identities. No private webview handler or notification is mocked.",
      "Control acknowledgements do not prove visible refusal messages or the use of display controls; record rendered/error, keyboard, focus, three-theme, large-font and assistive-technology observations separately.",
      "No migration SQL or database lifecycle command is executed. Comparison exports, stopped-engine, provider login and Windows acceptance are outside this scenario. The three-row migration list is not large-list native proof.",
      ...(guidanceOnly
        ? [
            "This configuration-guidance continuation covers only stale-review preservation, pre-review numeric refusal and corrected review recovery for the selected exact artifact. It does not re-prove the original successful save, endpoint, inventory or migration presentation. Visible guidance, min/max validity and focus need separate silent native observations; no speech is authorized.",
          ]
        : []),
    ],
  };
  let phase = "initialization",
    reads,
    document,
    originalBaseline,
    originalCandidates,
    failure;
  const ownedFiles = [],
    disposables = [];
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
  const acknowledge = async (nonce, action, timeoutMs = 60000) => {
    await waitFor(async () => {
      try {
        const { bytes } = await regular(config.controlPath, 4096);
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
    }, timeoutMs);
    result.operatorAcknowledgements.push({
      phase,
      action,
      at: new Date().toISOString(),
      provesVisibleAction: false,
    });
  };
  const unchanged = async (expected = originalText) => {
    const observed = await regular(sourcePath);
    assert.equal(observed.stat.dev, sourceIdentity.dev);
    assert.equal(observed.stat.ino, sourceIdentity.ino);
    assert.equal(observed.bytes.toString("utf8"), expected);
    assert.equal(observed.stat.mode & 0o777, original.stat.mode & 0o777);
    if (document) {
      if (document.isClosed)
        document = await vscode.workspace.openTextDocument(
          vscode.Uri.file(sourcePath),
        );
      assert.equal(document.isDirty, false);
      assert.equal(document.getText(), expected);
    }
  };
  const returnFromReview = async (name) => {
    const nonce = await publish(
      name,
      "Use the actual review's Return to project button. Then acknowledge action 'returned'. No command or panel message is injected.",
    );
    await acknowledge(nonce, "returned");
    await waitFor(
      () => reviews().length === 0 && projectTab()?.isActive === true,
    );
  };
  const restoreOwnedConfiguration = async () => {
    const observed = await regular(sourcePath),
      text = observed.bytes.toString("utf8");
    assert.equal(observed.stat.dev, sourceIdentity.dev);
    assert.equal(observed.stat.ino, sourceIdentity.ino);
    assert.ok(
      allowedSources.has(text),
      "Unexpected concurrent configuration edits were preserved; no restoration attempted.",
    );
    if (!document || document.isClosed)
      document = await vscode.workspace.openTextDocument(
        vscode.Uri.file(sourcePath),
      );
    assert.equal(
      document.isDirty,
      false,
      "Unsaved concurrent edits were preserved; no restoration attempted.",
    );
    assert.equal(document.getText(), text);
    if (text !== originalText) {
      const edit = new vscode.WorkspaceEdit();
      edit.replace(
        document.uri,
        new vscode.Range(
          document.positionAt(0),
          document.positionAt(text.length),
        ),
        originalText,
      );
      assert.equal(await vscode.workspace.applyEdit(edit), true);
      assert.equal(document.getText(), originalText);
      assert.equal(await document.save(), true);
    }
    await unchanged();
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
    const { parseEnvelope, parseActivityData } = require(
      path.join(extension.extensionPath, "dist/src/contracts.js"),
    );
    const { parseBaselineInspectionData } = require(
      path.join(extension.extensionPath, "dist/src/review_contract.js"),
    );
    const {
      parseMigrationReviewPlan,
      assertMatchingMigrationCandidates,
    } = require(
      path.join(extension.extensionPath, "dist/src/migration_review.js"),
    );
    const { parseConfigurationMetadata } = require(
      path.join(extension.extensionPath, "dist/src/configuration_contract.js"),
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
    assert.equal(originalBaseline.generations?.length, 2);
    const retained = originalBaseline.generations.find((item) => !item.active);
    assert.ok(retained && retained.rowCount === 3 && retained.tableCount === 3);
    originalCandidates = await reads.publicJson(["candidates"]);
    const metadata = parseConfigurationMetadata(
      await reads.publicJson(["configuration"]),
    );
    assert.equal(metadata.sourceSha256, sha(original.bytes));
    const retainedCount = metadata.fields.find(
      (field) => field.path === "resources.retainedEnvironmentCount",
    );
    assert.equal(retainedCount?.kind, "integer");
    assert.ok(
      Number.isSafeInteger(retainedCount.value) &&
        retainedCount.value >= 1 &&
        retainedCount.value <= 1000,
    );
    assert.equal(
      parseMigrationReviewPlan(await reads.publicJson(["inspect", "plan"]))
        .candidateCount,
      0,
    );
    document = await vscode.workspace.openTextDocument(
      vscode.Uri.file(sourcePath),
    );
    await unchanged();
    disposables.push(
      vscode.window.onDidOpenTerminal(() =>
        result.terminalEvents.push("opened"),
      ),
    );
    disposables.push(
      vscode.window.onDidStartTerminalShellExecution(() =>
        result.terminalEvents.push("execution-started"),
      ),
    );
    disposables.push(
      vscode.workspace.onDidSaveTextDocument((saved) => {
        if (saved.uri.fsPath === sourcePath) {
          if (result.configurationSaveEvents.length >= 64) {
            result.unexpectedSaveOverflow = true;
            return;
          }
          result.configurationSaveEvents.push({
            phase,
            sha256: sha(saved.getText()),
          });
        }
      }),
    );
    const setup = await publish(
      "setup-await-operator",
      "If metadata consent appears, decline it in the real UI. Automatic updates are off. Acknowledge action 'begin-review' after the actual editor is visible. This is not consent on your behalf.",
    );
    await extension.activate();
    await acknowledge(setup, "begin-review");
    await vscode.commands.executeCommand("rehearsal.refresh");
    await vscode.commands.executeCommand("rehearsal.openWorkspace", key);
    await waitFor(() => Boolean(projectTab()), 10000);
    if (!presentationOnly) {
      if (!guidanceOnly) {
        await publish(
          "configuration-cancel-open",
          "In Configuration, change only Baseline versions to retain from 2 to 3 and click Review exact configuration diff. Do not apply.",
        );
        await waitFor(() => reviews().length === 1);
        await unchanged();
        const cancel = await publish(
          "configuration-cancel",
          "Inspect the actual diff, then click Cancel in that review. Acknowledge action 'cancelled'.",
        );
        await acknowledge(cancel, "cancelled");
        await waitFor(() => reviews().length === 0);
        await unchanged();
        result.checks.push(
          "actual configuration review tab opened and closed with original bytes and document preserved",
        );

        await publish(
          "configuration-apply-open",
          "In Configuration, propose only Baseline versions to retain 3 again, then click Review exact configuration diff. Leave the review open.",
        );
        await waitFor(() => reviews().length === 1);
        await unchanged();
        await publish(
          "configuration-apply",
          "Read the actual diff, then click Apply changes in the review. This changes only this disposable fixture's retention setting, never its database.",
        );
        await waitFor(
          async () =>
            (await regular(sourcePath)).bytes.toString("utf8") ===
            retentionText,
        );
        await waitFor(async () => {
          if (document.isClosed)
            document = await vscode.workspace.openTextDocument(
              vscode.Uri.file(sourcePath),
            );
          return !document.isDirty && document.getText() === retentionText;
        }, 10000);
        await unchanged(retentionText);
        assert.equal(result.terminalEvents.length, 0);
        result.checks.push(
          "real UI save read back as exactly the one-field retention change with all comments retained",
        );
        await returnFromReview("configuration-return");
        await restoreOwnedConfiguration();
        await vscode.commands.executeCommand("rehearsal.refresh");
      }

      await publish(
        "configuration-concurrent-review-open",
        "In Configuration, propose only retention 2 to 3 and open Review exact configuration diff. Leave that review open; do not apply yet.",
      );
      await waitFor(() => reviews().length === 1);
      await unchanged();
      const concurrent = await publish(
        "configuration-concurrent-save",
        `In the actual text editor open ${fixture.configRelativePath}. Keep retention 2 and every original byte. Append this exact single line at EOF, without quotation marks or a final newline: ${JSON.stringify(concurrentMarker)}; then Save and return to the still-open review without applying. Acknowledge action 'source-saved' only after the file is saved.`,
      );
      await acknowledge(concurrent, "source-saved");
      await waitFor(async () => {
        try {
          await unchanged(concurrentText);
          return true;
        } catch (error) {
          const text = (await regular(sourcePath)).bytes.toString("utf8");
          assert.ok(
            allowedSources.has(text),
            "Unknown concurrent source was preserved; stop and inspect this fixture.",
          );
          return false;
        }
      });
      const savesBeforeStaleApply = result.configurationSaveEvents.length;
      const staleApply = await publish(
        "configuration-concurrent-stale-apply",
        guidanceOnly
          ? "Click Apply changes in the ORIGINAL review. Observe the real Action not confirmed alert explaining that the review no longer matches the current configuration or workspace, saved/unsaved edits were not reverted, and Close review / refresh / review current source is the recovery. Capture the actual alert, disabled Apply and focused Close separately without speech; do not retry or close yet. Then acknowledge action 'stale-refused'. The driver checks source preservation, not the visible guidance or focus."
          : "Click Apply changes in the ORIGINAL review. Observe the real refusal and Action not confirmed state; do not retry or close yet. Capture the actual readable error separately, then acknowledge action 'stale-refused'. The driver will check source preservation, not infer the visible error from your acknowledgement.",
      );
      await acknowledge(staleApply, "stale-refused");
      assert.equal(reviews().length, 1);
      await unchanged(concurrentText);
      assert.equal(
        result.configurationSaveEvents.length,
        savesBeforeStaleApply,
      );
      assert.equal(result.terminalEvents.length, 0);
      const staleClose = await publish(
        "configuration-concurrent-close",
        "Use the actual failed review's Close review button (or Escape), then acknowledge action 'closed'. The driver restores only this known clean, saved marker edit after the review is closed; unknown or dirty edits are preserved.",
      );
      await acknowledge(staleClose, "closed");
      await waitFor(() => reviews().length === 0);
      await unchanged(concurrentText);
      await restoreOwnedConfiguration();
      result.checks.push(
        "after operator-coordinated stale Apply, the exact known concurrent comment remained saved, no additional source save/terminal occurred, and known clean source was restored only after the actual review closed",
      );
      await vscode.commands.executeCommand("rehearsal.refresh");

      const savesBeforeInvalidApply = result.configurationSaveEvents.length;
      if (invalidBeforeReview) {
        const invalid = await publish(
          "policy-invalid-prereview",
          `In Configuration expand All supported structured settings. Change ONLY resources.retainedEnvironmentCount from ${retainedCount.value} to 1001 and click that structured form's Review exact configuration diff. Expect refusal BEFORE any review opens; do not edit source or bypass browser validity. Capture visible field help (whole number 1 through 1000) and actual numeric validation/guidance separately without speech. Acknowledge action 'invalid-refused' after the real click/refusal. The driver checks only no review, save or terminal execution, not what you saw.`,
        );
        await acknowledge(invalid, "invalid-refused");
        assert.equal(reviews().length, 0);
        await unchanged();
        assert.equal(
          result.configurationSaveEvents.length,
          savesBeforeInvalidApply,
        );
        assert.equal(result.terminalEvents.length, 0);
      } else {
        await publish(
          "policy-invalid-review-open",
          `In Configuration expand All supported structured settings. Change ONLY resources.retainedEnvironmentCount from ${retainedCount.value} to 1001, then click that structured form's Review exact configuration diff. This out-of-bounds policy is a review-only negative control; do not manually edit the source.`,
        );
        await waitFor(() => reviews().length === 1);
        await unchanged();
        const invalidApply = await publish(
          "policy-invalid-apply",
          "Read the invalid policy diff and click Apply changes. Complete core validation must refuse before writing. Observe Action not confirmed and the actual readable error, capture it separately, then acknowledge action 'invalid-refused'. Do not close the review yet.",
        );
        await acknowledge(invalidApply, "invalid-refused");
        assert.equal(reviews().length, 1);
        await unchanged();
        assert.equal(
          result.configurationSaveEvents.length,
          savesBeforeInvalidApply,
        );
        assert.equal(result.terminalEvents.length, 0);
        const invalidClose = await publish(
          "policy-invalid-close",
          "Close the failed review using Close review or Escape, return to Configuration, then acknowledge action 'closed'. No retry or rollback is injected.",
        );
        await acknowledge(invalidClose, "closed");
        await waitFor(() => reviews().length === 0);
        await unchanged();
      }
      await publish(
        "policy-valid-recovery-open",
        `Restore resources.retainedEnvironmentCount to its saved value ${retainedCount.value} if the invalid draft remains. Then propose only cleanup.retainBaselineGenerations 3 through either the simple Baseline versions to retain field or the structured form and Review exact configuration diff. Leave this fresh valid review open.`,
      );
      await waitFor(() => reviews().length === 1);
      await unchanged();
      const recoveryCancel = await publish(
        "policy-valid-recovery-cancel",
        "Inspect that fresh review, then Cancel it without applying. Acknowledge action 'cancelled'. This proves the real review guard can be used again after the stale/invalid failures; no policy is saved.",
      );
      await acknowledge(recoveryCancel, "cancelled");
      await waitFor(() => reviews().length === 0);
      await unchanged();
      assert.equal(
        result.configurationSaveEvents.length,
        savesBeforeInvalidApply,
      );
      result.checks.push(
        invalidBeforeReview
          ? "after operator-coordinated pre-review numeric refusal, no review, source save or terminal was observed, then a fresh corrected review opened and cancelled without a write; visible range/guidance requires separate native observations"
          : "invalid-policy Apply coordination left exact source and save-event count unchanged, then a fresh valid review opened and cancelled without a write; visible refusal details require separate native observations",
      );

      if (!guidanceOnly) {
        await publish(
          "endpoint-review-open",
          `In Configuration, change only Application URL to ${fixture.summaryUrl} and click Review exact configuration diff. Leave the review open; readiness must remain ${fixture.healthUrl}.`,
        );
        await waitFor(() => reviews().length === 1);
        await unchanged();
        const endpointCancel = await publish(
          "endpoint-review-cancel",
          "Inspect the endpoint-only diff and click Cancel. Acknowledge action 'cancelled'. Browser launch and provider login are not part of this review.",
        );
        await acknowledge(endpointCancel, "cancelled");
        await waitFor(() => reviews().length === 0);
        await unchanged();
        result.checks.push(
          "actual endpoint review lifecycle preserved configuration and its independent readiness route",
        );
      }
    } else {
      result.limitations.push(
        "Presentation-only continuation: no configuration review/save/refusal was exercised in this run. Reconcile the prior exact-artifact native configuration evidence separately.",
      );
    }

    if (!guidanceOnly) {
      const inventory = await publish(
        "inventory-display-review",
        "Open Environments. Use only category/search/state/ownership/sort/page-size/pagination and Inspect environment details; never Start, Stop, cleanup, reset or discard. Root records actual silent keyboard/focus, Light/Dark/High Contrast, large text and intermediate/narrow layout observations separately. Do not enable VoiceOver, speech or other speaker output. Acknowledge action 'inventory-reviewed' after those observations; acknowledgement alone proves none of them. Assistive-technology acceptance remains separate and unverified.",
      );
      await acknowledge(
        inventory,
        "inventory-reviewed",
        presentationOnly ? 600000 : 180000,
      );
      await unchanged();
      assert.equal(result.terminalEvents.length, 0);
      result.checks.push(
        "configuration and zero-terminal execution preserved across operator-coordinated read-only inventory presentation checks; rendering and assistive-technology evidence is separate",
      );

      // These are new, owned, display-only files. Never invoke run/apply/reset.
      for (const [filename, content] of [
        [
          "20261021010000_zebra_title_index.sql",
          "CREATE INDEX native_review_title_idx ON lab_api.entries (title);\n",
        ],
        [
          "20261021010100_alpha_index_comment.sql",
          "COMMENT ON INDEX lab_api.native_review_title_idx IS 'synthetic native review only';\n",
        ],
      ]) {
        const file = path.join(
          fixture.projectRoot,
          "database/migrations",
          filename,
        );
        const handle = await fs.open(file, "wx", 0o600);
        const owned = { file, filename, content, ...(await handle.stat()) };
        ownedFiles.push(owned);
        try {
          await handle.writeFile(content);
        } finally {
          await handle.close();
        }
      }
      const migrations = parseMigrationReviewPlan(
        await reads.publicJson(["inspect", "plan"]),
      );
      assertMatchingMigrationCandidates(
        migrations,
        await reads.publicJson(["candidates"]),
      );
      assert.equal(migrations.candidateCount, 2);
      assert.equal(migrations.targets.length, 1);
      assert.equal(migrations.targets[0].provider, "postgresql");
      assert.deepEqual(
        migrations.targets[0].entries
          .filter((item) => item.required)
          .map((item) => item.filename),
        ownedFiles.map((item) => item.filename),
      );
      await vscode.commands.executeCommand("rehearsal.refresh");
      const migration = await publish(
        "migration-display-review",
        "Use Migrations with the actual keyboard at narrow/intermediate widths: name/date/order sorts, query/status filters, review checkboxes, visible/reviewed counts and dependency details. Do not click Run or Apply. This fixture has three rows (two unapplied candidates), not a large native history. Acknowledge action 'display-reviewed'. The driver independently checks the exact digest/order; root records rendered controls/focus separately.",
      );
      await acknowledge(migration, "display-reviewed", 120000);
      const afterDisplay = parseMigrationReviewPlan(
        await reads.publicJson(["inspect", "plan"]),
      );
      assert.deepEqual(afterDisplay, migrations);
      assert.equal(result.terminalEvents.length, 0);
      result.checks.push(
        "public complete ordered two-candidate plan unchanged across the operator-coordinated display phase; no execution started",
      );
    }

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
      for (const owned of ownedFiles.reverse()) {
        const openDocument = vscode.workspace.textDocuments.find(
          (item) => item.uri.fsPath === owned.file,
        );
        assert.notEqual(
          openDocument?.isDirty,
          true,
          "Unsaved display-only migration edit preserved for recovery.",
        );
        const observed = await regular(owned.file);
        assert.equal(observed.stat.dev, owned.dev);
        assert.equal(observed.stat.ino, owned.ino);
        assert.equal(
          observed.bytes.toString("utf8"),
          owned.content,
          "Changed display-only migration preserved for recovery.",
        );
        await fs.unlink(owned.file);
      }
      assert.equal(
        reviews().length,
        0,
        "An unresolved review was preserved for recovery; its write state is not inferred.",
      );
      await restoreOwnedConfiguration();
      result.configurationRestored = true;
      for (const file of fixture.preserveFiles) {
        const observed = await regular(
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
      assert.notEqual(result.unexpectedSaveOverflow, true);
      const allowedSaveHashes = new Set([...allowedSources].map(sha));
      assert.ok(
        result.configurationSaveEvents.every((event) =>
          allowedSaveHashes.has(event.sha256),
        ),
        "An unexpected saved source revision was observed; manual reconciliation is required.",
      );
    } catch (error) {
      result.status = "failed";
      result.cleanupDiagnostic = diagnostic(error);
      result.recoveryRequired = true;
      result.cleanupLimitation =
        "Later restoration checks may have been skipped after a preservation refusal. Retain this fixture and inspect it before reuse; do not infer restored state.";
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
    result.workbenchReviewPassed =
      result.status === "passed" &&
      result.configurationRestored === true &&
      result.baselineGenerationPreserved === true &&
      result.ownedReadProcessesGone === true &&
      result.noTerminalCommandsStarted === true;
    if (!result.workbenchReviewPassed) result.status = "failed";
    await writeJson(config.resultPath, result);
  }
  if (result.status !== "passed")
    throw (
      failure ??
      new Error("Native workbench cleanup or preservation was inconclusive.")
    );
};
