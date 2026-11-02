/** Execute the compiled controller in an isolated DOM double, not a browser. */
import assert from "node:assert/strict";
import { resolve } from "node:path";
import { Script } from "node:vm";
import type { ProjectSnapshot } from "../../src/workspace/project_snapshot.js";

// Fixed build outputs only. Never resolve code from a consumer workspace.
const { renderWorkspaceDocument } = require(
  resolve(__dirname, "../../dist/src/workspace_view.js"),
) as typeof import("../../src/workspace/workspace_view.js");
const { migrationReviewIdentity } = require(
  resolve(__dirname, "../../dist/src/workspace_view_state.js"),
) as typeof import("../../src/workspace/workspace_view_state.js");
const { WORKSPACE_ACTION_IDS } = require(
  resolve(__dirname, "../../dist/src/action_catalog.js"),
) as typeof import("../../src/workspace/action_catalog.js");
const snapshot: ProjectSnapshot = {
  workspaceName: "Packaged controller check",
  workspaceRoot: "/never-displayed",
  availability: "ready",
};
const html = renderWorkspaceDocument(snapshot, {
  resourceSource: "fixture:",
  stylesheetUri: "fixture:style",
  logoUri: "fixture:logo",
  scriptNonce: "compiled-check",
  actionUris: Object.fromEntries(
    WORKSPACE_ACTION_IDS.map((id) => [id, `fixture:action/${id}`]),
  ) as Record<(typeof WORKSPACE_ACTION_IDS)[number], string>,
});
const script = /<script nonce="compiled-check">([\s\S]*?)<\/script>/u.exec(
  html,
)?.[1];
assert.ok(script);
let state: { view?: { reviewIdentity?: string; reviewed?: unknown[] } } = {
  view: { reviewIdentity: migrationReviewIdentity(snapshot), reviewed: [] },
};
class EmptyElement {}
new Script(script).runInNewContext(
  {
    acquireVsCodeApi: () => ({
      getState: () => state,
      setState: (value: typeof state) => {
        state = value;
      },
      postMessage: () => {},
    }),
    HTMLElement: EmptyElement,
    Element: EmptyElement,
    URL,
    queueMicrotask,
    FormData: class {
      entries() {
        return [][Symbol.iterator]();
      }
    },
    document: {
      activeElement: null,
      querySelector: () => null,
      querySelectorAll: () => [],
      getElementById: () => null,
      addEventListener: () => {},
      scrollingElement: { scrollTop: 0, scrollTo: () => {} },
    },
    window: {
      matchMedia: () => ({ matches: false, addEventListener: () => {} }),
      addEventListener: () => {},
    },
  },
  { timeout: 1000 },
);
assert.equal(state.view?.reviewIdentity, migrationReviewIdentity(snapshot));
assert.equal(state.view?.reviewed?.length, 0);
console.log(
  "Compiled webview controller initialized without Node globals. This is not rendered or assistive-technology acceptance.",
);
