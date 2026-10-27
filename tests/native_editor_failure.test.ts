import { describe, it, expect } from "vitest";
import { nativeEditorFailureDiagnostic } from "../scripts/verify-native-prisma-editor.js";

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
