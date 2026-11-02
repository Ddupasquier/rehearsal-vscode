import { describe, expect, it } from "vitest";
import { parseStaleStopReview } from "../../src/review/stale_review.js";

const configured = [{ target: "primary", projectId: "example-rehearsal" }];
const fixture = () => ({
  mode: "preview",
  plan: {
    schemaVersion: 1,
    action: "stop-stale",
    digest: "a".repeat(64),
    engineIdentity: "b".repeat(64),
    projectRootSha256: "c".repeat(64),
    context: "colima",
    preserves: [
      "database contents",
      "Storage contents",
      "containers",
      "volumes",
      "images",
      "immutable baselines",
      "shared engine",
      "other projects",
    ],
    targets: [
      {
        target: "primary",
        projectId: "example-rehearsal",
        provider: "postgresql",
        displayName: "Example sandbox",
        configurationSha256: "d".repeat(64),
        staleAfterSeconds: 3600,
        lastObservableActivityAt: "2026-01-01T00:00:00Z",
        containers: [
          {
            id: "e".repeat(64),
            running: true,
            startedAt: "2026-01-01T00:00:00Z",
            finishedAt: null as string | null,
          },
        ],
      },
    ],
  },
});
describe("exact stale-stop review", () => {
  it("keeps proven names, exact digest and counts without exporting technical paths or raw payload", () => {
    const result = parseStaleStopReview(fixture(), configured);
    expect(result.targets).toEqual([
      {
        target: "primary",
        projectId: "example-rehearsal",
        displayName: "Example sandbox",
        containerCount: 1,
        lastActivityAt: "2026-01-01T00:00:00Z",
      },
    ]);
    expect(result.digest).toBe("a".repeat(64));
    expect(
      parseStaleStopReview(
        { ...fixture(), plan: { ...fixture().plan, targets: [] } },
        configured,
      ).targets,
    ).toEqual([]);
  });
  it("refuses changed ownership, duplicate target/container bindings and truncated IDs", () => {
    for (const mutate of [
      (input: ReturnType<typeof fixture>) => {
        input.plan.targets[0]!.projectId = "foreign";
      },
      (input: ReturnType<typeof fixture>) => {
        input.plan.targets.push(input.plan.targets[0]!);
      },
      (input: ReturnType<typeof fixture>) => {
        input.plan.targets[0]!.containers.push(
          input.plan.targets[0]!.containers[0]!,
        );
      },
      (input: ReturnType<typeof fixture>) => {
        input.plan.targets[0]!.containers[0]!.id = "123abc";
      },
      (input: ReturnType<typeof fixture>) => {
        input.plan.digest = "truncated";
      },
    ]) {
      const input = fixture();
      mutate(input);
      expect(() => parseStaleStopReview(input, configured)).toThrow();
    }
  });
  it("refuses unsafe operation promises, missing preservation and unverifiable activity", () => {
    for (const mutate of [
      (input: ReturnType<typeof fixture>) => {
        input.mode = "applied";
      },
      (input: ReturnType<typeof fixture>) => {
        input.plan.action = "delete";
      },
      (input: ReturnType<typeof fixture>) => {
        input.plan.preserves.pop();
      },
      (input: ReturnType<typeof fixture>) => {
        input.plan.targets[0]!.containers[0]!.running = false;
      },
      (input: ReturnType<typeof fixture>) => {
        input.plan.targets[0]!.lastObservableActivityAt = "invalid";
      },
      (input: ReturnType<typeof fixture>) => {
        input.plan.targets[0]!.lastObservableActivityAt =
          "2999-01-01T00:00:00Z";
      },
      (input: ReturnType<typeof fixture>) => {
        input.plan.targets[0]!.lastObservableActivityAt =
          "2025-01-01T00:00:00Z";
      },
      (input: ReturnType<typeof fixture>) => {
        input.plan.targets[0]!.containers[0]!.finishedAt = "invalid";
      },
      (input: ReturnType<typeof fixture>) => {
        input.plan.targets[0]!.staleAfterSeconds = 0;
      },
    ]) {
      const input = fixture();
      mutate(input);
      expect(() => parseStaleStopReview(input, configured)).toThrow();
    }
  });
});
