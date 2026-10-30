import { describe, it, expect } from "vitest";
import { knexPlan } from "./knex_fixture.js";
import { parseNativeEditorAcceptanceArguments } from "../scripts/verify-native-prisma-editor.js";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { runInNewContext } from "node:vm";
const nativeRequire = createRequire(__filename);
const source = readFileSync(
  resolve(__dirname, "../scripts/native-prisma-review-test.cjs"),
  "utf8",
);
const api: {
  snapshotObservation: (value: unknown) => unknown;
  knexReviewedCandidate: (value: unknown) => Record<string, unknown>;
} = {
  snapshotObservation: () => undefined,
  knexReviewedCandidate: () => ({}),
};
runInNewContext(source, {
  exports: api,
  require: (name: string) =>
    name === "vscode" || name.startsWith("./") ? {} : nativeRequire(name),
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
  it("retains the known Drizzle baseline format without claiming native acceptance", () => {
    expect(
      api.snapshotObservation({
        baseline: { formatVersion: 4, nativeMigrations: { kind: "drizzle" } },
      }),
    ).toMatchObject({ baselineFormat: 4, hasNativeBinding: true });
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

it("retains Knex format5 without inventing SQL Insights", () => {
  expect(
    api.snapshotObservation({
      baseline: { formatVersion: 5, nativeMigrations: { kind: "knex" } },
      migrationInsights: { state: "unavailable" },
    }),
  ).toMatchObject({
    baselineFormat: 5,
    hasNativeBinding: true,
    insightsAvailable: false,
  });
});

it("native Knex source selection uses only an actual pending reviewed.cjs identity", () => {
  const plan = knexPlan();
  expect(plan.targets[0]!.entries[1]).not.toHaveProperty(
    "workspaceRelativePath",
  );
  expect(api.knexReviewedCandidate(plan)).toBe(plan.targets[0]!.entries[1]);
  for (const update of [
    { status: "represented_by_baseline" },
    { nativeIdentity: { kind: "drizzle", name: "200_change.cjs" } },
    { nativeIdentity: { kind: "knex", name: "other.cjs" } },
    { filename: "migration.sql" },
  ]) {
    const changed = structuredClone(plan);
    Object.assign(changed.targets[0]!.entries[1]!, update);
    expect(() => api.knexReviewedCandidate(changed)).toThrow();
  }
});

it("native launcher admits only explicit Knex review mode and preserves real-consumer argument isolation", () => {
  const values = [
    "vsix",
    "core-tar",
    "workspace",
    "code",
    "electron",
    "evidence",
  ]
    .map((key) => "--" + key + "=/Volumes/owned/" + key)
    .concat(
      ["vsix-sha", "core-sha", "electron-sha"].map(
        (key) => "--" + key + "=" + "a".repeat(64),
      ),
      ["--code-version=1.143.0"],
    );
  expect(
    parseNativeEditorAcceptanceArguments([
      ...values,
      "--migration-kind=knex",
    ]).get("migration-kind"),
  ).toBe("knex");
  expect(() =>
    parseNativeEditorAcceptanceArguments([
      ...values,
      "--migration-kind=unknown",
    ]),
  ).toThrow();
  expect(() =>
    parseNativeEditorAcceptanceArguments(
      [...values, "--migration-kind=knex"],
      "real-consumer",
    ),
  ).toThrow();
});
