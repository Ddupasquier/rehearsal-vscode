import { Script } from "node:vm";
import { afterEach, describe, expect, it, vi } from "vitest";

const editor = vi.hoisted(() => {
  const uri = (path: string) => ({
    path,
    toString: () => `file://${path}`,
  });
  const create = () => {
    let disposed = false;
    const messages = new Set<(message: unknown) => void>();
    const disposals = new Set<() => void>();
    const panel = {
      dispose: vi.fn(() => {
        if (disposed) return;
        disposed = true;
        [...disposals].forEach((listener) => listener());
      }),
      onDidDispose: (listener: () => void) => {
        disposals.add(listener);
        return { dispose: () => disposals.delete(listener) };
      },
      receive: (message: unknown) => {
        [...messages].forEach((listener) => listener(message));
      },
      webview: {
        html: "",
        cspSource: "vscode-webview-resource:",
        asWebviewUri: (value: ReturnType<typeof uri>) => value,
        postMessage: vi.fn(async (_message: unknown) => true),
        onDidReceiveMessage: (listener: (message: unknown) => void) => {
          messages.add(listener);
          return { dispose: () => messages.delete(listener) };
        },
      },
    };
    return panel;
  };
  const panels: ReturnType<typeof create>[] = [];
  return {
    uri,
    panels,
    createPanel: vi.fn((..._args: unknown[]) => {
      const panel = create();
      panels.push(panel);
      return panel;
    }),
  };
});

vi.mock("vscode", () => ({
  EventEmitter: class {
    listeners = new Set<(value: string) => void>();
    event = (listener: (value: string) => void) => {
      this.listeners.add(listener);
      return { dispose: () => this.listeners.delete(listener) };
    };
    fire(value: string) {
      for (const listener of this.listeners) listener(value);
    }
    dispose() {
      this.listeners.clear();
    }
  },
  Uri: {
    joinPath: (root: ReturnType<typeof editor.uri>, ...parts: string[]) =>
      editor.uri([root.path, ...parts].join("/")),
  },
  ViewColumn: { Active: 1, Beside: 2 },
  window: { createWebviewPanel: editor.createPanel },
}));

import {
  RehearsalReviewPanels,
  renderReviewDocument,
  type ReviewContent,
} from "../src/review_panel.js";
import { renderReviewDocument as renderPureReviewDocument } from "../src/action_review_view.js";

const content: ReviewContent = {
  title: "Review configuration changes",
  description: "Read the complete diff before saving. Nothing is written yet.",
  workspaceName: "Independent fixture",
  path: "rehearsal.config.mjs",
  detail:
    "--- a/rehearsal.config.mjs\n+++ b/rehearsal.config.mjs\n@@ -1 +1 @@\n-retain: 2\n+retain: 3\n",
  format: "diff",
  changedFields: ["cleanup.retainBaselineGenerations"],
};
const assets = {
  resourceSource: "vscode-webview-resource:",
  stylesheetUri: "vscode-webview-resource:/extension/media/workspace.css",
  scriptNonce: "synthetic-review-nonce",
};

const owners: RehearsalReviewPanels[] = [];
const createOwner = () => {
  const owner = new RehearsalReviewPanels(editor.uri("/extension") as never);
  owners.push(owner);
  return owner;
};
const lastPanel = () => editor.panels.at(-1)!;
const send = (
  type: string,
  panel = lastPanel(),
  extra: Record<string, unknown> = {},
) => {
  const token = /const token = "([a-zA-Z0-9_-]+)";/u.exec(
    panel.webview.html,
  )![1];
  panel.receive({ type, token, ...extra });
};
const options = () => ({
  ...content,
  workspaceKey: "file:///independent-fixture",
  canApply: vi.fn(),
  onApply: vi.fn(async (): Promise<void | boolean> => undefined),
  onReturn: vi.fn(),
  successMessage: "Saved the reviewed configuration changes.",
});

afterEach(() => {
  owners.splice(0).forEach((owner) => owner.dispose());
  editor.panels.splice(0);
  vi.clearAllMocks();
});

