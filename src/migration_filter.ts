/** Display only: filtering never changes a migration plan or approval digest. */
import type { WorkspacePreferences } from "./workspace_preferences.js";

export interface MigrationFilterEntry {
  readonly name: string;
  readonly sortName?: string;
  readonly target: string;
  readonly status: string;
  readonly version: string;
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
  const ordered = [...entries].sort((left, right) => {
    if (filters.sort === "name")
      return (left.sortName ?? left.name)
        .toLowerCase()
        .localeCompare((right.sortName ?? right.name).toLowerCase());
    if (filters.sort === "date")
      return left.version.localeCompare(right.version);
    if (filters.sort === "target")
      return (
        left.target.localeCompare(right.target) ||
        left.version.localeCompare(right.version)
      );
    return left.order - right.order;
  });
  const visible = ordered.filter((entry) => {
    const date = entry.version.slice(0, 8);
    return (
      filters.targets.includes(entry.target) &&
      (filters.status === "all" || filters.status === entry.status) &&
      (!query ||
        `${entry.name} ${entry.target} ${entry.version}`
          .toLowerCase()
          .includes(query)) &&
      (!from || date >= from) &&
      (!to || date <= to) &&
      (filters.warning !== "warnings" || entry.hasWarning)
    );
  });
  return { ordered, visible };
}
