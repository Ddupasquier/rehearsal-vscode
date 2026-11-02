import { describe, expect, it } from "vitest";
import { parseEnvironmentProvenance } from "../../src/runtime/resource_contract.js";
import { parseResourceInventoryData } from "../../src/contracts.js";
import { resourceManagerMarkup } from "../../src/runtime/resource_manager_view.js";
import { DEFAULT_WORKSPACE_PREFERENCES } from "../../src/workspace/workspace_preferences.js";

const provenance = {
  schemaVersion: 1,
  inspectorVersion: "0.1.0-rc.5",
  verification: "recorded-not-reverified",
  configuredPorts: [
    { service: "database", host: "127.0.0.1", port: 58322 },
    { service: "application", host: "[::1]", port: 5175 },
  ],
  runtime: {
    rehearsalVersion: "0.1.0-rc.4",
    versionReason: null,
    baselineGenerationId: "20261015T120000Z-abcdef123456",
    baselineDataSha256: "a".repeat(64),
    candidateSha256: "b".repeat(64),
    migrationReason: null,
  },
  runtimeReason: null,
};
const environment = {
  target: "primary",
  displayName: "QA <safe>",
  protected: false,
  projectId: "qa-rehearsal",
  provider: "postgresql",
  configPath: "/workspace/rehearsal.config.mjs",
  state: "stopped",
  containerCount: 1,
  runningContainerCount: 0,
  volumeCount: 1,
  diskUsageBytes: 1024,
  cpuPercent: null,
  memoryUsageBytes: null,
  memoryLimitBytes: null,
  createdAt: "2026-10-14T12:00:00Z",
  lastActivityAt: "2026-10-15T12:00:00Z",
  retention: "persistent",
  cleanupEligibility: "preview-required",
  restartPolicies: ["no"],
};
const inventory = (detail: unknown = provenance) =>
  parseResourceInventoryData({
    schemaVersion: 1,
    inspectedAt: "2026-10-15T13:00:00Z",
    engine: { state: "running", context: "default", disk: null, resources: [] },
    environments: [
      {
        ...environment,
        ...(detail === undefined ? {} : { provenance: detail }),
      },
    ],
    stale: { stoppedCount: 1, digest: "c".repeat(64), targets: ["primary"] },
    catalog: { schemaVersion: 1, images: [], volumes: [], otherContainers: [] },
  });

describe("environment provenance", () => {
  it("retains the versioned public projection across JSON and inventory normalization", () => {
    expect(parseEnvironmentProvenance(provenance)).toEqual(provenance);
    const result = inventory();
    expect(result.environments[0]?.provenance).toEqual(provenance);
    expect(
      parseResourceInventoryData(JSON.parse(JSON.stringify(result))),
    ).toEqual(result);
    expect(parseEnvironmentProvenance(undefined)).toBeUndefined();
  });
  it("keeps legacy and unavailable evidence explicit without inventing facts", () => {
    const legacy = {
      ...provenance,
      runtime: {
        ...provenance.runtime,
        rehearsalVersion: null,
        versionReason: "not-recorded",
        candidateSha256: null,
        migrationReason: "receipt-unavailable",
      },
    };
    expect(
      parseEnvironmentProvenance(legacy)?.runtime?.rehearsalVersion,
    ).toBeNull();
    for (const runtimeReason of ["receipt-unavailable", "receipt-invalid"]) {
      const parsed = parseEnvironmentProvenance({
        ...provenance,
        runtime: null,
        runtimeReason,
      });
      expect(parsed?.runtime).toBeNull();
    }
  });
  it("fails closed on unsupported, contradictory, private, malformed, or non-loopback metadata", () => {
    for (const invalid of [
      null,
      { ...provenance, schemaVersion: 2 },
      { ...provenance, verification: "verified" },
      { ...provenance, credentials: "SECRET" },
      {
        ...provenance,
        configuredPorts: [
          { service: "database", host: "db.production.example", port: 5432 },
        ],
      },
      {
        ...provenance,
        configuredPorts: [
          { service: "application", host: "localhost", port: 58322 },
          provenance.configuredPorts[0],
        ],
      },
      {
        ...provenance,
        configuredPorts: [{ service: "database", host: "127.0.0.1", port: 80 }],
      },
      {
        ...provenance,
        configuredPorts: [
          provenance.configuredPorts[0],
          provenance.configuredPorts[0],
        ],
      },
      { ...provenance, runtime: null, runtimeReason: null },
      { ...provenance, runtimeReason: "receipt-invalid" },
      {
        ...provenance,
        runtime: { ...provenance.runtime, databasePassword: "SECRET" },
      },
      {
        ...provenance,
        runtime: { ...provenance.runtime, rehearsalVersion: null },
      },
      {
        ...provenance,
        runtime: { ...provenance.runtime, candidateSha256: null },
      },
      {
        ...provenance,
        runtime: { ...provenance.runtime, baselineDataSha256: "SECRET" },
      },
      {
        ...provenance,
        runtime: {
          ...provenance.runtime,
          baselineGenerationId: "other target",
        },
      },
    ])
      expect(() => parseEnvironmentProvenance(invalid)).toThrow();
  });
  it("renders exact recorded facts and separates inspector version, verification and configured listening state", () => {
    const html = resourceManagerMarkup(
      inventory(),
      DEFAULT_WORKSPACE_PREFERENCES,
    );
    expect(html).toContain("QA &lt;safe&gt;");
    expect(html).toContain("Inspecting Rehearsal version");
    expect(html).toContain("Recorded runtime Rehearsal version");
    expect(html).toContain("0.1.0-rc.4");
    expect(html).toContain(provenance.runtime.baselineDataSha256);
    expect(html).toContain(provenance.runtime.candidateSha256);
    expect(html).toContain("application · [::1]:5175");
    expect(html).toContain("not a probe that these addresses are listening");
    expect(html).toContain("did not reverify database contents");
    expect(html).toContain("not a historical database copy");
    expect(html).toContain("Oldest owned resource created");
    expect(html).toContain("Last inspected");
    expect(html).not.toContain("/workspace/");
  });
  it("guides missing, legacy and mismatched receipts without substituting current baseline metadata", () => {
    const current = inventory();
    const { provenance: _omitted, ...olderEnvironment } =
      current.environments[0]!;
    expect(
      resourceManagerMarkup(
        { ...current, environments: [olderEnvironment] },
        DEFAULT_WORKSPACE_PREFERENCES,
      ),
    ).toContain("Not supplied by this core version");
    const missing = resourceManagerMarkup(
      inventory({
        ...provenance,
        runtime: null,
        runtimeReason: "receipt-unavailable",
      }),
      DEFAULT_WORKSPACE_PREFERENCES,
    );
    expect(missing).toContain("does not prove the database is absent");
    const legacy = resourceManagerMarkup(
      inventory({
        ...provenance,
        runtime: {
          ...provenance.runtime,
          rehearsalVersion: null,
          versionReason: "not-recorded",
          candidateSha256: null,
          migrationReason: "receipt-does-not-match-baseline",
        },
      }),
      DEFAULT_WORKSPACE_PREFERENCES,
    );
    expect(legacy).toContain("inspecting version is not its creator version");
    expect(legacy).toContain(
      "does not match this runtime's baseline and provider",
    );
  });
});
