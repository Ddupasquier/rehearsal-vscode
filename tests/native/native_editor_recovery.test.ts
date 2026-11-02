import { describe, expect, it, vi } from "vitest";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { Script } from "node:vm";
import { spawn } from "node:child_process";
import {
  nativeEditorCleanupForReport,
  type NativeEditorCleanup,
} from "../../scripts/native/verify-native-cancellation.js";

const nativeRequire = createRequire(__filename);
const recovery = nativeRequire(
  "../../scripts/native/native-editor-recovery.cjs",
) as {
  nativeEditorRecoveryDecision(
    result: unknown,
    count: unknown,
  ): {
    retainEditor: boolean;
    dirtyDocumentCount: number | null;
    reason: string;
  };
  shouldRetainNativeEditor(result: unknown): boolean;
};
type Report = Record<string, unknown>;
async function driver(
  documents: unknown = [],
  options: { writeFailure?: boolean; closeFailure?: boolean } = {},
) {
  const writes: Report[] = [],
    commands: string[] = [];
  const workspace = {};
  Object.defineProperty(workspace, "textDocuments", {
    get: () => {
      if (documents instanceof Error) throw documents;
      if (typeof documents === "function") return documents();
      return documents;
    },
  });
  const exports: {
    finalizeEditor?: (config: unknown, result: Report) => Promise<void>;
  } = {};
  new Script(
    await readFile(
      resolve(__dirname, "../../scripts/native/native-editor-driver.cjs"),
      "utf8",
    ),
  ).runInNewContext({
    exports,
    process: { env: {} },
    require: (name: string) => {
      if (name === "vscode")
        return {
          workspace,
          commands: {
            executeCommand: async (command: string) => {
              commands.push(command);
              if (options.closeFailure) throw new Error("PRIVATE_CANARY");
            },
          },
        };
      if (name === "node:fs/promises")
        return {
          writeFile: async (_path: string, text: string) => {
            if (options.writeFailure) throw new Error("PRIVATE_CANARY");
            writes.push(JSON.parse(text) as Report);
          },
          rename: async () => {},
        };
      if (name === "./native-editor-recovery.cjs") return recovery;
      if (["node:assert/strict", "node:fs", "node:path"].includes(name))
        return nativeRequire(name);
      throw new Error("Unexpected test import.");
    },
  });
  expect(exports.finalizeEditor).toBeTypeOf("function");
  return {
    writes,
    commands,
    finalize: (result: Report) =>
      exports.finalizeEditor!({ resultPath: "/owned/result.json" }, result),
  };
}

describe("native driver preserves actual unsaved or unknown work", () => {
  it("retains a scenario recovery request instead of closing the actual window", async () => {
    const host = await driver();
    await host.finalize({ status: "failed", recoveryRequired: true });
    expect(host.commands).toEqual([]);
    expect(host.writes.at(-1)).toMatchObject({
      status: "failed",
      driverFinalized: true,
      recoveryRequired: true,
      editorRecovery: {
        retainEditor: true,
        dirtyDocumentCount: 0,
        reason: "scenario-recovery-required",
      },
    });
  });
  it("independently observes dirty documents without reading any text or paths", async () => {
    const dirty = {
      isClosed: false,
      isDirty: true,
      get text() {
        throw new Error("PRIVATE_CANARY");
      },
      get uri() {
        throw new Error("PRIVATE_CANARY");
      },
    };
    const host = await driver([
      dirty,
      { isClosed: true, isDirty: true },
      { isClosed: false, isDirty: false },
    ]);
    await host.finalize({ status: "passed" });
    expect(host.commands).toEqual([]);
    expect(host.writes.at(-1)).toMatchObject({
      status: "failed",
      driverFinalized: true,
      recoveryRequired: true,
      editorRecovery: {
        retainEditor: true,
        dirtyDocumentCount: 1,
        reason: "dirty-documents",
      },
    });
    expect(JSON.stringify(host.writes)).not.toContain("PRIVATE_CANARY");
  });
  it("retains an unobservable editor rather than guessing it has no dirty work", async () => {
    const host = await driver(new Error("PRIVATE_CANARY"));
    await host.finalize({ status: "passed" });
    expect(host.commands).toEqual([]);
    expect(host.writes.at(-1)).toMatchObject({
      status: "failed",
      recoveryRequired: true,
      editorRecovery: { dirtyDocumentCount: null },
    });
    expect(JSON.stringify(host.writes)).not.toContain("PRIVATE_CANARY");
  });
  it("rechecks actual dirty buffers after awaiting finalization persistence", async () => {
    let reads = 0;
    const host = await driver(() =>
      ++reads === 1 ? [] : [{ isClosed: false, isDirty: true }],
    );
    await host.finalize({ status: "passed" });
    expect(reads).toBe(2);
    expect(host.commands).toEqual([]);
    expect(host.writes.at(-1)).toMatchObject({
      status: "failed",
      recoveryRequired: true,
      editorRecovery: { dirtyDocumentCount: 1 },
    });
  });
  it("does not treat a malformed recovery request as clean success", async () => {
    const host = await driver();
    await host.finalize({ status: "passed", recoveryRequired: "false" });
    expect(host.commands).toEqual([]);
    expect(host.writes.at(-1)).toMatchObject({
      status: "failed",
      recoveryRequired: true,
      editorRecovery: { reason: "unverified-recovery-request" },
    });
  });
  it.each(["passed", "failed"])(
    "keeps normal close behavior for a proven clean %s finalization",
    async (status) => {
      const host = await driver();
      await host.finalize({ status });
      expect(host.commands).toEqual(["workbench.action.closeWindow"]);
      expect(host.writes.at(-1)).toMatchObject({
        status,
        driverFinalized: true,
        recoveryRequired: false,
        editorRecovery: { dirtyDocumentCount: 0, retainEditor: false },
      });
    },
  );
  it("does not close when its finalization report could not be persisted", async () => {
    const host = await driver([], { writeFailure: true });
    await expect(host.finalize({ status: "passed" })).rejects.toThrow();
    expect(host.commands).toEqual([]);
  });
  it("changes a failed close request into explicit retained recovery", async () => {
    const host = await driver([], { closeFailure: true });
    await host.finalize({ status: "passed" });
    const result = host.writes.at(-1);
    expect(result).toMatchObject({ status: "failed", recoveryRequired: true });
    expect(recovery.shouldRetainNativeEditor(result)).toBe(true);
    expect(JSON.stringify(host.writes)).not.toContain("PRIVATE_CANARY");
  });
  it("bounds dirty-document counts and never invents zero from unknown input", () => {
    expect(
      recovery.nativeEditorRecoveryDecision({ status: "passed" }, 1001),
    ).toMatchObject({
      dirtyDocumentCount: 1000,
      dirtyDocumentCountTruncated: true,
      retainEditor: true,
    });
    for (const count of [null, undefined, -1, NaN, "0"])
      expect(
        recovery.nativeEditorRecoveryDecision({ status: "passed" }, count),
      ).toMatchObject({ dirtyDocumentCount: null, retainEditor: true });
  });
});

