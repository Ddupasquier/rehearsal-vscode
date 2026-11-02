import { describe, expect, it } from "vitest";
import { execFile } from "node:child_process";
import { mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import {
  readOperationActivityEvidence,
  verifyOperationActivityEvidence,
} from "../../scripts/native/verify-operation-activity.js";

const sha256 = "a".repeat(64);
const version = "0.1.0-rc.7";
function evidence() {
  const startedAt = "2026-10-13T12:00:00.000Z";
  const receipt = (kind: string, failed: boolean) => ({
    kind,
    rehearsalVersion: version,
    progress: {
      schemaVersion: 1,
      operationId: (failed ? "b" : "c").repeat(64),
      state: failed ? "failed" : "completed",
      startedAt,
      updatedAt: "2026-10-13T12:00:01.000Z",
      elapsedMilliseconds: 1000,
      currentStage: null,
      completedStages: [],
      events: [
        {
          sequence: 1,
          code: "operation.started",
          phase: null,
          target: null,
          at: startedAt,
        },
        {
          sequence: 2,
          code: failed ? "operation.failed" : "operation.completed",
          phase: null,
          target: null,
          at: "2026-10-13T12:00:01.000Z",
        },
      ],
      truncated: { stages: false, events: false },
    },
  });
  const idle = { schemaVersion: 1, state: "idle", operation: null, recent: [] };
  const completed = receipt("baseline create", false);
  return {
    schemaVersion: 1,
    status: "passed",
    artifact: { name: "@rehearsal-db/core", version, sha256 },
    cleanup: "removed",
    safeActivitySamples: {
      freshIdle: structuredClone(idle),
      completed: { ...idle, recent: [completed] },
      failed: { ...idle, recent: [completed, receipt("run", true)] },
      siblingIdle: structuredClone(idle),
    },
  };
}

describe("independent installed-activity evidence consumer", () => {
  it.skipIf(process.platform === "win32")(
    "refuses a no-writer FIFO without waiting for data or hanging the reader",
    async () => {
      const root = await mkdtemp(join(tmpdir(), "rehearsal-activity-fifo-"));
      try {
        const fifo = join(root, "report.pipe");
        await promisify(execFile)("mkfifo", [fifo], { timeout: 3000 });
        const result = await promisify(execFile)(
          process.execPath,
          [
            "--import",
            "tsx",
            resolve("scripts/native/verify-operation-activity.ts"),
            fifo,
            sha256,
          ],
          { timeout: 3000, killSignal: "SIGKILL", maxBuffer: 4096 },
        ).catch((error: unknown) => error);
        expect(result).toMatchObject({ code: 1, killed: false, signal: null });
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    },
  );
  it("bounds regular-file reads and refuses symlinks or oversized reports", async () => {
    const root = await mkdtemp(join(tmpdir(), "rehearsal-activity-evidence-"));
    try {
      const path = join(root, "report.json");
      await writeFile(path, JSON.stringify(evidence()), { mode: 0o600 });
      expect(await readOperationActivityEvidence(path, sha256)).toMatchObject({
        status: "passed",
      });
      await symlink(path, join(root, "redirect.json"));
      await expect(
        readOperationActivityEvidence(join(root, "redirect.json"), sha256),
      ).rejects.toThrow();
      await writeFile(join(root, "large.json"), " ".repeat(256 * 1024 + 1));
      await expect(
        readOperationActivityEvidence(join(root, "large.json"), sha256),
      ).rejects.toThrow();
      await expect(
        readOperationActivityEvidence(root, sha256),
      ).rejects.toThrow();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
  it("uses the production editor parser and renders honest successful/failed receipts", () => {
    expect(verifyOperationActivityEvidence(evidence(), sha256)).toMatchObject({
      status: "passed",
      samplesAccepted: 4,
      coreReceiptsRendered: 2,
      version,
    });
  });

  it("refuses mismatched artifacts, failed scenarios and incomplete cleanup", () => {
    for (const change of [
      { schemaVersion: 2 },
      { status: "failed" },
      { cleanup: "retained-for-diagnosis" },
      { artifact: { name: "other", version, sha256 } },
      {
        artifact: {
          name: "@rehearsal-db/core",
          version,
          sha256: "b".repeat(64),
        },
      },
      { safeActivitySamples: {} },
    ])
      expect(() =>
        verifyOperationActivityEvidence({ ...evidence(), ...change }, sha256),
      ).toThrow();
    expect(() =>
      verifyOperationActivityEvidence(evidence(), "short"),
    ).toThrow();
  });

  it("never treats unavailable, foreign or contradictory history as paired acceptance", () => {
    for (const sample of [
      "freshIdle",
      "completed",
      "failed",
      "siblingIdle",
    ] as const) {
      const value = evidence();
      const changed = {
        ...value.safeActivitySamples,
        [sample]: {
          schemaVersion: 2,
          state: "idle",
          operation: null,
          recent: [],
        },
      };
      expect(() =>
        verifyOperationActivityEvidence(
          { ...value, safeActivitySamples: changed },
          sha256,
        ),
      ).toThrow();
    }
    const value = evidence();
    value.safeActivitySamples.failed.recent[1]!.rehearsalVersion = "0.1.0-rc.4";
    expect(() => verifyOperationActivityEvidence(value, sha256)).toThrow();
    const missing = evidence();
    missing.safeActivitySamples.failed.recent.pop();
    expect(() => verifyOperationActivityEvidence(missing, sha256)).toThrow();
    const unavailable = evidence();
    expect(() =>
      verifyOperationActivityEvidence(
        {
          ...unavailable,
          safeActivitySamples: {
            ...unavailable.safeActivitySamples,
            failed: {
              schemaVersion: 1,
              state: "idle",
              operation: null,
              recent: null,
            },
          },
        },
        sha256,
      ),
    ).toThrow();
  });

  it("refuses unbounded progress and fabricated stage completion", () => {
    const oversized = evidence();
    oversized.safeActivitySamples.failed.recent[1]!.progress.events =
      Array.from({ length: 41 }, (_, index) => ({
        sequence: index + 1,
        code: "operation.failed",
        phase: null,
        target: null,
        at: "2026-10-13T12:00:01.000Z",
      }));
    expect(() => verifyOperationActivityEvidence(oversized, sha256)).toThrow();
    const fabricated = evidence();
    fabricated.safeActivitySamples.failed.recent[1]!.progress.events[1]!.code =
      "operation.completed";
    expect(() => verifyOperationActivityEvidence(fabricated, sha256)).toThrow();
  });
});
