import { describe, it, expect } from "vitest";
import { Script } from "node:vm";
import {
  parseEngineLifecycleStatus,
  parseEngineShutdownPreview,
  parseEngineShutdownResult,
  ENGINE_LIFECYCLE_REASON_LABELS,
} from "../src/engine_lifecycle_contract.js";
import {
  engineLifecycleMarkup,
  engineLifecyclePresentation,
  engineShutdownAvailable,
  engineShutdownUpdateFor,
  applyEngineShutdownUpdate,
  ENGINE_SHUTDOWN_UI_LABELS,
} from "../src/engine_lifecycle_view.js";
import { parseWorkspaceMessage } from "../src/workspace_preferences.js";
import { workspaceActionPlan } from "../src/action_catalog.js";
import {
  engineSnapshot,
  lifecycleStatus,
  lifecyclePreview,
  lifecycleResult,
} from "./engine_lifecycle_fixture.js";

describe("independent engine lifecycle contract", () => {
  it("keeps selected engine and stopped profile separate after global selection changes", () => {
    const report = parseEngineLifecycleStatus({
      ...lifecycleStatus(),
      selected: {
        state: "unavailable",
        context: "default",
        endpointIdentity: null,
        daemonId: null,
      },
      colimaDefault: {
        state: "stopped",
        profile: "default",
        shutdownSupported: false,
        reason: "profile-stopped",
      },
    });
    const view = engineLifecyclePresentation({
      ...engineSnapshot(),
      engineLifecycle: { state: "available", report },
    });
    expect(view.selected).toBe("Selected engine: unreachable");
    expect(view.profile).toBe("Colima profile: stopped");
  });
  it("rejects unknown fields, malformed bindings, unsafe side effects and duplicated impacts", () => {
    expect(() =>
      parseEngineLifecycleStatus({ ...lifecycleStatus(), raw: "SECRET" }),
    ).toThrow();
    expect(() =>
      parseEngineLifecycleStatus({
        ...lifecycleStatus(),
        safety: { ...lifecycleStatus().safety, enginesStarted: true },
      }),
    ).toThrow();
    expect(() =>
      parseEngineLifecycleStatus({
        ...lifecycleStatus(),
        selected: { ...lifecycleStatus().selected, daemonId: null },
      }),
    ).toThrow();
    const preview = lifecyclePreview();
    expect(parseEngineShutdownPreview(preview).engine?.vmIdentity).toBe(
      "c".repeat(64),
    );
    expect(() =>
      parseEngineShutdownPreview({
        ...preview,
        impact: {
          containers: [
            ...preview.impact.containers,
            ...preview.impact.containers,
          ],
          runningCount: 2,
        },
      }),
    ).toThrow();
    expect(() =>
      parseEngineShutdownPreview({ ...preview, consentDigest: null }),
    ).toThrow();
    expect(() =>
      parseEngineShutdownPreview({
        ...preview,
        engine: { ...preview.engine, vmIdentity: "process-1234" },
      }),
    ).toThrow();
  });
  it("requires both positive shutdown proofs and preserves partial already-stopped evidence", () => {
    expect(parseEngineShutdownResult(lifecycleResult()).status).toBe("stopped");
    expect(() =>
      parseEngineShutdownResult({
        ...lifecycleResult(),
        confirmed: { profileStopped: true, vmProcessAbsent: false },
      }),
    ).toThrow();
    expect(
      parseEngineShutdownResult({
        ...lifecycleResult(),
        status: "already-stopped",
        reason: "profile-stopped",
        confirmed: { profileStopped: true, vmProcessAbsent: false },
      }).confirmed.vmProcessAbsent,
    ).toBe(false);
    expect(() =>
      parseEngineShutdownResult({
        ...lifecycleResult(),
        status: "already-stopped",
        confirmed: { profileStopped: false, vmProcessAbsent: false },
      }),
    ).toThrow();
  });
  it("keeps shutdown visible without configuration, an old CLI or usable engine, with fixed guidance", () => {
    const current = engineSnapshot();
    expect(engineShutdownAvailable(current)).toBe(true);
    expect(workspaceActionPlan(current, "shutdownVm")?.kind).toBe(
      "review_engine_shutdown",
    );
    for (const state of [
      { state: "unsupported" as const },
      { state: "unavailable" as const },
    ]) {
      const snapshot = { ...current, engineLifecycle: state };
      const html = engineLifecycleMarkup(snapshot, "command:safe", true);
      expect(html).toContain("Shut down VM…");
      expect(html).toContain(" disabled");
      expect(html).not.toContain('href="command:safe"');
      expect(workspaceActionPlan(snapshot, "shutdownVm")).toBeNull();
    }
    expect(engineLifecycleMarkup(current, "command:safe", true)).not.toContain(
      " disabled",
    );
    expect(
      engineLifecycleMarkup(current, "command:safe", true, "running"),
    ).toContain("Waiting for its verified outcome");
    expect(
      engineLifecycleMarkup(current, "command:safe", true, "running"),
    ).toContain(" disabled");
  });
  it("never enables a busy, unsafe or unknown-activity shutdown and escapes context labels", () => {
    for (const availability of [
      "untrusted",
      "loading",
      "operation_active",
      "operation_attention",
    ] as const)
      expect(
        engineShutdownAvailable({ ...engineSnapshot(), availability }),
      ).toBe(false);
    expect(
      engineShutdownAvailable({
        ...engineSnapshot(),
        activity: undefined,
      } as never),
    ).toBe(false);
    const snapshot = {
      ...engineSnapshot(),
      engineLifecycle: {
        state: "available" as const,
        report: parseEngineLifecycleStatus({
          ...lifecycleStatus(),
          selected: {
            ...lifecycleStatus().selected,
            context: "<script>bad</script>",
          },
        }),
      },
    };
    const html = engineLifecycleMarkup(snapshot, "command:safe", true);
    expect(html).toContain("&lt;script&gt;");
    expect(html).not.toContain("<script>bad");
  });
});

