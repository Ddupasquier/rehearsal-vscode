/** Bounded read-only native-companion children; never discovers process authority. */
const assert = require("node:assert/strict");
const { spawn, execFile } = require("node:child_process");
const fs = require("node:fs/promises");
const path = require("node:path");
const { promisify } = require("node:util");
const { setTimeout: delay } = require("node:timers/promises");
const execute = promisify(execFile);
const commands = new Set([
  "activity",
  "status",
  "configuration",
  "explain",
  "doctor",
  "candidates",
  "inspect baseline",
  "inspect plan",
  "resources",
  "environments",
  "discover",
]);

function parseProcessRows(stdout) {
  const rows = new Map();
  for (const line of stdout.split("\n")) {
    const match = line.match(
      /^\s*(\d+)\s+(\d+)\s+(\d+)\s+(\S+)\s+([A-Za-z]{3}\s+[A-Za-z]{3}\s+\d{1,2}\s+\d\d:\d\d:\d\d\s+\d{4})\s+(.+)$/u,
    );
    if (match)
      rows.set(Number(match[1]), {
        pid: Number(match[1]),
        ppid: Number(match[2]),
        pgid: Number(match[3]),
        state: match[4],
        started: match[5].replace(/\s+/gu, " "),
        executable: path.basename(match[6].trim()),
      });
  }
  return rows;
}
async function processes() {
  const { stdout } = await execute(
    "/bin/ps",
    ["-axo", "pid=,ppid=,pgid=,stat=,lstart=,comm="],
    { encoding: "utf8", timeout: 5000, maxBuffer: 1024 * 1024 },
  );
  return parseProcessRows(stdout);
}
const same = (left, right) =>
  Boolean(
    left &&
    right &&
    left.pid === right.pid &&
    left.started === right.started &&
    left.executable === right.executable,
  );
function collect(rows, captured, roots) {
  const eligible = new Set([
    ...roots,
    ...[...captured.values()]
      .filter((row) => same(row, rows.get(row.pid)))
      .map((row) => row.pid),
  ]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const row of rows.values())
      if (eligible.has(row.ppid) && !eligible.has(row.pid)) {
        eligible.add(row.pid);
        changed = true;
      }
  }
  for (const pid of eligible)
    if (rows.has(pid) && !captured.has(pid)) captured.set(pid, rows.get(pid));
  assert.ok(
    captured.size <= 256,
    "Owned process observation exceeded its bound.",
  );
}
async function writeJson(file, value) {
  const temporary = `${file}.new`;
  await fs.writeFile(temporary, JSON.stringify(value, null, 2) + "\n", {
    mode: 0o600,
  });
  await fs.rename(temporary, file);
}
async function cleanupCaptured(captured) {
  const result = {
    observedRemainingBeforeFallback: [],
    remaining: [],
    fallbackUsed: false,
    observationFailed: false,
  };
  try {
    let rows = await processes();
    collect(rows, captured, []);
    result.observedRemainingBeforeFallback = [...captured.values()].filter(
      (row) => same(row, rows.get(row.pid)),
    );
    if (result.observedRemainingBeforeFallback.length) {
      result.fallbackUsed = true;
      for (const signal of ["SIGTERM", "SIGKILL"]) {
        rows = await processes();
        collect(rows, captured, []);
        for (const row of [...captured.values()].reverse())
          if (same(row, rows.get(row.pid))) {
            try {
              process.kill(row.pid, signal);
            } catch (error) {
              if (error.code !== "ESRCH") throw error;
            }
          }
        await delay(200);
      }
    }
    rows = await processes();
    result.remaining = [...captured.values()].filter((row) =>
      same(row, rows.get(row.pid)),
    );
  } catch {
    result.observationFailed = true;
  }
  return result;
}

