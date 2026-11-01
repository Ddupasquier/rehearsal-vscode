import { describe, expect, it } from "vitest";
import {
  activityStorageKey,
  normalizeActivityHistory,
  reconcileActivityHistory,
} from "../../src/workspace/workspace_activity.js";

describe("workspace activity", () => {
  it("canonicalizes only the legacy unknown-exit receipt without claiming completion", () => {
    const legacy = {
      id: "legacy-unknown",
      label: "Run rehearsal",
      startedAt: "2026-10-13T12:00:00Z",
      finishedAt: "2026-10-13T12:01:00Z",
      outcome: "unverified",
      exitCode: null,
    };
    const canonical = { ...legacy, finishedAt: null };
    expect(normalizeActivityHistory([legacy])).toEqual([canonical]);
    expect(normalizeActivityHistory([canonical])).toEqual([canonical]);
    expect(reconcileActivityHistory([legacy], new Set([legacy.id]))).toEqual([
      canonical,
    ]);
    for (const invalid of [
      { ...legacy, finishedAt: "2026-10-13T11:59:00Z" },
      { ...legacy, finishedAt: "invalid" },
      { ...legacy, startedAt: "invalid" },
      { ...legacy, exitCode: 0 },
      { ...legacy, exitCode: 9 },
      { ...legacy, exitCode: 130 },
      { ...legacy, exitCode: "unknown" },
      { ...legacy, exitCode: undefined },
    ])
      expect(normalizeActivityHistory([invalid])).toEqual([]);
  });

  it("keeps only bounded, structurally valid activity records", () => {
    const valid = Array.from({ length: 25 }, (_, index) => ({
      id: `run-${index}`,
      label: `Run ${index}`,
      startedAt: "2026-10-11T12:00:00.000Z",
      finishedAt: "2026-10-11T12:01:00.000Z",
      outcome: "completed",
      exitCode: 0,
    }));

    const result = normalizeActivityHistory([
      ...valid,
      null,
      { id: "bad", label: "Bad", startedAt: "nope", outcome: "failed" },
    ]);

    expect(result).toHaveLength(20);
    expect(result[0]).toMatchObject({ id: "run-0", outcome: "completed" });
    expect(result.at(-1)?.id).toBe("run-19");
  });
  it("distinguishes live owned work from old receipts after an editor restart", () => {
    const records = ["owned", "previous-session"].map((id) => ({
      id,
      label: "Run rehearsal",
      startedAt: "2026-10-13T12:00:00Z",
      finishedAt: null,
      outcome: "running",
      exitCode: null,
    }));
    expect(reconcileActivityHistory(records, new Set(["owned"]))).toMatchObject(
      [
        { id: "owned", outcome: "running" },
        {
          id: "previous-session",
          outcome: "unverified",
          finishedAt: null,
          exitCode: null,
        },
      ],
    );
    expect(reconcileActivityHistory(records, new Set())).toMatchObject([
      { outcome: "unverified" },
      { outcome: "unverified" },
    ]);
  });
  it("drops invalid lifetimes and contradictory success/failure claims", () => {
    const record = {
      id: "safe-id",
      label: "Run rehearsal",
      startedAt: "2026-10-13T12:00:00Z",
      finishedAt: "2026-10-13T12:01:00Z",
      outcome: "completed",
      exitCode: 0,
    };
    expect(
      normalizeActivityHistory([
        record,
        { ...record, finishedAt: "2026-10-13T11:59:00Z" },
        { ...record, exitCode: 9 },
        { ...record, outcome: "failed", exitCode: 0 },
        { ...record, outcome: "running" },
        { ...record, id: "x".repeat(121) },
        { ...record, label: "private\nnew line" },
      ]),
    ).toEqual([record]);
  });
  it("bounds history, preserves known exits and never turns unknown work into a success", () => {
    const records = [
      {
        id: "unknown",
        label: "Run rehearsal",
        startedAt: "2026-10-13T12:00:00Z",
        finishedAt: null,
        outcome: "unverified",
        exitCode: null,
      },
      {
        id: "failed",
        label: "Run rehearsal",
        startedAt: "2026-10-13T12:00:00Z",
        finishedAt: "2026-10-13T12:01:00Z",
        outcome: "failed",
        exitCode: 9,
      },
    ];
    expect(reconcileActivityHistory(records, new Set())).toEqual(records);
    expect(activityStorageKey("file:///private/project-a")).not.toBe(
      activityStorageKey("file:///private/project-b"),
    );
  });

  it("does not expose the workspace path in its storage key", () => {
    expect(activityStorageKey("file:///private/project")).not.toContain(
      "private",
    );
  });
  it("deduplicates bounded receipts instead of exposing conflicting stale ownership", () => {
    const record = {
      id: "same-id",
      label: "Run rehearsal",
      startedAt: "2026-10-13T12:00:00Z",
      finishedAt: null,
      outcome: "running",
      exitCode: null,
    };
    expect(normalizeActivityHistory([record, record])).toHaveLength(1);
    expect(
      normalizeActivityHistory([
        ...Array.from({ length: 100 }, () => null),
        record,
      ]),
    ).toEqual([]);
  });
});