describe("review column ownership", () => {
  it("keeps other reviews active by default and honors an explicit beside review", async () => {
    const owner = createOwner();
    const first = owner.review(options());
    expect(editor.createPanel.mock.calls.at(-1)?.[2]).toBe(1);
    send("cancelReview");
    await first;
    const second = owner.review({ ...options(), viewColumn: 2 });
    expect(editor.createPanel.mock.calls.at(-1)?.[2]).toBe(2);
    send("cancelReview");
    await second;
  });
});

describe("review return navigation", () => {
  it.each(["ready", "cancelled", "failed", "success"])(
    "returns exact workspace from %s while preserving specialized callbacks",
    async (state) => {
      const owner = createOwner(),
        returned = vi.fn(),
        applied = vi.fn(async () =>
          state === "cancelled" ? false : undefined,
        );
      owner.onDidRequestReturn(returned);
      const { onReturn: _onReturn, ...reviewOptions } = options();
      if (state === "failed")
        applied.mockImplementation(async () => {
          throw Error("private");
        });
      const pending = owner.review({ ...reviewOptions, onApply: applied });
      const observed = pending.catch(() => false);
      if (state !== "ready") {
        send("applyReview");
        await new Promise((resolve) => setTimeout(resolve, 0));
      }
      send("returnFromReview");
      await observed;
      expect(returned).toHaveBeenCalledWith(reviewOptions.workspaceKey);
      expect(lastPanel().dispose).toHaveBeenCalledOnce();
    },
  );
  it("does not navigate while applying and honors caller-owned return", async () => {
    const owner = createOwner(),
      returned = vi.fn(),
      onReturn = vi.fn();
    owner.onDidRequestReturn(returned);
    let finish!: () => void;
    const pending = owner.review({
      ...options(),
      onReturn,
      onApply: () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    });
    send("applyReview");
    await new Promise((resolve) => setTimeout(resolve, 0));
    send("returnFromReview");
    expect(lastPanel().dispose).not.toHaveBeenCalled();
    expect(onReturn).not.toHaveBeenCalled();
    finish();
    await pending;
    send("returnFromReview");
    expect(onReturn).toHaveBeenCalledOnce();
    expect(returned).not.toHaveBeenCalled();
  });
});

describe("non-modal review document", () => {
  it("exposes the same renderer through the VS Code-free view module", () => {
    expect(renderPureReviewDocument(content, assets)).toBe(
      renderReviewDocument(content, assets),
    );
  });

  it("shows the exact escaped diff and actual changed-field count", () => {
    const html = renderReviewDocument(content, assets);
    expect(html).toContain("1 setting changed");
    expect(html).toContain("cleanup.retainBaselineGenerations");
    expect(html).toContain("1 added line · 1 removed line");
    expect(html).toContain('review-panel__line--removed">-retain: 2');
    expect(html).toContain('review-panel__line--added">+retain: 3');
    expect(html).toContain('id="review-heading" tabindex="-1"');
    expect(html).toContain('id="review-status" role="status"');
    expect(html).toContain('id="review-return"');
    expect(html).toContain(">Back to Rehearsal</button>");
    expect(html).not.toMatch(/id="review-return"[^>]* hidden/u);
    expect(html).toContain("default-src 'none'");
    expect(html).toContain("connect-src 'none'");
    expect(html).not.toContain("contenteditable");
  });

  it("renders arbitrary review data as text, never HTML or executable scripts", () => {
    const html = renderReviewDocument(
      {
        ...content,
        title: "<img src=x onerror=bad()>",
        description: "<script>bad()</script>",
        detail: "+</script><img src=x onerror=bad()>\n",
        changedFields: ["<input autofocus>"],
      },
      assets,
    );
    expect(html).toContain("&lt;/script&gt;&lt;img");
    expect(html).toContain("&lt;input autofocus&gt;");
    expect(html.match(/<script /gu)).toHaveLength(1);
    expect(html).not.toContain("<img");
    expect(html).not.toContain("<input");
  });

  it("renders image/stop text reviews without implying a configuration save", () => {
    const html = renderReviewDocument(
      {
        title: "Review image cleanup",
        description: "Read every exact image before continuing.",
        workspaceName: "Fixture",
        detail: "+ exact image tag\n- zero data volumes",
        format: "text",
        applyLabel: "Continue to cleanup confirmation",
      },
      assets,
    );
    expect(html).toContain("Continue to cleanup confirmation");
    expect(html).not.toContain("added line");
    expect(html).not.toContain("Configuration file:");
    expect(html).not.toContain("review-panel__line--added");
  });

  it.each([
    "/private/config.mjs",
    "../config.mjs",
    "a/../config.mjs",
    "C:\\config.mjs",
    "file:///config.mjs",
  ])("rejects a non-project-relative path %s", (path) => {
    expect(() => renderReviewDocument({ ...content, path }, assets)).toThrow();
  });

  it("bounds byte size, line count, fields and script authorization", () => {
    expect(() =>
      renderReviewDocument(
        { ...content, detail: "x".repeat(2 * 1024 * 1024 + 1) },
        assets,
      ),
    ).toThrow();
    expect(() =>
      renderReviewDocument({ ...content, detail: "\n".repeat(40_000) }, assets),
    ).toThrow();
    expect(() =>
      renderReviewDocument(
        {
          ...content,
          changedFields: Array.from({ length: 1001 }, () => "field"),
        },
        assets,
      ),
    ).toThrow();
    expect(() =>
      renderReviewDocument(content, { ...assets, scriptNonce: 'unsafe"nonce' }),
    ).toThrow();
  });
});