function createReadClient({
  config,
  environment,
  parseEnvelope,
  readChildren,
  timeoutMs = 30000,
  maximumBytes = 512 * 1024,
}) {
  assert.ok(
    Number.isSafeInteger(timeoutMs) && timeoutMs >= 100 && timeoutMs <= 30000,
  );
  assert.ok(
    Number.isSafeInteger(maximumBytes) &&
      maximumBytes >= 64 &&
      maximumBytes <= 512 * 1024,
  );
  assert.equal(typeof parseEnvelope, "function");
  assert.ok(readChildren instanceof Map);
  const active = new Set();
  let fallbackUsed = false,
    observationFailed = false,
    closeObservationFailed = false,
    failedReads = 0;
  async function closeOwned(child) {
    if (!active.has(child)) return;
    fallbackUsed = true;
    // Direct ChildProcess ownership is independent of ps availability. No guessed PID.
    try {
      for (const signal of ["SIGTERM", "SIGKILL"]) {
        if (!active.has(child)) break;
        child.kill(signal);
        const until = Date.now() + 1000;
        while (active.has(child) && Date.now() < until) await delay(50);
      }
    } catch {
      closeObservationFailed = true;
    }
    if (active.has(child)) closeObservationFailed = true;
  }
  async function publicJson(command) {
    assert.ok(
      Array.isArray(command) &&
        command.every((part) => typeof part === "string") &&
        commands.has(command.join(" ")),
      "Native companion read command is not allowlisted.",
    );
    assert.equal(active.size, 0, "Native companion reads must be serial.");
    const child = spawn(
      process.execPath,
      [
        config.coreBin,
        ...command,
        "--json",
        `--config=${config.fixture.configRelativePath}`,
      ],
      {
        cwd: config.fixture.projectRoot,
        env: environment,
        detached: true,
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    const captured = new Map(),
      chunks = [];
    let stdoutBytes = 0,
      stderrBytes = 0,
      closed = false,
      childError,
      identity;
    active.add(child);
    const completion = new Promise((resolveExit) => {
      child.once("error", (error) => {
        childError = error;
      });
      child.once("close", (code, signal) => {
        closed = true;
        active.delete(child);
        resolveExit({ code, signal });
      });
    });
    child.stdout.on("data", (bytes) => {
      stdoutBytes += bytes.length;
      if (stdoutBytes <= maximumBytes) chunks.push(bytes);
    });
    child.stderr.on("data", (bytes) => {
      stderrBytes += bytes.length;
    });
    const deadline = Date.now() + timeoutMs;
    try {
      assert.ok(child.pid);
      while (
        !closed &&
        Date.now() < deadline &&
        stdoutBytes <= maximumBytes &&
        stderrBytes <= maximumBytes
      ) {
        const rows = await processes();
        if (!identity && !closed) identity = rows.get(child.pid);
        collect(
          rows,
          captured,
          same(identity, rows.get(child.pid)) ? [child.pid] : [],
        );
        await delay(Math.min(200, timeoutMs));
      }
      assert.equal(closed, true);
      const exit = await completion;
      assert.ok(
        !childError &&
          exit.code === 0 &&
          exit.signal === null &&
          stdoutBytes <= maximumBytes &&
          stderrBytes <= maximumBytes,
      );
      const envelope = parseEnvelope(
        JSON.parse(Buffer.concat(chunks).toString("utf8")),
        command.join(" "),
      );
      assert.equal(envelope.status, "success");
      assert.equal(envelope.rehearsalVersion, "1.0.2");
      return envelope.data;
    } catch {
      failedReads++;
      throw new Error("Owned public read failed; raw output withheld.");
    } finally {
      if (!closed) {
        fallbackUsed = true;
        const recovery = await cleanupCaptured(captured);
        observationFailed ||= recovery.observationFailed;
        await closeOwned(child);
      }
      for (const row of captured.values()) readChildren.set(row.pid, row);
      if (!closed)
        throw new Error(
          "Owned public read close is unverified; raw output withheld.",
        );
    }
  }
  async function cleanup() {
    const result = await cleanupCaptured(readChildren);
    for (const child of [...active]) await closeOwned(child);
    fallbackUsed ||= result.fallbackUsed;
    observationFailed ||= result.observationFailed;
    return {
      ...result,
      fallbackUsed,
      observationFailed,
      closeObservationFailed,
      failedReads,
    };
  }
  return { publicJson, cleanup };
}
module.exports = {
  parseProcessRows,
  processes,
  same,
  collect,
  writeJson,
  createReadClient,
};
