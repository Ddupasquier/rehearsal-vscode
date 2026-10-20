import { Script } from "node:vm";
import { describe, expect, it } from "vitest";
import {
  RESOURCE_MANAGER_SCRIPT,
  SUMMARY_LIST_SCRIPT,
  resourceManagerMarkup,
} from "../src/resource_manager_view.js";
import { parseResourceInventoryData } from "../src/contracts.js";
import { DEFAULT_WORKSPACE_PREFERENCES } from "../src/workspace_preferences.js";
import { reconcileImageSelection } from "../src/workspace_view_state.js";

const kinds = ["environment", "volume", "image", "other"] as const;
type Kind = (typeof kinds)[number];
const summaryKinds = [
  "targets",
  "resource-targets",
  "baselines",
  "baseline-evidence",
] as const;
type SummaryKind = (typeof summaryKinds)[number];

/** Executes the actual exported controller. This is not rendered-browser evidence. */
class ResourceNode {
  value = "";
  hidden = false;
  disabled = false;
  checked = false;
  replaceCalls = 0;
  textContent = "";
  parentElement: ResourceNode | null = null;
  readonly children: ResourceNode[] = [];
  readonly attributes = new Map<string, string>();
  readonly listeners = new Map<string, (() => void)[]>();
  constructor(readonly dataset: Record<string, string> = {}) {}
  addEventListener(name: string, listener: () => void) {
    this.listeners.set(name, [...(this.listeners.get(name) ?? []), listener]);
  }
  fire(name: string) {
    this.listeners.get(name)?.forEach((listener) => listener());
  }
  click() {
    if (!this.disabled && !this.hidden) this.fire("click");
  }
  change(value: string) {
    this.value = value;
    this.fire("change");
  }
  input(value: string) {
    this.value = value;
    this.fire("input");
  }
  setAttribute(name: string, value: string) {
    this.attributes.set(name, value);
  }
  closest(selector: string): ResourceNode | null {
    if (selector !== "[data-resource-row]") return null;
    return this.dataset.kind
      ? this
      : (this.parentElement?.closest(selector) ?? null);
  }
  replaceChildren(...children: ResourceNode[]) {
    this.replaceCalls++;
    this.children.forEach((child) => (child.parentElement = null));
    this.children.splice(0, this.children.length, ...children);
    children.forEach((child) => (child.parentElement = this));
  }
}

