import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  assertAutomaticUpdateFinalization,
  recordAutomaticUpdateCleanup,
} from "../../scripts/native/verify-automatic-updates.js";

type Input = Parameters<typeof recordAutomaticUpdateCleanup>[0];
const fixture = (evidence: string): Input => ({
  evidence,
  mode: "candidate",
  candidateSha256: "a".repeat(64),
  loadedVersion: "0.1.28",
  vscodeVersion: "1.143.0",
  nativeReport: {
    status: "failed",
    scenario: "automatic-updates",
    mode: "candidate",
    candidateSha256: "a".repeat(64),
    loadedVersion: "0.1.28",
    vscodeVersion: "1.143.0",
    checks: ["earlier reservation check passed"],
    failureCode: "NATIVE_UPDATE_ACCEPTANCE_FAILED",
    diagnostic: {
      code: "UNCLASSIFIED_ERROR",
      location: "native-editor-driver.cjs:166:7",
    },
    driverFinalized: true,
    recoveryRequired: false,
    editorRecovery: {
      schemaVersion: 1,
      retainEditor: false,
      dirtyDocumentCount: 0,
      dirtyDocumentCountTruncated: false,
      reason: "clean",
    },
  },
  ui: [
    {
      phase: "blocked-settings",
      keyboardAction: "Update Settings",
      screenshotSha256: "b".repeat(64),
    },
  ],
  cleanup: {
    cleanupSkippedForRecovery: false,
    observation: {
      rootObserved: true,
      fallbackUsed: false,
      observationFailed: false,
      identityUncertain: false,
      signalFailed: false,
      observedRemainingBeforeFallback: [],
      remaining: [],
      unknown: [],
      awaitingReap: [],
      uncertaintyHistory: [],
      execTransitions: [],
      execTransitionsOmitted: 0,
    },
  },
});

describe("native updater cleanup failure evidence boundary", () => {
  let evidence: string;
  beforeEach(async () => {
    evidence = await mkdtemp(join(tmpdir(), "native-cleanup-evidence-"));
  });
  afterEach(async () => {
    await rm(evidence, { recursive: true, force: true });
  });

  it("retains the original failed native report, partial UI and identity history before its real cleanup assertion propagates", async () => {
    const input = fixture(evidence);
    const expected = {
      pid: 120,
      ppid: 110,
      pgid: 100,
      started: "Tue Nov 3 12:00:00 2026",
      executable: "node",
    };
    const observed = { ...expected, executable: "unknown-helper" };
    Object.assign(input.cleanup.observation, {
      identityUncertain: true,
      unknown: [observed],
      uncertaintyHistory: [
        { reason: "descendant-identity-drift", expected, observed },
      ],
    });
    await expect(recordAutomaticUpdateCleanup(input)).rejects.toMatchObject({
      code: "ERR_ASSERTION",
    });
    const saved = JSON.parse(
      await readFile(join(evidence, "candidate-cleanup.json"), "utf8"),
    );
    expect(saved).toMatchObject({
      schemaVersion: 1,
      status: "observed",
      scope: "native-updater-cleanup-observation",
      mode: input.mode,
      candidateSha256: input.candidateSha256,
      loadedVersion: input.loadedVersion,
      vscodeVersion: input.vscodeVersion,
    });
    expect(saved.nativeReport).toEqual(input.nativeReport);
    expect(saved.nativeReport.status).toBe("failed");
    expect(saved.ui).toEqual(input.ui);
    expect(saved.cleanup).toEqual(input.cleanup);
  });

  it("does not turn a failed scenario into a native pass when cleanup itself is clean", async () => {
    const input = fixture(evidence);
    await recordAutomaticUpdateCleanup(input);
    expect(() =>
      assertAutomaticUpdateFinalization(input.nativeReport, input),
    ).toThrow();
    const saved = JSON.parse(
      await readFile(join(evidence, "candidate-cleanup.json"), "utf8"),
    );
    expect(saved.nativeReport.status).toBe("failed");
    expect(saved.cleanup.observation.identityUncertain).toBe(false);
    expect(saved.status).not.toBe("passed");
  });

  it("refuses a foreign report binding before labeling it owned evidence", async () => {
    const input = fixture(evidence);
    input.nativeReport = {
      ...(input.nativeReport as object),
      candidateSha256: "c".repeat(64),
    };
    await expect(recordAutomaticUpdateCleanup(input)).rejects.toThrow();
    expect(await readdir(evidence)).toEqual([]);
  });

  it("preserves an existing evidence file and retains both cleanup and evidence-write failures", async () => {
    const input = fixture(evidence);
    input.cleanup.observation.identityUncertain = true;
    const path = join(evidence, "candidate-cleanup.json");
    await writeFile(path, "existing owned evidence", {
      flag: "wx",
      mode: 0o600,
    });
    const failure = await recordAutomaticUpdateCleanup(input).catch(
      (error) => error,
    );
    expect(failure).toBeInstanceOf(AggregateError);
    expect(failure.errors[0]).toMatchObject({ code: "ERR_ASSERTION" });
    expect(failure.errors[1]).toMatchObject({ code: "EEXIST" });
    expect(await readFile(path, "utf8")).toBe("existing owned evidence");
  });
});
