/** Read Test Lab evidence through the production editor contract; never launch a CLI. */
import assert from "node:assert/strict";
import { constants } from "node:fs";
import { open } from "node:fs/promises";
import { parseActivityData } from "../../src/contracts.js";
import { renderOperationProgress } from "../../src/runtime/operation_progress.js";

const record = (value: unknown): Record<string, unknown> => {
  assert.ok(
    value !== null && typeof value === "object" && !Array.isArray(value),
  );
  return value as Record<string, unknown>;
};

export function verifyOperationActivityEvidence(
  value: unknown,
  expectedSha256: string,
) {
  assert.match(expectedSha256, /^[a-f0-9]{64}$/u);
  const report = record(value);
  assert.equal(report.schemaVersion, 1);
  assert.equal(report.status, "passed");
  assert.equal(report.cleanup, "removed");
  const artifact = record(report.artifact);
  assert.equal(artifact.name, "@rehearsal-db/core");
  assert.equal(artifact.sha256, expectedSha256);
  assert.equal(typeof artifact.version, "string");
  const samples = record(report.safeActivitySamples);
  const parsed = {
    freshIdle: parseActivityData(samples.freshIdle),
    completed: parseActivityData(samples.completed),
    failed: parseActivityData(samples.failed),
    siblingIdle: parseActivityData(samples.siblingIdle),
  };
  for (const activity of Object.values(parsed)) {
    assert.equal(activity.state, "idle");
    assert.equal(activity.operation, null);
    assert.ok(Array.isArray(activity.recent));
  }
  assert.deepEqual(parsed.freshIdle.recent, []);
  assert.deepEqual(parsed.siblingIdle.recent, []);
  assert.equal(parsed.completed.recent?.length, 1);
  assert.equal(parsed.failed.recent?.length, 2);
  const completed = parsed.completed.recent![0]!;
  const failed = parsed.failed.recent![1]!;
  assert.equal(completed.kind, "baseline create");
  assert.equal(completed.progress.state, "completed");
  assert.equal(failed.kind, "run");
  assert.equal(failed.progress.state, "failed");
  for (const item of [completed, failed]) {
    assert.equal(item.rehearsalVersion, artifact.version);
    assert.equal(item.progress.currentStage, null);
    assert.deepEqual(item.progress.completedStages, []);
  }
  assert.deepEqual(parsed.failed.recent![0], completed);
  assert.deepEqual(
    completed.progress.events.map(({ code }) => code),
    ["operation.started", "operation.completed"],
  );
  assert.deepEqual(
    failed.progress.events.map(({ code }) => code),
    ["operation.started", "operation.failed"],
  );
  const markup = renderOperationProgress({
    workspaceName: "Installed activity consumer",
    workspaceRoot: "/not-for-display",
    availability: "not_ready",
    activity: parsed.failed,
  });
  assert.ok(markup.includes("Completed") && markup.includes("Failed"));
  assert.ok(markup.includes("No successful stage completion was recorded."));
  assert.equal(markup.includes("/not-for-display"), false);
  return {
    status: "passed",
    artifactSha256: expectedSha256,
    version: artifact.version,
    samplesAccepted: 4,
    coreReceiptsRendered: 2,
    limitations: [
      "Reads prior exact-artifact Lab evidence; does not independently rerun its commands.",
      "Production editor parsing and HTML generation only; no native VS Code terminal, browser, keyboard or assistive-technology claim.",
      "Completed baseline creation and refused run are not database, migration, application or cancellation acceptance.",
    ],
  };
}

/** Bounded local report input shared by the installed-contract companions. */
export async function readOperationActivityReport(
  path: string,
): Promise<unknown> {
  const maximumBytes = 256 * 1024;
  const handle = await open(
    path,
    constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
  );
  try {
    const metadata = await handle.stat();
    assert.ok(metadata.isFile() && metadata.size <= maximumBytes);
    const bytes = Buffer.alloc(maximumBytes + 1);
    const { bytesRead } = await handle.read(bytes, 0, bytes.length, 0);
    assert.ok(bytesRead <= maximumBytes);
    assert.equal(bytesRead, metadata.size);
    assert.equal((await handle.stat()).size, metadata.size);
    return JSON.parse(bytes.subarray(0, bytesRead).toString("utf8"));
  } finally {
    await handle.close();
  }
}

export async function readOperationActivityEvidence(
  path: string,
  expectedSha256: string,
) {
  assert.match(expectedSha256, /^[a-f0-9]{64}$/u);
  return verifyOperationActivityEvidence(
    await readOperationActivityReport(path),
    expectedSha256,
  );
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  assert.equal(args.length, 2);
  console.log(
    JSON.stringify(
      await readOperationActivityEvidence(args[0]!, args[1]!),
      null,
      2,
    ),
  );
}

if (require.main === module)
  void main().catch(() => {
    console.error(
      "Activity evidence was missing, unsafe, mismatched or inconclusive; no CLI was launched.",
    );
    process.exitCode = 1;
  });