const harness = (
  counts: Partial<Record<Kind, number>> = {},
  savedUi: Record<string, unknown> = {},
  disabledImageIndexes: readonly number[] = [],
  withoutLists = false,
  summaryCounts: Partial<Record<SummaryKind, number>> = {},
) => {
  const ids = new Map<string, ResourceNode>();
  const node = (id: string, dataset: Record<string, string> = {}) => {
    const value = new ResourceNode(dataset);
    ids.set("#" + id, value);
    return value;
  };
  for (const id of [
    "resource-search",
    "resource-kind",
    "resource-state",
    "resource-ownership",
    "resource-sort",
    "resource-page-size",
    "resource-largest",
    "resource-visible-count",
    "resources-empty",
    "image-selection-summary",
    "select-eligible-images",
    "clear-image-selection",
    "review-image-cleanup",
  ])
    node(id);
  ids.get("#resource-kind")!.value = "all";
  ids.get("#resource-state")!.value = "all";
  ids.get("#resource-ownership")!.value = "all";
  ids.get("#resource-sort")!.value = "name";
  const rows = Object.fromEntries(
    kinds.map((kind) => [
      kind,
      Array.from({ length: counts[kind] ?? 13 }, (_, index) => {
        const row = new ResourceNode({
          kind,
          name: `${kind}-${String(index).padStart(3, "0")}`,
          state: kind === "image" ? "candidate" : "stopped",
          ownership:
            kind === "image"
              ? "shared"
              : kind === "other"
                ? "other"
                : "project",
          viewTarget: ["environment", "volume"].includes(kind)
            ? index % 2 === 0
              ? "primary"
              : "publication"
            : "",
          size: String((index + 1) * 1024 ** 2),
          created: String(index + 1),
          last: String(index + 1),
        });
        if (kind === "image") {
          const checkbox = new ResourceNode({
            imageId: `sha256:${(index + 1).toString(16).padStart(64, "0")}`,
            imageBytes: row.dataset.size!,
          });
          checkbox.disabled = disabledImageIndexes.includes(index);
          if (checkbox.disabled) row.dataset.state = "in-use";
          row.replaceChildren(checkbox);
        }
        return row;
      }),
    ]),
  ) as Record<Kind, ResourceNode[]>;
  const lists = {} as Record<Kind, ResourceNode>;
  const sections = {} as Record<Kind, ResourceNode>;
  const pagingButtons: ResourceNode[] = [];
  for (const kind of kinds) {
    const list = new ResourceNode({ resourceList: kind });
    list.replaceChildren(...rows[kind]);
    lists[kind] = list;
    const section = new ResourceNode({ resourceSection: kind });
    sections[kind] = section;
    node(`resource-${kind}-pagination`);
    node(`resource-${kind}-range`);
    node(`resource-${kind}-empty`);
    const previous = node(`resource-${kind}-previous`, {
      resourcePageKind: kind,
      resourcePageAction: "previous",
    });
    const next = node(`resource-${kind}-next`, {
      resourcePageKind: kind,
      resourcePageAction: "next",
    });
    new ResourceNode().replaceChildren(previous, next);
    pagingButtons.push(previous, next);
  }
  const summaryRows = {} as Record<SummaryKind, ResourceNode[]>;
  const summaryLists = {} as Record<SummaryKind, ResourceNode>;
  const summaryButtons: ResourceNode[] = [];
  for (const kind of summaryKinds) {
    const list = new ResourceNode({ summaryList: kind });
    const rows = Array.from(
      { length: summaryCounts[kind] ?? 0 },
      (_, index) =>
        new ResourceNode({
          summaryRow: kind,
          summaryTarget:
            kind === "targets" || kind === "resource-targets"
              ? index % 2 === 0
                ? "primary"
                : "publication"
              : "",
        }),
    );
    list.replaceChildren(...rows);
    summaryRows[kind] = rows;
    summaryLists[kind] = list;
    node(`summary-${kind}-pagination`);
    node(`summary-${kind}-range`);
    node(`summary-${kind}-empty`);
    const previous = node(`summary-${kind}-previous`, {
      summaryPageKind: kind,
      summaryPageAction: "previous",
    });
    const next = node(`summary-${kind}-next`, {
      summaryPageKind: kind,
      summaryPageAction: "next",
    });
    new ResourceNode().replaceChildren(previous, next);
    summaryButtons.push(previous, next);
  }
  const allRows = kinds.flatMap((kind) => rows[kind]);
  const imageCheckboxes = rows.image.map((row) => row.children[0]!);
  const messages: unknown[] = [];
  let scope = { targets: ["primary", "publication"], onlyProjectOwned: false };
  const context: Record<string, unknown> = {
    document: {
      querySelector(selector: string) {
        if (ids.has(selector)) return ids.get(selector);
        for (const kind of kinds) {
          if (selector === `[data-resource-list="${kind}"]`)
            return withoutLists ? null : lists[kind];
          if (selector === `[data-resource-section="${kind}"]`)
            return withoutLists ? null : sections[kind];
        }
        for (const kind of summaryKinds)
          if (selector === `[data-summary-list="${kind}"]`)
            return summaryLists[kind];
        return null;
      },
      querySelectorAll(selector: string) {
        if (selector === "[data-resource-row]") return allRows;
        if (selector === "[data-image-id]") return imageCheckboxes;
        if (selector === "[data-resource-page-action]") return pagingButtons;
        if (selector === "[data-summary-row]")
          return summaryKinds.flatMap((kind) => summaryRows[kind]);
        if (selector === "[data-summary-page-action]") return summaryButtons;
        return [];
      },
    },
    vscode: { postMessage: (message: unknown) => messages.push(message) },
    savedUi,
    preferences: {},
    currentViewScope: () => scope,
    reconcileImageSelection,
    rememberUi: () => {},
    savePreferences: () => messages.push({ type: "preferences" }),
  };
  new Script(
    RESOURCE_MANAGER_SCRIPT +
      SUMMARY_LIST_SCRIPT +
      "\nglobalThis.controller={resourcePaging,updateResourceView};",
  ).runInNewContext(context, { timeout: 1000 });
  const controller = context.controller as {
    resourcePaging: {
      pageSize: number;
      pages: Record<Kind, number>;
      summaryPages: Record<SummaryKind, number>;
    };
    updateResourceView(): void;
  };
  return {
    ids,
    lists,
    rows,
    sections,
    imageCheckboxes,
    summaryRows,
    summaryLists,
    messages,
    controller,
    setScope(next: typeof scope) {
      scope = next;
      controller.updateResourceView();
    },
    control: (id: string) => ids.get("#" + id)!,
  };
};

