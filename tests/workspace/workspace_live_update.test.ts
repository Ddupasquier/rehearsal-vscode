import { describe, expect, it } from "vitest";
import { Script } from "node:vm";
import { execFileSync } from "node:child_process";
import {
  applyOperationProgressUpdate,
  type ProgressDomDocument,
  type ProgressDomNode,
} from "../../src/workspace/workspace_live_update.js";
import { renderOperationProgress } from "../../src/runtime/operation_progress.js";
import type { ProjectSnapshot } from "../../src/workspace/project_snapshot.js";
import { renderWorkspaceDocument } from "../../src/workspace/workspace_view.js";
import {
  WORKSPACE_ACTION_IDS,
  type WorkspaceActionId,
} from "../../src/workspace/action_catalog.js";

/** DOM doubles: mutation identity is tested here; Chromium/VoiceOver are separate gates. */
class DomNode implements ProgressDomNode {
  readonly childNodes: DomNode[] = [];
  readonly attributes: { name: string; value: string }[] = [];
  parent: DomNode | null = null;
  observed = false;
  textWrites = 0;
  childWrites = 0;
  focusCalls = 0;
  private value: string | null;
  constructor(
    readonly nodeType: number,
    readonly nodeName: string,
    value: string | null = null,
  ) {
    this.value = value;
  }
  get nodeValue() {
    return this.value;
  }
  set nodeValue(value: string | null) {
    this.value = value;
    if (this.observed) this.textWrites++;
  }
  getAttribute(name: string) {
    return (
      this.attributes.find((attribute) => attribute.name === name)?.value ??
      null
    );
  }
  setAttribute(name: string, value: string) {
    const attribute = this.attributes.find(
      (attribute) => attribute.name === name,
    );
    if (attribute) attribute.value = value;
    else this.attributes.push({ name, value });
  }
  removeAttribute(name: string) {
    const index = this.attributes.findIndex(
      (attribute) => attribute.name === name,
    );
    if (index >= 0) this.attributes.splice(index, 1);
  }
  appendChild(node: ProgressDomNode) {
    const child = node as DomNode;
    child.parent = this;
    this.childNodes.push(child);
    if (this.observed) this.childWrites++;
    return child;
  }
  replaceChild(next: ProgressDomNode, previous: ProgressDomNode) {
    const index = this.childNodes.indexOf(previous as DomNode);
    this.childNodes[index] = next as DomNode;
    (next as DomNode).parent = this;
    (previous as DomNode).parent = null;
    if (this.observed) this.childWrites++;
    return previous;
  }
  removeChild(node: ProgressDomNode) {
    const index = this.childNodes.indexOf(node as DomNode);
    this.childNodes.splice(index, 1);
    (node as DomNode).parent = null;
    if (this.observed) this.childWrites++;
    return node;
  }
  cloneNode(deep: boolean): DomNode {
    const cloned = new DomNode(this.nodeType, this.nodeName, this.nodeValue);
    this.attributes.forEach(({ name, value }) =>
      cloned.setAttribute(name, value),
    );
    if (deep)
      this.childNodes.forEach((child) =>
        cloned.appendChild(child.cloneNode(true)),
      );
    return cloned;
  }
  contains(node: ProgressDomNode): boolean {
    return (
      node === this || this.childNodes.some((child) => child.contains(node))
    );
  }
  focus() {
    this.focusCalls++;
  }
  descendants(): DomNode[] {
    return [this, ...this.childNodes.flatMap((child) => child.descendants())];
  }
  text(): string {
    return this.nodeType === 3
      ? (this.nodeValue ?? "")
      : this.childNodes.map((child) => child.text()).join("");
  }
}

