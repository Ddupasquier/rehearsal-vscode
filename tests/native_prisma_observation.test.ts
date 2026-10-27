import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { runInNewContext } from "node:vm";
const require = createRequire(import.meta.url);
const source = readFileSync(
  new URL("../scripts/native-prisma-review-test.cjs", import.meta.url),
  "utf8",
);
const api: { snapshotObservation: (value: unknown) => unknown } = {
  snapshotObservation: () => undefined,
};
runInNewContext(source, {
  exports: api,
  require: (name: string) =>
    name === "vscode" || name.startsWith("./") ? {} : require(name),
});
describe("failure-only native Prisma snapshot projection", () => {
  it("retains known actionable states without private payloads", () => {
    const observation = api.snapshotObservation({
      availability: "error",
      version: "2.1.0",
      activity: { state: "idle", operation: { private: "PRIVATE" } },
      readiness: { state: "READY", checks: [{ detail: "PRIVATE" }] },
      error: { code: "invalid_cli_contract", message: "PRIVATE" },
      baseline: { formatVersion: 3, nativeMigrations: { private: "PRIVATE" } },
      migrationInsights: { state: "unavailable" },
      workspaceRoot: "PRIVATE",
    });
    expect(observation).toEqual({
      availability: "error",
      version: "2.1.0",
      activity: "idle",
      readiness: "READY",
      errorCode: "invalid_cli_contract",
      baselineFormat: 3,
      hasNativeBinding: true,
      insightsAvailable: false,
    });
    expect(JSON.stringify(observation)).not.toContain("PRIVATE");
  });
  it("does not emit unknown arbitrary codes/versions/states or unsupported formats", () => {
    const result = api.snapshotObservation({
      availability: "PRIVATE",
      version: "PRIVATE",
      activity: { state: "PRIVATE" },
      readiness: { state: "PRIVATE" },
      error: { code: "PRIVATE" },
      baseline: { formatVersion: 99 },
    });
    expect(JSON.stringify(result)).not.toContain("PRIVATE");
    expect(result).toMatchObject({
      errorCode: "unclassified",
      version: null,
      availability: null,
      baselineFormat: null,
    });
  });
  it("handles unavailable observations with bounded fixed fields", () => {
    expect(api.snapshotObservation(undefined)).toEqual({
      availability: null,
      version: null,
      errorCode: null,
      activity: null,
      readiness: null,
      baselineFormat: null,
      hasNativeBinding: false,
      insightsAvailable: false,
    });
  });
});
