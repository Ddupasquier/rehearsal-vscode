import { describe, expect, it } from "vitest";
import {
  isLoopbackUrl,
  normalizeWorkspacePreferences,
  parseWorkspaceMessage,
  preferenceStorageKey,
} from "../../src/workspace/workspace_preferences.js";

describe("workspace preferences", () => {
  it("opens migration evidence using only a closed opaque operation ID, never a supplied path or position", () => {
    const operationId = "a".repeat(64);
    expect(
      parseWorkspaceMessage({ type: "openMigrationFailure", operationId }),
    ).toEqual({ type: "openMigrationFailure", operationId });
    for (const invalid of [
      {
        type: "openMigrationFailure",
        operationId,
        path: "/private/secret.sql",
      },
      { type: "openMigrationFailure", operationId, line: 1 },
      { type: "openMigrationFailure", operationId: "not-an-operation" },
      { type: "openMigrationFailure", operationId: [operationId] },
    ])
      expect(parseWorkspaceMessage(invalid)).toBeNull();
  });
  it("keeps bounded harmless project preferences", () => {
    expect(
      normalizeWorkspacePreferences({
        migrationQuery: "accounts",
        migrationSort: "target",
        selectedTarget: "publication",
        migrationStatus: "candidate",
        applicationUrl: "http://localhost:5175",
        profile: "primary",
      }),
    ).toEqual({
      resourceQuery: "",
      resourceKind: "all",
      resourceState: "all",
      resourceOwnership: "all",
      resourceSort: "name",
      migrationQuery: "accounts",
      migrationSort: "target",
      selectedTarget: "publication",
      migrationStatus: "candidate",
      migrationFrom: "",
      migrationTo: "",
      migrationWarning: "all",
      applicationUrl: "http://localhost:5175",
      profile: "primary",
    });
  });

  it("rejects non-loopback URLs and does not expose the workspace path in its key", () => {
    expect(isLoopbackUrl("http://127.0.0.1:5175/auth")).toBe(true);
    expect(isLoopbackUrl("https://example.com")).toBe(false);
    expect(isLoopbackUrl("http://user:secret@localhost:5175")).toBe(false);
    expect(preferenceStorageKey("file:///private/project")).not.toContain(
      "private",
    );
  });

  it("accepts only the closed reset-editor-state message", () => {
    expect(parseWorkspaceMessage({ type: "resetLocalState" })).toEqual({
      type: "resetLocalState",
    });
    expect(
      parseWorkspaceMessage({ type: "resetLocalState", command: "rm -rf" }),
    ).toEqual({ type: "resetLocalState" });
    expect(parseWorkspaceMessage({ type: "resetEverything" })).toBeNull();
  });
});
