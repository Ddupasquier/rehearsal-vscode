import { describe, expect, it } from "vitest";
import type { ProjectSnapshot } from "../src/project_snapshot.js";
import {
  knownWorkspaceTargets,
  resolveWorkspaceViewScope,
  reconcileImageSelection,
  reconcileMigrationReview,
  migrationReviewIdentity,
  MIGRATION_REVIEW_PERSISTENCE_LIMIT,
} from "../src/workspace_view_state.js";

const profiles = [
  {
    name: "Publication review",
    targets: ["publication"],
    applicationUrl: null,
  },
  {
    name: "Whole application",
    targets: ["primary", "publication"],
    applicationUrl: null,
  },
];
const targets = ["primary", "publication"];
const image = (letter: string) => `sha256:${letter.repeat(64)}`;

describe("harmless workspace display state", () => {
  it("accepts the exact review-memory boundary but refuses an oversized restored cache", () => {
    const ids = Array.from(
      { length: MIGRATION_REVIEW_PERSISTENCE_LIMIT },
      (_, index) => `primary:${index}`,
    );
    expect(reconcileMigrationReview(ids, "current", "current", ids)).toEqual(
      ids,
    );
    expect(
      reconcileMigrationReview(
        [...ids, "primary:extra"],
        "current",
        "current",
        ids,
      ),
    ).toEqual([]);
    expect(ids).toHaveLength(MIGRATION_REVIEW_PERSISTENCE_LIMIT);
  });
  it("applies named and explicit target scopes without changing input or plan identity", () => {
    const selection = {
      profile: "named:Publication review",
      selectedTarget: "all",
    };
    expect(
      resolveWorkspaceViewScope(targets, profiles, selection).targets,
    ).toEqual(["publication"]);
    expect(
      resolveWorkspaceViewScope(targets, profiles, {
        profile: "named:Whole application",
        selectedTarget: "primary",
      }).targets,
    ).toEqual(["primary"]);
    expect(selection).toEqual({
      profile: "named:Publication review",
      selectedTarget: "all",
    });
    expect(targets).toEqual(["primary", "publication"]);
  });

  it("explains conflicting scopes rather than pretending the wrong target is selected", () => {
    const scope = resolveWorkspaceViewScope(targets, profiles, {
      profile: "named:Publication review",
      selectedTarget: "primary",
    });
    expect(scope.targets).toEqual([]);
    expect(scope.warning).toContain("outside the selected profile");
    expect(scope.selectedTarget).toBe("primary");
  });

  it("recovers removed profiles/targets to proven current choices", () => {
    const removedProfile = resolveWorkspaceViewScope(targets, profiles, {
      profile: "named:Retired experiment",
      selectedTarget: "all",
    });
    expect(removedProfile.profile).toBe("full");
    expect(removedProfile.targets).toEqual(targets);
    expect(removedProfile.warning).toContain("no longer exists");
    const removedTarget = resolveWorkspaceViewScope(targets, profiles, {
      profile: "full",
      selectedTarget: "retired",
    });
    expect(removedTarget.selectedTarget).toBe("all");
    expect(removedTarget.warning).toContain("no longer available");
  });

  it("labels minimal as project-owned display only and never assumes a primary target", () => {
    expect(
      resolveWorkspaceViewScope(targets, profiles, {
        profile: "minimal",
        selectedTarget: "all",
      }),
    ).toMatchObject({ targets, onlyProjectOwned: true });
    expect(
      resolveWorkspaceViewScope(["publication"], profiles, {
        profile: "primary",
        selectedTarget: "all",
      }).targets,
    ).toEqual([]);
    expect(
      resolveWorkspaceViewScope([], [], {
        profile: "full",
        selectedTarget: "all",
      }).targets,
    ).toEqual([]);
  });

  it("collects only bounded configured metadata and does not read environment values", () => {
    const snapshot = {
      workspaceName: "Example",
      workspaceRoot: "/not-read",
      availability: "ready",
      candidates: {
        count: 0,
        digest: "a".repeat(64),
        files: [],
        targets: [
          { name: "primary", count: 0, configPath: "not-read" },
          { name: "../../unknown", count: 0, configPath: "not-read" },
        ],
      },
      configurationMetadata: {
        schemaVersion: 1,
        path: "rehearsal.config.mjs",
        sourceSha256: "b".repeat(64),
        fields: [],
        profiles,
        pathResolution: "Project root",
        manualFields: "Manual review",
      },
    } as ProjectSnapshot;
    expect(knownWorkspaceTargets(snapshot)).toEqual(targets);
  });

  it("restores only unique, currently eligible complete image IDs", () => {
    expect(
      reconcileImageSelection(
        [image("a"), image("b"), image("a"), "short-id", image("c")],
        [image("a"), image("b")],
      ),
    ).toEqual([image("a"), image("b")]);
    expect(reconcileImageSelection([image("a")], [])).toEqual([]);
    expect(reconcileImageSelection(null, [image("a")])).toEqual([]);
    expect(
      reconcileImageSelection(Array(101).fill(image("a")), [image("a")]),
    ).toEqual([]);
    expect(
      reconcileImageSelection(
        [`sha256:${"A".repeat(64)}`],
        [`sha256:${"A".repeat(64)}`],
      ),
    ).toEqual([]);
  });

  it("binds restored migration review to digest and every target baseline", () => {
    const snapshot = {
      workspaceName: "Example",
      workspaceRoot: "/not-read",
      availability: "ready",
      candidates: { count: 1, digest: "a".repeat(64), files: [], targets: [] },
      baseline: {
        generationId: "generation-one",
        rowCount: 1,
        tableCount: 1,
        migrationCount: 1,
        createdAt: null,
        verification: "checksums_verified",
      },
    } as ProjectSnapshot;
    const identity = migrationReviewIdentity(snapshot);
    expect(
      reconcileMigrationReview(
        ["primary:1", "missing", "primary:1"],
        identity,
        identity,
        ["primary:1"],
      ),
    ).toEqual(["primary:1"]);
    expect(
      reconcileMigrationReview(
        ["primary:1"],
        identity,
        migrationReviewIdentity({
          ...snapshot,
          baseline: { ...snapshot.baseline!, generationId: "generation-two" },
        }),
        ["primary:1"],
      ),
    ).toEqual([]);
    expect(
      reconcileMigrationReview(
        ["primary:1"],
        identity,
        migrationReviewIdentity({
          ...snapshot,
          candidates: { ...snapshot.candidates!, digest: "b".repeat(64) },
        }),
        ["primary:1"],
      ),
    ).toEqual([]);
    expect(
      reconcileMigrationReview(["primary:1"], undefined, identity, [
        "primary:1",
      ]),
    ).toEqual([]);
    expect(
      reconcileMigrationReview(
        Array(1001).fill("primary:1"),
        identity,
        identity,
        ["primary:1"],
      ),
    ).toEqual([]);
    const twoTargets: ProjectSnapshot = {
      ...snapshot,
      runtime: {
        state: "stopped",
        targets: ["primary", "publication"].map((name) => ({
          name,
          state: "stopped",
          reason: "runtime_not_running",
          runtimeTarget: "postgresql",
          baselineGenerationId: name + "-generation",
          verifiedRuntimeAvailable: true,
          endpoint: null,
        })),
      },
    };
    const changedPublication: ProjectSnapshot = {
      ...twoTargets,
      runtime: {
        ...twoTargets.runtime!,
        targets: twoTargets.runtime!.targets.map((target) =>
          target.name === "publication"
            ? { ...target, baselineGenerationId: "new-publication-generation" }
            : target,
        ),
      },
    };
    expect(
      reconcileMigrationReview(
        ["primary:1"],
        migrationReviewIdentity(twoTargets),
        migrationReviewIdentity(changedPublication),
        ["primary:1"],
      ),
    ).toEqual([]);
  });
});
