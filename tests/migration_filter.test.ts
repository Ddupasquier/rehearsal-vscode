import { describe, expect, it } from "vitest";
import {
  selectMigrationView,
  type MigrationFilters,
} from "../src/migration_filter.js";

const entries = Object.freeze(
  [
    {
      id: "primary:1",
      name: "create_widgets.sql",
      target: "primary",
      status: "represented_by_baseline",
      version: "20261001000000",
      order: 0,
      hasWarning: false,
    },
    {
      id: "primary:2",
      name: "zebra_index.sql",
      target: "primary",
      status: "candidate",
      version: "20261003000000",
      order: 1,
      hasWarning: true,
    },
    {
      id: "publication:1",
      name: "alpha_table.sql",
      target: "publication",
      status: "applied_to_current_runtime",
      version: "20261002000000",
      order: 2,
      hasWarning: false,
    },
    {
      id: "publication:2",
      name: "beta_index.sql",
      target: "publication",
      status: "candidate",
      version: "20261004000000",
      order: 3,
      hasWarning: true,
    },
  ].map((entry) => Object.freeze(entry)),
);
const defaults: MigrationFilters = {
  query: "",
  targets: ["primary", "publication"],
  status: "all",
  sort: "order",
  from: "",
  to: "",
  warning: "all",
};
const ids = (changes: Partial<MigrationFilters> = {}) =>
  selectMigrationView(entries, { ...defaults, ...changes }).visible.map(
    ({ id }) => id,
  );

describe("shared migration display filtering", () => {
  it("sorts descriptive names independently of timestamp-prefixed filename search", () => {
    const rows = [
      { ...entries[1]!, name: "20261001000000_zebra.sql", sortName: "zebra" },
      { ...entries[3]!, name: "20261002000000_alpha.sql", sortName: "alpha" },
    ];
    const result = selectMigrationView(rows, { ...defaults, sort: "name" });
    expect(result.ordered.map(({ sortName }) => sortName)).toEqual([
      "alpha",
      "zebra",
    ]);
    expect(
      selectMigrationView(rows, {
        ...defaults,
        query: "20261001000000_zebra.sql",
      }).visible,
    ).toEqual([rows[0]]);
  });
  it("preserves exact migration input and dependency order while sorting only the display", () => {
    expect(ids()).toEqual([
      "primary:1",
      "primary:2",
      "publication:1",
      "publication:2",
    ]);
    expect(ids({ sort: "name" })).toEqual([
      "publication:1",
      "publication:2",
      "primary:1",
      "primary:2",
    ]);
    expect(ids({ sort: "date" })).toEqual([
      "primary:1",
      "publication:1",
      "primary:2",
      "publication:2",
    ]);
    expect(ids({ sort: "target" })).toEqual([
      "primary:1",
      "primary:2",
      "publication:1",
      "publication:2",
    ]);
    expect(entries.map(({ order }) => order)).toEqual([0, 1, 2, 3]);
  });
  it("combines target, status, warning, date and case-insensitive text filters", () => {
    expect(
      ids({
        targets: ["primary"],
        status: "candidate",
        warning: "warnings",
        query: "  ZEBRA  ",
        from: "2026-10-03",
        to: "2026-10-03",
      }),
    ).toEqual(["primary:2"]);
    expect(ids({ query: "PUBLICATION" })).toEqual([
      "publication:1",
      "publication:2",
    ]);
    expect(ids({ query: "20261002" })).toEqual(["publication:1"]);
    expect(ids({ from: "2026-10-02", to: "2026-10-03" })).toEqual([
      "primary:2",
      "publication:1",
    ]);
    expect(ids({ warning: "warnings" })).toEqual([
      "primary:2",
      "publication:2",
    ]);
    expect(ids({ status: "represented_by_baseline" })).toEqual(["primary:1"]);
    expect(ids({ status: "applied_to_current_runtime" })).toEqual([
      "publication:1",
    ]);
  });
  it("keeps unavailable targets and zero matches empty rather than widening execution or scope", () => {
    expect(ids({ targets: [] })).toEqual([]);
    expect(ids({ targets: ["retired"] })).toEqual([]);
    expect(ids({ query: "not present" })).toEqual([]);
    expect(ids({ from: "2026-10-04", to: "2026-10-01" })).toEqual([]);
    expect(selectMigrationView([], defaults)).toEqual({
      ordered: [],
      visible: [],
    });
    expect(selectMigrationView([entries[1]!], defaults).visible).toEqual([
      entries[1],
    ]);
  });
  it("handles the public 10000-entry boundary without mutating or truncating its input", () => {
    const many = Array.from({ length: 10000 }, (_, order) => ({
      ...entries[1]!,
      id: String(order),
      order,
    }));
    const result = selectMigrationView(many, {
      ...defaults,
      targets: ["primary"],
      status: "candidate",
    });
    expect(result.visible).toHaveLength(10000);
    expect(result.ordered[9999]!.order).toBe(9999);
    expect(result.ordered).not.toBe(many);
    expect(many[0]!.order).toBe(0);
  });
});
