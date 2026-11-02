import { Script } from "node:vm";
import { afterEach, describe, expect, it, vi } from "vitest";

const editor = vi.hoisted(() => {
  const uri = (path: string) => ({ path, toString: () => `file://${path}` });
  const create = () => {
    let closed = false;
    const messages = new Set<(value: unknown) => void>();
    const disposals = new Set<() => void>();
    return {
      dispose: vi.fn(() => {
        if (closed) return;
        closed = true;
        [...disposals].forEach((listener) => listener());
      }),
      onDidDispose: (listener: () => void) => {
        disposals.add(listener);
        return { dispose: () => disposals.delete(listener) };
      },
      receive: (value: unknown) =>
        [...messages].forEach((listener) => listener(value)),
      webview: {
        html: "",
        cspSource: "vscode-webview-resource:",
        asWebviewUri: (value: ReturnType<typeof uri>) => value,
        onDidReceiveMessage: (listener: (value: unknown) => void) => {
          messages.add(listener);
          return { dispose: () => messages.delete(listener) };
        },
      },
    };
  };
  const panels: ReturnType<typeof create>[] = [];
  return {
    uri,
    panels,
    createPanel: vi.fn(() => {
      const panel = create();
      panels.push(panel);
      return panel;
    }),
  };
});

vi.mock("vscode", () => ({
  Uri: {
    joinPath: (root: ReturnType<typeof editor.uri>, ...parts: string[]) =>
      editor.uri([root.path, ...parts].join("/")),
  },
  ViewColumn: { Active: 1 },
  window: { createWebviewPanel: editor.createPanel },
}));

import {
  RehearsalUpdatePrompts,
  type UpdatePromptOptions,
} from "../../src/updates/update_prompt.js";
import {
  parseUpdatePromptMessage,
  renderUpdatePromptDocument,
  type UpdatePromptContent,
  type UpdatePromptChoice,
} from "../../src/updates/update_prompt_view.js";

const content = (): UpdatePromptContent => ({
  workspaceName: "Independent fixture",
  core: { installed: "1.0.0", available: "1.0.1", eligible: true },
  extension: { installed: "0.1.17", available: "0.1.18" },
  channel: "stable",
  automatic: { extension: false, cli: false },
});
const options = (): UpdatePromptOptions => ({
  ...content(),
  workspaceKey: "file:///private-fixture",
  canApply: vi.fn(),
});
const assets = {
  resourceSource: "vscode-webview-resource:",
  stylesheetUri: "vscode-webview-resource:/extension/media/workspace.css",
  scriptNonce: "synthetic-update-nonce",
};
const owners: RehearsalUpdatePrompts[] = [];
const owner = () => {
  const result = new RehearsalUpdatePrompts(editor.uri("/extension") as never);
  owners.push(result);
  return result;
};
const panel = () => editor.panels.at(-1)!;
const message = (
  choice: UpdatePromptChoice,
  automatic = { extension: true, cli: true },
  target = panel(),
) => ({
  type: "updatePromptChoice",
  token: /const token="([A-Za-z0-9_-]+)"/u.exec(target.webview.html)![1],
  choice,
  automatic,
});

afterEach(() => {
  owners.splice(0).forEach((value) => value.dispose());
  editor.panels.splice(0);
  vi.clearAllMocks();
});

