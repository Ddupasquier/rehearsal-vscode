import { describe, it, expect, vi } from "vitest";
import { Socket } from "node:net";
import { PassThrough } from "node:stream";
import {
  nativeEditorFailureDiagnostic,
  nativeEditorStartupDiagnostic,
  unrefRetainedNativeEditorObserver,
} from "../scripts/verify-native-prisma-editor.js";

describe("native editor failure-only diagnostics", () => {
  it.each([
    [
      { code: "ERR_ASSERTION", message: "PRIVATE_SQL" },
      { category: "assertion", exitCode: null },
    ],
    [
      { code: "ENOENT", path: "PRIVATE_PATH" },
      { category: "missing-input", exitCode: null },
    ],
    [
      { code: "EACCES", stderr: "PRIVATE_PROVIDER" },
      { category: "access-refused", exitCode: null },
    ],
    [{ code: "EPERM" }, { category: "access-refused", exitCode: null }],
    [{ code: "ETIMEDOUT" }, { category: "transport-timeout", exitCode: null }],
    [{ code: "ABORT_ERR" }, { category: "cancelled", exitCode: null }],
    [{ name: "AbortError" }, { category: "cancelled", exitCode: null }],
    [
      { message: "Owned Code exited before observation." },
      { category: "owned-code-exit", exitCode: null },
    ],
    [
      { message: "Owned native observation incomplete." },
      { category: "observation-timeout", exitCode: null },
    ],
    [
      { message: "Owned CDP unavailable." },
      { category: "owned-cdp-unavailable", exitCode: null },
    ],
    [
      { message: "Owned CDP refused." },
      { category: "owned-cdp-unavailable", exitCode: null },
    ],
    [
      { code: 1, stdout: "PRIVATE_CREDENTIALS" },
      { category: "child-exit", exitCode: 1 },
    ],
    [{ code: 255 }, { category: "child-exit", exitCode: 255 }],
  ])(
    "classifies fixed failure boundary %# without retaining raw error",
    (error, expected) =>
      expect(nativeEditorFailureDiagnostic(error)).toEqual(expected),
  );
  it.each([
    undefined,
    null,
    "PRIVATE_ERROR",
    {
      code: "PRIVATE_PROVIDER",
      message: "PRIVATE_SQL",
      stack: "PRIVATE_PATH",
      argv: ["PRIVATE_CREDENTIAL"],
    },
    { code: 256 },
    { code: -1 },
    { code: 1.1 },
  ])("keeps unknown error %# unclassified and private", (error) => {
    const actual = nativeEditorFailureDiagnostic(error);
    expect(actual).toEqual({ category: "unexpected", exitCode: null });
    expect(JSON.stringify(actual)).not.toContain("PRIVATE");
  });
});

describe("bounded Electron startup failure classification", () => {
  it.each([
    [
      "The SUID sandbox helper binary was found, but is not configured correctly. PRIVATE_PATH",
      "sandbox-helper",
    ],
    [
      "Running as root without --no-sandbox is not supported. PRIVATE_PATH",
      "root-sandbox-refusal",
    ],
    [
      "Failed to move to new namespace: Operation not permitted PRIVATE_PATH",
      "user-namespace",
    ],
    ["No usable sandbox! PRIVATE_PATH", "sandbox-unavailable"],
    ["error while loading shared libraries: PRIVATE_LIBRARY", "shared-library"],
    ["Missing X server or $DISPLAY PRIVATE_DISPLAY", "display"],
    ["GPU process isn't usable. PRIVATE_PATH", "graphics-startup"],
    ["PRIVATE_UNKNOWN_PROVIDER_MESSAGE", "unclassified"],
    ["", "no-stderr"],
  ])("projects only fixed startup category %#", (text, category) => {
    const result = nativeEditorStartupDiagnostic(
      Buffer.from(text),
      1,
      "SIGABRT",
    );
    expect(result).toEqual({
      category,
      exitCode: 1,
      signal: "SIGABRT",
      stderrBytesCaptured: Buffer.byteLength(text),
    });
    expect(JSON.stringify(result)).not.toContain("PRIVATE");
  });
  it("bounds captured bytes and refuses unknown exit/signal values", () => {
    const result = nativeEditorStartupDiagnostic(
      Buffer.alloc(70000, 65),
      -1,
      "PRIVATE_SIGNAL",
    );
    expect(result).toEqual({
      category: "unclassified",
      exitCode: null,
      signal: null,
      stderrBytesCaptured: 65536,
    });
  });
  it("keeps an observed clean process exit separate from missing stderr", () =>
    expect(nativeEditorStartupDiagnostic(Buffer.alloc(0), 0, null)).toEqual({
      category: "no-stderr",
      exitCode: 0,
      signal: null,
      stderrBytesCaptured: 0,
    }));
});

describe("intentional retained editor observer ownership", () => {
  it("unrefs the actual public socket and child without destroying streams or signalling", () => {
    const socket = new Socket(),
      unref = vi.spyOn(socket, "unref"),
      destroy = vi.spyOn(socket, "destroy"),
      child = { stderr: socket, unref: vi.fn(), kill: vi.fn() };
    expect(unrefRetainedNativeEditorObserver(child)).toEqual({
      childUnref: true,
      stderrUnref: true,
    });
    expect(unref).toHaveBeenCalledOnce();
    expect(child.unref).toHaveBeenCalledOnce();
    expect(destroy).not.toHaveBeenCalled();
    expect(child.kill).not.toHaveBeenCalled();
    expect(socket.destroyed).toBe(false);
  });
  it("records unsupported readable observation rather than inventing socket detachment", () => {
    const stream = new PassThrough(),
      destroy = vi.spyOn(stream, "destroy"),
      child = { stderr: stream, unref: vi.fn(), kill: vi.fn() };
    expect(unrefRetainedNativeEditorObserver(child)).toEqual({
      childUnref: true,
      stderrUnref: false,
    });
    expect(child.unref).toHaveBeenCalledOnce();
    expect(destroy).not.toHaveBeenCalled();
    expect(child.kill).not.toHaveBeenCalled();
  });
  it("releases child observation when there is no stderr stream", () => {
    const child = { stderr: null, unref: vi.fn() };
    expect(unrefRetainedNativeEditorObserver(child)).toEqual({
      childUnref: true,
      stderrUnref: null,
    });
    expect(child.unref).toHaveBeenCalledOnce();
  });
});
