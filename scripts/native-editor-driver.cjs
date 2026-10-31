/** Shared normal development-host activation; scenario paths are never caller input. */
const assert = require("node:assert/strict");
const { constants } = require("node:fs");
const fs = require("node:fs/promises");
const path = require("node:path");
const vscode = require("vscode");
const {
  nativeEditorRecoveryDecision,
} = require("./native-editor-recovery.cjs");

const scenarios = Object.freeze({
  cancellation: () => require("./native-cancellation-test.cjs"),
  "drizzle-review": () => require("./native-prisma-review-test.cjs"),
  "real-consumer": () => require("./native-real-consumer-test.cjs"),
  "prisma-review": () => require("./native-prisma-review-test.cjs"),
  "workbench-review": () => require("./native-workbench-review-test.cjs"),
  "presentation-review": () => require("./native-workbench-review-test.cjs"),
  "configuration-guidance": () => require("./native-workbench-review-test.cjs"),
  "comparison-export": () => require("./native-comparison-export-test.cjs"),
});
let started = false;

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
          /native-(?:editor-driver|cancellation-test|workbench-review-test|comparison-export-test)\.cjs:\d{1,7}:\d{1,5}/u,
        )?.[0]
      : undefined;
  return { code, location: location ?? "native-editor-driver" };
}
// Failure-only projection: never serialize exception messages, paths or values.
function consumerDiagnostic(error) {
  const code =
    error?.code === "ERR_ASSERTION"
      ? "ASSERTION_FAILED"
      : error?.code === "NATIVE_OBSERVATION_TIMEOUT"
        ? "OBSERVATION_TIMEOUT"
        : ["ENOENT", "EACCES", "EPERM", "ELOOP"].includes(error?.code)
          ? "INPUT_READ_FAILED"
          : "UNCLASSIFIED_ERROR";
  const location =
    typeof error?.stack === "string"
      ? error.stack.match(
          /native-real-consumer-test\.cjs:\d{1,7}:\d{1,5}/u,
        )?.[0]
      : undefined;
  return { code, location: location ?? "native-real-consumer-test" };
}
exports.consumerDiagnostic = consumerDiagnostic;
async function readObject(file, maximumBytes) {
  const handle = await fs.open(
    file,
    constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
  );
  try {
    const before = await handle.stat();
    assert.ok(before.isFile() && before.size <= maximumBytes);
    const bytes = Buffer.alloc(before.size + 1);
    let length = 0;
    while (length < bytes.length) {
      const part = await handle.read(
        bytes,
        length,
        bytes.length - length,
        null,
      );
      if (!part.bytesRead) break;
      length += part.bytesRead;
    }
    const after = await handle.stat();
    assert.ok(
      length === before.size &&
        after.size === before.size &&
        after.mtimeMs === before.mtimeMs,
    );
    return JSON.parse(bytes.subarray(0, length).toString("utf8"));
  } finally {
    await handle.close();
  }
}
async function readConfiguration() {
  const file = process.env.REHEARSAL_NATIVE_CANCELLATION_CONFIG;
  assert.ok(typeof file === "string" && path.isAbsolute(file));
  const config = await readObject(file, 128 * 1024);
  assert.equal(path.dirname(file), config.root);
  assert.equal(path.dirname(config.resultPath), config.evidence);
  assert.ok(
    typeof config.scenario === "string" &&
      Object.hasOwn(scenarios, config.scenario),
    "Unknown native editor scenario.",
  );
  return config;
}
exports.readConfiguration = readConfiguration;
async function writeResult(config, result) {
  const temporary = `${config.resultPath}.new`;
  await fs.writeFile(temporary, JSON.stringify(result, null, 2) + "\n", {
    mode: 0o600,
  });
  await fs.rename(temporary, config.resultPath);
}

/** Actual dirty-document evidence is independent of a scenario's own failure flag. */
async function finalizeEditor(config, result) {
  const dirtyCount = () => {
    try {
      return vscode.workspace.textDocuments.filter(
        (document) => !document.isClosed && document.isDirty,
      ).length;
    } catch {
      // Unknown editor state must retain the host, not guess that no work exists.
      return null;
    }
  };
  result.editorRecovery = nativeEditorRecoveryDecision(result, dirtyCount());
  result.recoveryRequired = result.editorRecovery.retainEditor;
  if (result.recoveryRequired) result.status = "failed";
  result.driverFinalized = true;
  await writeResult(config, result);
  if (result.recoveryRequired) return;
  // Saving the bounded report awaited IO; repeat the actual buffer observation
  // before requesting close rather than using a now-stale clean count.
  const current = nativeEditorRecoveryDecision(result, dirtyCount());
  if (current.retainEditor) {
    result.status = "failed";
    result.recoveryRequired = true;
    result.editorRecovery = current;
    await writeResult(config, result);
    return;
  }
  try {
    await vscode.commands.executeCommand("workbench.action.closeWindow");
  } catch (error) {
    result.status = "failed";
    result.recoveryRequired = true;
    result.closeWindowDiagnostic = diagnostic(error);
    result.editorRecovery = nativeEditorRecoveryDecision(result, null);
    await writeResult(config, result);
  }
}
exports.finalizeEditor = finalizeEditor;

exports.activate = () => {
  if (started) return;
  started = true;
  // No --extensionTestsPath: VS Code deliberately suppresses real dialogs there.
  void (async () => {
    let config,
      result,
      failed = false,
      failure;
    try {
      config = await readConfiguration();
      const scenario = scenarios[config.scenario]();
      assert.equal(typeof scenario.run, "function");
      await scenario.run();
    } catch (error) {
      failed = true;
      failure = error;
    }
    try {
      config ??= await readConfiguration();
      try {
        result = await readObject(config.resultPath, 256 * 1024);
      } catch (error) {
        if (error.code !== "ENOENT") throw error;
        result = {
          status: "failed",
          failurePhase: "bootstrap",
          diagnostic: diagnostic(failure),
        };
      }
      if (failed) {
        result.status = "failed";
        result.diagnostic ??= diagnostic(failure);
      }
      if (result.scenario !== undefined)
        assert.equal(result.scenario, config.scenario);
      assert.ok(["passed", "failed"].includes(result.status));
      result.scenario = config.scenario;
      await finalizeEditor(config, result);
    } catch {
      // Missing/invalid finalization is a launcher failure, never a passing report.
    }
  })().catch(() => {});
};
