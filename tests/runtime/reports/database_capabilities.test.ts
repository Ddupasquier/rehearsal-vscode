import { describe, expect, it } from "vitest";
import {
  parseDatabaseCapabilities,
  supportsDatabaseFeature,
} from "../../../src/runtime/reports/database_capabilities.js";
import { parseRuntimeStatus } from "../../../src/contracts.js";
import { parseBaselineInspectionData } from "../../../src/review/contracts/review_contract.js";
import {
  sqliteBaselineEngine,
  sqliteCapabilities,
} from "./database_capabilities_fixture.js";

describe("negotiated database capabilities", () => {
  it("accepts the exact SQLite scope and keeps Auth/Storage inapplicable", () => {
    const report = parseDatabaseCapabilities(sqliteCapabilities());
    expect(supportsDatabaseFeature(report, "restore")).toBe(true);
    expect(supportsDatabaseFeature(report, "auth")).toBe(false);
    expect(supportsDatabaseFeature(undefined, "restore")).toBe(false);
  });

  it.each([
    { backend: "container" },
    { engine: { family: "sqlite", service: "supabase", version: "3.53.4" } },
    { engine: { family: "sqlite", service: "sqlite", version: "latest" } },
    { extra: "unreviewed" },
    { schemaVersion: 2 },
  ])("refuses unknown or contradictory report metadata", (change) => {
    expect(() =>
      parseDatabaseCapabilities({ ...sqliteCapabilities(), ...change }),
    ).toThrow();
  });

  it("requires the entire fixed feature set and validated state/reason pairs", () => {
    const input = sqliteCapabilities();
    const { cleanup: _cleanup, ...missing } = input.capabilities;
    expect(() =>
      parseDatabaseCapabilities({ ...input, capabilities: missing }),
    ).toThrow();
    for (const feature of [
      { state: "unknown", reason: "qualified", scope: "sqlite-v1" },
      { state: "supported", reason: "observation_missing", scope: "sqlite-v1" },
      {
        state: "supported",
        reason: "qualified",
        scope: "/private/file.sqlite",
      },
    ])
      expect(() =>
        parseDatabaseCapabilities({
          ...input,
          capabilities: { ...input.capabilities, restore: feature },
        }),
      ).toThrow();
    expect(() =>
      parseDatabaseCapabilities({
        ...input,
        capabilities: {
          ...input.capabilities,
          auth: input.capabilities.restore,
        },
      }),
    ).toThrow();
  });
});

const status = () => ({
  schemaVersion: 2,
  state: "running",
  reason: null,
  runtimeTarget: "sqlite",
  projectId: "sqlite-fixture",
  verifiedRuntimeAvailable: true,
  endpoint: { kind: "embedded-file", bindingSha256: "a".repeat(64) },
  baselineGenerationId: "sqlite-generation",
  candidateSha256: "b".repeat(64),
  candidates: [],
});

describe("SQLite status negotiation", () => {
  it("keeps schema2 unavailable without explicit target negotiation", () => {
    expect(() => parseRuntimeStatus(status())).toThrow();
    expect(parseRuntimeStatus(status(), { sqliteTarget: true })).toMatchObject({
      schemaVersion: 2,
      runtimeTarget: "sqlite",
      endpoint: { kind: "embedded-file" },
    });
  });

  it("rejects endpoint paths, mismatched schemas and service-specific reasons", () => {
    for (const change of [
      {
        endpoint: {
          kind: "embedded-file",
          bindingSha256: "a".repeat(64),
          path: "/private/db",
        },
      },
      { schemaVersion: 1 },
      { runtimeTarget: "postgresql" },
      {
        state: "unavailable",
        reason: "container_engine_unavailable",
        endpoint: null,
      },
    ])
      expect(() =>
        parseRuntimeStatus({ ...status(), ...change }, { sqliteTarget: true }),
      ).toThrow();
    expect(
      parseRuntimeStatus(
        {
          ...status(),
          state: "unavailable",
          reason: "sqlite_backend_unavailable",
          endpoint: null,
        },
        { sqliteTarget: true },
      ).state,
    ).toBe("unavailable");
  });
});

const baseline = () => ({
  formatVersion: 6,
  engine: sqliteBaselineEngine,
  generationId: "sqlite-generation",
  createdAt: "2026-11-03T00:00:00.000Z",
  migrationCutoff: null,
  rowCount: 3,
  tableCount: 1,
  migrationCount: 0,
  verification: "checksums_verified",
  sanitizationPolicySha256: "a".repeat(64),
  dataSha256: "b".repeat(64),
});

describe("SQLite baseline format", () => {
  it("requires the negotiated engine identity and preserves an empty history honestly", () => {
    expect(() => parseBaselineInspectionData(baseline(), "sqlite")).toThrow();
    const parsed = parseBaselineInspectionData(baseline(), "sqlite", {
      sqliteTarget: true,
    });
    expect(parsed.engine).toEqual(sqliteBaselineEngine);
    expect(parsed.migrationCutoff).toBeNull();
  });

  it("refuses cross-family, foreign codec and borrowed PostgreSQL review metadata", () => {
    expect(() =>
      parseBaselineInspectionData(baseline(), "postgresql", {
        sqliteTarget: true,
      }),
    ).toThrow();
    for (const change of [
      { engine: { ...sqliteBaselineEngine, codecVersion: 2 } },
      { engine: { ...sqliteBaselineEngine, version: "3.51.0" } },
      { migrationCount: 1 },
      { shape: null },
      { nativeMigrations: {} },
      { review: {} },
    ])
      expect(() =>
        parseBaselineInspectionData({ ...baseline(), ...change }, "sqlite", {
          sqliteTarget: true,
        }),
      ).toThrow();
  });

  it("keeps retained SQLite generations separate from Supabase Storage counts", () => {
    const current = baseline();
    const generation = { ...current, active: true };
    const parsed = parseBaselineInspectionData(
      { ...current, generations: [generation] },
      "sqlite",
      { sqliteTarget: true },
    );
    expect(parsed.generations?.[0]?.engine).toEqual(sqliteBaselineEngine);
    expect(parsed.generations?.[0]?.storageAssetCount).toBeUndefined();
    expect(() =>
      parseBaselineInspectionData(
        {
          ...current,
          generations: [{ ...generation, storageAssetCount: 1 }],
        },
        "sqlite",
        { sqliteTarget: true },
      ),
    ).toThrow();
  });
});
