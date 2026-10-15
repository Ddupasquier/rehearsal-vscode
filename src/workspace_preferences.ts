import { createHash } from "node:crypto";
import { isLocalEndpoint } from "./local_endpoint.js";

export const MIGRATION_SORTS = ["order", "name", "date", "target"] as const;
export type MigrationSort = (typeof MIGRATION_SORTS)[number];

export const WORKSPACE_PROFILES = ["full", "primary", "minimal"] as const;
export type WorkspaceProfile =
  (typeof WORKSPACE_PROFILES)[number] | `named:${string}`;

export interface WorkspacePreferences {
  readonly resourceQuery: string;
  readonly resourceKind: "all" | "environment" | "volume" | "image" | "other";
  readonly resourceState:
    | "all"
    | "running"
    | "stopped"
    | "candidate"
    | "protected"
    | "attached"
    | "detached";
  readonly resourceOwnership: "all" | "project" | "shared" | "other";
  readonly resourceSort: "name" | "size" | "age" | "activity";
  readonly migrationQuery: string;
  readonly migrationSort: MigrationSort;
  readonly selectedTarget: string;
  readonly migrationStatus:
    | "all"
    | "candidate"
    | "represented_by_baseline"
    | "applied_to_current_runtime";
  readonly migrationFrom: string;
  readonly migrationTo: string;
  readonly migrationWarning: "all" | "warnings";
  readonly applicationUrl: string;
  readonly profile: WorkspaceProfile;
}

export const DEFAULT_WORKSPACE_PREFERENCES: WorkspacePreferences =
  Object.freeze({
    resourceQuery: "",
    resourceKind: "all",
    resourceState: "all",
    resourceOwnership: "all",
    resourceSort: "name",
    migrationQuery: "",
    migrationSort: "order",
    selectedTarget: "all",
    migrationStatus: "all",
    migrationFrom: "",
    migrationTo: "",
    migrationWarning: "all",
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
    record.profile as (typeof WORKSPACE_PROFILES)[number],
  )
    ? (record.profile as WorkspaceProfile)
    : typeof record.profile === "string" &&
        record.profile.startsWith("named:") &&
        bounded(record.profile, 86)
      ? (record.profile as WorkspaceProfile)
      : "full";
  return {
    resourceQuery: bounded(record.resourceQuery, 120),
    resourceKind: (["all", "environment", "volume", "image", "other"].includes(
      String(record.resourceKind),
    )
      ? record.resourceKind
      : "all") as WorkspacePreferences["resourceKind"],
    resourceState: ([
      "all",
      "running",
      "stopped",
      "candidate",
      "protected",
      "attached",
      "detached",
    ].includes(String(record.resourceState))
      ? record.resourceState
      : "all") as WorkspacePreferences["resourceState"],
    resourceOwnership: (["all", "project", "shared", "other"].includes(
      String(record.resourceOwnership),
    )
      ? record.resourceOwnership
      : "all") as WorkspacePreferences["resourceOwnership"],
    resourceSort: (["name", "size", "age", "activity"].includes(
      String(record.resourceSort),
    )
      ? record.resourceSort
      : "name") as WorkspacePreferences["resourceSort"],
    migrationQuery: bounded(record.migrationQuery, 120),
    migrationSort,
    selectedTarget: bounded(record.selectedTarget, 120) || "all",
    migrationStatus: [
      "candidate",
      "represented_by_baseline",
      "applied_to_current_runtime",
    ].includes(String(record.migrationStatus))
      ? (record.migrationStatus as WorkspacePreferences["migrationStatus"])
      : "all",
    migrationFrom:
      typeof record.migrationFrom === "string" &&
      /^\d{4}-\d{2}-\d{2}$/u.test(record.migrationFrom)
        ? record.migrationFrom
        : "",
    migrationTo:
      typeof record.migrationTo === "string" &&
      /^\d{4}-\d{2}-\d{2}$/u.test(record.migrationTo)
        ? record.migrationTo
        : "",
    migrationWarning:
      record.migrationWarning === "warnings" ? "warnings" : "all",
    applicationUrl: bounded(record.applicationUrl, 500),
    profile,
  };
};

export const preferenceStorageKey = (workspaceKey: string): string =>
  `rehearsal.workspace.${createHash("sha256").update(workspaceKey).digest("hex").slice(0, 24)}`;

export const isLoopbackUrl = isLocalEndpoint;

export type WorkspaceMessage =
  | { readonly type: "reviewStaleStop" }
  | { readonly type: "editing"; readonly editing: boolean }
  | { readonly type: "cleanupImages"; readonly ids: unknown }
  | {
      readonly type: "resourceAction";
      readonly target: unknown;
      readonly action: unknown;
    }
  | {
      readonly type: "reviewResourceConfiguration";
      readonly target: unknown;
      readonly values: unknown;
    }
  | { readonly type: "navigate"; readonly page: string }
  | {
      readonly type: "preferences";
      readonly preferences: unknown;
    }
  | { readonly type: "openApplication"; readonly url: unknown }
  | {
      readonly type: "exportReport";
      readonly format: unknown;
      readonly leftId?: unknown;
      readonly rightId?: unknown;
    }
  | { readonly type: "resetLocalState" }
  | { readonly type: "reviewConfiguration"; readonly values: unknown };

export const parseWorkspaceMessage = (
  value: unknown,
): WorkspaceMessage | null => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const message = value as Record<string, unknown>;
  if (message.type === "reviewStaleStop") return { type: "reviewStaleStop" };
  if (message.type === "editing" && typeof message.editing === "boolean")
    return { type: "editing", editing: message.editing };
  if (message.type === "cleanupImages")
    return { type: "cleanupImages", ids: message.ids };
  if (message.type === "resourceAction")
    return {
      type: "resourceAction",
      target: message.target,
      action: message.action,
    };
  if (message.type === "reviewResourceConfiguration")
    return {
      type: "reviewResourceConfiguration",
      target: message.target,
      values: message.values,
    };
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
    return {
      type: "exportReport",
      format: message.format,
      ...(typeof message.leftId === "string" ? { leftId: message.leftId } : {}),
      ...(typeof message.rightId === "string"
        ? { rightId: message.rightId }
        : {}),
    };
  }
  if (message.type === "resetLocalState") {
    return { type: "resetLocalState" };
  }
  if (message.type === "reviewConfiguration") {
    return { type: "reviewConfiguration", values: message.values };
  }
  return null;
};
