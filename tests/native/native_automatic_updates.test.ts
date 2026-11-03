import { describe, expect, it } from "vitest";
import { execFile, spawn } from "node:child_process";
import { createRequire } from "node:module";
import {
  mkdtemp,
  mkdir,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { runInNewContext } from "node:vm";
import {
  assertAutomaticUpdateInstalledPayload,
  assertAutomaticUpdateExecutablePair,
  assertAutomaticUpdateFinalization,
  assertAutomaticUpdateReportBinding,
  assertAutomaticUpdateVersions,
  automaticUpdateInstalledManifest,
  automaticUpdateRuntimeRoot,
  automaticUpdateEnvironment,
  assertAutomaticUpdateMemoryPressure,
  automaticUpdateFailureMessage,
  AutomaticUpdatePreflightMemoryPressureError,
  parseAutomaticUpdateAcceptanceArguments,
  automaticUpdateLaneModes,
  runAutomaticUpdateLanes,
} from "../../scripts/native/verify-automatic-updates.js";
import {
  acquireExtensionUpdateReservation,
  readLoadedExtensionState,
  updateProcessState,
} from "../../src/updates/automatic/extension_update_reservation.js";

const nativeRequire = createRequire(__filename);
const ui = nativeRequire("../../scripts/native/native-update-ui.cjs") as {
  notificationButtonProbe(label: string): string;
  nativeDestinationProbe(destination: "extensions" | "settings"): string;
  parseOwnedDevtoolsPort(value: unknown): string;
  updatePhaseDeadline(phase: unknown, now?: number): number;
};
const fixtureEnvironment = nativeRequire(
  "../../scripts/native/native-update-reservation-worker.cjs",
) as {
  nativeUpdateEnvironment(
    source: NodeJS.ProcessEnv,
    storage: NodeJS.ProcessEnv,
    platform: NodeJS.Platform,
    display?: boolean,
  ): NodeJS.ProcessEnv;
};
const exactArguments = () =>
  ["candidate", "previous", "target", "code", "electron"]
    .map((name) => `--${name}=/owned/${name}`)
    .concat([
      ...["candidate", "previous", "target", "electron"].map(
        (name) => `--${name}-sha=${"a".repeat(64)}`,
      ),
      "--code-version=1.143.0",
    ]);
const buffer = (value: unknown) => Buffer.from(JSON.stringify(value));
const manifest = {
  publisher: "rehearsal-db",
  name: "rehearsal-db",
  version: "0.1.27",
};

type CdpTarget = { targetId: string; type: string; url: string };
const nativeViewport = {
  innerWidth: 1280,
  innerHeight: 900,
  getComputedStyle: (node: { hidden?: boolean }) => ({
    display: "block",
    visibility: node.hidden ? "hidden" : "visible",
  }),
};
function renderedSearchPanel(
  destination: "extensions" | "settings",
  query: string,
  offscreen = false,
  hidden = false,
) {
  const bounds = () => ({
    left: offscreen ? 1400 : 20,
    right: offscreen ? 1660 : 280,
    top: 50,
    bottom: 72,
    width: 260,
    height: 22,
  });
  // SuggestEnabledInput's Monaco text model renders token spans, independently
  // of its empty EditContext/textarea input proxy (pinned Code 1.143.0).
  const tokens = [
    { textContent: query.slice(0, 4) },
    { textContent: query.slice(4) },
  ];
  const line = {
    get textContent() {
      return tokens.map((token) => token.textContent).join("");
    },
    getBoundingClientRect: bounds,
  };
  const editor = {
    getBoundingClientRect: bounds,
    querySelectorAll: (selector: string) =>
      selector === ".view-lines .view-line" ? [line] : [],
  };
  const search =
    destination === "extensions"
      ? ".extensions-search-container .monaco-editor"
      : ".settings-header .search-container .monaco-editor";
  return {
    hidden,
    getBoundingClientRect: bounds,
    querySelectorAll: (selector: string) =>
      selector === search ? [editor] : [],
  };
}
async function fakeWorkbenchUi(
  snapshots: CdpTarget[][],
  abortAt?: number,
  responseMilliseconds = 0,
  interaction?: {
    wrongDestination?: boolean;
    ignoreFront?: boolean;
    phaseBudget?: number;
    consentDuringAction?: boolean;
    settingsModal?: "valid" | "missing" | "ambiguous" | "foreign" | "failed";
  },
) {
  let now = 0,
    queries = 0,
    closed = false;
  const controller = new AbortController();
  const requests: { method: string; params: Record<string, unknown> }[] = [];
  const diagnostics: Record<string, unknown>[] = [];
  const screenshots: string[] = [];
  const progressRecords: Record<string, unknown>[] = [];
  const phaseDeadlines = new Map<number, number>();
  const phases = [
    "blocked-extensions",
    "returned-extensions",
    "blocked-settings",
    "returned-settings",
    "done",
  ];
  let phaseIndex = 0,
    foreground = false,
    warning = true,
    entered = false,
    pairs = 0,
    destination = "";
  let modalOpen = false,
    modalCloses = 0,
    consentOpen = false,
    consentOffered = false,
    consentCloses = 0;
  const consentButton = {
    textContent: "Don't Ask Again",
    getAttribute: () => null,
    getBoundingClientRect: () => ({ width: 100, height: 20 }),
    focus: () => {
      document.activeElement = consentButton;
    },
  };
  const modalClose = {
    getBoundingClientRect: () => ({ width: 20, height: 20 }),
    getAttribute: (name: string) =>
      name === "aria-label" ? "Close Modal Editor (Escape)" : null,
    focus: () => {
      document.activeElement = modalClose;
    },
  };
  const modal = {
    getBoundingClientRect: () => ({ width: 100, height: 100 }),
    querySelectorAll: (selector: string) =>
      selector === ".settings-editor"
        ? interaction?.settingsModal === "foreign"
          ? []
          : [{ getBoundingClientRect: () => ({ width: 100, height: 100 }) }]
        : selector ===
            ".modal-editor-header .modal-editor-action-container .action-label.codicon-close"
          ? interaction?.settingsModal === "missing"
            ? []
            : interaction?.settingsModal === "ambiguous"
              ? [modalClose, modalClose]
              : [modalClose]
          : [],
  };
  const captures = new Map<number, number>();
  const button = {
    disabled: false,
    get textContent() {
      return phaseIndex === 0 ? "Open Extensions" : "Update Settings";
    },
    getAttribute: () => null,
    getBoundingClientRect: () => ({ width: 100, height: 20 }),
    focus: () => {
      document.activeElement = button;
    },
  };
  const document: {
    activeElement: unknown;
    hasFocus: () => boolean;
    querySelectorAll: (selector: string) => unknown[];
  } = {
    activeElement: undefined,
    hasFocus: () => foreground,
    querySelectorAll: (selector) =>
      selector === "[role=dialog],[role=alertdialog]" && consentOpen
        ? [
            {
              textContent: "Allow optional Rehearsal update checks?",
              querySelectorAll: () => [consentButton],
            },
          ]
        : selector === ".monaco-modal-editor-block"
          ? modalOpen
            ? [modal]
            : []
          : selector === ".notification-list-item" &&
              warning &&
              [0, 2].includes(phaseIndex)
            ? [
                {
                  textContent: "unverified reservation was preserved",
                  getBoundingClientRect: () => ({ width: 100, height: 100 }),
                  querySelectorAll: () => [button],
                },
              ]
            : ((selector === ".extensions-viewlet" && phaseIndex === 0) ||
                  (selector === ".settings-editor" && phaseIndex === 2)) &&
                destination
              ? [
                  renderedSearchPanel(
                    phaseIndex === 0 ? "extensions" : "settings",
                    destination,
                  ),
                ]
              : selector === "input,textarea" && destination
                ? [
                    {
                      value: "",
                      getBoundingClientRect: () => ({ width: 100, height: 20 }),
                    },
                  ]
                : [],
  };
  let timerId = 0;
  const timers = new Map<number, { end: number; run: () => void }>();
  class Socket {
    static OPEN = 1;
    readyState = 1;
    private listeners = new Map<string, (event: { data: string }) => void>();
    constructor(address: string) {
      expect(address).toBe("ws://127.0.0.1:12345/devtools/browser/owned-123");
    }
    addEventListener(
      name: string,
      callback: (event: { data: string }) => void,
    ) {
      this.listeners.set(name, callback);
    }
    close() {
      this.readyState = 3;
      closed = true;
    }
    send(input: string) {
      const request = JSON.parse(input);
      requests.push(request);
      let result: Record<string, unknown> =
        request.method === "Target.getTargets"
          ? {
              targetInfos: snapshots[Math.min(queries++, snapshots.length - 1)],
            }
          : request.method === "Target.attachToTarget"
            ? { sessionId: "owned-session" }
            : { result: { value: false } };
      if (interaction) {
        if (request.method === "Page.bringToFront")
          foreground = !interaction.ignoreFront;
        if (request.method === "Runtime.evaluate")
          result = {
            result: {
              value: runInNewContext(request.params.expression, {
                document,
                ...nativeViewport,
              }),
            },
          };
        if (request.method === "Page.captureScreenshot") {
          result = {
            data: Buffer.from("synthetic screenshot").toString("base64"),
          };
          const count = (captures.get(phaseIndex) ?? 0) + 1;
          captures.set(phaseIndex, count);
          if (count === 1)
            document.activeElement = {
              notification: "metadata arrived during capture",
            };
        }
        if (request.method === "Input.dispatchKeyEvent") {
          const key = request.params;
          if (document.activeElement === consentButton) {
            if (key.type === "keyDown")
              entered = foreground && key.key === "Enter";
            else if (key.type === "keyUp" && entered) {
              consentCloses++;
              consentOpen = false;
              entered = false;
            }
          } else if (document.activeElement === modalClose) {
            if (key.type === "keyDown")
              entered = key.key === "Enter" && foreground;
            else if (key.type === "keyUp" && entered) {
              modalCloses++;
              if (interaction.settingsModal !== "failed") modalOpen = false;
              entered = false;
            }
          } else if (key.type === "keyDown")
            entered =
              foreground &&
              document.activeElement === button &&
              key.key === "Enter" &&
              key.code === "Enter" &&
              key.windowsVirtualKeyCode === 13 &&
              key.modifiers === 0 &&
              key.text === "\r" &&
              key.unmodifiedText === "\r";
          else if (key.type === "keyUp" && entered) {
            expect(key).toEqual({
              type: "keyUp",
              key: "Enter",
              code: "Enter",
              windowsVirtualKeyCode: 13,
              modifiers: 0,
            });
            pairs++;
            warning = false;
            destination =
              phaseIndex === 0
                ? "@id:rehearsal-db.rehearsal-db"
                : "rehearsal.automaticUpdates";
            if (phaseIndex === 2 && interaction.settingsModal) modalOpen = true;
            if (interaction.wrongDestination)
              destination += " PRIVATE_INPUT_VALUE";
            entered = false;
          }
        }
      }
      queueMicrotask(() => {
        const end = now + responseMilliseconds;
        const due = [...timers.entries()].sort(
          (a, b) => a[1].end - b[1].end,
        )[0];
        if (due && due[1].end <= end) {
          now = due[1].end;
          timers.delete(due[0]);
          due[1].run();
          return;
        }
        now = end;
        this.listeners.get("message")?.({
          data: JSON.stringify({ id: request.id, result }),
        });
      });
    }
  }
  const api = {
    driveUpdateUi: undefined as unknown as (
      input: unknown,
    ) => Promise<unknown[]>,
  };
  const source = await readFile(
    resolve(__dirname, "../../scripts/native/native-update-ui.cjs"),
    "utf8",
  );
  runInNewContext(source, {
    exports: api,
    WebSocket: Socket,
    Buffer,
    URL,
    Date: { now: () => now },
    setTimeout: (run: () => void, milliseconds: number) => {
      const id = ++timerId;
      timers.set(id, { end: now + milliseconds, run });
      return id;
    },
    clearTimeout: (id: number) => timers.delete(id),
    require: (name: string) =>
      name === "node:fs/promises"
        ? {
            readFile: async (path: string) =>
              path.endsWith("DevToolsActivePort")
                ? "12345\n/devtools/browser/owned-123\n"
                : (() => {
                    if (!phaseDeadlines.has(phaseIndex))
                      phaseDeadlines.set(
                        phaseIndex,
                        now + (interaction?.phaseBudget ?? 30000),
                      );
                    return JSON.stringify({
                      phase: interaction ? phases[phaseIndex] : "done",
                      nonce: `11111111-1111-1111-1111-${String(phaseIndex).padStart(12, "0")}`,
                      deadline: phaseDeadlines.get(phaseIndex),
                    });
                  })(),
            writeFile: async (
              path: string,
              bytes: string | Uint8Array,
              options: unknown,
            ) => {
              if (path === "/owned/evidence/ui-progress.json.new") {
                const record = JSON.parse(String(bytes));
                progressRecords.push(record);
                if (
                  interaction?.consentDuringAction &&
                  !consentOffered &&
                  record.stage === "notification-button"
                ) {
                  consentOpen = true;
                  consentOffered = true;
                }
              } else if (path.endsWith(".png")) {
                expect(path.startsWith("/owned/evidence/")).toBe(true);
                screenshots.push(path);
              } else if (path === "/owned/root/ack.json.new") {
                expect(JSON.parse(String(bytes)).phase).toBe(
                  phases[phaseIndex],
                );
              } else {
                expect(
                  path === "/owned/evidence/workbench-readiness.json" ||
                    path === "/owned/evidence/blocked-extensions-failed.json",
                ).toBe(true);
                expect(options).toEqual({ mode: 0o600, flag: "wx" });
                diagnostics.push(JSON.parse(String(bytes)));
              }
            },
            rename: async (from: string, to: string) => {
              if (from === "/owned/evidence/ui-progress.json.new") {
                expect(to).toBe("/owned/evidence/ui-progress.json");
                return;
              }
              expect([from, to]).toEqual([
                "/owned/root/ack.json.new",
                "/owned/root/ack.json",
              ]);
              if (phaseIndex === 2) expect(modalOpen).toBe(false);
              phaseIndex++;
              warning = true;
              destination = "";
              document.activeElement = undefined;
            },
          }
        : name === "node:timers/promises"
          ? {
              setTimeout: async (milliseconds: number) => {
                now += milliseconds;
                if (abortAt !== undefined && now >= abortAt) controller.abort();
              },
            }
          : nativeRequire(name),
  });
  return {
    run: () =>
      api.driveUpdateUi({
        profile: "/owned/profile",
        root: "/owned/root",
        evidence: "/owned/evidence",
        signal: controller.signal,
        interactive: !!interaction,
      }),
    requests,
    diagnostics,
    screenshots,
    progressRecords,
    pairs: () => pairs,
    modalCloses: () => modalCloses,
    consentCloses: () => consentCloses,
    elapsed: () => now,
    closed: () => closed,
    pending: () => timers.size,
  };
}

describe("owned workbench CDP readiness", () => {
  const page = {
    targetId: "owned-page",
    type: "page",
    url: "vscode-file://vscode-app/owned/Code/resources/app/out/vs/code/electron-browser/workbench/workbench.html",
  };
  it("waits for a delayed actual CDP target before attaching once", async () => {
    const fixture = await fakeWorkbenchUi([[], [], [page]]);
    await expect(fixture.run()).resolves.toEqual([]);
    expect(fixture.elapsed()).toBe(200);
    expect(
      fixture.requests.filter((row) => row.method === "Target.attachToTarget"),
    ).toEqual([
      expect.objectContaining({
        params: { targetId: "owned-page", flatten: true },
      }),
    ]);
    expect(fixture.diagnostics).toEqual([]);
    expect(fixture.closed()).toBe(true);
  });
  it.each([
    { targets: [page, { ...page, targetId: "ambiguous-page" }] },
    {
      targets: [
        { ...page, url: "https://foreign.test/workbench?PRIVATE_TARGET_VALUE" },
      ],
    },
  ])(
    "refuses ambiguous or foreign workbenches without attaching",
    async ({ targets }) => {
      const fixture = await fakeWorkbenchUi([targets]);
      await expect(fixture.run()).rejects.toThrow();
      expect(
        fixture.requests.some((row) => row.method === "Target.attachToTarget"),
      ).toBe(false);
      expect(fixture.elapsed()).toBe(0);
      expect(fixture.diagnostics).toHaveLength(1);
      expect(JSON.stringify(fixture.diagnostics)).not.toContain(
        "PRIVATE_TARGET_VALUE",
      );
      expect(fixture.closed()).toBe(true);
    },
  );
  it("retains only bounded target-shape diagnostics at the existing thirty-second deadline", async () => {
    const fixture = await fakeWorkbenchUi([
      [
        {
          ...page,
          url: "vscode-file://vscode-app/PRIVATE_TARGET_VALUE/other.html",
        },
      ],
    ]);
    await expect(fixture.run()).rejects.toThrow(
      "Owned update UI observation incomplete",
    );
    expect(fixture.elapsed()).toBe(30000);
    expect(
      fixture.requests.some((row) => row.method === "Target.attachToTarget"),
    ).toBe(false);
    expect(fixture.diagnostics).toEqual([
      {
        status: "failed",
        scope: "owned-workbench-readiness",
        targets: 1,
        pages: 1,
        nativePages: 1,
        workbenches: 0,
        foreignWorkbenches: 0,
      },
    ]);
    expect(JSON.stringify(fixture.diagnostics)).not.toContain(
      "PRIVATE_TARGET_VALUE",
    );
    expect(fixture.closed()).toBe(true);
  });
  it("honors cancellation while no workbench is ready and never attaches later", async () => {
    const fixture = await fakeWorkbenchUi([[], [page]], 100);
    await expect(fixture.run()).rejects.toThrow();
    expect(fixture.elapsed()).toBe(100);
    expect(
      fixture.requests.filter((row) => row.method === "Target.getTargets"),
    ).toHaveLength(1);
    expect(
      fixture.requests.some((row) => row.method === "Target.attachToTarget"),
    ).toBe(false);
    expect(fixture.closed()).toBe(true);
  });
  it("bounds delayed CDP replies by the same readiness deadline and clears pending requests", async () => {
    const fixture = await fakeWorkbenchUi([[]], undefined, 10000);
    await expect(fixture.run()).rejects.toThrow(
      "Owned update CDP response incomplete",
    );
    expect(fixture.elapsed()).toBe(30000);
    expect(
      fixture.requests.filter((row) => row.method === "Target.getTargets"),
    ).toHaveLength(3);
    expect(
      fixture.requests.some((row) => row.method === "Target.attachToTarget"),
    ).toBe(false);
    expect(fixture.pending()).toBe(0);
    expect(fixture.closed()).toBe(true);
  });
});

describe("pinned native Monaco search oracle", () => {
  for (const destination of ["extensions", "settings"] as const) {
    const selector =
      destination === "extensions" ? ".extensions-viewlet" : ".settings-editor";
    const query =
      destination === "extensions"
        ? "@id:rehearsal-db.rehearsal-db"
        : "rehearsal.automaticUpdates";
    it(`reads the exact rendered ${destination} query even when its native input proxy is empty`, () => {
      const proxy = { value: "" };
      const panel = renderedSearchPanel(destination, query);
      const document = {
        querySelectorAll: (requested: string) =>
          requested === selector
            ? [panel]
            : requested === "input,textarea"
              ? [proxy]
              : [],
      };
      expect(proxy.value).not.toBe(query);
      expect(
        runInNewContext(ui.nativeDestinationProbe(destination), {
          document,
          ...nativeViewport,
        }),
      ).toEqual({
        matched: true,
        panels: 1,
        controls: 1,
        lines: 1,
        matchingQueries: 1,
      });
    });
    it.each([
      "wrong-query",
      "leading-space",
      "trailing-space",
      "offscreen",
      "hidden",
      "foreign-panel",
      "ambiguous-panel",
    ])(
      `refuses %s ${destination} evidence rather than matching another page input`,
      (kind) => {
        const actual =
          kind === "wrong-query"
            ? `${query}.other`
            : kind === "leading-space"
              ? ` ${query}`
              : kind === "trailing-space"
                ? `${query} `
                : query;
        const panel = renderedSearchPanel(
          destination,
          actual,
          kind === "offscreen",
          kind === "hidden",
        );
        const document = {
          querySelectorAll: (requested: string) =>
            requested === selector && kind !== "foreign-panel"
              ? kind === "ambiguous-panel"
                ? [panel, panel]
                : [panel]
              : requested === "input,textarea"
                ? [{ value: query }]
                : [],
        };
        const observed = runInNewContext(
          ui.nativeDestinationProbe(destination),
          { document, ...nativeViewport },
        );
        expect(observed.matched).toBe(false);
      },
    );
  }
});

describe("trusted native updater keyboard actions", () => {
  const page = {
    targetId: "owned-page",
    type: "page",
    url: "vscode-file://vscode-app/owned/Code/resources/app/out/vs/code/electron-browser/workbench/workbench.html",
  };
  it("fronts the owned page and dispatches complete Enter pairs after rechecking focus stolen by a notification", async () => {
    const fixture = await fakeWorkbenchUi([[page]], undefined, 0, {});
    const observations = await fixture.run();
    expect(observations.map((row) => (row as { phase: string }).phase)).toEqual(
      [
        "blocked-extensions",
        "returned-extensions",
        "blocked-settings",
        "returned-settings",
      ],
    );
    expect(fixture.pairs()).toBe(2);
    expect(
      fixture.requests.filter((row) => row.method === "Page.bringToFront"),
    ).toHaveLength(3);
    expect(
      fixture.requests.filter((row) => row.method === "Input.dispatchKeyEvent"),
    ).toHaveLength(4);
    expect(fixture.diagnostics).toEqual([]);
    expect(fixture.pending()).toBe(0);
    expect(fixture.progressRecords.at(-1)).toMatchObject({
      status: "passed",
      phase: "done",
      stage: "complete",
    });
  });
  it("handles the existing real consent action during an action wait under the same deadline", async () => {
    const fixture = await fakeWorkbenchUi([[page]], undefined, 0, {
      consentDuringAction: true,
    });
    await expect(fixture.run()).resolves.toHaveLength(4);
    expect(fixture.consentCloses()).toBe(1);
    expect(fixture.pairs()).toBe(2);
    expect(fixture.progressRecords.at(-1)).toMatchObject({
      status: "passed",
      phase: "done",
      stage: "complete",
      consentActionCount: 1,
    });
  });
  it("closes only the observed Settings modal through a focused native Enter before acknowledging return", async () => {
    const fixture = await fakeWorkbenchUi([[page]], undefined, 0, {
      settingsModal: "valid",
    });
    const observations = await fixture.run();
    expect(observations).toHaveLength(4);
    expect(fixture.modalCloses()).toBe(1);
    expect(fixture.pairs()).toBe(2);
    expect(fixture.pending()).toBe(0);
  });
  it.each(["missing", "ambiguous", "foreign", "failed"] as const)(
    "refuses %s Settings modal closure without acknowledging a return",
    async (kind) => {
      const fixture = await fakeWorkbenchUi([[page]], undefined, 0, {
        settingsModal: kind,
      });
      await expect(fixture.run()).rejects.toThrow();
      expect(fixture.modalCloses()).toBe(kind === "failed" ? 1 : 0);
      expect(
        fixture.screenshots.some((path) =>
          path.endsWith("returned-settings.png"),
        ),
      ).toBe(false);
      expect(fixture.pending()).toBe(0);
      if (kind === "failed") expect(fixture.elapsed()).toBe(28000);
    },
  );
  it("keeps exact destination proof strict and retains failure screenshot plus fixed state without input text", async () => {
    const fixture = await fakeWorkbenchUi([[page]], undefined, 0, {
      wrongDestination: true,
    });
    await expect(fixture.run()).rejects.toThrow(
      "Owned update UI observation incomplete",
    );
    expect(fixture.pairs()).toBe(1);
    expect(fixture.elapsed()).toBe(28000);
    expect(fixture.diagnostics).toEqual([
      {
        status: "failed",
        phase: "blocked-extensions",
        keyboardPairDispatched: true,
        pageFocused: true,
        warningVisible: false,
        actionFocused: false,
        visibleInputs: 1,
        matchingInputs: 0,
        nativeDestinationMatched: false,
        nativePanels: 1,
        nativeSearchControls: 1,
        nativeQueryLines: 1,
        matchingNativeQueries: 0,
      },
    ]);
    expect(JSON.stringify(fixture.diagnostics)).not.toContain(
      "PRIVATE_INPUT_VALUE",
    );
    expect(fixture.screenshots).toContain(
      "/owned/evidence/blocked-extensions-failed.png",
    );
    expect(fixture.pending()).toBe(0);
  });
  it("does not send keyboard input when the owned page cannot obtain focus", async () => {
    const fixture = await fakeWorkbenchUi([[page]], undefined, 0, {
      ignoreFront: true,
    });
    await expect(fixture.run()).rejects.toThrow(
      "Owned update UI observation incomplete",
    );
    expect(fixture.elapsed()).toBe(28000);
    expect(
      fixture.requests.some((row) => row.method === "Input.dispatchKeyEvent"),
    ).toBe(false);
    expect(fixture.diagnostics[0]).toMatchObject({
      keyboardPairDispatched: false,
      pageFocused: false,
      warningVisible: true,
      actionFocused: true,
    });
    expect(fixture.screenshots).toContain(
      "/owned/evidence/blocked-extensions-failed.png",
    );
    expect(fixture.pending()).toBe(0);
  });
});

describe("native updater preflight memory refusal", () => {
  it.each([2, 4, 0, NaN])(
    "keeps preflight pressure %s fail-closed with accurate no-allocation guidance",
    (value) => {
      let failure: unknown;
      try {
        assertAutomaticUpdateMemoryPressure(value, "preflight");
      } catch (error) {
        failure = error;
      }
      expect(failure).toBeInstanceOf(
        AutomaticUpdatePreflightMemoryPressureError,
      );
      const message = automaticUpdateFailureMessage(failure);
      expect(message).toContain("macOS memory pressure is not normal");
      expect(message).toContain("No test fixture was allocated");
      expect(message).toContain(
        "no extension was installed or native Code host launched",
      );
      expect(message).not.toContain("retained verification reports");
    },
  );
  it("continues only at the existing exact normal pressure level in either stage", () => {
    for (const phase of ["preflight", "allocated"] as const)
      expect(() => assertAutomaticUpdateMemoryPressure(1, phase)).not.toThrow();
  });
  it("keeps allocated-stage pressure refusal and recovery guidance separate", () => {
    let failure: unknown;
    try {
      assertAutomaticUpdateMemoryPressure(2, "allocated");
    } catch (error) {
      failure = error;
    }
    expect(failure).toBeInstanceOf(Error);
    expect(failure).not.toBeInstanceOf(
      AutomaticUpdatePreflightMemoryPressureError,
    );
    expect(automaticUpdateFailureMessage(failure)).toContain(
      "unknown fixture state was preserved",
    );
    expect(automaticUpdateFailureMessage(failure)).not.toContain(
      "No test fixture was allocated",
    );
  });
  it("never classifies arbitrary error text as preflight authority or dumps raw errors", () => {
    const failure = new Error("PRIVATE_CANARY No test fixture was allocated");
    expect(automaticUpdateFailureMessage(failure)).toContain(
      "unknown fixture state was preserved",
    );
    expect(automaticUpdateFailureMessage(failure)).not.toContain(
      "PRIVATE_CANARY",
    );
    const known = new AutomaticUpdatePreflightMemoryPressureError();
    known.message = "PRIVATE_CANARY";
    expect(automaticUpdateFailureMessage(known)).toContain(
      "No test fixture was allocated",
    );
    expect(automaticUpdateFailureMessage(known)).not.toContain(
      "PRIVATE_CANARY",
    );
  });
});

describe("native updater child environment boundary", () => {
  const identity = {
    HOME: "/identity-home",
    USER: "fixture-user",
    LOGNAME: "fixture-user",
    LANG: "en_US.UTF-8",
    LC_ALL: "en_US.UTF-8",
    PATH: "/maintained/bin:/usr/bin:/bin",
  };
  const storage = {
    TMPDIR: "/approved/tmp",
    TMP: "/approved/tmp",
    TEMP: "/approved/tmp",
    NODE_COMPILE_CACHE: "/approved/compile-cache",
    NPM_CONFIG_CACHE: "/approved/npm-cache",
    NPM_CONFIG_LOGS_DIR: "/approved/npm-logs",
  };
  const display = {
    DISPLAY: ":99",
    XAUTHORITY: "/session/owned.xauthority",
    DBUS_SESSION_BUS_ADDRESS: "unix:path=/session/bus",
  };
  const forbidden = {
    NODE_PATH: "ENV_CANARY",
    NODE_OPTIONS: "ENV_CANARY",
    NPM_TOKEN: "ENV_CANARY",
    npm_config__authToken: "ENV_CANARY",
    NPM_CONFIG_USERCONFIG: "ENV_CANARY",
    NPM_CONFIG_GLOBALCONFIG: "ENV_CANARY",
    NPM_CONFIG_REGISTRY: "ENV_CANARY",
    GITHUB_TOKEN: "ENV_CANARY",
    GH_TOKEN: "ENV_CANARY",
    AWS_SECRET_ACCESS_KEY: "ENV_CANARY",
    SSH_AUTH_SOCK: "ENV_CANARY",
    DOCKER_HOST: "ENV_CANARY",
    DOCKER_CONTEXT: "ENV_CANARY",
    DOCKER_CONFIG: "ENV_CANARY",
    COLIMA_HOME: "ENV_CANARY",
    REHEARSAL_DATABASE_URL: "ENV_CANARY",
    REHEARSAL_DEVELOPMENT_ROOT: "ENV_CANARY",
    REHEARSAL_EDITOR_TEST_ROOT: "ENV_CANARY",
    REHEARSAL_NATIVE_CANCELLATION_CONFIG: "ENV_CANARY",
    REHEARSAL_USER_STATE_DIRECTORY: "/approved/unrelated-state",
    VSCODE_IPC_HOOK_CLI: "ENV_CANARY",
    ELECTRON_RUN_AS_NODE: "ENV_CANARY",
    XDG_RUNTIME_DIR: "ENV_CANARY",
    XDG_CONFIG_HOME: "ENV_CANARY",
    XDG_DATA_HOME: "ENV_CANARY",
    WAYLAND_DISPLAY: "ENV_CANARY",
    OTHER_PRIVATE_VALUE: "ENV_CANARY",
  };
  it.each(["darwin", "linux"] as const)(
    "retains only needed %s identity/storage/display values from synthetic parent data",
    (platform) => {
      const source = Object.freeze({
        ...identity,
        ...storage,
        ...display,
        ...forbidden,
      });
      const before = { ...source };
      const selected = automaticUpdateEnvironment(source, platform);
      expect(selected).toEqual({
        ...identity,
        ...storage,
        ...(platform === "linux" ? display : {}),
      });
      expect(JSON.stringify(selected)).not.toContain("ENV_CANARY");
      expect(source).toEqual(before);
    },
  );
  it("keeps reservation workers narrower than the GUI host and ignores unrelated validated storage selectors", () => {
    const selected = fixtureEnvironment.nativeUpdateEnvironment(
      { ...identity, ...display, ...forbidden },
      {
        ...storage,
        REHEARSAL_USER_STATE_DIRECTORY: "/approved/unrelated-state",
        DOCKER_HOST: "ENV_CANARY",
      },
      "linux",
    );
    expect(selected).toEqual({ ...identity, ...storage });
    expect(selected).not.toHaveProperty("DISPLAY");
    expect(selected).not.toHaveProperty("XDG_RUNTIME_DIR");
    expect(JSON.stringify(selected)).not.toContain("ENV_CANARY");
  });
  it("preserves maintained storage refusal rather than falling back for invalid cache or temp paths", () => {
    expect(() =>
      automaticUpdateEnvironment(
        { ...identity, ...storage, TMPDIR: "relative-temp" },
        "darwin",
      ),
    ).toThrow("Storage overrides must be absolute");
    expect(() =>
      automaticUpdateEnvironment(
        { ...identity, ...storage, npm_config_cache: "/conflicting/cache" },
        "linux",
      ),
    ).toThrow("Conflicting or invalid storage overrides");
  });
});

describe("native updater exact-input and installed-byte boundaries", () => {
  it("executes candidate checks directly from installed bytes and historical fixes from the frozen candidate", () => {
    const installed = "/owned/extensions/canonical-0.1.27",
      frozen = "/owned/candidate/archive/extension";
    expect(automaticUpdateRuntimeRoot("candidate", installed, frozen)).toBe(
      installed,
    );
    for (const mode of ["historical-install", "historical-recovery"])
      expect(automaticUpdateRuntimeRoot(mode, installed, frozen)).toBe(frozen);
    expect(() =>
      automaticUpdateRuntimeRoot("arbitrary-module", installed, frozen),
    ).toThrow();
    expect(() =>
      automaticUpdateRuntimeRoot("candidate", installed, installed),
    ).toThrow();
    expect(() =>
      automaticUpdateRuntimeRoot("candidate", "relative", frozen),
    ).toThrow();
  });
  it("binds the actual hash-pinned macOS executable to its Code bundle without guessing its name", () => {
    const cli =
      "/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code";
    expect(() =>
      assertAutomaticUpdateExecutablePair(
        cli,
        "/Applications/Visual Studio Code.app/Contents/MacOS/Electron",
        "darwin",
      ),
    ).not.toThrow();
    expect(() =>
      assertAutomaticUpdateExecutablePair(
        cli,
        "/Applications/Other.app/Contents/MacOS/Electron",
        "darwin",
      ),
    ).toThrow();
    expect(() =>
      assertAutomaticUpdateExecutablePair(
        "/owned/code/bin/code",
        "/owned/code/code",
        "linux",
      ),
    ).not.toThrow();
    expect(() =>
      assertAutomaticUpdateExecutablePair(
        "/owned/code/bin/code",
        "/foreign/code",
        "linux",
      ),
    ).toThrow();
    expect(() =>
      assertAutomaticUpdateExecutablePair(
        "/owned/code/bin/code",
        "/owned/code/code",
        "win32",
      ),
    ).toThrow();
  });
  const expected = {
    mode: "candidate",
    candidateSha256: "a".repeat(64),
    loadedVersion: "0.1.27",
    vscodeVersion: "1.143.0",
  };
  const finalized = () => ({
    ...expected,
    status: "passed",
    scenario: "automatic-updates",
    checks: ["observed"],
    driverFinalized: true,
    recoveryRequired: false,
    editorRecovery: {
      schemaVersion: 1,
      retainEditor: false,
      dirtyDocumentCount: 0,
      dirtyDocumentCountTruncated: false,
      reason: "clean",
    },
  });
  it("accepts only clean finalization bound to this exact candidate and native lane", () => {
    expect(() =>
      assertAutomaticUpdateFinalization(finalized(), expected),
    ).not.toThrow();
  });
  it("binds a clean failed report before permitting cleanup while refusing unsafe or foreign reports", () => {
    expect(() =>
      assertAutomaticUpdateReportBinding(
        { ...finalized(), status: "failed", checks: [] },
        expected,
      ),
    ).not.toThrow();
    expect(() =>
      assertAutomaticUpdateReportBinding(
        { ...finalized(), candidateSha256: "b".repeat(64) },
        expected,
      ),
    ).toThrow();
    expect(() =>
      assertAutomaticUpdateReportBinding(
        { ...finalized(), recoveryRequired: true },
        expected,
      ),
    ).toThrow();
  });
  it.each([
    { candidateSha256: "b".repeat(64) },
    { mode: "historical-install" },
    { loadedVersion: "0.1.26" },
    { vscodeVersion: "1.1.0" },
    { scenario: "constructor" },
    { status: "failed" },
    { checks: [] },
    { driverFinalized: false },
    { recoveryRequired: true },
    {
      editorRecovery: {
        schemaVersion: 1,
        retainEditor: false,
        dirtyDocumentCount: 1,
        dirtyDocumentCountTruncated: false,
        reason: "clean",
      },
    },
  ])("refuses foreign, incomplete, failed or unsafe finalization", (change) => {
    expect(() =>
      assertAutomaticUpdateFinalization(
        { ...finalized(), ...change },
        expected,
      ),
    ).toThrow();
  });
  it("accepts the complete explicit artifact/runtime set without adding launch switches", () => {
    expect(parseAutomaticUpdateAcceptanceArguments(exactArguments()).size).toBe(
      10,
    );
  });
  it.each([
    (values: string[]) => values.slice(1),
    (values: string[]) => [...values, values[0]!],
    (values: string[]) => [...values, "--user-data-dir=/owner"],
    (values: string[]) =>
      values.map((value) =>
        value.startsWith("--candidate=") ? "--candidate=relative.vsix" : value,
      ),
    (values: string[]) =>
      values.map((value) =>
        value.startsWith("--candidate-sha=") ? "--candidate-sha=bad" : value,
      ),
    (values: string[]) =>
      values.map((value) =>
        value.startsWith("--code-version=") ? "--code-version=latest" : value,
      ),
  ])("refuses missing, duplicate, foreign and unpinned arguments", (mutate) => {
    expect(() =>
      parseAutomaticUpdateAcceptanceArguments(mutate(exactArguments())),
    ).toThrow();
  });
  it("keeps a genuine newer official target separate from the candidate version", () => {
    expect(() =>
      assertAutomaticUpdateVersions("0.1.27", "0.1.26", "0.1.27"),
    ).not.toThrow();
    expect(() =>
      assertAutomaticUpdateVersions("0.1.28", "0.1.26", "0.1.27"),
    ).not.toThrow();
    for (const values of [
      ["0.1.27", "0.1.27", "0.1.27"],
      ["0.1.26", "0.1.25", "0.1.27"],
      ["0.1.27", "invalid", "0.1.27"],
    ])
      expect(() =>
        assertAutomaticUpdateVersions(values[0]!, values[1]!, values[2]!),
      ).toThrow();
  });
  it("allows only VS Code's installation metadata outside the exact packaged manifest", () => {
    expect(() =>
      automaticUpdateInstalledManifest(
        buffer(manifest),
        buffer({ ...manifest, __metadata: { installedTimestamp: 1 } }),
      ),
    ).not.toThrow();
    for (const value of [
      { ...manifest, version: "0.1.28" },
      { ...manifest, extra: true },
      { ...manifest, name: "rehearsal" },
    ])
      expect(() =>
        automaticUpdateInstalledManifest(buffer(manifest), buffer(value)),
      ).toThrow();
  });
  it("compares actual payload contents, extra files and native manifest bytes", async () => {
    const root = await mkdtemp(join(tmpdir(), "native-update-payload-"));
    const expected = join(root, "archive/extension"),
      installed = join(root, "installed");
    try {
      await mkdir(expected, { recursive: true });
      await mkdir(installed);
      await writeFile(
        join(root, "archive/extension.vsixmanifest"),
        "exact native identity",
      );
      await writeFile(
        join(installed, ".vsixmanifest"),
        "exact native identity",
      );
      await writeFile(join(expected, "package.json"), buffer(manifest));
      await writeFile(
        join(installed, "package.json"),
        buffer({ ...manifest, __metadata: {} }),
      );
      await writeFile(join(expected, "runtime.js"), "exact runtime");
      await writeFile(join(installed, "runtime.js"), "exact runtime");
      expect(
        await assertAutomaticUpdateInstalledPayload(expected, installed),
      ).toBe(2);
      await writeFile(join(installed, "runtime.js"), "modified runtime");
      await expect(
        assertAutomaticUpdateInstalledPayload(expected, installed),
      ).rejects.toThrow();
      await writeFile(join(installed, "runtime.js"), "exact runtime");
      await writeFile(join(installed, "unexpected.js"), "extra");
      await expect(
        assertAutomaticUpdateInstalledPayload(expected, installed),
      ).rejects.toThrow();
      await rm(join(installed, "unexpected.js"));
      await writeFile(join(installed, ".vsixmanifest"), "wrong identity");
      await expect(
        assertAutomaticUpdateInstalledPayload(expected, installed),
      ).rejects.toThrow();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

describe("owned workbench UI refusal", () => {
  it("permits only a validated localhost browser endpoint", () => {
    expect(
      ui.parseOwnedDevtoolsPort("12345\n/devtools/browser/owned-123\n"),
    ).toBe("ws://127.0.0.1:12345/devtools/browser/owned-123");
    for (const value of [
      "0\n/devtools/browser/id",
      "65536\n/devtools/browser/id",
      "123\nws://foreign/id",
      "123\n/devtools/browser/id\nextra",
      null,
    ])
      expect(() => ui.parseOwnedDevtoolsPort(value)).toThrow();
  });
  it.each(["Open Extensions", "Update Settings"])(
    "focuses exactly one visible %s button on the recovery warning",
    (label) => {
      const document: {
        activeElement?: unknown;
        querySelectorAll?: () => unknown[];
        hasFocus: () => boolean;
      } = { hasFocus: () => true };
      const button = (visible: boolean) => ({
        disabled: false,
        textContent: label,
        getAttribute: () => null,
        getBoundingClientRect: () => ({ width: visible ? 100 : 0, height: 20 }),
        focus() {
          document.activeElement = this;
        },
      });
      const visible = button(true),
        hidden = button(false);
      let items = [visible, hidden];
      document.querySelectorAll = () => [
        {
          textContent:
            "Automatic Rehearsal extension updates need recovery review; the unverified reservation was preserved.",
          getBoundingClientRect: () => ({ width: 100, height: 100 }),
          querySelectorAll: () => items,
        },
      ];
      expect(
        runInNewContext(ui.notificationButtonProbe(label), { document }),
      ).toBe(true);
      expect(document.activeElement).toBe(visible);
      items = [hidden];
      document.activeElement = undefined;
      expect(
        runInNewContext(ui.notificationButtonProbe(label), { document }),
      ).toBe(false);
      items = [visible, button(true)];
      expect(
        runInNewContext(ui.notificationButtonProbe(label), { document }),
      ).toBe(false);
      expect(document.activeElement).toBeUndefined();
    },
  );
  it("rejects caller-selected arbitrary UI actions", () => {
    expect(() => ui.notificationButtonProbe("Delete Everything")).toThrow();
  });
});

async function workerFixture(
  phase: "preparing" | "installer-dispatched" | "live",
) {
  const root = await mkdtemp(join(tmpdir(), "native-update-worker-"));
  const runtimeRoot = join(root, "runtime"),
    storagePath = join(root, "storage"),
    loadedPath = join(root, "installed");
  await mkdir(join(runtimeRoot, "dist/src"), { recursive: true });
  await mkdir(storagePath);
  await mkdir(loadedPath);
  // The child uses the real production API through the already-installed TS loader.
  await writeFile(
    join(runtimeRoot, "dist/src/extension_update_reservation.js"),
    `module.exports=require(${JSON.stringify(resolve(__dirname, "../../src/updates/automatic/extension_update_reservation.ts"))});`,
  );
  await writeFile(join(loadedPath, "package.json"), buffer(manifest));
  const config = {
    root,
    runtimeRoot,
    storagePath,
    loadedPath,
    loadedVersion: "0.1.27",
    targetVersion: "0.1.28",
    phase,
  };
  const input = join(root, "worker.json");
  await writeFile(input, buffer(config));
  const arguments_ = [
    "--import",
    "tsx",
    resolve(
      __dirname,
      "../../scripts/native/native-update-reservation-worker.cjs",
    ),
    input,
  ];
  const acquire = () =>
    acquireExtensionUpdateReservation({
      storagePath,
      version: "0.1.28",
      installation: () =>
        readLoadedExtensionState(loadedPath, "0.1.27", loadedPath, "0.1.27"),
      ready: async () => true,
    });
  return {
    root,
    input,
    config,
    arguments_,
    acquire,
    lock: join(storagePath, "extension-update.lock"),
  };
}
describe("production-written native crash-state fixtures", () => {
  it("creates a genuinely exited preparing owner that the unchanged installation can recover", async () => {
    const fixture = await workerFixture("preparing");
    try {
      const output = await promisify(execFile)(
        process.execPath,
        fixture.arguments_,
        { timeout: 20000, maxBuffer: 4096 },
      );
      const receipt = JSON.parse(output.stdout) as {
        pid: number;
        ready: boolean;
      };
      expect(receipt.ready).toBe(true);
      expect(updateProcessState(receipt.pid)).toBe("stopped");
      expect(JSON.parse(await readFile(fixture.lock, "utf8"))).toMatchObject({
        pid: receipt.pid,
        phase: "preparing",
      });
      const reservation = await fixture.acquire();
      expect(await reservation?.owns()).toBe(true);
      await reservation?.release();
      await expect(readFile(fixture.lock)).rejects.toHaveProperty(
        "code",
        "ENOENT",
      );
    } finally {
      await rm(fixture.root, { recursive: true, force: true });
    }
  }, 25000);
  it("keeps a genuinely exited dispatched owner unconfirmed against the old loaded state", async () => {
    const fixture = await workerFixture("installer-dispatched");
    try {
      await promisify(execFile)(process.execPath, fixture.arguments_, {
        timeout: 20000,
        maxBuffer: 4096,
      });
      const bytes = await readFile(fixture.lock);
      await expect(fixture.acquire()).rejects.toHaveProperty(
        "reason",
        "installation-unconfirmed",
      );
      expect(await readFile(fixture.lock)).toEqual(bytes);
    } finally {
      await rm(fixture.root, { recursive: true, force: true });
    }
  }, 25000);
  it("keeps a live child reservation until that child's own release path runs", async () => {
    const fixture = await workerFixture("live");
    const child = spawn(process.execPath, fixture.arguments_, {
      stdio: ["pipe", "pipe", "pipe"],
    });
    child.stderr.resume();
    const closed = new Promise<number | null>((done) =>
      child.once("close", done),
    );
    try {
      await new Promise<void>((done, fail) => {
        let text = "";
        const timer = setTimeout(
          () => fail(Error("Fixture did not become ready.")),
          20000,
        );
        child.once("error", (error) => {
          clearTimeout(timer);
          fail(error);
        });
        child.stdout.on("data", (chunk: Buffer) => {
          text += chunk.toString();
          if (text.includes("\n")) {
            clearTimeout(timer);
            done();
          }
        });
      });
      const before = await readFile(fixture.lock);
      await expect(fixture.acquire()).rejects.toHaveProperty(
        "reason",
        "update-in-progress",
      );
      expect(await readFile(fixture.lock)).toEqual(before);
      child.stdin.end();
      expect(await closed).toBe(0);
      await expect(readFile(fixture.lock)).rejects.toHaveProperty(
        "code",
        "ENOENT",
      );
    } finally {
      child.stdin.end();
      await closed;
      await rm(fixture.root, { recursive: true, force: true });
    }
  }, 25000);
  it.each(["escaped", "symlink"])(
    "refuses %s storage before writing a reservation",
    async (kind) => {
      const fixture = await workerFixture("preparing");
      const outside = await mkdtemp(join(tmpdir(), "native-update-outside-"));
      try {
        if (kind === "escaped") fixture.config.storagePath = outside;
        else {
          await symlink(outside, join(fixture.root, "linked-storage"));
          fixture.config.storagePath = join(fixture.root, "linked-storage");
        }
        await writeFile(fixture.input, buffer(fixture.config));
        await expect(
          promisify(execFile)(process.execPath, fixture.arguments_, {
            timeout: 20000,
            maxBuffer: 4096,
          }),
        ).rejects.toHaveProperty("code", 1);
        await expect(
          readFile(join(outside, "extension-update.lock")),
        ).rejects.toHaveProperty("code", "ENOENT");
      } finally {
        await rm(fixture.root, { recursive: true, force: true });
        await rm(outside, { recursive: true, force: true });
      }
    },
    25000,
  );
});

describe("native updater shared phase protocol and selected lanes", () => {
  it("validates one original deadline and reserves two seconds for closed diagnostics", () => {
    expect(
      ui.updatePhaseDeadline(
        { phase: "blocked-settings", deadline: 30100 },
        100,
      ),
    ).toBe(28100);
    for (const phase of [
      { phase: "foreign", deadline: 30100 },
      { phase: "blocked-settings", deadline: 100 },
      { phase: "blocked-settings", deadline: 30101 },
    ])
      expect(() => ui.updatePhaseDeadline(phase, 100)).toThrow();
  });
  it("retains a closed current-stage journal before the original acknowledgement deadline", async () => {
    const page = {
      targetId: "owned-page",
      type: "page",
      url: "vscode-file://vscode-app/owned/Code/resources/app/out/vs/code/electron-browser/workbench/workbench.html",
    };
    const fixture = await fakeWorkbenchUi([[page]], undefined, 0, {
      wrongDestination: true,
    });
    await expect(fixture.run()).rejects.toThrow();
    expect(fixture.elapsed()).toBe(28000);
    expect(fixture.progressRecords.at(-1)).toMatchObject({
      status: "failed",
      phase: "blocked-extensions",
      stage: "destination",
      code: "phase-deadline",
      consentActionCount: 0,
    });
    expect(JSON.stringify(fixture.progressRecords)).not.toContain(
      "PRIVATE_INPUT_VALUE",
    );
  });
  it("preserves all3 lanes by default and runs only actual candidate or ordered historical lanes when selected", async () => {
    for (const [plan, modes] of [
      [undefined, ["candidate", "historical-install", "historical-recovery"]],
      ["candidate", ["candidate"]],
      ["historical", ["historical-install", "historical-recovery"]],
    ] as const) {
      const calls: string[] = [];
      expect(
        await runAutomaticUpdateLanes(plan, async (mode) => {
          calls.push(mode);
        }),
      ).toEqual(modes);
      expect(calls).toEqual(modes);
    }
    expect(() => automaticUpdateLaneModes("PRIVATE")).toThrow();
    expect(
      parseAutomaticUpdateAcceptanceArguments([
        ...exactArguments(),
        "--lanes=historical",
      ]).get("lanes"),
    ).toBe("historical");
    expect(() =>
      parseAutomaticUpdateAcceptanceArguments([
        ...exactArguments(),
        "--lanes=unknown",
      ]),
    ).toThrow();
  });
  it("does not run or synthesize a later historical restart after installation failure", async () => {
    const calls: string[] = [];
    const original = Error("PRIVATE");
    await expect(
      runAutomaticUpdateLanes("historical", async (mode) => {
        calls.push(mode);
        throw original;
      }),
    ).rejects.toBe(original);
    expect(calls).toEqual(["historical-install"]);
  });
  it("the actual publisher writes one deadline and never renews it or accepts a late acknowledgement", async () => {
    type PublishedPhase = { phase: string; nonce: string; deadline: number };
    const api: {
      publishUpdatePhase?: (input: {
        phase: string;
        root: string;
        now: () => number;
        write: (path: string, value: PublishedPhase) => Promise<void>;
        read: () => Promise<{ bytes: Buffer }>;
        pause: (milliseconds: number) => Promise<void>;
      }) => Promise<void>;
    } = {};
    const source = await readFile(
      resolve(
        __dirname,
        "../../scripts/native/native-automatic-update-test.cjs",
      ),
      "utf8",
    );
    runInNewContext(source, {
      exports: api,
      require: (name: string) =>
        name === "vscode"
          ? {}
          : name === "./native-editor-driver.cjs"
            ? {}
            : name === "./native-editor-reads.cjs"
              ? {}
              : nativeRequire(name),
      Buffer,
    });
    let now = 100,
      record: PublishedPhase = { phase: "", nonce: "", deadline: 0 },
      writes = 0;
    await expect(
      api.publishUpdatePhase!({
        phase: "blocked-extensions",
        root: "/owned",
        now: () => now,
        write: async (_path: string, value: PublishedPhase) => {
          record = value;
          writes++;
        },
        read: async () => {
          now = record.deadline;
          return {
            bytes: Buffer.from(
              JSON.stringify({ phase: record.phase, nonce: record.nonce }),
            ),
          };
        },
        pause: async (ms: number) => {
          now += ms;
        },
      }),
    ).rejects.toMatchObject({ code: "NATIVE_UPDATE_PHASE_TIMEOUT" });
    expect(writes).toBe(1);
    expect(record.deadline).toBe(30100);
    expect(now).toBe(30100);
    now = 100;
    await api.publishUpdatePhase!({
      phase: "returned-settings",
      root: "/owned",
      now: () => now,
      write: async (_path: string, value: PublishedPhase) => {
        record = value;
      },
      read: async () => ({
        bytes: Buffer.from(
          JSON.stringify({ phase: record.phase, nonce: record.nonce }),
        ),
      }),
      pause: async () => {
        throw Error("No delay required");
      },
    });
  });
});

it("native driver retains only the reviewed scenario basename and coordinates", async () => {
  const api: { diagnostic?: (error: unknown) => unknown } = {};
  runInNewContext(
    await readFile(
      resolve(__dirname, "../../scripts/native/native-editor-driver.cjs"),
      "utf8",
    ),
    {
      exports: api,
      require: (name: string) =>
        name === "vscode"
          ? {}
          : name === "./native-editor-recovery.cjs"
            ? nativeRequire("../../scripts/native/native-editor-recovery.cjs")
            : nativeRequire(name),
      Buffer,
    },
  );
  expect(
    api.diagnostic!({
      stack:
        "Error PRIVATE /private/owner/native-automatic-update-test.cjs:123:4\n /other.cjs:2:3",
    }),
  ).toEqual({
    code: "UNCLASSIFIED_ERROR",
    location: "native-automatic-update-test.cjs:123:4",
  });
  expect(
    JSON.stringify(
      api.diagnostic!({ stack: "PRIVATE /private/foreign.cjs:123:4" }),
    ),
  ).not.toContain("PRIVATE");
});
