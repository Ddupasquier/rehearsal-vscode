import { createHash } from "node:crypto";

export interface WorkspaceActivityRecord {
  readonly id: string;
  readonly label: string;
  readonly startedAt: string;
  readonly finishedAt: string | null;
  readonly outcome: "running" | "completed" | "failed" | "cancelled";
  readonly exitCode: number | null;
}

export const activityStorageKey = (workspaceKey: string): string =>
  `rehearsal.activity.${createHash("sha256").update(workspaceKey).digest("hex").slice(0, 24)}`;

export const normalizeActivityHistory = (
  value: unknown,
): readonly WorkspaceActivityRecord[] => {
  if (!Array.isArray(value)) return [];
  return value
    .filter(
      (entry): entry is Record<string, unknown> =>
        Boolean(entry) && typeof entry === "object" && !Array.isArray(entry),
    )
    .flatMap((entry) => {
      const outcome = entry.outcome;
      if (
        typeof entry.id !== "string" ||
        typeof entry.label !== "string" ||
        typeof entry.startedAt !== "string" ||
        !["running", "completed", "failed", "cancelled"].includes(
          String(outcome),
        ) ||
        entry.label.length > 200 ||
        !Number.isFinite(Date.parse(entry.startedAt))
      ) {
        return [];
      }
      return [
        {
          id: entry.id,
          label: entry.label,
          startedAt: entry.startedAt,
          finishedAt:
            typeof entry.finishedAt === "string" &&
            Number.isFinite(Date.parse(entry.finishedAt))
              ? entry.finishedAt
              : null,
          outcome: outcome as WorkspaceActivityRecord["outcome"],
          exitCode:
            typeof entry.exitCode === "number" &&
            Number.isSafeInteger(entry.exitCode)
              ? entry.exitCode
              : null,
        },
      ];
    })
    .slice(0, 20);
};
