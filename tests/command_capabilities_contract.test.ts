import { describe, it, expect } from "vitest";
import {
  parseCommandCapabilities,
  supportsOfflineInspection,
} from "../src/command_capabilities_contract.js";
import { commandCapabilitiesFixture } from "./command_capabilities_fixture.js";
describe("command capabilities public boundary", () => {
  it("separates permission to attempt offline reads from runtime and proof readiness", () => {
    const report = parseCommandCapabilities(commandCapabilitiesFixture());
    const observation = { state: "observed" as const, report };
    expect(
      supportsOfflineInspection(observation, ["explain", "inspect plan"]),
    ).toBe(true);
    expect(supportsOfflineInspection(observation, ["run"])).toBe(false);
    expect(supportsOfflineInspection(observation, ["inspect source"])).toBe(
      false,
    );
    expect(report.receipt.currentInputsMatch).toBe("unknown");
    expect(report.operations[1]?.availability).toBe("unknown");
  });
  it.each([
    "schema",
    "keys",
    "safety",
    "future-backend",
    "duplicate",
    "receipt-current",
    "receipt-invented-time",
    "oversize",
  ])("refuses %s", (change) => {
    const value = commandCapabilitiesFixture();
    if (change === "schema") value.schemaVersion = 2;
    if (change === "keys") Object.assign(value, { arbitrary: true });
    if (change === "safety") value.safety.enginesProbed = true;
    if (change === "future-backend") value.operations[0]!.backend = "automatic";
    if (change === "duplicate")
      value.operations.push({ ...value.operations[0]! });
    if (change === "receipt-current") value.receipt.currentInputsMatch = "true";
    if (change === "receipt-invented-time")
      Object.assign(value.receipt, { timestamp: "2026-10-27" });
    if (change === "oversize")
      value.operations[0]!.commands = Array.from(
        { length: 33 },
        (_, i) => `inspect ${i}`,
      );
    expect(() => parseCommandCapabilities(value)).toThrow();
  });
  it.each(["unsupported", "unknown", "not-applicable"])(
    "does not infer eligibility from %s support",
    (support) => {
      const value = commandCapabilitiesFixture();
      value.operations[0]!.supportState = support;
      expect(
        supportsOfflineInspection(
          { state: "observed", report: parseCommandCapabilities(value) },
          ["explain"],
        ),
      ).toBe(false);
    },
  );
  it("native Windows, unavailable rows and missing contracts do not gain offline project permission", () => {
    const value = commandCapabilitiesFixture();
    value.host.kind = "windows";
    value.host.runtimeHostQualified = false;
    expect(
      supportsOfflineInspection(
        { state: "observed", report: parseCommandCapabilities(value) },
        ["explain"],
      ),
    ).toBe(false);
    value.host.kind = "macos";
    value.host.runtimeHostQualified = true;
    value.operations[0]!.availability = "unavailable";
    expect(
      supportsOfflineInspection(
        { state: "observed", report: parseCommandCapabilities(value) },
        ["explain"],
      ),
    ).toBe(false);
    expect(
      supportsOfflineInspection({ state: "unsupported" }, ["explain"]),
    ).toBe(false);
  });
  it.each([
    "qualification_missing",
    "feature_unsupported",
    "version_unqualified",
  ])(
    "does not infer offline permission from contradictory reason %s",
    (reason) => {
      const value = commandCapabilitiesFixture();
      value.operations[0]!.reason = reason;
      expect(
        supportsOfflineInspection(
          { state: "observed", report: parseCommandCapabilities(value) },
          ["explain"],
        ),
      ).toBe(false);
    },
  );
  it("keeps an unobserved Node version ineligible even when a producer claims support", () => {
    const value = commandCapabilitiesFixture();
    Object.assign(value.node, { major: null, supported: true });
    expect(
      supportsOfflineInspection(
        { state: "observed", report: parseCommandCapabilities(value) },
        ["explain"],
      ),
    ).toBe(false);
  });
});