describe("independent update preferences view", () => {
  it("starts with independent unchecked opt-ins and explains their separate scope", () => {
    const html = renderUpdatePromptDocument(content(), assets);
    expect(html).toContain(
      'id="automatic-extension" type="checkbox" aria-describedby',
    );
    expect(html).toContain(
      'id="automatic-cli" type="checkbox" aria-describedby',
    );
    expect(html).not.toMatch(/type="checkbox" checked/u);
    expect(html).toContain(
      "manifest and lockfile with install scripts ignored",
    );
    expect(html).toContain("no forced window reload");
    expect(html).toContain("VS Code user settings");
    expect(html).toContain("no database operation");
    expect(html).toContain("default-src 'none'");
    expect(html).toContain("connect-src 'none'");
    expect(html).toContain('role="status" aria-live="polite"');
  });
  it("shows existing settings, only available actions, and labels unsupported CLI review honestly", () => {
    const current = content();
    const html = renderUpdatePromptDocument(
      {
        ...current,
        automatic: { extension: true, cli: false },
        core: { ...current.core!, eligible: false },
        extension: null,
      },
      assets,
    );
    expect(html).toContain('id="automatic-extension" type="checkbox" checked');
    expect(html).toContain(
      'id="automatic-cli" type="checkbox" aria-describedby',
    );
    expect(html).toContain('data-update-choice="core">Review CLI</button>');
    expect(html).not.toContain('id="update-extension"');
    expect(html).toContain(
      "will not be installed automatically from this prompt",
    );
  });
  it("escapes all variable content and bounds malformed data and nonce authorization", () => {
    const html = renderUpdatePromptDocument(
      {
        ...content(),
        workspaceName: "<img src=x onerror=bad()>",
        extension: { installed: "<script>bad()</script>", available: "0.1.18" },
      },
      assets,
    );
    expect(html).toContain("&lt;img src=x");
    expect(html).not.toContain("<img");
    expect(html.match(/<script /gu)).toHaveLength(1);
    expect(() =>
      renderUpdatePromptDocument(
        { ...content(), workspaceName: "x".repeat(301) },
        assets,
      ),
    ).toThrow();
    expect(() =>
      renderUpdatePromptDocument(content(), {
        ...assets,
        scriptNonce: 'unsafe"token',
      }),
    ).toThrow();
    expect(() =>
      renderUpdatePromptDocument(
        { ...content(), automatic: { extension: true, cli: "yes" } as never },
        assets,
      ),
    ).toThrow();
  });
  it("runs the actual fixed-action controller without Node globals and submits once", () => {
    const html = renderUpdatePromptDocument(content(), assets);
    const sent: unknown[] = [];
    const focus = vi.fn();
    const listeners = new Map<string, () => void>();
    const choices = [
      "core",
      "extension",
      "preferences",
      "later",
      "skip",
      "disable",
    ];
    const controls = choices.map((choice) => ({
      dataset: { updateChoice: choice },
      disabled: false,
      addEventListener: (_name: string, listener: () => void) =>
        listeners.set(choice, listener),
    }));
    const script = /<script nonce="[^"]+">([\s\S]*?)<\/script>/u.exec(
      html,
    )![1]!;
    new Script(script).runInNewContext(
      {
        acquireVsCodeApi: () => ({
          postMessage: (value: unknown) => sent.push(value),
        }),
        document: {
          querySelectorAll: () => controls,
          querySelector: (selector: string) => ({
            checked: selector === "#automatic-extension",
            focus,
          }),
        },
      },
      { timeout: 1000 },
    );
    listeners.get("preferences")!();
    listeners.get("extension")!();
    expect(sent).toEqual([
      {
        type: "updatePromptChoice",
        token: assets.scriptNonce,
        choice: "preferences",
        automatic: { extension: true, cli: false },
      },
    ]);
    expect(controls.every((control) => control.disabled)).toBe(true);
    expect(focus).toHaveBeenCalledOnce();
  });
});

