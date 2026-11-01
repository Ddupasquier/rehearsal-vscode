/** Normal activation is required for genuine modal UI: Code test-host mode refuses dialogs. */
import assert from "node:assert/strict";
import { constants } from "node:fs";
import { open } from "node:fs/promises";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";

export const nativeEngineLaunchMode = (
  engineUiReview: boolean,
  harness: string,
) => ({
  activationEvents: engineUiReview ? ["onStartupFinished"] : [],
  testArguments: engineUiReview
    ? []
    : [`--extensionTestsPath=${join(harness, "runner.cjs")}`],
  completeOnStarted: engineUiReview,
});

/** Completion authorizes only cleanup of the already captured owned process group. */
export async function waitForNativeEngineResult(
  path: string,
  candidateSha256: string,
  activitySha256: string,
  timeoutMs = 5000,
) {
  assert.ok(
    Number.isSafeInteger(timeoutMs) && timeoutMs > 0 && timeoutMs <= 30000,
  );
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    const handle = await open(
      path,
      constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
    ).catch(() => null);
    if (handle) {
      try {
        const stat = await handle.stat();
        assert.ok(stat.isFile() && stat.size <= 256 * 1024);
        const bytes = Buffer.alloc(stat.size + 1),
          { bytesRead } = await handle.read(bytes, 0, bytes.length, 0);
        assert.equal(bytesRead, stat.size);
        const after = await handle.stat();
        assert.equal(after.size, stat.size);
        assert.equal(after.mtimeMs, stat.mtimeMs);
        const result = JSON.parse(
          bytes.subarray(0, bytesRead).toString("utf8"),
        );
        assert.equal(result.status, "passed");
        assert.equal(result.candidateSha256, candidateSha256);
        assert.equal(result.activitySha256, activitySha256);
        return;
      } finally {
        await handle.close();
      }
    }
    await delay(25);
  }
  throw Error("Owned native companion did not produce a verified result.");
}