describe("non-modal review lifecycle", () => {
  it("does not apply at open, allows reading, and cancels without changes", async () => {
    const input = options();
    const pending = createOwner().review(input);
    expect(editor.createPanel).toHaveBeenCalledWith(
      "rehearsal.review",
      expect.any(String),
      1,
      expect.objectContaining({
        enableCommandUris: false,
        enableScripts: true,
      }),
    );
    expect(input.onApply).not.toHaveBeenCalled();
    send("cancelReview");
    await expect(pending).resolves.toBe(false);
    expect(input.onApply).not.toHaveBeenCalled();
  });

  it("rechecks authorization and applies only once, retaining a completed review", async () => {
    const input = options();
    const pending = createOwner().review(input);
    const panel = lastPanel();
    send("applyReview", panel);
    send("applyReview", panel);
    await expect(pending).resolves.toBe(true);
    expect(input.onApply).toHaveBeenCalledTimes(1);
    expect(input.canApply).toHaveBeenCalledTimes(3);
    expect(panel.dispose).not.toHaveBeenCalled();
    expect(panel.webview.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        state: "succeeded",
        message: input.successMessage,
      }),
    );
    send("applyReview", panel);
    expect(input.onApply).toHaveBeenCalledTimes(1);
    send("returnFromReview", panel);
    expect(input.onReturn).toHaveBeenCalledOnce();
    expect(panel.dispose).toHaveBeenCalledOnce();
  });

  it("ignores malformed messages, foreign tokens and unknown actions", async () => {
    const input = options();
    const pending = createOwner().review(input);
    for (const value of [null, [], "applyReview", { type: "applyReview" }])
      lastPanel().receive(value);
    send("applyReview", lastPanel(), { token: "foreign" });
    send("applyReview", lastPanel(), { unexpected: true });
    send("unknown", lastPanel(), { type: { toString: null } });
    send("unknown");
    expect(input.onApply).not.toHaveBeenCalled();
    expect(input.onReturn).not.toHaveBeenCalled();
    send("cancelReview");
    await expect(pending).resolves.toBe(false);
  });

  it("fails closed after authorization drift and never retries automatically", async () => {
    const input = options();
    const pending = createOwner().review(input);
    input.canApply.mockImplementation(() => {
      throw new Error("sensitive internal failure");
    });
    const rejected = expect(pending).rejects.toThrow(
      "sensitive internal failure",
    );
    send("applyReview");
    await rejected;
    await vi.waitFor(() =>
      expect(lastPanel().webview.postMessage).toHaveBeenCalledWith(
        expect.objectContaining({ state: "failed" }),
      ),
    );
    send("applyReview");
    expect(input.onApply).not.toHaveBeenCalled();
    expect(
      JSON.stringify(lastPanel().webview.postMessage.mock.calls),
    ).not.toContain("sensitive internal failure");
    send("cancelReview");
  });

  it("does not report cancellation when the tab closes during an actual save", async () => {
    let complete: (() => void) | undefined;
    const input = options();
    input.onApply.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          complete = resolve;
        }),
    );
    const pending = createOwner().review(input);
    send("applyReview");
    await vi.waitFor(() => expect(input.onApply).toHaveBeenCalledOnce());
    lastPanel().dispose();
    let settled = false;
    void pending.then(() => {
      settled = true;
    });
    await Promise.resolve();
    expect(settled).toBe(false);
    complete!();
    await expect(pending).resolves.toBe(true);
  });

  it("keeps a cancelled downstream native confirmation uncompleted", async () => {
    const input = options();
    input.onApply.mockResolvedValue(false);
    const pending = createOwner().review(input);
    send("applyReview");
    await vi.waitFor(() =>
      expect(lastPanel().webview.postMessage).toHaveBeenCalledWith(
        expect.objectContaining({ state: "cancelled" }),
      ),
    );
    expect(lastPanel().webview.postMessage).not.toHaveBeenCalledWith(
      expect.objectContaining({ state: "succeeded" }),
    );
    send("cancelReview");
    await expect(pending).resolves.toBe(false);
  });

  it("shows a safe failure after a rejected save and permits closing", async () => {
    const input = options();
    input.onApply.mockRejectedValue(new Error("private source information"));
    const pending = createOwner().review(input);
    const rejected = expect(pending).rejects.toThrow(
      "private source information",
    );
    send("applyReview");
    await rejected;
    await vi.waitFor(() =>
      expect(lastPanel().webview.postMessage).toHaveBeenCalledWith(
        expect.objectContaining({ state: "failed" }),
      ),
    );
    send("applyReview");
    expect(input.onApply).toHaveBeenCalledOnce();
    send("cancelReview");
  });
  it("posts only caller-approved fixed guidance for a failed configuration review", async () => {
    class KnownFailure extends Error {}
    const failure = new KnownFailure("PRIVATE_CANARY");
    const input = options();
    input.onApply.mockRejectedValue(failure);
    const guidance =
      "The configuration changed. Close review and inspect the current source.";
    const pending = createOwner().review({
      ...input,
      failureMessage: (error) =>
        error instanceof KnownFailure ? guidance : undefined,
    });
    const rejected = expect(pending).rejects.toThrow("PRIVATE_CANARY");
    send("applyReview");
    await rejected;
    await vi.waitFor(() =>
      expect(lastPanel().webview.postMessage).toHaveBeenCalledWith(
        expect.objectContaining({ state: "failed", message: guidance }),
      ),
    );
    expect(
      JSON.stringify(lastPanel().webview.postMessage.mock.calls),
    ).not.toContain("PRIVATE_CANARY");
    send("applyReview");
    expect(input.onApply).toHaveBeenCalledOnce();
    send("cancelReview");
  });
  it.each(["", "x".repeat(501), "unsafe\nmessage"])(
    "falls back when guidance is empty, excessive or control-bearing",
    async (message) => {
      const input = options();
      input.onApply.mockRejectedValue(new Error("PRIVATE_CANARY"));
      const pending = createOwner().review({
        ...input,
        failureMessage: () => message,
      });
      const rejected = expect(pending).rejects.toThrow("PRIVATE_CANARY");
      send("applyReview");
      await rejected;
      await vi.waitFor(() =>
        expect(lastPanel().webview.postMessage).toHaveBeenCalledWith(
          expect.objectContaining({ state: "failed" }),
        ),
      );
      const failed = lastPanel()
        .webview.postMessage.mock.calls.map(([value]) => value)
        .find((value) => (value as { state?: string }).state === "failed");
      expect(failed).not.toHaveProperty("message");
      send("cancelReview");
    },
  );

  it("invalidates only reviews belonging to the removed workspace", async () => {
    const owner = createOwner();
    const first = owner.review(options());
    const second = owner.review({
      ...options(),
      workspaceKey: "file:///other",
    });
    const firstPanel = editor.panels[0]!;
    const secondPanel = editor.panels[1]!;
    owner.releaseWorkspace("file:///independent-fixture");
    await expect(first).resolves.toBe(false);
    expect(firstPanel.dispose).toHaveBeenCalledOnce();
    expect(secondPanel.dispose).not.toHaveBeenCalled();
    send("cancelReview", secondPanel);
    await expect(second).resolves.toBe(false);
  });

  it("revokes a review closed before its application callback begins", async () => {
    const owner = createOwner();
    const input = options();
    const pending = owner.review(input);
    const rejected = expect(pending).rejects.toThrow(
      "Review closed before applying",
    );
    send("applyReview");
    owner.releaseWorkspace(input.workspaceKey);
    await rejected;
    expect(input.onApply).not.toHaveBeenCalled();
  });

  it("bounds retained reviews and releases capacity when a review closes", async () => {
    const owner = createOwner();
    const pending = Array.from({ length: 16 }, () => owner.review(options()));
    await expect(owner.review(options())).rejects.toThrow("Close an existing");
    editor.panels[0]!.dispose();
    const next = owner.review(options());
    send("cancelReview");
    await expect(next).resolves.toBe(false);
    owner.dispose();
    expect(await Promise.all(pending)).toEqual(Array(16).fill(false));
    await expect(owner.review(options())).rejects.toThrow();
  });

  it("bounds total retained detail bytes, including completed reviews", async () => {
    const owner = createOwner();
    const large = { ...options(), detail: "x".repeat(2 * 1024 * 1024) };
    const pending = Array.from({ length: 4 }, () => owner.review(large));
    await expect(owner.review(options())).rejects.toThrow("Close an existing");
    owner.dispose();
    expect(await Promise.all(pending)).toEqual(Array(4).fill(false));
  });
});