const observation: NativeEditorCleanup = {
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
};
const clean = (status = "passed"): Report => ({
  status,
  driverFinalized: true,
  recoveryRequired: false,
  editorRecovery: recovery.nativeEditorRecoveryDecision({ status }, 0),
});
async function bounded<T>(
  promise: Promise<T>,
  milliseconds: number,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () =>
            reject(new Error("Owned recovery-test sentinel did not settle.")),
          milliseconds,
        );
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
describe("native launcher respects recovery finalization", () => {
  it("retains a real owned sentinel host and retires only launcher wait ownership", async () => {
    const sentinel = spawn(
      process.execPath,
      [
        "-e",
        "process.on('message',()=>process.send('alive'));setInterval(()=>{},1000)",
      ],
      { stdio: ["ignore", "ignore", "ignore", "ipc"] },
    );
    const closed = new Promise<void>((done) =>
      sentinel.once("close", () => done()),
    );
    sentinel.on("error", () => {});
    const cleanup = vi.fn(async () => {
      sentinel.kill("SIGTERM");
      return observation;
    });
    const observe = vi.fn(async () => observation),
      retain = vi.fn();
    try {
      const result = await nativeEditorCleanupForReport(
        { ...clean("failed"), recoveryRequired: true },
        { observe, cleanup },
        retain,
      );
      expect(result.cleanupSkippedForRecovery).toBe(true);
      expect(cleanup).not.toHaveBeenCalled();
      expect(observe).toHaveBeenCalledOnce();
      expect(retain).toHaveBeenCalledOnce();
      const alive = new Promise<unknown>((done) =>
        sentinel.once("message", done),
      );
      sentinel.send("check");
      expect(await bounded(alive, 2500)).toBe("alive");
    } finally {
      sentinel.kill("SIGTERM");
      try {
        await bounded(closed, 2000);
      } catch {
        sentinel.kill("SIGKILL");
        await bounded(closed, 2000);
      }
    }
  });
  it.each(
    [
      undefined,
      null,
      {},
      { ...clean(), recoveryRequired: "false" },
      {
        ...clean(),
        editorRecovery: { schemaVersion: 1, retainEditor: false },
      },
    ].map((report) => [report]),
  )(
    "never converts missing or malformed finalization into signalling authority",
    async (report) => {
      const tracker = {
        observe: vi.fn(async () => observation),
        cleanup: vi.fn(async () => observation),
      };
      expect(
        (await nativeEditorCleanupForReport(report, tracker))
          .cleanupSkippedForRecovery,
      ).toBe(true);
      expect(tracker.cleanup).not.toHaveBeenCalled();
    },
  );
  it.each(["passed", "failed"])(
    "preserves existing owned cleanup for a verified clean %s report",
    async (status) => {
      const tracker = {
        observe: vi.fn(async () => observation),
        cleanup: vi.fn(async () => observation),
      };
      const retain = vi.fn();
      expect(
        (await nativeEditorCleanupForReport(clean(status), tracker, retain))
          .cleanupSkippedForRecovery,
      ).toBe(false);
      expect(tracker.cleanup).toHaveBeenCalledOnce();
      expect(retain).not.toHaveBeenCalled();
    },
  );
});