describe("update choice and consent boundary", () => {
  it.each(["core", "extension", "preferences"] as const)(
    "returns separately selected flags only for explicit %s choice",
    async (choice) => {
      const input = options();
      const pending = owner().prompt(input);
      panel().receive(message(choice, { extension: true, cli: false }));
      await expect(pending).resolves.toEqual({
        choice,
        automatic: { extension: true, cli: false },
      });
      expect(input.canApply).toHaveBeenCalledTimes(2);
      expect(input.automatic).toEqual({ extension: false, cli: false });
      expect(panel().dispose).toHaveBeenCalledOnce();
    },
  );
  it.each(["later", "skip", "disable"] as const)(
    "does not apply checkbox drafts on %s",
    async (choice) => {
      const input = {
        ...options(),
        automatic: { extension: false, cli: true },
      };
      const pending = owner().prompt(input);
      panel().receive(message(choice, { extension: true, cli: false }));
      await expect(pending).resolves.toEqual({
        choice,
        automatic: { extension: false, cli: true },
      });
    },
  );
  it("does not save checkbox edits when merely reviewing an unsupported CLI update", async () => {
    const input = {
      ...options(),
      core: { installed: null, available: "2.0.0", eligible: false },
    };
    const pending = owner().prompt(input);
    panel().receive(message("core"));
    await expect(pending).resolves.toEqual({
      choice: "core",
      automatic: { extension: false, cli: false },
    });
  });
  it("closing or disposing the prompt makes no preference choice", async () => {
    const input = options();
    const prompts = owner();
    const first = prompts.prompt(input);
    panel().dispose();
    await expect(first).resolves.toBeUndefined();
    expect(input.canApply).toHaveBeenCalledTimes(2);
    const second = prompts.prompt({
      ...options(),
      workspaceKey: "file:///second",
    });
    prompts.dispose();
    await expect(second).resolves.toBeUndefined();
  });
  it("rejects malformed, injected, unavailable and foreign-token messages", async () => {
    const input = { ...options(), core: null };
    const pending = owner().prompt(input);
    const valid = message("extension");
    for (const raw of [
      null,
      [],
      "extension",
      {},
      { ...valid, type: "runCommand" },
      { ...valid, token: "foreign" },
      { ...valid, command: "install" },
      { ...valid, automatic: { extension: true, cli: true, extra: true } },
      { ...valid, automatic: { extension: "true", cli: true } },
      { ...valid, choice: "core" },
      { ...valid, choice: { toString: null } },
    ])
      panel().receive(raw);
    expect(input.canApply).toHaveBeenCalledOnce();
    panel().receive(message("later"));
    await expect(pending).resolves.toEqual({
      choice: "later",
      automatic: { extension: false, cli: false },
    });
  });
  it("refuses a choice after authorization changes without exposing raw errors or retrying", async () => {
    const canApply = vi.fn();
    const pending = owner().prompt({ ...options(), canApply });
    canApply.mockImplementation(() => {
      throw new Error("PRIVATE_CANARY");
    });
    panel().receive(message("extension"));
    await expect(pending).resolves.toBeUndefined();
    expect(canApply).toHaveBeenCalledTimes(2);
    expect(panel().webview.html).not.toContain("PRIVATE_CANARY");
    expect(editor.createPanel).toHaveBeenCalledOnce();
  });
  it("keeps cancellation flags from the opened snapshot rather than a mutated caller object", async () => {
    const input = options();
    const pending = owner().prompt(input);
    Object.assign(input.automatic, { extension: true, cli: true });
    panel().receive(message("skip"));
    await expect(pending).resolves.toEqual({
      choice: "skip",
      automatic: { extension: false, cli: false },
    });
  });
  it("bounds simultaneous prompts, never borrows another project's pending choice, and fails closed after disposal", async () => {
    const prompts = owner();
    const waiting = Array.from({ length: 16 }, (_, index) =>
      prompts.prompt({ ...options(), workspaceKey: `project-${index}` }),
    );
    await expect(
      prompts.prompt({ ...options(), workspaceKey: "project-0" }),
    ).resolves.toBeUndefined();
    await expect(
      prompts.prompt({ ...options(), workspaceKey: "project-overflow" }),
    ).resolves.toBeUndefined();
    expect(editor.createPanel).toHaveBeenCalledTimes(16);
    prompts.dispose();
    expect(await Promise.all(waiting)).toEqual(
      Array.from({ length: 16 }, () => undefined),
    );
    await expect(prompts.prompt(options())).resolves.toBeUndefined();
  });
  it("returns no result for actions not offered by the rendered prompt", () => {
    const withoutExtension = { ...content(), extension: null };
    expect(
      parseUpdatePromptMessage(
        {
          type: "updatePromptChoice",
          token: assets.scriptNonce,
          choice: "extension",
          automatic: { extension: true, cli: false },
        },
        assets.scriptNonce,
        withoutExtension,
      ),
    ).toBeUndefined();
  });
});