it("patches fixed VM nodes without replacing dirty form values, focus or scroll", () => {
  class Node {
    textContent: string | null = "prior";
    tagName = "BUTTON";
    disabled = false;
    readonly attributes = new Map<string, string>();
    getAttribute(name: string) {
      return this.attributes.get(name) ?? null;
    }
    setAttribute(name: string, value: string) {
      this.attributes.set(name, value);
    }
    removeAttribute(name: string) {
      this.attributes.delete(name);
    }
  }
  const notices = [new Node(), new Node()],
    controls = [new Node(), new Node()],
    profiles = [new Node(), new Node()],
    selected = [new Node(), new Node()],
    regions = [new Node(), new Node()];
  const draft = { value: "unsaved configuration", focused: true },
    scroll = { top: 314 };
  const groups: Record<string, Node[]> = {
    "[data-engine-shutdown-notice]": notices,
    "[data-engine-shutdown-control]": controls,
    "[data-engine-shutdown-profile]": profiles,
    "[data-engine-shutdown-selected]": selected,
    "[data-engine-shutdown-region]": regions,
  };
  const doc = {
    querySelectorAll: (selector: string) => groups[selector] ?? [],
  };
  const labels = {
    outcomes: ENGINE_SHUTDOWN_UI_LABELS,
    reasons: ENGINE_LIFECYCLE_REASON_LABELS,
  };
  const pending = engineShutdownUpdateFor(engineSnapshot(), "running");
  expect(
    new Script(
      `(${applyEngineShutdownUpdate.toString()})(document,payload,labels)`,
    ).runInNewContext({ document: doc, payload: pending, labels }),
  ).toBe(true);
  expect(controls.every((node) => node.disabled)).toBe(true);
  expect(notices[0]?.textContent).toContain("Waiting for its verified outcome");
  expect(regions[0]?.getAttribute("aria-busy")).toBe("true");
  const report = lifecycleStatus();
  const complete = {
    ...engineSnapshot(),
    engineLifecycle: {
      state: "available" as const,
      report: parseEngineLifecycleStatus({
        ...report,
        selected: {
          state: "unavailable",
          context: "default",
          endpointIdentity: null,
          daemonId: null,
        },
        colimaDefault: {
          state: "stopped",
          profile: "default",
          shutdownSupported: false,
          reason: "profile-stopped",
        },
      }),
    },
  };
  expect(
    applyEngineShutdownUpdate(
      doc,
      engineShutdownUpdateFor(complete, "confirmed"),
      labels,
    ),
  ).toBe(true);
  expect(profiles[0]?.textContent).toBe("Colima profile: stopped");
  expect(selected[0]?.textContent).toBe("Selected engine: unreachable");
  expect(controls.every((node) => node.disabled)).toBe(true);
  expect(notices[0]?.textContent).toContain("Last shutdown confirmed");
  const prior = notices[0]?.textContent;
  expect(
    applyEngineShutdownUpdate(doc, { ...pending, state: "SECRET" }, labels),
  ).toBe(false);
  expect(
    applyEngineShutdownUpdate(
      doc,
      { ...pending, rawProviderText: "SECRET" },
      labels,
    ),
  ).toBe(false);
  expect(notices[0]?.textContent).toBe(prior);
  expect(draft).toEqual({ value: "unsaved configuration", focused: true });
  expect(scroll.top).toBe(314);
});

it("provides unique description associations on both surfaces and only a fixed shutdown review message", () => {
  const snapshot = {
    ...engineSnapshot(),
    engineLifecycle: { state: "unsupported" as const },
  };
  const markup =
    engineLifecycleMarkup(snapshot, "command:safe", true) +
    engineLifecycleMarkup(snapshot, "command:safe", false);
  const ids = [...markup.matchAll(/ id="([^"]+)"/gu)].map((match) => match[1]);
  expect(ids).toEqual([
    "engine-shutdown-header-description",
    "engine-shutdown-resources-description",
  ]);
  expect(new Set(ids).size).toBe(2);
  for (const id of ids) expect(markup).toContain(`aria-describedby="${id}"`);
  expect(parseWorkspaceMessage({ type: "reviewVmShutdown" })).toEqual({
    type: "reviewVmShutdown",
  });
  expect(
    parseWorkspaceMessage({ type: "reviewVmShutdown", command: "docker stop" }),
  ).toBeNull();
});
