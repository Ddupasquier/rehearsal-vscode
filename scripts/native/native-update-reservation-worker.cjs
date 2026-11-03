/** Test-owned crash-state fixture: production writes, genuine child lifetime. */
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");

/** Fixture children receive no inherited tool selectors, auth or preload options. */
exports.nativeUpdateEnvironment = (
  source,
  storage,
  platform,
  display = false,
) => {
  const result = {};
  for (const name of [
    "TMPDIR",
    "TMP",
    "TEMP",
    "NODE_COMPILE_CACHE",
    "NPM_CONFIG_CACHE",
    "NPM_CONFIG_LOGS_DIR",
  ])
    if (storage[name]) result[name] = storage[name];
  for (const name of [
    "HOME",
    "USER",
    "LOGNAME",
    "LANG",
    "LC_ALL",
    "PATH",
    ...(platform === "linux" && display
      ? ["DISPLAY", "XAUTHORITY", "DBUS_SESSION_BUS_ADDRESS"]
      : []),
  ])
    if (source[name]) result[name] = source[name];
  return result;
};

async function main() {
  const [input, ...extra] = process.argv.slice(2);
  assert.ok(input && extra.length === 0 && path.isAbsolute(input));
  const config = JSON.parse(await fs.readFile(input, "utf8"));
  assert.equal(await fs.realpath(config.root), config.root);
  for (const selected of [input, config.storagePath, config.runtimeRoot]) {
    const part = path.relative(config.root, selected);
    assert.ok(
      part &&
        !path.isAbsolute(part) &&
        part !== ".." &&
        !part.startsWith(`..${path.sep}`),
    );
    assert.equal(await fs.realpath(selected), selected);
  }
  assert.ok(
    ["preparing", "installer-dispatched", "live"].includes(config.phase),
  );
  const api = require(
    path.join(config.runtimeRoot, "dist/src/extension_update_reservation.js"),
  );
  let installation = null;
  if (config.phase !== "installer-dispatched") {
    const part = path.relative(config.root, config.loadedPath);
    assert.ok(
      part &&
        !path.isAbsolute(part) &&
        part !== ".." &&
        !part.startsWith(`..${path.sep}`),
    );
    assert.equal(await fs.realpath(config.loadedPath), config.loadedPath);
    installation = await api.readLoadedExtensionState(
      config.loadedPath,
      config.loadedVersion,
      config.loadedPath,
      config.loadedVersion,
    );
    assert.ok(
      installation,
      "The actual native installation snapshot is required.",
    );
  }
  const reservation = await api.acquireExtensionUpdateReservation({
    storagePath: config.storagePath,
    version: config.targetVersion,
    installation: async () => installation,
    ready: async () => true,
  });
  assert.ok(reservation && (await reservation.owns()));
  if (config.phase === "installer-dispatched")
    await reservation.markDispatched();
  process.stdout.write(
    JSON.stringify({ ready: true, pid: process.pid }) + "\n",
  );
  if (config.phase === "live") {
    process.stdin.resume();
    await new Promise((done) => process.stdin.once("end", done));
    await reservation.release();
  } else {
    // Deliberately close without release: the exited PID is real, not edited.
    await reservation.close();
  }
}
if (require.main === module)
  main().catch(() => {
    process.exitCode = 1;
  });
