import { mkdtemp, writeFile, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  nativeEngineLaunchMode,
  waitForNativeEngineResult,
} from "../scripts/native-engine-launch.js";
const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0))
    await rm(root, { recursive: true, force: true });
});
describe("owned native modal launch boundary", () => {
  it("uses normal startup only for the explicit genuine-modal mode and retains the historical test runner", () => {
    const native = nativeEngineLaunchMode(true, "/owned/harness");
    expect(native.activationEvents).toEqual(["onStartupFinished"]);
    expect(native.testArguments).toEqual([]);
    expect(native.completeOnStarted).toBe(true);
    const historical = nativeEngineLaunchMode(false, "/owned/harness");
    expect(historical.activationEvents).toEqual([]);
    expect(historical.testArguments).toEqual([
      "--extensionTestsPath=/owned/harness/runner.cjs",
    ]);
    expect(historical.completeOnStarted).toBe(false);
  });
  it("requires exact positive result before normal cleanup completion and refuses failure/foreign artifacts", async () => {
    const root = await mkdtemp(join(tmpdir(), "native-engine-result-"));
    roots.push(root);
    const file = join(root, "result.json");
    const result = {
      status: "passed",
      candidateSha256: "a".repeat(64),
      activitySha256: "b".repeat(64),
    };
    await writeFile(file, JSON.stringify(result));
    await expect(
      waitForNativeEngineResult(
        file,
        result.candidateSha256,
        result.activitySha256,
      ),
    ).resolves.toBeUndefined();
    await expect(
      waitForNativeEngineResult(file, "c".repeat(64), result.activitySha256),
    ).rejects.toThrow();
    await writeFile(file, JSON.stringify({ ...result, status: "failed" }));
    await expect(
      waitForNativeEngineResult(
        file,
        result.candidateSha256,
        result.activitySha256,
      ),
    ).rejects.toThrow();
  });
  it("fails closed on absent or redirected results without treating process exit as acceptance", async () => {
    const root = await mkdtemp(join(tmpdir(), "native-engine-result-"));
    roots.push(root);
    const file = join(root, "missing.json");
    await expect(
      waitForNativeEngineResult(file, "a", "b", 1),
    ).rejects.toThrow();
    const target = join(root, "target.json");
    await writeFile(
      target,
      JSON.stringify({
        status: "passed",
        candidateSha256: "a",
        activitySha256: "b",
      }),
    );
    await symlink(target, file);
    await expect(
      waitForNativeEngineResult(file, "a", "b", 1),
    ).rejects.toThrow();
  });
});

describe("owned first-use optional-check consent", () => {
  const { declinedUpdateConsent, updateConsentDeclineLabel } =
    require("../scripts/native-engine-ui-contract.cjs") as {
      declinedUpdateConsent: (
        question: unknown,
        labels: unknown,
      ) => string | undefined;
      updateConsentDeclineLabel: string;
    };
  it("selects only Don't Ask Again for the exact recognized prompt", () => {
    expect(
      declinedUpdateConsent(true, [
        "Don't Ask Again",
        "Not Now",
        "Cancel",
        "Enable Daily Checks",
      ]),
    ).toBe(updateConsentDeclineLabel);
    expect(declinedUpdateConsent(false, ["Don't Ask Again"])).toBeUndefined();
    expect(
      declinedUpdateConsent(true, ["Enable Daily Checks"]),
    ).toBeUndefined();
    expect(declinedUpdateConsent(true, ["Don't Ask Again", "Close"])).toBe(
      updateConsentDeclineLabel,
    );
    expect(
      declinedUpdateConsent(true, [
        "Don't Ask Again",
        "Other unselected action",
      ]),
    ).toBe(updateConsentDeclineLabel);
    expect(
      declinedUpdateConsent(true, ["Don't Ask Again", "Don't Ask Again"]),
    ).toBeUndefined();
    expect(declinedUpdateConsent(true, null)).toBeUndefined();
  });
});

describe("unbound draft evidence", () => {
  const { unboundDraftPreserved } =
    require("../scripts/native-engine-ui-contract.cjs") as {
      unboundDraftPreserved: (flags: unknown) => boolean;
    };
  it("requires document/field/value preservation independently of window occlusion", () => {
    const flags = {
      sameDocument: true,
      sameField: true,
      exactValue: true,
      browserVisible: false,
    };
    expect(unboundDraftPreserved(flags)).toBe(true);
    for (const key of ["sameDocument", "sameField", "exactValue"])
      expect(unboundDraftPreserved({ ...flags, [key]: false })).toBe(false);
    expect(unboundDraftPreserved(null)).toBe(false);
  });
});

describe("asynchronous owned dashboard pane", () => {
  const { dashboardPaneSettled } =
    require("../scripts/native-engine-ui-contract.cjs") as {
      dashboardPaneSettled: (state: unknown) => boolean;
    };
  it("waits for a positive original column and preserves exact visible pane ownership", () => {
    const settled = {
      originalColumn: 1,
      actualColumn: 1,
      panelVisible: true,
      samePanel: true,
    };
    expect(dashboardPaneSettled(settled)).toBe(true);
    for (const state of [
      { ...settled, originalColumn: null },
      { ...settled, actualColumn: undefined },
      { ...settled, actualColumn: 2 },
      { ...settled, panelVisible: false },
      { ...settled, samePanel: false },
    ])
      expect(dashboardPaneSettled(state)).toBe(false);
  });
});
