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
  return `(()=>{const visible=node=>{const rect=node.getBoundingClientRect();return rect.width>0&&rect.height>0;};const items=[...document.querySelectorAll('.notification-list-item')].filter(node=>visible(node)&&node.textContent.includes('unverified reservation was preserved'));const buttons=items.flatMap(item=>[...item.querySelectorAll('button,[role=button],.monaco-button')]).filter(node=>visible(node)&&!node.disabled&&(node.getAttribute('aria-label')||node.textContent).trim()===${JSON.stringify(label)});if(buttons.length!==1)return false;buttons[0].focus();return document.activeElement===buttons[0];})()`;
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
      const value = await check();
      if (value) return value;
      await delay(100, undefined, { signal });
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
  const send = (method, params = {}, sessionId) =>
    new Promise((resolve, reject) => {
      if (signal.aborted || socket.readyState !== WebSocket.OPEN) {
        reject(Error("Owned update CDP unavailable."));
        return;
      }
      const id = ++next;
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(Error("Owned update CDP response incomplete."));
      }, 15000);
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
    const targets = await send("Target.getTargets");
    const pages = targets.targetInfos.filter(
      (item) => item.type === "page" && item.url.includes("workbench"),
    );
    assert.equal(pages.length, 1, "Exactly one owned workbench is required.");
    const { sessionId } = await send("Target.attachToTarget", {
      targetId: pages[0].targetId,
      flatten: true,
    });
    const evaluate = async (expression) => {
      const result = await send(
        "Runtime.evaluate",
        { expression, returnByValue: true },
        sessionId,
      );
      assert.ok(!result.exceptionDetails);
      return result.result.value;
    };
    const observations = [],
      handled = new Set();
    while (true) {
      const phase = await wait(async () => {
        const consent = await evaluate(
          `(()=>{const dialogs=[...document.querySelectorAll('[role=dialog],[role=alertdialog]')].filter(node=>node.textContent.includes('Allow optional Rehearsal update checks?'));const buttons=dialogs.flatMap(node=>[...node.querySelectorAll('button,[role=button]')]).filter(node=>(node.getAttribute('aria-label')||node.textContent).trim()==="Don't Ask Again"&&node.getBoundingClientRect().width>0);if(buttons.length!==1)return false;buttons[0].focus();return document.activeElement===buttons[0];})()`,
        );
        if (consent) {
          await send(
            "Input.dispatchKeyEvent",
            {
              type: "keyDown",
              key: "Enter",
              code: "Enter",
              windowsVirtualKeyCode: 13,
            },
            sessionId,
          );
          await send(
            "Input.dispatchKeyEvent",
            {
              type: "keyUp",
              key: "Enter",
              code: "Enter",
              windowsVirtualKeyCode: 13,
            },
            sessionId,
          );
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
        await wait(() => evaluate(exports.notificationButtonProbe(button)));
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
        await send(
          "Input.dispatchKeyEvent",
          {
            type: "keyDown",
            key: "Enter",
            code: "Enter",
            windowsVirtualKeyCode: 13,
          },
          sessionId,
        );
        await send(
          "Input.dispatchKeyEvent",
          {
            type: "keyUp",
            key: "Enter",
            code: "Enter",
            windowsVirtualKeyCode: 13,
          },
          sessionId,
        );
        const expected =
          button === "Open Extensions"
            ? "@id:rehearsal-db.rehearsal-db"
            : "rehearsal.automaticUpdates";
        await wait(() =>
          evaluate(
            `(()=>[...document.querySelectorAll('input,textarea')].some(node=>node.value===${JSON.stringify(expected)}&&node.getBoundingClientRect().width>0))()`,
          ),
        );
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
