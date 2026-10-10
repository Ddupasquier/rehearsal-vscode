import { describe, expect, it } from "vitest";
import {
  ContractError,
  parseActivityData,
  parseEnvelope,
  parseJson,
  parseStatusData,
  parseVersionResult,
} from "../src/contracts.js";

describe("CLI contracts", () => {
  it("accepts the public version result", () => {
    expect(
      parseVersionResult({ name: "@rehearsal-db/core", version: "0.1.0-rc.1" }),
    ).toEqual({ name: "@rehearsal-db/core", version: "0.1.0-rc.1" });
  });

  it("rejects another package or result schema", () => {
    expect(() => parseVersionResult({ name: "other", version: "1" })).toThrow(
      ContractError,
    );
    expect(() => parseEnvelope({ schemaVersion: 2 }, "doctor")).toThrow(
      "Unsupported CLI result schema",
    );
  });

  it("accepts success, not-ready, and error envelopes", () => {
    const base = {
      schemaVersion: 1,
      rehearsalVersion: "0.1.0-rc.1",
      command: "doctor",
      startedAt: "2026-10-09T00:00:00.000Z",
      durationMs: 1,
      warnings: [],
      data: { state: "READY" },
    };
    expect(parseEnvelope({ ...base, status: "success" }, "doctor").status).toBe(
      "success",
    );
    expect(
      parseEnvelope({ ...base, status: "not_ready" }, "doctor").status,
    ).toBe("not_ready");
    expect(
      parseEnvelope(
        {
          schemaVersion: 1,
          rehearsalVersion: "0.1.0-rc.1",
          status: "error",
          error: {
            category: "configuration_invalid",
            code: "CONFIGURATION_INVALID",
            message: "Invalid configuration.",
            suggestions: ["Run rehearsal doctor."],
            diagnosticId: "abc123",
          },
        },
        "doctor",
      ).status,
    ).toBe("error");
  });

  it("rejects malformed JSON without echoing it", () => {
    expect(() => parseJson('{"secret":"do-not-repeat"')).toThrow(
      "Rehearsal returned malformed JSON.",
    );
    try {
      parseJson('{"secret":"do-not-repeat"');
    } catch (error) {
      expect(String(error)).not.toContain("do-not-repeat");
    }
  });

  it("accepts and sanitizes the public activity snapshot", () => {
    const activity = parseActivityData({
      schemaVersion: 1,
      state: "busy",
      operation: {
        kind: "run",
        startedAt: "2026-10-10T00:00:00.000Z",
        rehearsalVersion: "0.1.0-rc.2",
        pid: 12345,
        token: "private",
      },
    });

    expect(activity).toEqual({
      schemaVersion: 1,
      state: "busy",
      operation: {
        kind: "run",
        startedAt: "2026-10-10T00:00:00.000Z",
        rehearsalVersion: "0.1.0-rc.2",
      },
    });
    expect(activity.operation).not.toHaveProperty("pid");
    expect(activity.operation).not.toHaveProperty("token");
    expect(
      parseActivityData({ schemaVersion: 1, state: "idle", operation: null }),
    ).toMatchObject({ state: "idle", operation: null });
  });

  it("accepts credential-free single and multi-target runtime status", () => {
    const runtimeStatus = {
      schemaVersion: 1,
      state: "running",
      reason: null,
      runtimeTarget: "postgresql",
      projectId: "fixture-rehearsal",
      endpoint: {
        kind: "postgresql",
        host: "127.0.0.1",
        port: 55432,
        database: "postgres",
      },
      baselineGenerationId: "baseline-1",
      candidateSha256: "a".repeat(64),
      candidates: ["20261010000100_add_index.sql"],
    };
    const target = {
      action: "status",
      target: "primary",
      durationMs: 1,
      runtimeStatus,
      output: "human output is ignored",
    };

    expect(parseStatusData(target)).toMatchObject({
      target: "primary",
      runtimeStatus: { state: "running", runtimeTarget: "postgresql" },
    });
    expect(
      parseStatusData({
        action: "status",
        durationMs: 2,
        targets: [target, { ...target, target: "publication" }],
      }),
    ).toMatchObject({
      targets: [{ target: "primary" }, { target: "publication" }],
    });
  });

  it("rejects unsafe or contradictory structured state", () => {
    expect(() =>
      parseActivityData({
        schemaVersion: 1,
        state: "idle",
        operation: { kind: "run" },
      }),
    ).toThrow("must not include an operation");
    expect(() =>
      parseStatusData({
        action: "status",
        target: "primary",
        durationMs: 1,
        runtimeStatus: {
          schemaVersion: 1,
          state: "running",
          reason: null,
          runtimeTarget: "supabase",
          projectId: "fixture",
          endpoint: { kind: "http", url: "https://hosted.example.com" },
          baselineGenerationId: "baseline-1",
          candidateSha256: "a".repeat(64),
          candidates: [],
        },
      }),
    ).toThrow("loopback");
  });
});
