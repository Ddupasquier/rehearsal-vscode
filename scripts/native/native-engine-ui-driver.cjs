/** Bounded CDP driver for one captured, isolated editor profile. Never discovers other editors. */
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const { setTimeout: delay } = require("node:timers/promises");
const {
  updateConsentQuestion,
  updateConsentDeclineLabel,
  declinedUpdateConsent,
  unboundDraftPreserved,
} = require("./native-engine-ui-contract.cjs");
const [profile, root] = process.argv.slice(2);
let step = "input",
  diagnosticRoot;
const checkpoint = async (value) => {
  step = value;
  if (diagnosticRoot)
    await fs.writeFile(
      path.join(diagnosticRoot, "engine-ui-driver-phase.json"),
      JSON.stringify({ step, status: "running" }),
      { mode: 0o600 },
    );
};
const deadline = Date.now() + 115000;
const wait = async (fn, ms = 30000) => {
  const end = Math.min(deadline, Date.now() + ms);
  while (Date.now() < end) {
    const value = await fn().catch(() => null);
    if (value) return value;
    await delay(75);
  }
  throw Error("Owned UI state timed out.");
};
(async () => {
  assert.ok(path.isAbsolute(profile) && path.isAbsolute(root));
  assert.equal(await fs.realpath(root), root);
  assert.ok(profile.startsWith(root + path.sep));
  diagnosticRoot = root;
  const content = await wait(() =>
    fs.readFile(path.join(profile, "DevToolsActivePort"), "utf8"),
  );
  const [rawPort, endpoint] = content.trim().split("\n");
  const port = Number(rawPort);
  assert.ok(Number.isInteger(port) && port > 0 && port < 65536);
  assert.match(endpoint, /^\/devtools\/browser\/[A-Za-z0-9-]+$/);
  const ws = new WebSocket(`ws://127.0.0.1:${port}${endpoint}`);
  await new Promise((resolve, reject) => {
    ws.addEventListener("open", resolve, { once: true });
    ws.addEventListener("error", reject, { once: true });
  });
  let nextId = 0;
  const pending = new Map(),
    contexts = new Map();
  const runtimeFaults = {
    syntax: 0,
    reference: 0,
    type: 0,
    duplicateApi: 0,
    csp: 0,
    other: 0,
  };
  let lastLiveObservations = [];
  ws.addEventListener("message", (event) => {
    const value = JSON.parse(String(event.data));
    if (value.id) {
      const entry = pending.get(value.id);
      if (entry) {
        pending.delete(value.id);
        value.error
          ? entry.reject(Error("Owned CDP request refused."))
          : entry.resolve(value.result);
      }
    } else if (value.method === "Runtime.executionContextCreated") {
      const id = value.params.context.id;
      contexts.set(`${value.sessionId}:${id}`, {
        session: value.sessionId,
        id,
        mainWorld: value.params.context.auxData?.isDefault === true,
      });
    } else if (value.method === "Runtime.exceptionThrown") {
      const exception = value.params.exceptionDetails.exception;
      const category =
        {
          SyntaxError: "syntax",
          ReferenceError: "reference",
          TypeError: "type",
        }[exception?.className] || "other";
      runtimeFaults[category]++;
      if (
        exception?.description?.includes(
          "VS Code API has already been acquired",
        )
      )
        runtimeFaults.duplicateApi++;
    } else if (value.method === "Log.entryAdded") {
      if (
        value.params.entry.source === "security" &&
        /Content Security Policy|Refused to execute inline script/u.test(
          value.params.entry.text,
        )
      )
        runtimeFaults.csp++;
    } else if (value.method === "Runtime.executionContextDestroyed") {
      contexts.delete(`${value.sessionId}:${value.params.executionContextId}`);
    }
  });
  const send = (method, params = {}, sessionId) =>
    new Promise((resolve, reject) => {
      const id = ++nextId;
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(Error("Owned CDP request timeout."));
      }, 5000);
      pending.set(id, {
        resolve: (value) => {
          clearTimeout(timer);
          resolve(value);
        },
        reject: (error) => {
          clearTimeout(timer);
          reject(error);
        },
      });
      ws.send(
        JSON.stringify({
          id,
          method,
          params,
          ...(sessionId ? { sessionId } : {}),
        }),
      );
    });
  const attached = new Set();
  let workbenchSession;
  const discover = async () => {
    const { targetInfos } = await send("Target.getTargets");
    for (const target of targetInfos) {
      if (
        !["page", "iframe"].includes(target.type) ||
        attached.has(target.targetId)
      )
        continue;
      const { sessionId } = await send("Target.attachToTarget", {
        targetId: target.targetId,
        flatten: true,
      });
      attached.add(target.targetId);
      if (target.type === "page" && target.url.startsWith("vscode-file://"))
        workbenchSession = sessionId;
      await send("Runtime.enable", {}, sessionId);
      await send("Log.enable", {}, sessionId).catch(() => {});
    }
  };
  const evaluate = async (context, expression) =>
    (
      await send(
        "Runtime.evaluate",
        { expression, contextId: context.id, returnByValue: true },
        context.session,
      )
    ).result?.value;
  const classify = async () => {
    const observations = [];
    for (const context of contexts.values()) {
      const result = await evaluate(
        context,
        `(()=>{const visible=selector=>[...document.querySelectorAll(selector)].filter(node=>{const rect=node.getBoundingClientRect();return rect.width>0&&rect.height>0;});const status=document.querySelector('#review-status')?.textContent||'';return {ready:document.readyState==='complete',apiPresent:typeof acquireVsCodeApi==='function',previewOnly:status.includes('Preview only.'),optionalUpdateQuestion:visible('[role=dialog],[role=alertdialog]').some(node=>node.textContent.includes('Allow optional Rehearsal update checks?')),ownedWorkspace:document.title.startsWith('Synthetic native VM controls'),review:Boolean(document.querySelector('#review-apply')),customDialogs:visible('.monaco-dialog-box').length,roleDialogs:visible('[role=dialog]').length,wholeVmQuestion:visible('[role=dialog],[role=alertdialog]').some(node=>node.textContent.includes('Shut down this shared VM?')),confirmationButton:visible('.monaco-dialog-box .monaco-button').some(node=>node.textContent.trim()==='Shut Down VM'),reviewProcessing:status.includes('Processing your reviewed action'),reviewFailed:status.includes('could not be confirmed')||status.includes('not confirmed'),reviewCancelled:status.includes('Confirmation cancelled')};})()`,
      ).catch(() => null);
      if (result)
        observations.push({ ...result, mainWorld: context.mainWorld });
    }
    if (observations.length) lastLiveObservations = observations;
    await fs.writeFile(
      path.join(root, "engine-ui-observation.json"),
      JSON.stringify({
        step,
        observations: observations.length ? observations : lastLiveObservations,
        runtimeFaults,
      }),
      { mode: 0o600 },
    );
  };
  const find = async (selector, ownedWorkspace = false, question = null) =>
    wait(async () => {
      await discover();
      for (const context of contexts.values())
        if (
          context.mainWorld &&
          (await evaluate(
            context,
            `(()=>{if(${JSON.stringify(ownedWorkspace)} && !document.title.startsWith("Synthetic native VM controls"))return false;const node=[...document.querySelectorAll(${JSON.stringify(selector)})].find(node=>!${JSON.stringify(question)} || node.textContent.includes(${JSON.stringify(question)}));if(!node || document.readyState!=='complete')return false;const rect=node.getBoundingClientRect();return rect.width>0 && rect.height>0;})()`,
          ).catch(() => false))
        )
          return context;
      return null;
    });
  const key = async (context, name) => {
    const code = name === "Enter" ? 13 : name === "Escape" ? 27 : 9;
    await send(
      "Input.dispatchKeyEvent",
      {
        type: "keyDown",
        key: name,
        code: name,
        windowsVirtualKeyCode: code,
        ...(name === "Enter" ? { text: "\r", unmodifiedText: "\r" } : {}),
      },
      context.session,
    );
    await send(
      "Input.dispatchKeyEvent",
      { type: "keyUp", key: name, code: name, windowsVirtualKeyCode: code },
      context.session,
    );
  };
  const screenshot = async (name) => {
    assert.ok(
      /^(?:dark|light|high-contrast|unbound)-(?:dashboard|review|returned)$/u.test(
        name,
      ),
    );
    assert.ok(workbenchSession);
    const result = await send(
      "Page.captureScreenshot",
      { format: "png", captureBeyondViewport: false, fromSurface: true },
      workbenchSession,
    );
    const bytes = Buffer.from(result.data, "base64");
    assert.ok(bytes.length > 0 && bytes.length <= 8 * 1024 * 1024);
    await fs.writeFile(path.join(root, `engine-ui-${name}.png`), bytes, {
      mode: 0o600,
    });
  };
  const activate = async (selector, ownedWorkspace = false) => {
    const context = await find(`${selector}:not(:disabled)`, ownedWorkspace);
    await wait(async () => {
      const remote = await send(
        "Runtime.evaluate",
        {
          expression: `document.querySelector(${JSON.stringify(selector)})`,
          contextId: context.id,
        },
        context.session,
      );
      if (!remote.result?.objectId) return false;
      const result = await send(
        "DOMDebugger.getEventListeners",
        { objectId: remote.result.objectId },
        context.session,
      );
      return result.listeners.some((listener) => listener.type === "click");
    }, 5000);
    assert.equal(
      await evaluate(
        context,
        `(()=>{const node=document.querySelector(${JSON.stringify(selector)});if(node.disabled)return false;node.focus();return document.activeElement===node;})()`,
      ),
      true,
    );
    await key(context, "Enter");
    return context;
  };
  try {
    await checkpoint("dirty-ready");
    await wait(async () => {
      const phase = JSON.parse(
        await fs.readFile(path.join(root, "engine-ui-phase.json"), "utf8"),
      );
      return phase.scenario === "unbound-draft" && phase.state === "ready";
    });
    await checkpoint("first-use-update-consent");
    const consent = await find(
      '[role="dialog"],[role="alertdialog"]',
      false,
      updateConsentQuestion,
    );
    await checkpoint("first-use-question-found");
    const labels = await evaluate(
      consent,
      `(()=>{const dialog=[...document.querySelectorAll('[role=dialog],[role=alertdialog]')].find(node=>node.textContent.includes(${JSON.stringify(updateConsentQuestion)}));return [...dialog.querySelectorAll('button,[role=button],.monaco-button')].filter(node=>{const rect=node.getBoundingClientRect();return rect.width>0&&rect.height>0;}).map(node=>(node.getAttribute('aria-label')||node.textContent).trim());})()`,
    );
    assert.equal(
      declinedUpdateConsent(true, labels),
      updateConsentDeclineLabel,
    );
    assert.equal(
      await evaluate(
        consent,
        `(()=>{const dialog=[...document.querySelectorAll('[role=dialog],[role=alertdialog]')].find(node=>node.textContent.includes(${JSON.stringify(updateConsentQuestion)}));const button=[...dialog.querySelectorAll('button,[role=button],.monaco-button')].find(node=>(node.getAttribute('aria-label')||node.textContent).trim()===${JSON.stringify(updateConsentDeclineLabel)});if(!button)return false;button.focus();return document.activeElement===button;})()`,
      ),
      true,
    );
    await checkpoint("first-use-decline-focused");
    await key(consent, "Enter");
    await checkpoint("first-use-decline-key-sent");
    await wait(() =>
      evaluate(
        consent,
        `![...document.querySelectorAll('[role=dialog],[role=alertdialog]')].some(node=>node.textContent.includes(${JSON.stringify(updateConsentQuestion)}))`,
      ),
    );
    await checkpoint("first-use-prompt-dismissed");
    await fs.writeFile(
      path.join(root, "engine-ui-consent.json"),
      JSON.stringify({ optionalUpdateChecks: "declined", keyboard: true }),
      { mode: 0o600 },
    );
    await checkpoint("first-use-update-consent-declined");
    await checkpoint("unbound-draft-entry");
    const unbound = await find(
      '#configuration-controls input[name="applicationUrl"]',
      true,
    );
    await evaluate(
      unbound,
      "(()=>{const input=document.querySelector('#configuration-controls input[name=applicationUrl]');input.focus();input.select();window.__ownedUnboundInput=input;window.__ownedUnboundDocument=document;return true;})()",
    );
    await send(
      "Input.insertText",
      { text: "http://localhost:43219/unbound-draft" },
      unbound.session,
    );
    await screenshot("unbound-dashboard");
    await activate("[data-engine-shutdown-control]", true);
    await find("#review-return");
    await screenshot("unbound-review");
    const observeUnbound = async (view) => {
      const context = await find(
        '#configuration-controls input[name="applicationUrl"]',
        true,
      );
      const flags = await evaluate(
        context,
        "(()=>{const field=document.querySelector('#configuration-controls input[name=applicationUrl]');return {sameDocument:document===window.__ownedUnboundDocument,sameField:window.__ownedUnboundInput===field,exactValue:field.value==='http://localhost:43219/unbound-draft',browserVisible:document.visibilityState==='visible',documentFocused:document.hasFocus(),configurationPage:!document.querySelector('#configuration').hidden};})()",
      );
      await fs.writeFile(
        path.join(root, `engine-ui-unbound-${view}.json`),
        JSON.stringify(flags),
        { mode: 0o600 },
      );
      assert.equal(flags.configurationPage, true);
      assert.equal(unboundDraftPreserved(flags), true);
    };
    await observeUnbound("review");
    await checkpoint("unbound-back-navigation");
    await activate("#review-return");
    await find("[data-engine-shutdown-control]", true);
    await screenshot("unbound-returned");
    await observeUnbound("return");
    await fs.writeFile(
      path.join(root, "engine-ui-done.json"),
      JSON.stringify({
        scenario: "unbound-preserved",
        sameDocument: true,
        draftValue: true,
        keyboardBack: true,
      }),
      { mode: 0o600 },
    );
    await wait(async () => {
      const phase = JSON.parse(
        await fs.readFile(path.join(root, "engine-ui-phase.json"), "utf8"),
      );
      return phase.scenario === "dirty-draft" && phase.state === "ready";
    });
    const draft = await find(
      '#configuration-controls input[name="applicationUrl"]',
      true,
    );
    await evaluate(
      draft,
      "(()=>{const input=document.querySelector('#configuration-controls input[name=applicationUrl]');input.focus();input.select();window.__ownedEngineDraftInput=input;window.__ownedEngineDraftDocument=document;return true;})()",
    );
    await send(
      "Input.insertText",
      { text: "http://localhost:43219/owned-draft" },
      draft.session,
    );
    assert.equal(
      await evaluate(
        draft,
        "document.activeElement===window.__ownedEngineDraftInput && window.__ownedEngineDraftInput.value==='http://localhost:43219/owned-draft'",
      ),
      true,
    );
    await fs.writeFile(
      path.join(root, "engine-ui-done.json"),
      JSON.stringify({ scenario: "dirty-entered" }),
      { mode: 0o600 },
    );
    await wait(() =>
      evaluate(
        draft,
        "[...document.querySelectorAll('[data-engine-shutdown-control]')].every(node=>node.disabled) && [...document.querySelectorAll('[data-engine-shutdown-notice]')].some(node=>node.textContent.includes('Waiting for its verified outcome'))",
      ),
    );
    assert.equal(
      await evaluate(
        draft,
        "document===window.__ownedEngineDraftDocument && document.activeElement===window.__ownedEngineDraftInput && window.__ownedEngineDraftInput.value==='http://localhost:43219/owned-draft'",
      ),
      true,
    );
    await fs.writeFile(
      path.join(root, "engine-ui-done.json"),
      JSON.stringify({ scenario: "dirty-preserved" }),
      { mode: 0o600 },
    );
    for (const theme of ["dark", "light", "high-contrast"]) {
      await wait(async () => {
        const phase = JSON.parse(
          await fs.readFile(path.join(root, "engine-ui-phase.json"), "utf8"),
        );
        return phase.scenario === `style-${theme}` && phase.state === "ready";
      });
      await checkpoint(`${theme}-dashboard-style`);
      await find("[data-engine-shutdown-control]", true);
      await screenshot(`${theme}-dashboard`);
      await activate("[data-engine-shutdown-control]", true);
      await checkpoint(`${theme}-review-style`);
      await find("#review-return");
      await screenshot(`${theme}-review`);
      await checkpoint(`${theme}-back-navigation`);
      await activate("#review-return");
      await find("[data-engine-shutdown-control]", true);
      const returned = await find(
        '#configuration-controls input[name="applicationUrl"]',
        true,
      );
      await screenshot(`${theme}-returned`);
      const restored = await evaluate(
        returned,
        "(()=>{const field=document.querySelector('#configuration-controls input[name=applicationUrl]');const active=document.activeElement;return {configurationPage:!document.querySelector('#configuration').hidden,draftValue:field.value==='http://localhost:43219/owned-draft',documentFocused:document.hasFocus(),focusOnDraft:active===field,focusWithinDashboard:Boolean(active&&document.body.contains(active))};})()",
      );
      await fs.writeFile(
        path.join(root, `engine-ui-${theme}-return.json`),
        JSON.stringify(restored),
        { mode: 0o600 },
      );
      assert.equal(restored.configurationPage, true);
      assert.equal(restored.draftValue, true);
      await key(returned, "Tab");
      const logicalFocus = await evaluate(
        returned,
        "(()=>{const active=document.activeElement;return document.hasFocus()&&active!==document.body&&Boolean(active?.closest('main,header,nav,section,a,button,input,select,textarea'))&&!active.closest('[hidden]');})()",
      );
      assert.equal(logicalFocus, true);
      await fs.writeFile(
        path.join(root, "engine-ui-done.json"),
        JSON.stringify({ scenario: `style-${theme}`, backByKeyboard: true }),
        { mode: 0o600 },
      );
    }
    for (const scenario of ["cancel", "confirm-success", "confirm-uncertain"]) {
      await wait(async () => {
        const phase = JSON.parse(
          await fs.readFile(path.join(root, "engine-ui-phase.json"), "utf8"),
        );
        return phase.scenario === scenario && phase.state === "ready";
      });
      await checkpoint(`${scenario}-workspace-control`);
      await activate("[data-engine-shutdown-control]", true);
      await checkpoint(`${scenario}-review-control`);
      await activate("#review-apply");
      await checkpoint(`${scenario}-native-dialog`);
      await classify();
      const modal = await find(
        '[role="dialog"],[role="alertdialog"]',
        false,
        "Shut down this shared VM?",
      );
      await wait(() =>
        evaluate(
          modal,
          "[...document.querySelectorAll('[role=dialog],[role=alertdialog]')].some(node=>node.textContent.includes('Shut down this shared VM?'))",
        ),
      );
      if (scenario === "cancel") await key(modal, "Escape");
      else {
        assert.equal(
          await evaluate(
            modal,
            "(()=>{const dialog=[...document.querySelectorAll('[role=dialog],[role=alertdialog]')].find(node=>node.textContent.includes('Shut down this shared VM?'));const button=[...(dialog?.querySelectorAll('button,[role=button],.monaco-button')||[])].find(node=>(node.getAttribute('aria-label')||node.textContent).trim()==='Shut Down VM');if(!button)return false;button.focus();return document.activeElement===button;})()",
          ),
          true,
        );
        await key(modal, "Enter");
      }
      await checkpoint(`${scenario}-review-result`);
      const review = await find("#review-status");
      await wait(() =>
        evaluate(
          review,
          scenario === "cancel"
            ? "document.querySelector('#review-status').textContent.includes('Confirmation cancelled')"
            : scenario === "confirm-success"
              ? "document.querySelector('#review-status').textContent.includes('VM shutdown confirmed')"
              : "document.querySelector('#review-status').textContent.includes('VM shutdown is not confirmed.')",
        ),
      );
      await checkpoint(`${scenario}-back-navigation`);
      await activate("#review-return");
      await find("[data-engine-shutdown-control]", true);
      await fs.writeFile(
        path.join(root, "engine-ui-done.json"),
        JSON.stringify({
          scenario,
          keyboard: true,
          customDialog: true,
          backByKeyboard: true,
        }),
        { mode: 0o600 },
      );
    }
  } finally {
    await classify().catch(() => {});
    ws.close();
    for (const item of pending.values())
      item.reject(Error("Owned UI driver closed."));
  }
})().catch(async () => {
  if (diagnosticRoot)
    await fs
      .writeFile(
        path.join(diagnosticRoot, "engine-ui-driver-phase.json"),
        JSON.stringify({ step, status: "failed" }),
        { mode: 0o600 },
      )
      .catch(() => {});
  console.error(
    "Owned native engine UI verification failed; raw UI output withheld.",
  );
  process.exitCode = 1;
});
