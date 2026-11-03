/** Owned workbench CDP only: real focus/Enter actions, never product handlers. */
const assert = require("node:assert/strict");
const { createHash } = require("node:crypto");
const fs = require("node:fs/promises");
const path = require("node:path");
const { setTimeout: delay } = require("node:timers/promises");

const phases = Object.freeze({
  "blocked-extensions": "Open Extensions",
  "blocked-settings": "Update Settings",
  "returned-extensions": null,
  "returned-settings": null,
});
exports.notificationButtonProbe = (label) => {
  assert.ok(["Open Extensions", "Update Settings"].includes(label));
  return `(()=>{const visible=node=>{const rect=node.getBoundingClientRect();return rect.width>0&&rect.height>0;};const items=[...document.querySelectorAll('.notification-list-item')].filter(node=>visible(node)&&node.textContent.includes('unverified reservation was preserved'));const buttons=items.flatMap(item=>[...item.querySelectorAll('button,[role=button],.monaco-button')]).filter(node=>visible(node)&&!node.disabled&&(node.getAttribute('aria-label')||node.textContent).trim()===${JSON.stringify(label)});if(buttons.length!==1)return false;buttons[0].focus();return document.hasFocus()&&document.activeElement===buttons[0];})()`;
};
exports.parseOwnedDevtoolsPort = (value) => {
  assert.ok(typeof value === "string" && value.length < 256);
  const [port, endpoint, ...extra] = value.trim().split("\n");
  assert.ok(extra.length === 0 && /^\d{1,5}$/u.test(port));
  assert.ok(Number(port) > 0 && Number(port) < 65536);
  assert.match(endpoint, /^\/devtools\/browser\/[A-Za-z0-9-]+$/u);
  return `ws://127.0.0.1:${port}${endpoint}`;
};
exports.driveUpdateUi = async ({
  profile,
  root,
  evidence,
  signal,
  interactive,
}) => {
  const wait = async (check, milliseconds = 30000) => {
    const end = Date.now() + milliseconds;
    do {
      signal.throwIfAborted();
      const value = await check(end);
      if (value) return value;
      const remaining = end - Date.now();
      if (remaining <= 0) break;
      await delay(Math.min(100, remaining), undefined, { signal });
    } while (Date.now() < end);
    throw Error("Owned update UI observation incomplete.");
  };
  const address = exports.parseOwnedDevtoolsPort(
    await wait(() =>
      fs
        .readFile(path.join(profile, "DevToolsActivePort"), "utf8")
        .catch((error) => {
          if (error.code === "ENOENT") return null;
          throw error;
        }),
    ),
  );
  const socket = new WebSocket(address);
  let next = 0;
  const pending = new Map();
  const cancel = () => {
    for (const request of pending.values()) {
      clearTimeout(request.timer);
      request.reject(Error("Owned update CDP closed."));
    }
    pending.clear();
    socket.close();
  };
  signal.addEventListener("abort", cancel, { once: true });
  socket.addEventListener("message", (event) => {
    const message = JSON.parse(String(event.data));
    const request = pending.get(message.id);
    if (!request) return;
    pending.delete(message.id);
    clearTimeout(request.timer);
    if (message.error) request.reject(Error("Owned update CDP refused."));
    else request.resolve(message.result);
  });
  const send = (method, params = {}, sessionId, end = Date.now() + 15000) =>
    new Promise((resolve, reject) => {
      if (
        signal.aborted ||
        socket.readyState !== WebSocket.OPEN ||
        end <= Date.now()
      ) {
        reject(Error("Owned update CDP unavailable."));
        return;
      }
      const id = ++next;
      const timer = setTimeout(
        () => {
          pending.delete(id);
          reject(Error("Owned update CDP response incomplete."));
        },
        Math.min(15000, end - Date.now()),
      );
      pending.set(id, { resolve, reject, timer });
      socket.send(
        JSON.stringify({
          id,
          method,
          params,
          ...(sessionId ? { sessionId } : {}),
        }),
      );
    });
  try {
    await wait(() => socket.readyState === WebSocket.OPEN);
    let shape = {
      targets: 0,
      pages: 0,
      nativePages: 0,
      workbenches: 0,
      foreignWorkbenches: 0,
    };
    let page;
    try {
      page = await wait(async (end) => {
        const targets = await send("Target.getTargets", {}, undefined, end);
        assert.ok(
          Array.isArray(targets.targetInfos) &&
            targets.targetInfos.length <= 256,
        );
        const pages = targets.targetInfos.filter(
          (item) => item?.type === "page",
        );
        assert.ok(
          pages.every(
            (item) => typeof item.url === "string" && item.url.length <= 8192,
          ),
        );
        const workbenches = pages.filter((item) =>
          item.url.includes("workbench"),
        );
        const native = (url) => /^vscode-file:\/\/vscode-app\//u.test(url);
        const foreign = workbenches.filter(
          (item) =>
            !native(item.url) ||
            !new URL(item.url).pathname.endsWith(
              "/out/vs/code/electron-browser/workbench/workbench.html",
            ),
        );
        shape = {
          targets: targets.targetInfos.length,
          pages: pages.length,
          nativePages: pages.filter((item) => native(item.url)).length,
          workbenches: workbenches.length,
          foreignWorkbenches: foreign.length,
        };
        assert.equal(
          foreign.length,
          0,
          "An unverified workbench target was refused.",
        );
        assert.ok(
          workbenches.length <= 1,
          "Exactly one owned workbench is required.",
        );
        return workbenches[0] ?? null;
      });
    } catch (error) {
      try {
        await fs.writeFile(
          path.join(evidence, "workbench-readiness.json"),
          JSON.stringify({
            status: "failed",
            scope: "owned-workbench-readiness",
            ...shape,
          }) + "\n",
          { mode: 0o600, flag: "wx" },
        );
      } catch (diagnostic) {
        throw new AggregateError(
          [error, diagnostic],
          "Owned workbench readiness failed; its bounded diagnostic could not be retained.",
        );
      }
      throw error;
    }
    const { sessionId } = await send("Target.attachToTarget", {
      targetId: page.targetId,
      flatten: true,
    });
    const evaluate = async (expression, end) => {
      const result = await send(
        "Runtime.evaluate",
        { expression, returnByValue: true },
        sessionId,
        end,
      );
      assert.ok(!result.exceptionDetails);
      return result.result.value;
    };
    // Match the maintained Chromium keyboard drivers: Enter carries carriage-return text.
    const enter = async () => {
      for (const type of ["keyDown", "keyUp"])
        await send(
          "Input.dispatchKeyEvent",
          {
            type,
            key: "Enter",
            code: "Enter",
            windowsVirtualKeyCode: 13,
            modifiers: 0,
            ...(type === "keyDown" ? { text: "\r", unmodifiedText: "\r" } : {}),
          },
          sessionId,
        );
    };
    await send("Page.bringToFront", {}, sessionId);
    const observations = [],
      handled = new Set();
    while (true) {
      const phase = await wait(async () => {
        const consent = await evaluate(
          `(()=>{const dialogs=[...document.querySelectorAll('[role=dialog],[role=alertdialog]')].filter(node=>node.textContent.includes('Allow optional Rehearsal update checks?'));const buttons=dialogs.flatMap(node=>[...node.querySelectorAll('button,[role=button]')]).filter(node=>(node.getAttribute('aria-label')||node.textContent).trim()==="Don't Ask Again"&&node.getBoundingClientRect().width>0);if(buttons.length!==1)return false;buttons[0].focus();return document.activeElement===buttons[0];})()`,
        );
        if (consent) {
          await enter();
        }
        let value;
        try {
          value = JSON.parse(
            await fs.readFile(path.join(root, "phase.json"), "utf8"),
          );
        } catch (error) {
          if (error.code === "ENOENT") return null;
          throw error;
        }
        return value.phase !== "starting" && !handled.has(value.nonce) && value;
      }, 180000);
      assert.match(phase.nonce, /^[a-f0-9-]{36}$/u);
      if (phase.phase === "done") {
        assert.deepEqual(
          observations.map((item) => item.phase),
          interactive
            ? [
                "blocked-extensions",
                "returned-extensions",
                "blocked-settings",
                "returned-settings",
              ]
            : [],
        );
        return observations;
      }
      assert.equal(interactive, true);
      assert.ok(Object.hasOwn(phases, phase.phase));
      const button = phases[phase.phase];
      if (button) {
        let dispatched = false;
        try {
          await send("Page.bringToFront", {}, sessionId);
          await wait((end) =>
            evaluate(exports.notificationButtonProbe(button), end),
          );
          const warning = await send(
            "Page.captureScreenshot",
            { format: "png" },
            sessionId,
          );
          const warningBytes = Buffer.from(warning.data, "base64");
          assert.ok(
            warningBytes.length > 0 && warningBytes.length < 16 * 1024 * 1024,
          );
          await fs.writeFile(
            path.join(evidence, `${phase.phase}-warning.png`),
            warningBytes,
            { mode: 0o600 },
          );
          // A notification arriving during the screenshot must not receive our Enter.
          assert.equal(
            await evaluate(exports.notificationButtonProbe(button)),
            true,
          );
          await enter();
          dispatched = true;
          const expected =
            button === "Open Extensions"
              ? "@id:rehearsal-db.rehearsal-db"
              : "rehearsal.automaticUpdates";
          await wait((end) =>
            evaluate(
              `(()=>[...document.querySelectorAll('input,textarea')].some(node=>node.value===${JSON.stringify(expected)}&&node.getBoundingClientRect().width>0))()`,
              end,
            ),
          );
        } catch (error) {
          const end = Date.now() + 2000,
            failures = [error];
          try {
            const expected =
              button === "Open Extensions"
                ? "@id:rehearsal-db.rehearsal-db"
                : "rehearsal.automaticUpdates";
            const state = await evaluate(
              `(()=>{const visible=node=>node.getBoundingClientRect().width>0;const inputs=[...document.querySelectorAll('input,textarea')].filter(visible);const warnings=[...document.querySelectorAll('.notification-list-item')].filter(node=>visible(node)&&node.textContent.includes('unverified reservation was preserved'));return {pageFocused:document.hasFocus(),warningVisible:warnings.length>0,actionFocused:warnings.some(node=>[...node.querySelectorAll('button,[role=button],.monaco-button')].some(button=>button===document.activeElement&&(button.getAttribute('aria-label')||button.textContent).trim()===${JSON.stringify(button)})),visibleInputs:Math.min(inputs.length,256),matchingInputs:Math.min(inputs.filter(node=>node.value===${JSON.stringify(expected)}).length,256)};})()`,
              end,
            );
            assert.ok(
              state &&
                typeof state.pageFocused === "boolean" &&
                typeof state.warningVisible === "boolean" &&
                typeof state.actionFocused === "boolean",
            );
            assert.ok(
              [state.visibleInputs, state.matchingInputs].every(
                (value) =>
                  Number.isSafeInteger(value) && value >= 0 && value <= 256,
              ),
            );
            await fs.writeFile(
              path.join(evidence, `${phase.phase}-failed.json`),
              JSON.stringify({
                status: "failed",
                phase: phase.phase,
                keyboardPairDispatched: dispatched,
                pageFocused: state.pageFocused,
                warningVisible: state.warningVisible,
                actionFocused: state.actionFocused,
                visibleInputs: state.visibleInputs,
                matchingInputs: state.matchingInputs,
              }) + "\n",
              { mode: 0o600, flag: "wx" },
            );
          } catch (diagnostic) {
            failures.push(diagnostic);
          }
          try {
            const capture = await send(
              "Page.captureScreenshot",
              { format: "png" },
              sessionId,
              end,
            );
            const bytes = Buffer.from(capture.data, "base64");
            assert.ok(bytes.length > 0 && bytes.length < 16 * 1024 * 1024);
            await fs.writeFile(
              path.join(evidence, `${phase.phase}-failed.png`),
              bytes,
              { mode: 0o600, flag: "wx" },
            );
          } catch (diagnostic) {
            failures.push(diagnostic);
          }
          if (failures.length > 1)
            throw new AggregateError(
              failures,
              "Owned update UI action failed; bounded diagnostic capture was incomplete.",
            );
          throw error;
        }
      }
      const capture = await send(
        "Page.captureScreenshot",
        { format: "png" },
        sessionId,
      );
      const bytes = Buffer.from(capture.data, "base64");
      assert.ok(bytes.length > 0 && bytes.length < 16 * 1024 * 1024);
      await fs.writeFile(path.join(evidence, `${phase.phase}.png`), bytes, {
        mode: 0o600,
      });
      observations.push({
        phase: phase.phase,
        keyboardAction: button,
        screenshotSha256: createHash("sha256").update(bytes).digest("hex"),
      });
      await fs.writeFile(
        path.join(root, "ack.json.new"),
        JSON.stringify({ phase: phase.phase, nonce: phase.nonce }),
        { mode: 0o600 },
      );
      await fs.rename(
        path.join(root, "ack.json.new"),
        path.join(root, "ack.json"),
      );
      handled.add(phase.nonce);
    }
  } finally {
    signal.removeEventListener("abort", cancel);
    cancel();
  }
};
