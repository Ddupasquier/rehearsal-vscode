/** Display only: filtering never changes a migration plan or approval digest. */
import type { WorkspacePreferences } from "./workspace_preferences.js";

export interface MigrationFilterEntry {
  readonly name: string;
  readonly sortName?: string;
  readonly target: string;
  readonly status: string;
  readonly version?: string;
  readonly nativeIdentity?:
    | {
        readonly kind?: "drizzle";
        readonly idx: number;
        readonly when: number;
        readonly tag: string;
      }
    | { readonly kind: "knex"; readonly name: string };
  readonly order: number;
  readonly hasWarning: boolean;
}

export interface MigrationFilters {
  readonly query: string;
  readonly targets: readonly string[];
  readonly status: WorkspacePreferences["migrationStatus"];
  readonly sort: WorkspacePreferences["migrationSort"];
  readonly from: string;
  readonly to: string;
  readonly warning: WorkspacePreferences["migrationWarning"];
}

/** Self-contained for the packaged webview and installed-contract acceptance. */
export function selectMigrationView<T extends MigrationFilterEntry>(
  entries: readonly T[],
  filters: MigrationFilters,
): { ordered: T[]; visible: T[] } {
  const query = filters.query.trim().toLowerCase();
  const from = filters.from.replaceAll("-", "");
  const to = filters.to.replaceAll("-", "");
  const migrationTime = (entry: MigrationFilterEntry): number => {
    if (entry.nativeIdentity)
      return entry.nativeIdentity.kind === "knex"
        ? 0
        : entry.nativeIdentity.when;
    const v = entry.version ?? "";
    return /^\d{14}$/u.test(v)
      ? Date.UTC(
          Number(v.slice(0, 4)),
          Number(v.slice(4, 6)) - 1,
          Number(v.slice(6, 8)),
          Number(v.slice(8, 10)),
          Number(v.slice(10, 12)),
          Number(v.slice(12, 14)),
        )
      : 0;
  };
  const ordered = [...entries].sort((left, right) => {
    if (filters.sort === "name")
      return (left.sortName ?? left.name)
        .toLowerCase()
        .localeCompare((right.sortName ?? right.name).toLowerCase());
    if (filters.sort === "date")
      return migrationTime(left) - migrationTime(right);
    if (filters.sort === "target")
      return (
        left.target.localeCompare(right.target) ||
        migrationTime(left) - migrationTime(right)
      );
    return left.order - right.order;
  });
  const visible = ordered.filter((entry) => {
    const date =
      entry.nativeIdentity?.kind === "knex"
        ? ""
        : entry.nativeIdentity
          ? entry.nativeIdentity.when <= 8640000000000000
            ? new Date(entry.nativeIdentity.when)
                .toISOString()
                .slice(0, 10)
                .replaceAll("-", "")
            : ""
          : (entry.version ?? "").slice(0, 8);
    return (
      filters.targets.includes(entry.target) &&
      (filters.status === "all" || filters.status === entry.status) &&
      (!query ||
        `${entry.name} ${entry.target} ${entry.nativeIdentity ? (entry.nativeIdentity.kind === "knex" ? entry.nativeIdentity.name : `${entry.nativeIdentity.idx} ${entry.nativeIdentity.when} ${entry.nativeIdentity.tag}`) : (entry.version ?? "")}`
          .toLowerCase()
          .includes(query)) &&
      (!(from || to) || date !== "") &&
      (!from || date >= from) &&
      (!to || date <= to) &&
      (filters.warning !== "warnings" || entry.hasWarning)
    );
  });
  return { ordered, visible };
}
