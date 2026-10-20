/** Native identity runner. Use only via verify-marketplace-migration.ts. */
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const vscode = require("vscode");

exports.activate = () => {};

exports.run = async () => {
  const input = process.env.REHEARSAL_MIGRATION_VERIFY_CONFIG;
  assert.ok(input, "An isolated verification configuration is required.");
  const config = JSON.parse(await fs.readFile(input, "utf8"));
  assert.ok(["fresh", "coexistence"].includes(config.mode));
  assert.ok(path.isAbsolute(config.root));
  assert.notEqual(config.root, path.parse(config.root).root);
  assert.equal(await fs.realpath(config.root), config.root);
  for (const key of ["workspace", "extensions", "resultPath"]) {
    const relative = path.relative(config.root, config[key]);
    assert.ok(relative && !path.isAbsolute(relative));
    assert.ok(relative !== ".." && !relative.startsWith(`..${path.sep}`));
  }
  const result = {
    status: "running",
    mode: config.mode,
    vscodeVersion: vscode.version,
    nodeVersion: process.versions.node,
    checks: [],
    limitations: [
      "Native registry, activation and shared license-command ownership only; no database or CLI lifecycle operation.",
      "No full provider, assistive-technology or owner visual acceptance is inferred.",
      "The owner profile, installed extensions and existing windows are not targeted.",
    ],
  };
  let openedTerminals = 0;
  const listener = vscode.window.onDidOpenTerminal(() => openedTerminals++);
  try {
    await fs.writeFile(config.resultPath, JSON.stringify(result, null, 2));
    assert.equal(vscode.workspace.workspaceFolders?.length, 1);
    assert.equal(
      vscode.workspace.workspaceFolders[0].uri.fsPath,
      config.workspace,
    );
    assert.deepEqual(await fs.readdir(config.workspace), []);
    assert.equal(vscode.window.terminals.length, 0);
    const canonical = vscode.extensions.getExtension(
      "rehearsal-db.rehearsal-db",
    );
    const legacy = vscode.extensions.getExtension("rehearsal-db.rehearsal");
    assert.ok(canonical, "The exact canonical identity must be installed.");
    assert.equal(canonical.packageJSON.version, "0.1.19");
    const extensionsRoot = await fs.realpath(config.extensions);
    const assertInstalled = async (extension) => {
      const installed = await fs.realpath(extension.extensionPath);
      const relative = path.relative(extensionsRoot, installed);
      assert.ok(relative && !path.isAbsolute(relative));
      assert.ok(relative !== ".." && !relative.startsWith(`..${path.sep}`));
    };
    await assertInstalled(canonical);
    if (config.mode === "fresh") assert.equal(legacy, undefined);
    else {
      assert.ok(legacy, "The native registry must report legacy coexistence.");
      assert.equal(legacy.packageJSON.version, "0.1.18");
      await assertInstalled(legacy);
      result.legacyInitiallyActive = legacy.isActive;
    }
    // A normal return may set isActive=true even when activation deliberately
    // refuses to register work. Exact command ownership is the observable proof.
    await canonical.activate();
    result.checks.push("canonical activation returned normally");
    const owner = config.mode === "fresh" ? canonical : legacy;
    if (legacy) await legacy.activate();
    await vscode.commands.executeCommand("rehearsal.openLicense");
    const expected = vscode.Uri.joinPath(owner.extensionUri, "LICENSE.txt");
    const document = vscode.window.activeTextEditor?.document;
    assert.ok(document, "License command must reveal a real editor document.");
    assert.equal(document.uri.toString(), expected.toString());
    assert.ok(
      vscode.window.visibleTextEditors.some(
        (editor) => editor.document.uri.toString() === expected.toString(),
      ),
    );
    const text = document.getText();
    assert.match(text, /Rehearsal for VS Code — Starter License/u);
    assert.match(text, /indefinitely at no charge/u);
    assert.match(text, /No purchase, accepted order, account, payment card/u);
    assert.equal(text, await fs.readFile(expected.fsPath, "utf8"));
    assert.equal(openedTerminals, 0);
    assert.equal(vscode.window.terminals.length, 0);
    assert.deepEqual(await fs.readdir(config.workspace), []);
    result.licenseOwner = owner.id;
    result.licenseDocument = expected.toString();
    result.checks.push(
      config.mode === "fresh"
        ? "fresh canonical command reveals its own packaged free Starter license"
        : "legacy presence leaves the shared license command owned by legacy 0.1.18",
      "no terminal was created and the empty project remains unchanged",
    );
    result.status = "passed";
  } catch (error) {
    result.status = "failed";
    result.failure = error instanceof Error ? error.message : String(error);
    throw error;
  } finally {
    listener.dispose();
    await fs.writeFile(
      config.resultPath,
      `${JSON.stringify(result, null, 2)}\n`,
    );
  }
};
