import { createHash } from "node:crypto";

export interface WorkspaceActivityRecord {
  readonly id: string;
  readonly label: string;
  readonly startedAt: string;
  readonly finishedAt: string | null;
  readonly outcome:
    "running" | "completed" | "failed" | "cancelled" | "unverified";
  readonly exitCode: number | null;
}

export const activityStorageKey = (workspaceKey: string): string =>
  `rehearsal.activity.${createHash("sha256").update(workspaceKey).digest("hex").slice(0, 24)}`;

const isTimestamp = (value: unknown): value is string =>
  typeof value === "string" &&
  /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,3})?Z$/u.test(value) &&
  Number.isFinite(Date.parse(value));

export const normalizeActivityHistory = (
  value: unknown,
): readonly WorkspaceActivityRecord[] => {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  return value
    .slice(0, 100)
    .filter(
      (entry): entry is Record<string, unknown> =>
        Boolean(entry) && typeof entry === "object" && !Array.isArray(entry),
    )
    .flatMap((entry) => {
      const outcome = entry.outcome;
      if (
        typeof entry.id !== "string" ||
        !/^[A-Za-z0-9:_-]{1,120}$/u.test(entry.id) ||
        seen.has(entry.id) ||
        typeof entry.label !== "string" ||
        typeof entry.startedAt !== "string" ||
        !["running", "completed", "failed", "cancelled", "unverified"].includes(
          String(outcome),
        ) ||
        entry.label.length > 200 ||
        !entry.label.trim() ||
        /[\x00-\x1f\x7f]/u.test(entry.label) ||
        !isTimestamp(entry.startedAt)
      ) {
        return [];
      }
      const finishedAt = isTimestamp(entry.finishedAt)
        ? entry.finishedAt
        : null;
      const exitCode =
        typeof entry.exitCode === "number" &&
        Number.isSafeInteger(entry.exitCode) &&
        entry.exitCode >= 0 &&
        entry.exitCode <= 255
          ? entry.exitCode
          : null;
      // Earlier writers recorded terminal-close time without an observed exit.
      // Preserve only that exact legacy shape; the timestamp is not completion proof.
      const legacyUnverified =
        outcome === "unverified" &&
        entry.exitCode === null &&
        finishedAt !== null;
      if (
        (finishedAt && Date.parse(finishedAt) < Date.parse(entry.startedAt)) ||
        (outcome === "running" && (finishedAt !== null || exitCode !== null)) ||
        (outcome === "completed" && (finishedAt === null || exitCode !== 0)) ||
        (outcome === "failed" &&
          (finishedAt === null || exitCode === null || exitCode === 0)) ||
        (outcome === "cancelled" && finishedAt === null) ||
        (outcome === "unverified" &&
          (entry.exitCode !== null ||
            (entry.finishedAt !== null && !legacyUnverified)))
      )
        return [];
      seen.add(entry.id);
      return [
        {
          id: entry.id,
          label: entry.label,
          startedAt: entry.startedAt,
          finishedAt: legacyUnverified ? null : finishedAt,
          outcome: outcome as WorkspaceActivityRecord["outcome"],
          exitCode,
        },
      ];
    })
    .slice(0, 20);
};

/** A receipt is not a live process handle. Lost ownership never grants cancellation. */
export const reconcileActivityHistory = (
  value: unknown,
  ownedRunningIds: ReadonlySet<string>,
): readonly WorkspaceActivityRecord[] =>
  normalizeActivityHistory(value).map((record) =>
    record.outcome === "running" && !ownedRunningIds.has(record.id)
      ? { ...record, outcome: "unverified", finishedAt: null, exitCode: null }
      : record,
  );
