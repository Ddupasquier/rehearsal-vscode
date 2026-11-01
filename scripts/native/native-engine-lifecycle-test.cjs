/** File-only native VS Code API companion. No engine, Docker or Core process is dispatched. */
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const { createHash } = require("node:crypto");
const vscode = require("vscode");
const { dashboardPaneSettled } = require("./native-engine-ui-contract.cjs");
const { setTimeout: delay } = require("node:timers/promises");
const wait = async (fn) => {
  const end = Date.now() + 30000;
  while (Date.now() < end) {
    if (await fn()) return;
    await delay(50);
  }
  throw Error("Owned native UI transition timed out.");
};
const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
exports.activate = () => {
  if (process.env.REHEARSAL_NATIVE_ENGINE_NORMAL_ACTIVATION === "1")
    return exports.run().catch(() => {
      throw Error(
        "Owned native companion activation failed; private diagnostics withheld.",
      );
    });
};
exports.run = async () => {
  const config = JSON.parse(
    await fs.readFile(process.env.REHEARSAL_NATIVE_MIGRATION_CONFIG, "utf8"),
  );
  const bytes = await fs.readFile(config.activityPath);
  assert.equal(sha(bytes), config.activitySha256);
  const fixture = JSON.parse(bytes);
  assert.equal(fixture.kind, "engine-lifecycle-native-fixture");
  assert.equal(fixture.candidateSha256, config.candidateSha256);
  const extension = vscode.extensions.getExtension("rehearsal-db.rehearsal-db");
  assert.ok(extension);
  assert.equal(extension.packageJSON.version, config.version);
  const runtime = (file) =>
    require(path.join(extension.extensionPath, "dist/src", file));
  const report = runtime(
    "engine_lifecycle_contract.js",
  ).parseEngineLifecycleStatus(fixture.status);
  const { RehearsalWorkspacePanels } = runtime("workspace_panel.js");
  const folder = vscode.workspace.workspaceFolders[0];
  assert.equal(folder.uri.fsPath, config.workspace);
  const key = folder.uri.toString();
  const snapshots = new vscode.EventEmitter(),
    inspections = new vscode.EventEmitter(),
    actionEvents = new vscode.EventEmitter();
  let current = {
    workspaceName: "Synthetic native VM controls · no engine operations",
    workspaceRoot: config.workspace,
    availability: "not_ready",
    version: fixture.coreVersion,
    activity: { schemaVersion: 1, state: "idle", operation: null },
    engineLifecycle: { state: "available", report },
  };
  let reviews = 0;
  const projects = {
    onDidUpdateSnapshot: snapshots.event,
    onDidChangeInspection: inspections.event,
    snapshotFor: () => current,
    inspectionStateFor: () => "idle",
    refreshWorkspace: async () =>
      snapshots.fire({ workspaceKey: key, snapshot: current }),
  };
  const actions = {
    onDidRecordActivity: actionEvents.event,
    registerWorkspace: () => "synthetic-native-engine",
    releaseWorkspace: () => {},
    activityFor: () => [],
    engineShutdownStateFor: () => undefined,
    reviewVmShutdown: async (received) => {
      assert.equal(received, key);
      reviews++;
    },
  };
  const state = new Map();
  const owner = new RehearsalWorkspacePanels(
    extension.extensionUri,
    projects,
    actions,
    {
      get: (name) => state.get(name),
      update: async (name, value) => state.set(name, value),
    },
    config.version,
  );
  const initialTerminals = vscode.window.terminals.length;
  const checks = [];
  let realActions, realOwner, realReviews, output;
  let phase = "panel-host";
  try {
    await owner.open(key);
    const panel = owner.panels.get(key);
    assert.ok(panel);
    assert.ok(panel.webview.html.includes("data-engine-shutdown-control"));
    assert.ok(panel.webview.html.includes("Colima VM: running"));
    assert.ok(
      panel.webview.html.includes(
        'aria-describedby="engine-shutdown-header-description"',
      ),
    );
    await owner.handleMessage(panel, key, { type: "reviewVmShutdown" });
    assert.equal(reviews, 1);
    await owner.handleMessage(panel, key, {
      type: "reviewVmShutdown",
      command: "engine stop",
    });
    assert.equal(reviews, 1);
    checks.push(
      "Installed production panel exposes VM control and closed host review message rejects extra command fields.",
    );
    for (const [profile, expected] of [
      ["stopped", "Colima profile: stopped"],
      ["not-observed", "VM shutdown unavailable"],
    ]) {
      current = {
        ...current,
        engineLifecycle: {
          state: "available",
          report: {
            ...report,
            colimaDefault: {
              ...report.colimaDefault,
              state: profile,
              shutdownSupported: false,
              reason:
                profile === "stopped" ? "profile-stopped" : "unsupported-host",
            },
          },
        },
      };
      await projects.refreshWorkspace(key);
      assert.ok(panel.webview.html.includes(expected));
    }
    checks.push(
      "Installed production panel renders independently stopped and unsupported profile facts.",
    );
    if (config.engineUiReview) {
      phase = "canonical-activation";
      owner.dispose();
      const snapshotRuntime = runtime("project_snapshot.js");
      const observed = [];
      const inspect = snapshotRuntime.inspectProject;
      snapshotRuntime.inspectProject = async (...args) => {
        const value = await inspect(...args);
        observed.push(value);
        return value;
      };
      try {
        await extension.activate();
        await vscode.commands.executeCommand("rehearsal.refresh");
        await wait(async () =>
          observed.some(
            (value) => value.engineLifecycle?.state === "available",
          ),
        );
      } finally {
        snapshotRuntime.inspectProject = inspect;
      }
      checks.push(
        "Canonical installed extension activation inspected the clearly synthetic workspace-local public CLI. Recorded Core tar was not executed.",
      );
      current = { ...current, engineLifecycle: { state: "available", report } };
      const { RehearsalWorkspaceActions } = runtime("workspace_actions.js");
      const { RehearsalReviewPanels } = runtime("review_panel.js");
      realReviews = new RehearsalReviewPanels(extension.extensionUri);
      output = vscode.window.createOutputChannel(
        "Owned synthetic engine acceptance",
        { log: true },
      );
      const memento = {
        get: (name) => state.get(name),
        update: async (name, value) => state.set(name, value),
      };
      realActions = new RehearsalWorkspaceActions(
        projects,
        output,
        memento,
        realReviews,
      );
      realOwner = new RehearsalWorkspacePanels(
        extension.extensionUri,
        projects,
        realActions,
        memento,
        config.version,
        realReviews,
      );
      phase = "dirty-draft";
      const configurationMetadata = runtime(
        "configuration_contract.js",
      ).parseConfigurationMetadata(
        JSON.parse(
          await fs.readFile(
            path.join(config.root, "engine-configuration-metadata.json"),
            "utf8",
          ),
        ),
      );
      assert.equal(
        sha(
          await fs.readFile(
            path.join(config.workspace, configurationMetadata.path),
          ),
        ),
        configurationMetadata.sourceSha256,
      );
      current = { ...current, configPath: "missing-explicit.mjs" };
      await realOwner.open(key);
      const actualPanel = realOwner.panels.get(key);
      let originalDashboardColumn;
      const paneObservation = () => ({
        originalColumn: Number.isSafeInteger(originalDashboardColumn)
          ? originalDashboardColumn
          : null,
        actualColumn: Number.isSafeInteger(actualPanel.viewColumn)
          ? actualPanel.viewColumn
          : null,
        panelVisible: actualPanel.visible,
        samePanel: realOwner.panels.get(key) === actualPanel,
      });
      const dashboardVisibility = [];
      const recordDashboardVisibility = () => {
        dashboardVisibility.push({
          phase,
          ...paneObservation(),
        });
        return fs.writeFile(
          path.join(config.root, "engine-ui-dashboard-visibility.json"),
          JSON.stringify({ observations: dashboardVisibility.slice(-24) }),
          { mode: 0o600 },
        );
      };
      actualPanel.onDidChangeViewState(() => {
        void recordDashboardVisibility();
      });
      await recordDashboardVisibility();
      await wait(
        async () =>
          actualPanel.visible &&
          Number.isSafeInteger(actualPanel.viewColumn) &&
          actualPanel.viewColumn > 0,
      );
      originalDashboardColumn = actualPanel.viewColumn;
      await recordDashboardVisibility();
      const hostObservation = {
        reviewRequests: 0,
        reviewEntries: 0,
        applyMessages: 0,
        guardPasses: 0,
        guardRefusals: 0,
        onApplyEntries: 0,
        onApplyReturned: 0,
      };
      const recordHost = () =>
        fs.writeFile(
          path.join(config.root, "engine-ui-host.json"),
          JSON.stringify(hostObservation),
          { mode: 0o600 },
        );
      actualPanel.webview.onDidReceiveMessage((message) => {
        if (
          message?.type === "reviewVmShutdown" &&
          Object.keys(message).length === 1
        ) {
          hostObservation.reviewRequests++;
          void recordHost();
        }
      });
      const productionReview = realReviews.review.bind(realReviews);
      realReviews.review = async (options) => {
        hostObservation.reviewEntries++;
        await recordHost();
        const pendingReview = productionReview({
          ...options,
          canApply: () => {
            try {
              const value = options.canApply();
              hostObservation.guardPasses++;
              void recordHost();
              return value;
            } catch (error) {
              hostObservation.guardRefusals++;
              void recordHost();
              throw error;
            }
          },
          onApply: async () => {
            hostObservation.onApplyEntries++;
            await recordHost();
            const result = await options.onApply();
            hostObservation.onApplyReturned++;
            await recordHost();
            return result;
          },
        });
        for (const entry of realReviews.reviews)
          entry.panel.webview.onDidReceiveMessage((message) => {
            if (
              message?.type === "applyReview" &&
              Object.keys(message).length === 2
            ) {
              hostObservation.applyMessages++;
              void recordHost();
            }
          });
        return pendingReview;
      };
      await recordHost();
      await realOwner.handleMessage(actualPanel, key, {
        type: "navigate",
        page: "configuration",
      });
      await projects.refreshWorkspace(key);
      phase = "unbound-draft";
      const dashboardColumn = originalDashboardColumn;
      await fs.writeFile(
        path.join(config.root, "engine-ui-phase.json"),
        JSON.stringify({ scenario: "unbound-draft", state: "ready" }),
        { mode: 0o600 },
      );
      await wait(async () => {
        try {
          return (
            JSON.parse(
              await fs.readFile(
                path.join(config.root, "engine-ui-done.json"),
                "utf8",
              ),
            ).scenario === "unbound-preserved"
          );
        } catch {
          return false;
        }
      });
      await recordDashboardVisibility();
      try {
        await wait(async () => dashboardPaneSettled(paneObservation()));
      } finally {
        await recordDashboardVisibility();
      }
      assert.equal(actualPanel.visible, true);
      assert.equal(actualPanel.viewColumn, dashboardColumn);
      assert.equal(realOwner.panels.get(key), actualPanel);
      checks.push(
        "Missing explicit configuration still allowed VM review beside the dashboard; actual unbound draft document/field/value survived review and keyboard Back in its original column.",
      );
      current = {
        ...current,
        configPath: configurationMetadata.path,
        configurationMetadata,
      };
      await realOwner.handleMessage(actualPanel, key, {
        type: "editing",
        editing: false,
      });
      await projects.refreshWorkspace(key);
      phase = "dirty-draft";
      await fs.writeFile(
        path.join(config.root, "engine-ui-phase.json"),
        JSON.stringify({ scenario: "dirty-draft", state: "ready" }),
        { mode: 0o600 },
      );
      await wait(async () => {
        try {
          return (
            JSON.parse(
              await fs.readFile(
                path.join(config.root, "engine-ui-done.json"),
                "utf8",
              ),
            ).scenario === "dirty-entered"
          );
        } catch {
          return false;
        }
      });
      assert.deepEqual(
        JSON.parse(
          await fs.readFile(
            path.join(config.root, "engine-ui-consent.json"),
            "utf8",
          ),
        ),
        { optionalUpdateChecks: "declined", keyboard: true },
      );
      checks.push(
        "First-use optional update checks declined by actual keyboard Don't Ask Again; no check opt-in enabled.",
      );
      realActions.engineShutdownStates.set(key, "running");
      await projects.refreshWorkspace(key);
      await wait(async () => {
        try {
          return (
            JSON.parse(
              await fs.readFile(
                path.join(config.root, "engine-ui-done.json"),
                "utf8",
              ),
            ).scenario === "dirty-preserved"
          );
        } catch {
          return false;
        }
      });
      realActions.engineShutdownStates.delete(key);
      await projects.refreshWorkspace(key);
      checks.push(
        "Actual webview draft value, focused input and document identity survived production engine-running state patch; shutdown control disabled.",
      );
      for (const [theme, name, kind] of [
        ["dark", "Default Dark Modern", vscode.ColorThemeKind.Dark],
        ["light", "Default Light Modern", vscode.ColorThemeKind.Light],
        [
          "high-contrast",
          "Default High Contrast",
          vscode.ColorThemeKind.HighContrast,
        ],
      ]) {
        phase = `style-${theme}`;
        await vscode.workspace
          .getConfiguration("workbench")
          .update("colorTheme", name, vscode.ConfigurationTarget.Global);
        await wait(async () => vscode.window.activeColorTheme.kind === kind);
        await realOwner.open(key);
        await fs.writeFile(
          path.join(config.root, "engine-ui-phase.json"),
          JSON.stringify({ scenario: `style-${theme}`, state: "ready" }),
          { mode: 0o600 },
        );
        await wait(async () => {
          try {
            return (
              JSON.parse(
                await fs.readFile(
                  path.join(config.root, "engine-ui-done.json"),
                  "utf8",
                ),
              ).scenario === `style-${theme}`
            );
          } catch {
            return false;
          }
        });
        assert.equal(realOwner.panels.get(key), actualPanel);
        assert.equal(realOwner.activePages.get(key), "configuration");
        checks.push(
          `Owned ${theme} dashboard/review screenshots captured; ready-state Back returned by keyboard to exact workspace panel/configuration page with restored draft.`,
        );
      }
      for (const scenario of [
        "cancel",
        "confirm-success",
        "confirm-uncertain",
      ]) {
        phase = scenario;
        await fs.writeFile(
          path.join(config.root, "engine-scenario.json"),
          JSON.stringify({ scenario }),
          { mode: 0o600 },
        );
        await realOwner.open(key);
        await fs.writeFile(
          path.join(config.root, "engine-ui-phase.json"),
          JSON.stringify({ scenario, state: "ready" }),
          { mode: 0o600 },
        );
        await wait(async () => {
          try {
            return (
              JSON.parse(
                await fs.readFile(
                  path.join(config.root, "engine-ui-done.json"),
                  "utf8",
                ),
              ).scenario === scenario
            );
          } catch {
            return false;
          }
        });
        const dispatched = (
          await fs.readFile(
            path.join(config.root, "engine-dispatch.jsonl"),
            "utf8",
          )
        )
          .trim()
          .split("\n")
          .filter(Boolean)
          .map((line) => JSON.parse(line));
        assert.equal(
          dispatched.filter((entry) => entry.scenario === scenario).length,
          scenario === "cancel" ? 0 : 1,
        );
        if (scenario === "cancel")
          assert.notEqual(realActions.engineShutdownStateFor(key), "confirmed");
        else
          await wait(
            async () =>
              realActions.engineShutdownStateFor(key) ===
              (scenario === "confirm-success" ? "confirmed" : "uncertain"),
          );
        realReviews.releaseWorkspace(key);
        checks.push(
          `Actual installed production review keyboard and custom native dialog: ${scenario}; exact synthetic public CLI dispatch count checked.`,
        );
      }
      await fs.writeFile(
        path.join(config.root, "engine-scenario.json"),
        JSON.stringify({ scenario: "cancel" }),
        { mode: 0o600 },
      );
    }
    assert.equal(vscode.window.terminals.length, initialTerminals);
    await fs.writeFile(
      config.resultPath,
      JSON.stringify({
        status: "passed",
        candidateSha256: config.candidateSha256,
        activitySha256: config.activitySha256,
        recordedCoreArtifactSha256: fixture.coreArtifactSha256,
        scenario: "synthetic-engine-lifecycle-native",
        checks,
        limitations: [
          "Real installed VS Code API/panel host dispatch; optional isolated custom-dialog UI mode adds actual keyboard/modal proof only when its scenario checks pass. No real Core or VM shutdown proof.",
          "Core artifact hash is input provenance, not an executed synthetic Core replacement.",
        ],
      }),
    );
  } catch {
    await fs.writeFile(
      config.resultPath,
      JSON.stringify({
        status: "failed",
        phase,
        candidateSha256: config.candidateSha256,
        activitySha256: config.activitySha256,
        checks,
        rawOutputIncluded: false,
      }),
    );
    throw Error(
      "Owned native engine acceptance failed; private diagnostics withheld.",
    );
  } finally {
    realOwner?.dispose();
    realActions?.dispose();
    realReviews?.dispose();
    output?.dispose();
    owner.dispose();
    snapshots.dispose();
    inspections.dispose();
    actionEvents.dispose();
  }
};
