import { createHash } from "node:crypto";

export const MIGRATION_SORTS = ["order", "name", "date", "target"] as const;
export type MigrationSort = (typeof MIGRATION_SORTS)[number];

export const WORKSPACE_PROFILES = ["full", "primary", "minimal"] as const;
export type WorkspaceProfile = (typeof WORKSPACE_PROFILES)[number];

export interface WorkspacePreferences {
  readonly migrationQuery: string;
  readonly migrationSort: MigrationSort;
  readonly selectedTarget: string;
  readonly migrationStatus: "all" | "candidate";
  readonly applicationUrl: string;
  readonly profile: WorkspaceProfile;
}

export const DEFAULT_WORKSPACE_PREFERENCES: WorkspacePreferences =
  Object.freeze({
    migrationQuery: "",
    migrationSort: "order",
    selectedTarget: "all",
    migrationStatus: "all",
    applicationUrl: "",
    profile: "full",
  });

const bounded = (value: unknown, maximum: number): string =>
  typeof value === "string" &&
  value.length <= maximum &&
  !/[\r\n\0]/u.test(value)
    ? value
    : "";

export const normalizeWorkspacePreferences = (
  value: unknown,
): WorkspacePreferences => {
  const record =
    value && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  const migrationSort = MIGRATION_SORTS.includes(
    record.migrationSort as MigrationSort,
  )
    ? (record.migrationSort as MigrationSort)
    : "order";
  const profile = WORKSPACE_PROFILES.includes(
    record.profile as WorkspaceProfile,
  )
    ? (record.profile as WorkspaceProfile)
    : "full";
  return {
    migrationQuery: bounded(record.migrationQuery, 120),
    migrationSort,
    selectedTarget: bounded(record.selectedTarget, 120) || "all",
    migrationStatus:
      record.migrationStatus === "candidate" ? "candidate" : "all",
    applicationUrl: bounded(record.applicationUrl, 500),
    profile,
  };
};

export const preferenceStorageKey = (workspaceKey: string): string =>
  `rehearsal.workspace.${createHash("sha256").update(workspaceKey).digest("hex").slice(0, 24)}`;

export const isLoopbackUrl = (value: string): boolean => {
  try {
    const url = new URL(value);
    return (
      (url.protocol === "http:" || url.protocol === "https:") &&
      ["localhost", "127.0.0.1", "::1"].includes(url.hostname) &&
      url.username === "" &&
      url.password === ""
    );
  } catch {
    return false;
  }
};

export type WorkspaceMessage =
  | { readonly type: "navigate"; readonly page: string }
  | {
      readonly type: "preferences";
      readonly preferences: unknown;
    }
  | { readonly type: "openApplication"; readonly url: unknown }
  | { readonly type: "exportReport"; readonly format: unknown }
  | { readonly type: "resetLocalState" }
  | { readonly type: "reviewConfiguration"; readonly values: unknown };

export const parseWorkspaceMessage = (
  value: unknown,
): WorkspaceMessage | null => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const message = value as Record<string, unknown>;
  if (message.type === "navigate" && typeof message.page === "string") {
    return { type: "navigate", page: message.page };
  }
  if (message.type === "preferences") {
    return { type: "preferences", preferences: message.preferences };
  }
  if (message.type === "openApplication") {
    return { type: "openApplication", url: message.url };
  }
  if (message.type === "exportReport") {
    return { type: "exportReport", format: message.format };
  }
  if (message.type === "resetLocalState") {
    return { type: "resetLocalState" };
  }
  if (message.type === "reviewConfiguration") {
    return { type: "reviewConfiguration", values: message.values };
  }
  return null;
};