/** Small parser for these fixture doubles; the product uses the browser's inert template. */
const parseFixture = (html: string): DomNode => {
  const root = new DomNode(11, "#document-fragment");
  const stack = [root];
  for (const match of html.matchAll(/<!--[\s\S]*?-->|<[^>]+>|[^<]+/gu)) {
    const token = match[0];
    const parent = stack.at(-1)!;
    if (token.startsWith("<!--")) {
      parent.appendChild(new DomNode(8, "#comment", token));
      continue;
    }
    if (token.startsWith("</")) {
      stack.pop();
      continue;
    }
    if (!token.startsWith("<")) {
      parent.appendChild(new DomNode(3, "#text", token));
      continue;
    }
    const tag = /^<([a-z\d-]+)/iu.exec(token)?.[1];
    if (!tag) {
      parent.appendChild(new DomNode(10, "#doctype"));
      continue;
    }
    const element = new DomNode(1, tag.toUpperCase());
    const attributes = token.slice(1 + tag.length, -1);
    for (const attribute of attributes.matchAll(
      /([a-z\d:-]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/giu,
    )) {
      element.setAttribute(
        attribute[1]!.toLowerCase(),
        attribute[2] ?? attribute[3] ?? attribute[4] ?? "",
      );
    }
    parent.appendChild(element);
    if (
      !["img", "br", "input", "link", "meta"].includes(tag.toLowerCase()) &&
      !token.endsWith("/>")
    )
      stack.push(element);
  }
  return root;
};
const createDocument = (html: string) => {
  const root = parseFixture(html);
  const nodes = root.descendants();
  nodes.forEach((node) => (node.observed = true));
  const scrolls: { top: number; left: number }[] = [];
  const document: ProgressDomDocument = {
    getElementById: (id) => (id === "operation-progress" ? root : null),
    createElement: () => {
      let content = new DomNode(11, "#document-fragment");
      return {
        get innerHTML() {
          return "";
        },
        set innerHTML(value: string) {
          content = parseFixture(value);
        },
        get content() {
          return content;
        },
      };
    },
    activeElement: nodes.find((node) => node.nodeName === "SUMMARY") ?? null,
    scrollingElement: {
      scrollTop: 420,
      scrollLeft: 3,
      scrollTo: (position) => {
        scrolls.push(position);
      },
    },
  };
  return { root, document, scrolls, nodes };
};
const update = (html: string) => ({ type: "operationProgressUpdated", html });
const simple = (elapsed: string) =>
  `<article class="surface"><div role="status" aria-live="polite" aria-atomic="true"><dl class="detail-list"><div><dt>Elapsed at inspection</dt><dd>${elapsed}</dd></div></dl><details class="technical-details"><summary>Safe structured events</summary><ol><li>Operation started</li></ol></details></div></article>`;

describe("operation progress live reconciliation", () => {
  it("changes elapsed text without replacing existing progress, expanded details or focus", () => {
    const { root, document, nodes, scrolls } = createDocument(simple("10s"));
    const details = nodes.find((node) => node.nodeName === "DETAILS")!;
    details.setAttribute("open", "");
    const focus = document.activeElement;
    for (const elapsed of ["12s", "14s", "16s"])
      expect(
        applyOperationProgressUpdate(document, update(simple(elapsed))),
      ).toBe(true);
    expect(root.descendants()).toEqual(nodes);
    expect(root.text()).toContain("16s");
    expect(nodes.reduce((sum, node) => sum + node.childWrites, 0)).toBe(0);
    expect(nodes.reduce((sum, node) => sum + node.textWrites, 0)).toBe(3);
    expect(details.getAttribute("open")).toBe("");
    expect(document.activeElement).toBe(focus);
    expect(root.contains(focus!)).toBe(true);
    expect(root.focusCalls).toBe(0);
    expect(scrolls).toEqual(
      Array.from({ length: 3 }, () => ({ top: 420, left: 3 })),
    );
  });

  it("appends new evidence without replacing an existing focused summary", () => {
    const { root, document } = createDocument(simple("10s"));
    const focus = document.activeElement;
    const next = simple("12s").replace(
      "</ol>",
      "<li>Stage completed</li></ol>",
    );
    expect(applyOperationProgressUpdate(document, update(next))).toBe(true);
    expect(root.text()).toContain("Stage completed");
    expect(root.contains(focus!)).toBe(true);
    expect(root.descendants().find((node) => node.nodeName === "SUMMARY")).toBe(
      focus,
    );
  });

  it("preserves focus outside the progress region and safely falls back when evidence disappears", () => {
    const { root, document } = createDocument(simple("10s"));
    expect(
      applyOperationProgressUpdate(
        document,
        update(
          '<article class="surface"><p>Phase evidence is unavailable</p></article>',
        ),
      ),
    ).toBe(true);
    expect(root.focusCalls).toBe(1);
    const external = new DomNode(1, "INPUT");
    expect(
      applyOperationProgressUpdate(
        { ...document, activeElement: external },
        update(simple("12s")),
      ),
    ).toBe(true);
    expect(root.focusCalls).toBe(1);
  });

  it.each([
    null,
    { type: "unknown", html: simple("10s") },
    { type: "operationProgressUpdated", html: simple("10s"), command: "run" },
    { type: "operationProgressUpdated", html: 12 },
    update(""),
    update(" "),
    update("Arbitrary missing evidence"),
    update("x".repeat(256 * 1024 + 1)),
    update("😀".repeat(66_000)),
    update("<article><script>unsafe()</script></article>"),
    update('<article><img src="https://example.invalid/private" /></article>'),
    update('<article onclick="unsafe()">No</article>'),
    update('<article style="display:none">No</article>'),
    update('<article id="other-control">No</article>'),
    update('<article><time datetime="not-a-date">No</time></article>'),
    update("<article><!-- hidden content --></article>"),
    update(
      "<article>" +
        "<div>".repeat(26) +
        "No" +
        "</div>".repeat(26) +
        "</article>",
    ),
  ])(
    "refuses malformed, unbounded or executable messages without touching live DOM: %j",
    (message) => {
      const { root, document, nodes, scrolls } = createDocument(simple("10s"));
      expect(applyOperationProgressUpdate(document, message)).toBe(false);
      expect(root.descendants()).toEqual(nodes);
      expect(
        nodes.every((node) => node.childWrites === 0 && node.textWrites === 0),
      ).toBe(true);
      expect(scrolls).toEqual([]);
    },
  );

  it("refuses when the stable progress region is absent", () => {
    const { document } = createDocument(simple("10s"));
    expect(
      applyOperationProgressUpdate(
        { ...document, getElementById: () => null },
        update(simple("12s")),
      ),
    ).toBe(false);
  });

  it("bounds node count even when the HTML fits inside the byte limit", () => {
    const { root, document, nodes } = createDocument(simple("10s"));
    const html = `<article>${"<span></span>".repeat(20_000)}</article>`;
    expect(Buffer.byteLength(html)).toBeLessThan(256 * 1024);
    expect(applyOperationProgressUpdate(document, update(html))).toBe(false);
    expect(root.descendants()).toEqual(nodes);
    expect(
      nodes.every((node) => node.childWrites === 0 && node.textWrites === 0),
    ).toBe(true);
  });

  it("accepts actual host-rendered operation markup and keeps its elapsed update in place", () => {
    const snapshot = (elapsed: number): ProjectSnapshot => ({
      workspaceName: "synthetic",
      workspaceRoot: "/synthetic",
      availability: "operation_active",
      activity: {
        schemaVersion: 1,
        state: "busy",
        operation: {
          kind: "open",
          startedAt: "2026-10-15T12:00:00.000Z",
          rehearsalVersion: "0.1.0-rc.4",
          progress: {
            schemaVersion: 1,
            operationId: "a".repeat(64),
            state: "running",
            startedAt: "2026-10-15T12:00:00.000Z",
            updatedAt: `2026-10-15T12:00:${elapsed}.000Z`,
            elapsedMilliseconds: elapsed * 1000,
            currentStage: {
              id: 1,
              phase: "interactive-session",
              target: null,
              state: "running",
              startedAt: "2026-10-15T12:00:00.000Z",
              endedAt: null,
              durationMilliseconds: elapsed * 1000,
            },
            completedStages: [],
            events: [],
            truncated: { stages: false, events: false },
          },
        },
        recent: [],
      },
    });
    const html = renderOperationProgress(snapshot(10));
    const { root, document, nodes } = createDocument(html);
    expect(
      applyOperationProgressUpdate(
        document,
        update(renderOperationProgress(snapshot(12))),
      ),
    ).toBe(true);
    expect(root.descendants()).toEqual(nodes);
    expect(nodes.every((node) => node.childWrites === 0)).toBe(true);
    expect(root.text()).toContain("Keeping the sandbox open for interaction");
    expect(root.text()).toContain("12s");
  });

  it("is self-contained when injected into the packaged browser controller", () => {
    const { root, document } = createDocument(simple("10s"));
    const applied = new Script(
      `(${applyOperationProgressUpdate.toString()})(document,message)`,
    ).runInNewContext(
      { document, message: update(simple("12s")), TextEncoder },
      { timeout: 1000 },
    );
    expect(applied).toBe(true);
    expect(root.text()).toContain("12s");
  });

  it("supports actual tsx naming helpers inside serialized preview functions", () => {
    const serialized = execFileSync(
      process.execPath,
      [
        "--import",
        "tsx",
        "--input-type=module",
        "-e",
        "import { createRequire } from 'node:module'; const { applyOperationProgressUpdate } = createRequire(import.meta.url)('./src/workspace/workspace_live_update.ts'); process.stdout.write(applyOperationProgressUpdate.toString());",
      ],
      {
        cwd: process.cwd(),
        encoding: "utf8",
        timeout: 10_000,
        maxBuffer: 256 * 1024,
      },
    );
    expect(serialized).toContain("__name(");
    const html = renderWorkspaceDocument(
      {
        workspaceName: "synthetic",
        workspaceRoot: "/synthetic",
        availability: "loading",
      },
      {
        resourceSource: "vscode-webview-resource:",
        stylesheetUri: "vscode-resource://styles/workspace.css",
        logoUri: "vscode-resource://media/rehearsal.png",
        scriptNonce: "test-nonce",
        actionUris: Object.fromEntries(
          WORKSPACE_ACTION_IDS.map((action) => [
            action,
            `command:rehearsal.workspaceAction?${action}`,
          ]),
        ) as Record<WorkspaceActionId, string>,
      },
    );
    const binding = /const __name = value => value;/u.exec(html)?.[0];
    expect(binding).toBeDefined();
    const { root, document } = createDocument(simple("10s"));
    expect(() =>
      new Script(`(${serialized})(document,message)`).runInNewContext(
        { document, message: update(simple("12s")), TextEncoder },
        { timeout: 1000 },
      ),
    ).toThrow(/__name/u);
    expect(root.text()).toContain("10s");
    const result = new Script(
      `${binding}\n(${serialized})(document,message)`,
    ).runInNewContext(
      { document, message: update(simple("12s")), TextEncoder },
      { timeout: 1000 },
    );
    expect(result).toBe(true);
    expect(root.text()).toContain("12s");
  });
});