describe("resource list pagination", () => {
  it("bounds database targets, compact resource summaries, and both baseline lists independently", () => {
    const f = harness({}, {}, [], false, {
      targets: 13,
      "resource-targets": 13,
      baselines: 23,
      "baseline-evidence": 23,
    });
    for (const kind of summaryKinds)
      expect(f.summaryLists[kind].children).toHaveLength(5);
    f.control("summary-targets-next").click();
    expect(f.summaryLists.targets.children).toEqual(
      f.summaryRows.targets.slice(5, 10),
    );
    expect(f.summaryLists["resource-targets"].children).toEqual(
      f.summaryRows["resource-targets"].slice(0, 5),
    );
    f.control("summary-baselines-next").click();
    expect(f.summaryLists.baselines.children).toEqual(
      f.summaryRows.baselines.slice(5, 10),
    );
    expect(f.summaryLists["baseline-evidence"].children).toEqual(
      f.summaryRows["baseline-evidence"].slice(0, 5),
    );
    expect(f.control("summary-baselines-range").textContent).toContain(
      "6–10 of 23 baseline versions",
    );
    f.control("resource-page-size").change("10");
    for (const kind of summaryKinds) {
      expect(f.summaryLists[kind].children).toHaveLength(10);
      expect(f.controller.resourcePaging.summaryPages[kind]).toBe(0);
    }
    expect(
      f.messages.every(
        (message) => (message as { type: string }).type === "preferences",
      ),
    ).toBe(true);
  });

  it("scopes the complete cached target lists before slicing, without narrowing baseline evidence", () => {
    const f = harness({}, {}, [], false, {
      targets: 13,
      "resource-targets": 13,
      baselines: 23,
    });
    f.control("summary-targets-next").click();
    f.control("summary-resource-targets-next").click();
    f.setScope({ targets: ["primary"], onlyProjectOwned: true });
    for (const kind of ["targets", "resource-targets"] as const) {
      expect(f.summaryLists[kind].children).toEqual(
        f.summaryRows[kind].filter((_, index) => index % 2 === 0).slice(0, 5),
      );
      expect(f.control(`summary-${kind}-range`).textContent).toContain(
        "1–5 of 7",
      );
      expect(f.controller.resourcePaging.summaryPages[kind]).toBe(0);
    }
    expect(f.control("summary-baselines-range").textContent).toContain(
      "1–5 of 23",
    );
    f.setScope({ targets: [], onlyProjectOwned: true });
    expect(f.control("summary-targets-empty").hidden).toBe(false);
    expect(f.control("summary-targets-pagination").hidden).toBe(true);
    expect(f.summaryLists.targets.children).toHaveLength(0);
    f.setScope({ targets: ["publication"], onlyProjectOwned: false });
    expect(f.summaryLists.targets.children).toHaveLength(5);
    expect(f.control("summary-targets-range").textContent).toContain(
      "1–5 of 6",
    );
  });

  it("restores and clamps independent summary pages, then shares row-size changes", () => {
    const f = harness(
      {},
      {
        resourcePageSize: 10,
        resourceSummaryPages: {
          targets: 999,
          baselines: 1,
          "resource-targets": -1,
          "baseline-evidence": "1",
        },
      },
      [],
      false,
      {
        targets: 13,
        "resource-targets": 1,
        baselines: 23,
        "baseline-evidence": 23,
      },
    );
    expect(f.controller.resourcePaging.summaryPages).toEqual({
      targets: 1,
      "resource-targets": 0,
      baselines: 1,
      "baseline-evidence": 0,
    });
    expect(f.summaryLists.targets.children).toHaveLength(3);
    expect(f.summaryLists.baselines.children).toEqual(
      f.summaryRows.baselines.slice(10, 20),
    );
    f.control("resource-page-size").change("25");
    expect(f.summaryLists.targets.children).toHaveLength(13);
    expect(f.summaryLists.baselines.children).toHaveLength(23);
    expect(f.controller.resourcePaging.summaryPages.baselines).toBe(0);
    expect(f.control("summary-targets-previous").parentElement!.hidden).toBe(
      true,
    );
  });

  it("renders labeled native page-size and independent accessible paging controls", () => {
    const markup = resourceManagerMarkup(
      parseResourceInventoryData({
        schemaVersion: 1,
        inspectedAt: "2026-10-18T12:00:00Z",
        engine: {
          state: "running",
          context: "default",
          disk: null,
          resources: [],
        },
        environments: [],
        stale: { stoppedCount: 0, digest: "a".repeat(64), targets: [] },
        catalog: {
          schemaVersion: 1,
          images: [],
          volumes: [],
          otherContainers: [],
        },
      }),
      DEFAULT_WORKSPACE_PREFERENCES,
    );
    expect(markup).toContain('<select id="resource-page-size">');
    for (const kind of kinds) {
      expect(markup).toContain(`data-resource-list="${kind}"`);
      expect(markup).toContain(`id="resource-${kind}-previous"`);
      expect(markup).toContain(`id="resource-${kind}-next"`);
      expect(markup).toContain(`id="resource-${kind}-range"`);
    }
    expect(
      markup.match(/aria-live="polite" aria-atomic="true"/gu),
    ).toHaveLength(4);
  });

  it("bounds every list to five attached cards and pages each category independently", () => {
    const f = harness();
    for (const kind of kinds) {
      expect(f.lists[kind].children).toEqual(f.rows[kind].slice(0, 5));
      expect(f.control(`resource-${kind}-previous`).disabled).toBe(true);
      expect(f.control(`resource-${kind}-range`).textContent).toContain(
        "1–5 of 13",
      );
      expect(f.rows[kind][5]!.parentElement).toBeNull();
    }
    const unchangedEnvironmentReplacements = f.lists.environment.replaceCalls;
    f.control("resource-volume-next").click();
    expect(f.lists.volume.children).toEqual(f.rows.volume.slice(5, 10));
    expect(f.lists.image.children).toEqual(f.rows.image.slice(0, 5));
    expect(f.lists.environment.replaceCalls).toBe(
      unchangedEnvironmentReplacements,
    );
    f.control("resource-volume-next").click();
    expect(f.lists.volume.children).toEqual(f.rows.volume.slice(10));
    expect(f.control("resource-volume-range").textContent).toContain(
      "11–13 of 13",
    );
    expect(f.control("resource-volume-next").disabled).toBe(true);
    f.control("resource-volume-next").click();
    expect(f.controller.resourcePaging.pages.volume).toBe(2);
    f.control("resource-volume-previous").click();
    expect(f.controller.resourcePaging.pages.volume).toBe(1);
    expect(
      f.messages.every(
        (message) => (message as { type: string }).type === "preferences",
      ),
    ).toBe(true);
  });

  it("filters and sorts the entire cached inventory before slicing, then resets pages", () => {
    const f = harness();
    f.control("resource-volume-next").click();
    f.control("resource-sort").change("size");
    expect(f.lists.volume.children[0]).toBe(f.rows.volume[12]);
    expect(f.controller.resourcePaging.pages.volume).toBe(0);
    f.control("resource-image-next").click();
    f.control("resource-search").input("volume-012");
    expect(f.lists.volume.children).toEqual([f.rows.volume[12]]);
    expect(f.lists.image.children).toHaveLength(0);
    expect(f.control("resource-volume-range").textContent).toContain(
      "1–1 of 1",
    );
    expect(f.controller.resourcePaging.pages.image).toBe(0);
    expect(f.control("resource-volume-previous").parentElement!.hidden).toBe(
      true,
    );
    f.control("resource-search").input("");
    f.control("resource-volume-next").click();
    f.control("resource-state").change("candidate");
    expect(f.lists.image.children).toHaveLength(5);
    expect(f.lists.volume.children).toHaveLength(0);
    f.control("resource-state").change("all");
    f.control("resource-ownership").change("other");
    expect(f.lists.other.children).toHaveLength(5);
    expect(f.lists.image.children).toHaveLength(0);
  });

  it("applies project scope before paging and resets pages when the view changes", () => {
    const f = harness();
    f.control("resource-volume-next").click();
    f.setScope({ targets: ["primary"], onlyProjectOwned: true });
    expect(f.lists.volume.children).toEqual(
      f.rows.volume.filter((_, index) => index % 2 === 0).slice(0, 5),
    );
    expect(f.control("resource-volume-range").textContent).toContain(
      "1–5 of 7",
    );
    expect(f.controller.resourcePaging.pages.volume).toBe(0);
    expect(f.lists.image.children).toHaveLength(0);
    expect(f.lists.other.children).toHaveLength(0);
    f.control("resource-kind").change("volume");
    f.control("resource-search").input("missing");
    expect(f.sections.volume.hidden).toBe(false);
    expect(f.control("resource-volume-empty").hidden).toBe(false);
    expect(f.control("resources-empty").hidden).toBe(false);
    expect(f.control("resource-volume-pagination").hidden).toBe(true);
  });

  it("restores bounded page state and clamps pages to a smaller fresh inventory", () => {
    const f = harness(
      { volume: 13 },
      {
        resourcePageSize: 10,
        resourcePages: {
          volume: 9999,
          image: -1,
          environment: "2",
          other: 0.5,
        },
      },
    );
    expect(f.controller.resourcePaging.pageSize).toBe(10);
    expect(f.control("resource-page-size").value).toBe("10");
    expect(f.controller.resourcePaging.pages).toEqual({
      environment: 0,
      volume: 1,
      image: 0,
      other: 0,
    });
    expect(f.lists.volume.children).toEqual(f.rows.volume.slice(10));
    for (const value of ["5", "10", "25"]) {
      f.control("resource-page-size").change(value);
      expect(f.controller.resourcePaging.pages.volume).toBe(0);
      expect(f.lists.volume.children).toHaveLength(Math.min(Number(value), 13));
    }
    f.control("resource-page-size").change("1000000");
    expect(f.controller.resourcePaging.pageSize).toBe(5);
    expect(
      harness({}, { resourcePageSize: 1000000 }).controller.resourcePaging
        .pageSize,
    ).toBe(5);
  });

  it("keeps cached form drafts and listeners intact when their card leaves the DOM", () => {
    const f = harness();
    const first = f.rows.environment[0]!;
    const draft = new ResourceNode();
    draft.value = "My unsaved sandbox label";
    let calls = 0;
    draft.addEventListener("change", () => calls++);
    first.replaceChildren(draft);
    f.control("resource-environment-next").click();
    expect(first.parentElement).toBeNull();
    f.control("resource-environment-previous").click();
    expect(f.lists.environment.children[0]).toBe(first);
    expect(first.children[0]!.value).toBe("My unsaved sandbox label");
    first.children[0]!.fire("change");
    expect(calls).toBe(1);
  });

  it("selects only current-page eligible images and retains off-page selections explicitly", () => {
    const f = harness({}, {}, [0]);
    f.control("select-eligible-images").click();
    expect(f.imageCheckboxes.filter((input) => input.checked)).toEqual(
      f.imageCheckboxes.slice(1, 5),
    );
    f.control("resource-image-next").click();
    expect(f.control("image-selection-summary").textContent).toContain(
      "4 outside current page or filters",
    );
    f.control("select-eligible-images").click();
    expect(f.imageCheckboxes.filter((input) => input.checked)).toHaveLength(9);
    f.control("resource-search").input("does-not-match");
    expect(f.control("image-selection-summary").textContent).toContain(
      "9 outside current page or filters",
    );
    expect(
      f.messages.every(
        (message) => (message as { type: string }).type === "preferences",
      ),
    ).toBe(true);
    f.control("clear-image-selection").click();
    expect(f.imageCheckboxes.some((input) => input.checked)).toBe(false);
    expect(f.control("review-image-cleanup").disabled).toBe(true);
  });

  it("keeps the hundred-image bulk cap across pages and ignores stale or unsafe restored IDs", () => {
    const savedIds = Array.from(
      { length: 99 },
      (_, index) => `sha256:${(index + 1).toString(16).padStart(64, "0")}`,
    );
    const f = harness(
      { image: 130 },
      { images: savedIds, resourcePages: { image: 20 } },
    );
    f.control("select-eligible-images").click();
    expect(f.imageCheckboxes.filter((input) => input.checked)).toHaveLength(
      100,
    );
    f.control("resource-image-next").click();
    f.control("select-eligible-images").click();
    expect(f.imageCheckboxes.filter((input) => input.checked)).toHaveLength(
      100,
    );
    expect(f.control("review-image-cleanup").disabled).toBe(false);
    const restored = harness(
      { image: 13 },
      { images: [savedIds[0], savedIds[1], `sha256:${"f".repeat(64)}`] },
      [0],
    );
    expect(restored.imageCheckboxes.filter((input) => input.checked)).toEqual([
      restored.imageCheckboxes[1],
    ]);
  });

  it("handles empty inventories and older DOM doubles without list containers", () => {
    const empty = harness({ environment: 0, volume: 0, image: 0, other: 0 });
    for (const kind of kinds) {
      expect(empty.control(`resource-${kind}-pagination`).hidden).toBe(true);
      expect(empty.control(`resource-${kind}-empty`).textContent).toContain(
        "were observed",
      );
    }
    const f = harness(
      { environment: 1, volume: 1, image: 1, other: 0 },
      {},
      [],
      true,
    );
    f.control("resource-search").input("image");
    expect(f.rows.image[0]!.hidden).toBe(false);
    expect(f.rows.environment[0]!.hidden).toBe(true);
    expect(f.rows.volume[0]!.hidden).toBe(true);
  });
});