describe("review keyboard/controller behavior", () => {
  it.each([
    "Close review, correct the proposed settings, and review again.",
    undefined,
    "x".repeat(501),
    "unsafe\nmessage",
  ])(
    "announces bounded failure guidance and preserves close/focus/retry guards",
    (message) => {
      const listeners: Record<string, (event: never) => void> = {};
      const nodes = Object.fromEntries(
        ["heading", "apply", "cancel", "return", "status"].map((id) => [
          `#review-${id}`,
          {
            disabled: false,
            hidden: false,
            textContent: "Apply changes",
            focus: vi.fn(),
            setAttribute: vi.fn(),
            addEventListener: (
              name: string,
              handler: (event: never) => void,
            ) => {
              listeners[`${id}:${name}`] = handler;
            },
          },
        ]),
      );
      const postMessage = vi.fn();
      const script = /<script nonce="[^"]+">([\s\S]*?)<\/script>/u.exec(
        renderReviewDocument(content, assets),
      )![1]!;
      new Script(script).runInNewContext({
        acquireVsCodeApi: () => ({ postMessage }),
        document: {
          querySelector: (selector: string) => nodes[selector],
          addEventListener: (name: string, handler: (event: never) => void) => {
            listeners[name] = handler;
          },
        },
        window: {
          addEventListener: (name: string, handler: (event: never) => void) => {
            listeners[name] = handler;
          },
        },
      });
      listeners["apply:click"]!({} as never);
      listeners.message!({
        data: {
          type: "reviewState",
          token: assets.scriptNonce,
          state: "failed",
          message,
        },
      } as never);
      const expected =
        typeof message === "string" &&
        message.length <= 500 &&
        !message.includes("\n")
          ? message
          : "The action could not be confirmed.";
      expect(nodes["#review-status"]!.textContent).toContain(expected);
      expect(nodes["#review-status"]!.setAttribute).toHaveBeenCalledWith(
        "role",
        "alert",
      );
      expect(nodes["#review-apply"]!.disabled).toBe(true);
      expect(nodes["#review-cancel"]!.textContent).toBe("Close review");
      expect(nodes["#review-cancel"]!.focus).toHaveBeenCalledOnce();
      listeners["apply:click"]!({} as never);
      expect(postMessage).toHaveBeenCalledTimes(1);
      listeners.keydown!({ key: "Escape", preventDefault: vi.fn() } as never);
      expect(postMessage).toHaveBeenLastCalledWith({
        type: "cancelReview",
        token: assets.scriptNonce,
      });
    },
  );
  it("works without a VS Code bridge and never simulates a successful save", () => {
    const listeners: Record<string, (event: never) => void> = {};
    const nodes = Object.fromEntries(
      ["heading", "apply", "cancel", "return", "status"].map((id) => [
        `#review-${id}`,
        {
          disabled: false,
          hidden: id === "return",
          textContent: "Apply changes",
          focus: vi.fn(),
          setAttribute: vi.fn(),
          addEventListener: (name: string, handler: (event: never) => void) => {
            listeners[`${id}:${name}`] = handler;
          },
        },
      ]),
    );
    const script = /<script nonce="[^"]+">([\s\S]*?)<\/script>/u.exec(
      renderReviewDocument(content, assets),
    )![1]!;
    new Script(script).runInNewContext({
      document: {
        querySelector: (selector: string) => nodes[selector],
        addEventListener: (name: string, handler: (event: never) => void) => {
          listeners[name] = handler;
        },
      },
      window: {
        addEventListener: (name: string, handler: (event: never) => void) => {
          listeners[name] = handler;
        },
      },
    });
    listeners["apply:click"]!({} as never);
    expect(nodes["#review-status"]!.textContent).toContain("Preview only");
    expect(nodes["#review-status"]!.textContent).toContain(
      "No configuration, resources or files were changed",
    );
    listeners.message!({
      data: {
        type: "reviewState",
        token: assets.scriptNonce,
        state: "succeeded",
        message: "Saved.",
      },
    } as never);
    expect(nodes["#review-status"]!.textContent).not.toBe("Saved.");
    expect(nodes["#review-return"]!.hidden).toBe(true);
    expect(nodes["#review-apply"]!.disabled).toBe(false);
    listeners["cancel:click"]!({} as never);
    expect(nodes["#review-status"]!.textContent).toContain("Preview only");
  });

  it("focuses the heading, handles Escape, disables pending actions and preserves success", () => {
    class Node {
      disabled = false;
      hidden = false;
      textContent = "Apply changes";
      focus = vi.fn();
      setAttribute = vi.fn();
      listeners = new Map<string, () => void>();
      addEventListener(name: string, listener: () => void) {
        this.listeners.set(name, listener);
      }
      click() {
        if (!this.disabled) this.listeners.get("click")?.();
      }
    }
    const nodes = Object.fromEntries(
      ["heading", "apply", "cancel", "return", "status"].map((id) => [
        `#review-${id}`,
        new Node(),
      ]),
    );
    const listeners: Record<string, (event: never) => void> = {};
    const postMessage = vi.fn();
    const script = /<script nonce="[^"]+">([\s\S]*?)<\/script>/u.exec(
      renderReviewDocument(content, assets),
    )![1]!;
    new Script(script).runInNewContext({
      acquireVsCodeApi: () => ({ postMessage }),
      document: {
        querySelector: (selector: string) => nodes[selector],
        addEventListener: (name: string, handler: (event: never) => void) => {
          listeners[name] = handler;
        },
      },
      window: {
        addEventListener: (name: string, handler: (event: never) => void) => {
          listeners[name] = handler;
        },
      },
    });
    expect(nodes["#review-heading"]!.focus).toHaveBeenCalledOnce();
    nodes["#review-apply"]!.click();
    expect(nodes["#review-return"]!.disabled).toBe(true);
    nodes["#review-return"]!.click();
    expect(postMessage).toHaveBeenCalledWith({
      type: "applyReview",
      token: assets.scriptNonce,
    });
    nodes["#review-apply"]!.click();
    nodes["#review-cancel"]!.click();
    expect(postMessage).toHaveBeenCalledTimes(1);
    listeners.keydown!({ key: "Escape", preventDefault: vi.fn() } as never);
    expect(postMessage).toHaveBeenCalledTimes(1);
    listeners.message!({
      data: {
        type: "reviewState",
        token: assets.scriptNonce,
        state: "succeeded",
        message: "Saved.",
      },
    } as never);
    expect(nodes["#review-status"]!.textContent).toBe("Saved.");
    expect(nodes["#review-apply"]!.hidden).toBe(true);
    expect(nodes["#review-return"]!.hidden).toBe(false);
    expect(nodes["#review-return"]!.disabled).toBe(false);
    expect(nodes["#review-return"]!.focus).toHaveBeenCalledOnce();
    listeners.keydown!({ key: "Escape", preventDefault: vi.fn() } as never);
    expect(postMessage).toHaveBeenLastCalledWith({
      type: "returnFromReview",
      token: assets.scriptNonce,
    });
  });
});
