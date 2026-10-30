/** Explicit opt-in Ubuntu hosted acceptance. Never installs/downloads Code or starts databases. */
import assert from "node:assert/strict";
import { execFile, spawn, type ChildProcess } from "node:child_process";
import { Socket } from "node:net";
import { createHash } from "node:crypto";
import { constants } from "node:fs";
import {
  copyFile,
  lstat,
  mkdir,
  mkdtemp,
  open,
  readFile,
  readdir,
  realpath,
  writeFile,
} from "node:fs/promises";
import {
  basename,
  dirname,
  isAbsolute,
  join,
  posix,
  relative,
  resolve,
} from "node:path";
import { freemem } from "node:os";
import { promisify } from "node:util";
import { setTimeout as delay } from "node:timers/promises";
import { assertArchiveContents } from "./verify-private-vsix.js";
import {
  createNativeTemporaryDirectory,
  nativeStorageRoot,
} from "./native-development-storage.js";
import {
  ownedProcessState,
  retireOwnedProcessGroup,
} from "../src/process_adapter.js";
const { shouldRetainNativeEditor } =
  require("./native-editor-recovery.cjs") as {
    shouldRetainNativeEditor: (value: unknown) => boolean;
  };
const execute = promisify(execFile),
  sha = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
const nativeObservationBudgetMs = 180000;
/** Locate a control behind native DETAILS only; inactive hidden pages stay excluded. */
export const nativeControlProbe = (
  selector: string,
  workspaceName: string,
  allowClosedDetails = false,
) =>
  `(()=>{if(document.title!==${JSON.stringify(workspaceName + " · Rehearsal")}||document.readyState!=='complete')return false;const node=document.querySelector(${JSON.stringify(selector)}),rect=node?.getBoundingClientRect();if(!node)return false;if(rect&&rect.width>0&&rect.height>0)return true;if(!${allowClosedDetails}||node.closest('[hidden]'))return false;for(let parent=node.parentElement;parent;parent=parent.parentElement)if(parent.tagName==='DETAILS'&&!parent.open)return true;return false;})()`;

async function regular(file: string, max = 64 * 1024 * 1024) {
  assert.ok(isAbsolute(file));
  assert.equal(await realpath(file), file);
  const handle = await open(
    file,
    constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
  );
  try {
    const before = await handle.stat();
    assert.ok(before.isFile() && before.size <= max);
    const bytes = Buffer.alloc(before.size + 1),
      { bytesRead } = await handle.read(bytes, 0, bytes.length, 0),
      after = await handle.stat();
    assert.ok(
      bytesRead === before.size &&
        before.ino === after.ino &&
        before.size === after.size &&
        before.mtimeMs === after.mtimeMs &&
        before.ctimeMs === after.ctimeMs,
    );
    return bytes.subarray(0, bytesRead);
  } finally {
    await handle.close();
  }
}
const within = (root: string, file: string) => {
  const part = relative(root, file);
  assert.ok(part && !part.startsWith("..") && !isAbsolute(part));
};
async function inventory(root: string, prefix = ""): Promise<string[]> {
  const result: string[] = [];
  for (const entry of await readdir(join(root, prefix), {
    withFileTypes: true,
  })) {
    assert.equal(entry.isSymbolicLink(), false);
    const name = join(prefix, entry.name);
    if (entry.isDirectory()) result.push(...(await inventory(root, name)));
    else {
      assert.ok(entry.isFile());
      result.push(name);
    }
  }
  return result.sort();
}
/** VS Code alone may add installer metadata; every product field remains exact. */
export function assertInstalledPrismaEditorManifest(
  expectedBytes: Uint8Array,
  installedBytes: Uint8Array,
): void {
  const expected = JSON.parse(Buffer.from(expectedBytes).toString("utf8"));
  const installed = JSON.parse(Buffer.from(installedBytes).toString("utf8"));
  assert.ok(
    installed && typeof installed === "object" && !Array.isArray(installed),
  );
  delete installed.__metadata;
  assert.deepEqual(installed, expected);
}
async function sameFiles(
  expected: string,
  installed: string,
  exclude: string[] = [],
  extensionPayload = false,
) {
  const a = await inventory(expected),
    b = (await inventory(installed)).filter((name) => !exclude.includes(name));
  assert.deepEqual(b, a);
  for (const name of a) {
    const expectedBytes = await regular(join(expected, name));
    const installedBytes = await regular(join(installed, name));
    if (extensionPayload && name === "package.json")
      assertInstalledPrismaEditorManifest(expectedBytes, installedBytes);
    else assert.equal(sha(expectedBytes), sha(installedBytes));
  }
  return a.length;
}
async function wait<T>(
  check: () => Promise<T | false | undefined | null>,
  milliseconds = 30000,
): Promise<T> {
  const end = Date.now() + milliseconds;
  while (Date.now() < end) {
    const value = await check();
    if (value) return value;
    await delay(100);
  }
  throw Error("Owned native observation incomplete.");
}
export const nativeEditorFailureDiagnostic = (
  error: unknown,
): { category: string; exitCode: number | null } => {
  const value =
    error && typeof error === "object"
      ? (error as { code?: unknown; name?: unknown; message?: unknown })
      : {};
  if (
    typeof value.code === "number" &&
    Number.isSafeInteger(value.code) &&
    value.code >= 0 &&
    value.code <= 255
  )
    return { category: "child-exit", exitCode: value.code };
  if (value.code === "ERR_ASSERTION")
    return { category: "assertion", exitCode: null };
  if (value.code === "EINVAL")
    return { category: "ipc-invalid-argument", exitCode: null };
  if (value.code === "ENOENT")
    return { category: "missing-input", exitCode: null };
  if (value.code === "EACCES" || value.code === "EPERM")
    return { category: "access-refused", exitCode: null };
  if (value.code === "ETIMEDOUT")
    return { category: "transport-timeout", exitCode: null };
  if (value.name === "AbortError" || value.code === "ABORT_ERR")
    return { category: "cancelled", exitCode: null };
  if (value.message === "Owned Code exited before observation.")
    return { category: "owned-code-exit", exitCode: null };
  if (value.message === "Owned native observation incomplete.")
    return { category: "observation-timeout", exitCode: null };
  if (
    [
      "Owned CDP unavailable.",
      "Owned CDP closed.",
      "Owned CDP refused.",
      "Owned CDP cancelled.",
    ].includes(String(value.message))
  )
    return { category: "owned-cdp-unavailable", exitCode: null };
  return { category: "unexpected", exitCode: null };
};
/** Release only observer event-loop references when the owned editor is intentionally retained. */
export const unrefRetainedNativeEditorObserver = (
  child: Pick<ChildProcess, "stderr" | "unref">,
) => {
  const stderrUnref =
    child.stderr === null ? null : child.stderr instanceof Socket;
  if (child.stderr instanceof Socket) child.stderr.unref();
  child.unref();
  return { childUnref: true as const, stderrUnref };
};
/** Pinned Code 1.143 IPC formulas; count UTF8 bytes, not only JavaScript characters. */
export const nativeEditorIpcBudget = (
  runtimeDirectory: string,
  profile: string,
  version: string,
) => {
  assert.ok(
    posix.isAbsolute(runtimeDirectory) &&
      posix.resolve(runtimeDirectory) === runtimeDirectory &&
      posix.isAbsolute(profile) &&
      /^\d+\.\d+\.\d+$/u.test(version),
  );
  const scope = createHash("sha256").update(profile).digest("hex").slice(0, 8);
  const staticHandle = posix.join(
    runtimeDirectory,
    `vscode-${scope}-${version.slice(0, 4)}-shared.sock`,
  );
  const suffixLength = Math.min(
    36,
    Math.max(0, 106 - posix.join(runtimeDirectory, "vscode-ipc-.sock").length),
  );
  const randomHandle = posix.join(
    runtimeDirectory,
    `vscode-ipc-${"0".repeat(suffixLength)}.sock`,
  );
  const staticBytes = Buffer.byteLength(staticHandle),
    randomBytes = Buffer.byteLength(randomHandle);
  assert.ok(
    staticBytes < 107 && randomBytes < 107 && suffixLength >= 16,
    "Owned Code IPC namespace exceeds the pinned Linux budget.",
  );
  return {
    staticWorstBytes: staticBytes,
    randomBytes,
    randomSuffixLength: suffixLength,
    linuxBoundExclusive: 107,
    inBounds: true as const,
  };
};
export const createNativeEditorIpcNamespace = async (
  approved: string,
  profile: string,
  version: string,
) => {
  assert.ok(isAbsolute(approved) && resolve(approved) === approved);
  assert.equal(await realpath(approved), approved);
  const directory = await mkdtemp(join(approved, "i-"));
  assert.equal(dirname(directory), approved);
  assert.equal(await realpath(directory), directory);
  const metadata = await lstat(directory);
  assert.ok(
    metadata.isDirectory() &&
      !metadata.isSymbolicLink() &&
      (metadata.mode & 0o777) === 0o700 &&
      metadata.uid === process.getuid?.(),
  );
  const budget = nativeEditorIpcBudget(directory, profile, version);
  return {
    directory,
    receipt: {
      schemaVersion: 1,
      namespaceName: basename(directory),
      directorySha256: sha(Buffer.from(directory)),
      canonical: true,
      ownedByCurrentUser: true,
      ownerOnly: true,
      ...budget,
      retainedWithProfile: true,
      callerTemporaryDirectoryChanged: false,
    },
  };
};
export const nativeEditorStartupDiagnostic = (
  bytes: Uint8Array,
  exitCode: unknown,
  signal: unknown,
) => {
  const text = Buffer.from(bytes.subarray(0, 65536)).toString("utf8");
  let category = "unclassified";
  if (!text.length) category = "no-stderr";
  else if (
    /SUID sandbox helper binary was found, but is not configured correctly/iu.test(
      text,
    )
  )
    category = "sandbox-helper";
  else if (/Running as root without --no-sandbox is not supported/iu.test(text))
    category = "root-sandbox-refusal";
  else if (/No usable sandbox/iu.test(text)) category = "sandbox-unavailable";
  else if (
    /Failed to move to new namespace|unprivileged_userns_clone|user namespace.*(?:denied|not permitted)/iu.test(
      text,
    )
  )
    category = "user-namespace";
  else if (
    /IPC handle.*(?:longer|too long)|shorter --user-data-dir|listen EINVAL|bind.*EINVAL|\bEINVAL\b.*(?:\.sock|IPC)/iu.test(
      text,
    )
  )
    category = "ipc-path";
  else if (/error while loading shared libraries:/iu.test(text))
    category = "shared-library";
  else if (
    /Missing X server or \$DISPLAY|cannot open display|Gtk-WARNING.*cannot open display/iu.test(
      text,
    )
  )
    category = "display";
  else if (/GPU process isn't usable/iu.test(text))
    category = "graphics-startup";
  const signals = [
    "SIGABRT",
    "SIGSEGV",
    "SIGTRAP",
    "SIGTERM",
    "SIGKILL",
    "SIGINT",
    "SIGHUP",
    "SIGILL",
    "SIGBUS",
    "SIGFPE",
    "SIGSYS",
    "SIGPIPE",
  ];
  return {
    category,
    exitCode:
      typeof exitCode === "number" &&
      Number.isSafeInteger(exitCode) &&
      exitCode >= 0 &&
      exitCode <= 255
        ? exitCode
        : null,
    signal:
      typeof signal === "string" && signals.includes(signal) ? signal : null,
    stderrBytesCaptured: Math.min(bytes.length, 65536),
  };
};
async function drive(
  profile: string,
  root: string,
  signal: AbortSignal,
  observePhase: (value: string) => void = () => {},
) {
  observePhase("ui-devtools-port");
  const waitOwned = <T>(
    check: () => Promise<T | false | undefined | null>,
    ms = 30000,
  ) =>
    wait(async () => {
      signal.throwIfAborted();
      return check();
    }, ms);
  let workspaceName = "";
  const portFile = await waitOwned(() =>
    readFile(join(profile, "DevToolsActivePort"), "utf8").catch(
      () => undefined,
    ),
  );
  const [port, endpoint] = portFile.trim().split("\n");
  assert.match(port!, /^\d{1,5}$/);
  assert.ok(Number(port) > 0 && Number(port) < 65536);
  assert.match(endpoint!, /^\/devtools\/browser\/[A-Za-z0-9-]+$/);
  observePhase("ui-cdp-connect");
  const ws = new WebSocket(`ws://127.0.0.1:${port}${endpoint}`);
  await new Promise<void>((yes, no) => {
    const cancel = () => {
      no(Error("Owned CDP cancelled."));
      ws.close();
    };
    signal.addEventListener("abort", cancel, { once: true });
    ws.addEventListener(
      "open",
      () => {
        signal.removeEventListener("abort", cancel);
        yes();
      },
      { once: true },
    );
    ws.addEventListener(
      "error",
      () => {
        signal.removeEventListener("abort", cancel);
        no(Error("Owned CDP unavailable."));
      },
      {
        once: true,
      },
    );
    if (signal.aborted) cancel();
  });
  let next = 0;
  const pending = new Map<
      number,
      { resolve: (value: any) => void; reject: (error: Error) => void }
    >(),
    contexts = new Map<string, { id: number; session: string }>(),
    sessions = new Set<string>();
  const send = (method: string, params: object = {}, sessionId?: string) =>
    new Promise<any>((resolveResult, reject) => {
      if (signal.aborted || ws.readyState !== WebSocket.OPEN) {
        reject(Error("Owned CDP closed."));
        return;
      }
      const id = ++next;
      pending.set(id, { resolve: resolveResult, reject });
      ws.send(
        JSON.stringify({
          id,
          method,
          params,
          ...(sessionId ? { sessionId } : {}),
        }),
      );
    });
  ws.addEventListener("message", (event) => {
    const message = JSON.parse(String(event.data));
    if (message.id) {
      const request = pending.get(message.id);
      pending.delete(message.id);
      if (message.error) request?.reject(Error("Owned CDP refused."));
      else request?.resolve(message.result);
    } else if (
      message.method === "Runtime.executionContextCreated" &&
      message.params.context.auxData?.isDefault
    )
      contexts.set(`${message.sessionId}:${message.params.context.id}`, {
        id: message.params.context.id,
        session: message.sessionId,
      });
    else if (message.method === "Runtime.executionContextDestroyed")
      contexts.delete(
        `${message.sessionId}:${message.params.executionContextId}`,
      );
  });
  const abort = () => {
    for (const request of pending.values())
      request.reject(Error("Owned CDP cancelled."));
    pending.clear();
    ws.close();
  };
  signal.addEventListener("abort", abort, { once: true });
  const evaluate = async (
    context: { id: number; session: string },
    expression: string,
  ) =>
    (
      await send(
        "Runtime.evaluate",
        { expression, contextId: context.id, returnByValue: true },
        context.session,
      )
    ).result?.value;
  const discover = async () => {
    const { targetInfos } = await send("Target.getTargets");
    for (const target of targetInfos.filter((target: any) =>
      ["page", "iframe"].includes(target.type),
    )) {
      if (sessions.has(target.targetId)) continue;
      const { sessionId } = await send("Target.attachToTarget", {
        targetId: target.targetId,
        flatten: true,
      });
      sessions.add(target.targetId);
      await send("Runtime.enable", {}, sessionId);
    }
  };
  const find = async (selector: string, allowClosedDetails = false) =>
    waitOwned(async () => {
      await discover();
      for (const context of contexts.values())
        if (
          await evaluate(
            context,
            nativeControlProbe(selector, workspaceName, allowClosedDetails),
          ).catch(() => false)
        )
          return context;
      return undefined;
    });
  const key = async (context: { session: string }) => {
    for (const type of ["keyDown", "keyUp"])
      await send(
        "Input.dispatchKeyEvent",
        {
          type,
          key: "Enter",
          code: "Enter",
          windowsVirtualKeyCode: 13,
          ...(type === "keyDown" ? { text: "\r", unmodifiedText: "\r" } : {}),
        },
        context.session,
      );
  };
  const activate = async (selector: string) => {
    const context = await find(selector, true);
    // Native disclosure content must be opened by the same keyboard action a user uses.
    for (let attempt = 0; attempt < 8; attempt++) {
      const closed = await evaluate(
        context,
        `(()=>{const node=document.querySelector(${JSON.stringify(selector)}),closed=[];for(let parent=node?.parentElement;parent;parent=parent.parentElement)if(parent.tagName==='DETAILS'&&!parent.open)closed.push(parent);if(!closed.length)return 0;const summary=closed.at(-1).querySelector(':scope > summary');if(!summary)return -1;summary.scrollIntoView({block:'center'});summary.focus();return document.activeElement===summary?closed.length:-1;})()`,
      );
      if (closed === 0) break;
      assert.ok(Number.isInteger(closed) && closed > 0);
      await key(context);
      await waitOwned(() =>
        evaluate(
          context,
          `(()=>{let count=0;for(let parent=document.querySelector(${JSON.stringify(selector)})?.parentElement;parent;parent=parent.parentElement)if(parent.tagName==='DETAILS'&&!parent.open)count++;return count<${closed};})()`,
        ),
      );
    }
    await waitOwned(async () => {
      const remote = await send(
        "Runtime.evaluate",
        {
          expression: "document",
          contextId: context.id,
          objectGroup: "prisma-listeners",
        },
        context.session,
      );
      const listeners = await send(
        "DOMDebugger.getEventListeners",
        { objectId: remote.result.objectId },
        context.session,
      );
      for (const listener of listeners.listeners.filter(
        (item: any) => item.type === "click" && item.handler?.objectId,
      )) {
        const result = await send(
          "Runtime.callFunctionOn",
          {
            objectId: listener.handler.objectId,
            functionDeclaration: `function(){return Function.prototype.toString.call(this).includes(${JSON.stringify(selector.startsWith("[data-rehearsal-page") ? "data-rehearsal-page" : selector.startsWith("[data-open-reviewed-migration") ? "data-open-reviewed-migration" : "data-open-migration-insight")});}`,
            returnByValue: true,
          },
          context.session,
        );
        if (result.result?.value === true) return true;
      }
      return false;
    });
    assert.equal(
      await evaluate(
        context,
        `(()=>{const node=document.querySelector(${JSON.stringify(selector)});if(node.disabled)return false;node.scrollIntoView({block:'center'});node.focus();return document.activeElement===node;})()`,
      ),
      true,
    );
    await key(context);
    return context;
  };
  const screenshot = async (name: string) => {
    const { targetInfos } = await send("Target.getTargets");
    const target = targetInfos.find(
      (target: any) =>
        target.type === "page" && /^vscode-file:/u.test(target.url),
    );
    assert.ok(target);
    const { sessionId } = await send("Target.attachToTarget", {
      targetId: target.targetId,
      flatten: true,
    });
    const result = await send(
      "Page.captureScreenshot",
      { format: "png", captureBeyondViewport: false },
      sessionId,
    );
    const bytes = Buffer.from(result.data, "base64");
    assert.ok(bytes.length > 0 && bytes.length <= 8 * 1024 * 1024);
    await writeFile(join(root, `${name}.png`), bytes, { mode: 0o600 });
  };
  try {
    observePhase("ui-update-consent");
    // First-use consent is a real isolated-user choice, never a fabricated Memento value.
    // Startup includes the genuine initial project scan; share the existing outer budget.
    const consent = await waitOwned(async () => {
      await discover();
      for (const context of contexts.values())
        if (
          await evaluate(
            context,
            "[...document.querySelectorAll('[role=dialog],[role=alertdialog]')].some(node=>node.textContent.includes('Allow optional Rehearsal update checks?'))",
          ).catch(() => false)
        )
          return context;
      return undefined;
    }, nativeObservationBudgetMs);
    assert.equal(
      await evaluate(
        consent,
        `(()=>{const dialog=[...document.querySelectorAll('[role=dialog],[role=alertdialog]')].find(node=>node.textContent.includes('Allow optional Rehearsal update checks?'));const choices=[...dialog.querySelectorAll('button,[role=button]')].filter(node=>(node.getAttribute('aria-label')||node.textContent).trim()==="Don't Ask Again"&&node.getBoundingClientRect().width>0);if(choices.length!==1)return false;choices[0].focus();return document.activeElement===choices[0];})()`,
      ),
      true,
    );
    await key(consent);
    await writeFile(
      join(root, "ui-observations.json"),
      JSON.stringify({ optionalUpdateConsentDeclined: true, keyboard: true }),
      { mode: 0o600 },
    );
    observePhase("ui-companion-ready");
    const phase = await waitOwned(async () => {
      try {
        const value = JSON.parse(
          await readFile(join(root, "phase.json"), "utf8"),
        );
        return value.state === "ready" ? value : false;
      } catch {
        return false;
      }
    });
    assert.ok(
      typeof phase.workspaceName === "string" &&
        phase.workspaceName.length <= 300,
    );
    workspaceName = phase.workspaceName;
    observePhase("ui-dashboard-navigation");
    const navigate = async (page: string) => {
      observePhase("ui-dashboard-navigation");
      const selector = `[data-rehearsal-page="${page}"]`;
      const dashboard = await find("[data-engine-shutdown-control]");
      if (
        !(await evaluate(
          dashboard,
          `(()=>{const rect=document.querySelector(${JSON.stringify(selector)})?.getBoundingClientRect();return !!rect&&rect.width>0&&rect.height>0;})()`,
        ))
      ) {
        const trigger = await find("#compact-navigation-trigger");
        assert.equal(
          await evaluate(
            trigger,
            "(()=>{const node=document.querySelector('#compact-navigation-trigger');node.focus();return document.activeElement===node;})()",
          ),
          true,
        );
        await key(trigger);
      }
      const context = await activate(selector);
      await waitOwned(() =>
        evaluate(
          context,
          `!document.getElementById(${JSON.stringify(page)}).hidden`,
        ),
      );
    };
    const settleKnexView = async (page: string) => {
      const context = await find("#" + page);
      const visible = `(()=>{const node=document.getElementById(${JSON.stringify(page)}),rect=node?.getBoundingClientRect();return !!node&&!node.hidden&&rect.width>0&&rect.height>0;})()`;
      await waitOwned(() =>
        evaluate(
          context,
          `(()=>{if(!${visible})return false;return !document.getElementById(${JSON.stringify(page)}).getAnimations({subtree:true}).some(animation=>animation.playState==='running'&&Number.isFinite(animation.effect?.getComputedTiming().endTime));})()`,
        ),
      );
      const rendered = await send(
        "Runtime.evaluate",
        {
          contextId: context.id,
          returnByValue: true,
          awaitPromise: true,
          expression: `Promise.race([new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve(${visible})))),new Promise(resolve=>setTimeout(()=>resolve(false),1000))])`,
        },
        context.session,
      );
      assert.equal(
        rendered.result?.value,
        true,
        "Knex view capture did not settle within its bounded rendering checkpoint.",
      );
    };
    if (phase.consumerReview === true) {
      for (const page of [
        "overview",
        "setup",
        "migrations",
        "runtime",
        "data-auth",
        "configuration",
        "activity",
      ]) {
        await navigate(page);
        await screenshot(`consumer-${page}`);
      }
    }
    await navigate("migrations");
    if (phase.reviewedCodeOnly === true) await settleKnexView("migrations");
    await screenshot("prisma-migrations");
    if (phase.sourceId !== undefined) {
      assert.match(phase.sourceId, /^[a-f0-9]{64}$/);
      await activate(`[data-open-reviewed-migration="${phase.sourceId}"]`);
      await waitOwned(async () => {
        try {
          return (
            JSON.parse(await readFile(join(root, "phase.json"), "utf8"))
              .state === "reviewed-input-observed"
          );
        } catch {
          return false;
        }
      });
      await screenshot(
        phase.reviewedCodeOnly === true
          ? "knex-reviewed-code"
          : "drizzle-reviewed-input",
      );
      await writeFile(
        join(root, "reviewed-ui-done.json"),
        JSON.stringify({ complete: true }),
        { mode: 0o600 },
      );
      await waitOwned(async () => {
        try {
          return (
            JSON.parse(await readFile(join(root, "phase.json"), "utf8"))
              .state ===
            (phase.reviewedCodeOnly === true
              ? "reviewed-code-returned"
              : "finding-ready")
          );
        } catch {
          return false;
        }
      });
      const restored = await find("#migrations");
      await waitOwned(() =>
        evaluate(restored, "!document.getElementById('migrations').hidden"),
      );
    }
    if (phase.reviewedCodeOnly === true) {
      assert.equal(phase.findingId, undefined);
      await navigate("overview");
      await settleKnexView("overview");
      await screenshot("knex-returned-overview");
      await writeFile(
        join(root, "ui-done.json"),
        JSON.stringify({ complete: true, overview: true }),
        { mode: 0o600 },
      );
      return;
    }
    assert.match(phase.findingId, /^[a-f0-9]{64}$/);
    observePhase("ui-source-control");
    const sourceSelector = `[data-open-migration-insight="${phase.findingId}"]`;
    await find(sourceSelector, true);
    if (phase.consumerReview === true)
      await writeFile(
        join(root, "ui-source-ready.json"),
        JSON.stringify({
          state: "source-control-ready",
          findingId: phase.findingId,
        }),
        { mode: 0o600, flag: "wx" },
      );
    await activate(sourceSelector);
    await waitOwned(async () => {
      try {
        return (
          JSON.parse(await readFile(join(root, "phase.json"), "utf8")).state ===
          "source-observed"
        );
      } catch {
        return false;
      }
    });
    observePhase("ui-source-screenshot");
    await screenshot("prisma-native-sql");
    await writeFile(
      join(root, "ui-done.json"),
      JSON.stringify({ complete: true }),
      { mode: 0o600 },
    );
    if (phase.consumerReview === true) {
      observePhase("ui-consumer-return");
      await waitOwned(async () => {
        try {
          return (
            JSON.parse(await readFile(join(root, "phase.json"), "utf8"))
              .state === "dashboard-returned"
          );
        } catch {
          return false;
        }
      });
      const returned = await find("#migrations");
      await waitOwned(() =>
        evaluate(returned, "!document.getElementById('migrations').hidden"),
      );
      await screenshot("consumer-returned");
      await writeFile(
        join(root, "consumer-returned-done.json"),
        JSON.stringify({ complete: true }),
        { mode: 0o600 },
      );
    }
  } catch (error) {
    await screenshot("prisma-failure").catch(() => {});
    throw error;
  } finally {
    for (const context of contexts.values())
      await send(
        "Runtime.releaseObjectGroup",
        { objectGroup: "prisma-listeners" },
        context.session,
      ).catch(() => {});
    signal.removeEventListener("abort", abort);
    ws.close();
    for (const request of pending.values())
      request.reject(Error("Owned CDP closed."));
  }
}
export const assertNativeEditorNamespace = (
  approved: string,
  workspace: string,
  evidence: string,
): void => {
  const inside = (root: string, path: string) => {
    const p = relative(root, path);
    return !isAbsolute(p) && p !== ".." && !p.startsWith("../");
  };
  for (const path of [approved, workspace, evidence])
    assert.ok(
      isAbsolute(path) &&
        resolve(path) === path &&
        !path.split("/").includes("notes"),
    );
  assert.ok(
    workspace !== approved &&
      evidence !== approved &&
      inside(approved, workspace) &&
      inside(approved, evidence) &&
      !inside(workspace, evidence) &&
      !inside(evidence, workspace),
  );
};
export type NativeEditorScenario = "prisma-review" | "real-consumer";
export const parseNativeEditorAcceptanceArguments = (
  values: readonly string[],
  scenario: NativeEditorScenario = "prisma-review",
): ReadonlyMap<string, string> => {
  assert.ok(scenario === "prisma-review" || scenario === "real-consumer");
  const names = [
    "vsix",
    "vsix-sha",
    "core-tar",
    "core-sha",
    "workspace",
    "code",
    "electron",
    "electron-sha",
    "code-version",
    "evidence",
  ];
  const args = new Map<string, string>();
  for (const raw of values) {
    const match = /^--([a-z-]+)=(.+)$/u.exec(raw);
    assert.ok(
      match &&
        (names.includes(match[1]!) ||
          (scenario === "prisma-review" && match[1] === "migration-kind")) &&
        !args.has(match[1]!),
    );
    args.set(match[1]!, match[2]!);
  }
  assert.equal(args.size, names.length + (args.has("migration-kind") ? 1 : 0));
  if (args.has("migration-kind"))
    assert.ok(
      ["prisma", "drizzle", "knex"].includes(args.get("migration-kind")!),
    );
  for (const name of ["vsix-sha", "core-sha", "electron-sha"])
    assert.match(args.get(name)!, /^[a-f0-9]{64}$/u);
  assert.match(args.get("code-version")!, /^\d+\.\d+\.\d+$/u);
  for (const name of [
    "vsix",
    "core-tar",
    "workspace",
    "code",
    "electron",
    "evidence",
  ])
    assert.ok(isAbsolute(args.get(name)!));
  return args;
};
export async function runNativeEditorAcceptance(
  values: readonly string[] = process.argv.slice(2),
  scenario: NativeEditorScenario = "prisma-review",
) {
  assert.equal(process.platform, "linux");
  assert.equal(process.arch, "x64");
  assert.equal(process.env.GITHUB_ACTIONS, "true");
  assert.equal(process.env.RUNNER_OS, "Linux");
  assert.ok(process.env.DISPLAY);
  assert.match(await readFile("/etc/os-release", "utf8"), /^ID=ubuntu$/m);
  assert.match(
    await readFile("/etc/os-release", "utf8"),
    /^VERSION_ID="24\.04"$/m,
  );
  assert.ok(
    freemem() >= 3 * 1024 ** 3,
    "Native editor requires3GiB available memory.",
  );
  const args = parseNativeEditorAcceptanceArguments(values, scenario);
  const migrationKind = args.get("migration-kind") ?? "prisma";
  const get = (name: string) => args.get(name)!;
  const approved = await realpath(process.env.REHEARSAL_DEVELOPMENT_ROOT!);
  await nativeStorageRoot();
  const workspace = await realpath(get("workspace"));
  assert.equal(workspace, get("workspace"));
  assertNativeEditorNamespace(approved, workspace, get("evidence"));
  assert.equal(await realpath(get("code")), get("code"));
  assert.equal(await realpath(get("electron")), get("electron"));
  assert.equal(get("code"), join(dirname(get("electron")), "bin/code"));
  assert.equal(
    sha(await regular(get("electron"), 256 * 1024 * 1024)),
    get("electron-sha"),
  );
  assert.equal(
    JSON.parse(
      (
        await regular(
          join(dirname(get("electron")), "resources/app/package.json"),
          1024 * 1024,
        )
      ).toString(),
    ).version,
    get("code-version"),
  );
  assert.equal(
    sha(await regular(get("vsix"), 16 * 1024 * 1024)),
    get("vsix-sha"),
  );
  assert.equal(sha(await regular(get("core-tar"))), get("core-sha"));
  const environment: NodeJS.ProcessEnv = {
    ...process.env,
    ELECTRON_RUN_AS_NODE: undefined,
    REHEARSAL_UPDATE_CHECK: "off",
  };
  const run = (command: string, args: string[]) =>
    execute(command, args, {
      env: environment,
      encoding: "utf8",
      timeout: 30000,
      maxBuffer: 4 * 1024 * 1024,
    });
  const root = await createNativeTemporaryDirectory("p-", environment),
    evidence = get("evidence"),
    profile = join(root, "user"),
    extensions = join(root, "extensions"),
    frozen = join(root, "frozen"),
    coreFrozen = join(root, "core"),
    harness = join(root, "harness");
  for (const directory of [
    evidence,
    profile,
    extensions,
    frozen,
    coreFrozen,
    harness,
    join(profile, "User"),
  ]) {
    await mkdir(directory, { recursive: true, mode: 0o700 });
    assert.equal(await realpath(directory), directory);
    assert.equal((await lstat(directory)).isSymbolicLink(), false);
  }
  let child: ReturnType<typeof spawn> | undefined,
    closed = false,
    recoveryRequired = true;
  let consumerBefore:
    | Awaited<
        ReturnType<
          (typeof import("./verify-native-real-consumer.js"))["captureRealConsumerFiles"]
        >
      >
    | undefined;
  let consumerAfter: typeof consumerBefore;
  let consumerPreserved = scenario !== "real-consumer";
  const resultPath = join(evidence, "result.json");
  const startupStderr = Buffer.alloc(65536);
  let startupBytes = 0,
    startupTruncated = false;
  let retainedObserver:
    ReturnType<typeof unrefRetainedNativeEditorObserver> | undefined;
  let startupSpawnFailure:
    ReturnType<typeof nativeEditorFailureDiagnostic> | undefined;
  let phase = "artifact-inspection";
  try {
    const entries = (await run("unzip", ["-Z1", get("vsix")])).stdout
      .trim()
      .split(/\r?\n/u);
    assertArchiveContents(entries);
    await run("unzip", ["-q", get("vsix"), "-d", frozen]);
    const tarEntries = (await run("tar", ["-tzf", get("core-tar")])).stdout
      .trim()
      .split(/\r?\n/u);
    assert.ok(
      tarEntries.length > 0 &&
        tarEntries.every(
          (name) =>
            /^package\//u.test(name) &&
            !name.split("/").includes("..") &&
            !name.startsWith("/"),
        ),
    );
    const tarTypes = (await run("tar", ["-tvzf", get("core-tar")])).stdout
      .trim()
      .split(/\r?\n/u);
    assert.ok(
      tarTypes.every((line) => line.startsWith("-") || line.startsWith("d")),
    );
    await run("tar", [
      "-xzf",
      get("core-tar"),
      "-C",
      coreFrozen,
      "--no-same-owner",
    ]);
    const manifest = JSON.parse(
      (
        await regular(join(frozen, "extension/package.json"), 1024 * 1024)
      ).toString(),
    );
    assert.equal(
      `${manifest.publisher}.${manifest.name}`,
      "rehearsal-db.rehearsal-db",
    );
    const coreRoot = await realpath(
      join(workspace, "node_modules/@rehearsal-db/core"),
    );
    within(workspace, coreRoot);
    phase = "core-package-comparison";
    const coreFiles = await sameFiles(join(coreFrozen, "package"), coreRoot);
    const coreManifest = JSON.parse(
      (await regular(join(coreRoot, "package.json"), 1024 * 1024)).toString(),
    );
    assert.equal(coreManifest.name, "@rehearsal-db/core");
    if (scenario !== "real-consumer") {
      assert.equal(
        coreManifest.rehearsalContracts?.[
          migrationKind === "knex"
            ? "knexMigrations"
            : migrationKind === "drizzle"
              ? "drizzleMigrations"
              : "nativeMigrations"
        ],
        1,
      );
    }
    if (scenario === "real-consumer") {
      phase = "initial-consumer-preservation";
      consumerBefore = await (
        await import("./verify-native-real-consumer.js")
      ).captureRealConsumerFiles(workspace, approved);
    }
    phase = "isolated-settings";
    await writeFile(
      join(profile, "User/settings.json"),
      JSON.stringify({
        "security.workspace.trust.enabled": false,
        "window.dialogStyle": "custom",
        "window.newWindowDimensions": "maximized",
        "workbench.startupEditor": "none",
        "workbench.colorTheme": "Default Dark Modern",
        "update.mode": "none",
        "extensions.autoUpdate": false,
        "extensions.autoCheckUpdates": false,
        "telemetry.telemetryLevel": "off",
        "rehearsal.automaticUpdates": { extension: false, cli: false },
      }),
      { mode: 0o600 },
    );
    const isolated = [
      "--user-data-dir",
      profile,
      "--extensions-dir",
      extensions,
    ];
    phase = "owned-ipc-namespace";
    assert.ok(
      !environment.VSCODE_PORTABLE,
      "Owned Code portable mode cannot bypass its IPC namespace.",
    );
    const ipc = await createNativeEditorIpcNamespace(
      approved,
      profile,
      get("code-version"),
    );
    environment.XDG_RUNTIME_DIR = ipc.directory;
    await writeFile(
      join(evidence, "ipc-namespace.json"),
      JSON.stringify(ipc.receipt),
      { mode: 0o600 },
    );
    phase = "isolated-extension-install";
    await run(get("code"), [...isolated, "--install-extension", get("vsix")]);
    const installed = join(
      extensions,
      `rehearsal-db.rehearsal-db-${manifest.version}`,
    );
    assert.equal(
      sha(await regular(join(installed, ".vsixmanifest"))),
      sha(await regular(join(frozen, "extension.vsixmanifest"))),
    );
    phase = "installed-extension-payload";
    const extensionFiles = await sameFiles(
      join(frozen, "extension"),
      installed,
      [".vsixmanifest"],
      true,
    );
    phase = "companion-preparation";
    for (const name of [
      "native-editor-driver.cjs",
      "native-editor-recovery.cjs",
      "native-editor-reads.cjs",
      scenario === "real-consumer"
        ? "native-real-consumer-test.cjs"
        : "native-prisma-review-test.cjs",
    ])
      await copyFile(resolve(__dirname, name), join(harness, name));
    await writeFile(
      join(harness, "package.json"),
      JSON.stringify({
        name:
          scenario === "real-consumer"
            ? "owned-native-real-consumer"
            : "owned-native-prisma-review",
        publisher: "rehearsal-local-acceptance",
        version: "0.0.0",
        engines: { vscode: "^1.101.0" },
        main: "native-editor-driver.cjs",
        activationEvents: ["onStartupFinished"],
      }),
      { mode: 0o600 },
    );
    const configPath = join(root, "config.json"),
      phasePath = join(root, "phase.json");
    await writeFile(
      configPath,
      JSON.stringify({
        scenario:
          scenario === "real-consumer" ? scenario : migrationKind + "-review",
        migrationKind,
        root,
        evidence,
        resultPath,
        workspace,
        phasePath,
        installedExtension: installed,
        version: manifest.version,
        coreVersion: coreManifest.version,
        candidateSha256: get("vsix-sha"),
        coreArtifactSha256: get("core-sha"),
      }),
      { mode: 0o600 },
    );
    environment.REHEARSAL_NATIVE_CANCELLATION_CONFIG = configPath;
    phase = "owned-code-start";
    child = spawn(
      get("electron"),
      [
        ...isolated,
        `--extensionDevelopmentPath=${harness}`,
        "--remote-debugging-address=127.0.0.1",
        "--remote-debugging-port=0",
        "--disable-updates",
        "--disable-workspace-trust",
        "--skip-welcome",
        "--new-window",
        workspace,
      ],
      {
        env: environment,
        detached: true,
        stdio: ["ignore", "ignore", "pipe"],
      },
    );
    child.stderr?.on("data", (chunk: Buffer) => {
      const length = Math.min(
        chunk.length,
        startupStderr.length - startupBytes,
      );
      if (length > 0) {
        chunk.copy(startupStderr, startupBytes, 0, length);
        startupBytes += length;
      }
      if (length < chunk.length) startupTruncated = true;
    });
    // Never print or persist raw Electron output; only the bounded fixed classifier is reported.
    child.once("error", (error) => {
      startupSpawnFailure = nativeEditorFailureDiagnostic(error);
    });
    assert.ok(child.pid);
    // The maintained companion finalizes only after observing no dirty documents.
    const controller = new AbortController();
    const onOwnedExit = () =>
      controller.abort(Error("Owned Code exited before observation."));
    child.once("exit", onOwnedExit);
    const timer = setTimeout(
      () => controller.abort(),
      nativeObservationBudgetMs,
    );
    try {
      await drive(profile, root, controller.signal, (value) => {
        phase = value;
      });
    } finally {
      child.removeListener("exit", onOwnedExit);
      clearTimeout(timer);
      controller.abort();
    }
    phase = "companion-finalization";
    const result = await wait(
      async () => {
        try {
          const value = JSON.parse(
            (await regular(resultPath, 256 * 1024)).toString(),
          );
          return value.driverFinalized ? value : false;
        } catch {
          return false;
        }
      },
      scenario === "real-consumer" ? nativeObservationBudgetMs : 30000,
    );
    phase = "companion-result-validation";
    assert.equal(result.status, "passed");
    if (migrationKind === "knex" && scenario !== "real-consumer") {
      assert.equal(result.migrationKind, "knex");
      assert.equal(result.baselineFormat, 5);
      assert.equal(result.insightsAvailable, false);
      assert.equal(result.overviewReturned, true);
      assert.equal(result.dirtyDocuments, 0);
      assert.equal(result.terminalCount, 0);
      assert.equal(result.sourceDispatches, 1);
      assert.equal(result.reviewedInput?.clean, true);
      assert.equal(result.reviewedInput?.line, 0);
      assert.equal(result.reviewedInput?.column, 0);
    }
    assert.equal(result.driverFinalized, true);
    assert.equal(result.recoveryRequired, false);
    recoveryRequired = false;
    await retireOwnedProcessGroup({
      probe: () => ownedProcessState(child!),
      send: (signal) => process.kill(-child!.pid!, signal),
    });
    closed = true;
    phase = "final-payload-comparison";
    assert.equal(
      await sameFiles(join(coreFrozen, "package"), coreRoot),
      coreFiles,
    );
    assert.equal(
      await sameFiles(
        join(frozen, "extension"),
        installed,
        [".vsixmanifest"],
        true,
      ),
      extensionFiles,
    );
    assert.equal(sha(await regular(get("vsix"))), get("vsix-sha"));
    assert.equal(sha(await regular(get("core-tar"))), get("core-sha"));
    assert.equal(
      sha(await regular(get("electron"), 256 * 1024 * 1024)),
      get("electron-sha"),
    );
    if (consumerBefore) {
      phase = "final-consumer-preservation";
      consumerAfter = await (
        await import("./verify-native-real-consumer.js")
      ).captureRealConsumerFiles(workspace, approved);
      assert.deepEqual(consumerAfter, consumerBefore);
      consumerPreserved = true;
    }
    await writeFile(
      join(evidence, "verification.json"),
      JSON.stringify({
        status: "passed",
        ...(scenario === "real-consumer"
          ? { scenario, consumerPreserved }
          : {}),
        candidateSha256: get("vsix-sha"),
        coreArtifactSha256: get("core-sha"),
        electronSha256: get("electron-sha"),
        codeVersion: get("code-version"),
        migrationKind,
        coreFiles,
        extensionFiles,
        ownedProcessGroupClosed: closed,
      }),
      { mode: 0o600 },
    );
  } catch (error) {
    const sandbox = await lstat(
      join(dirname(get("electron")), "chrome-sandbox"),
    ).catch(() => null);
    const startup = nativeEditorStartupDiagnostic(
      startupStderr.subarray(0, startupBytes),
      child?.exitCode,
      child?.signalCode,
    );
    const failure = {
      status: "failed",
      startup: {
        ...startup,
        spawnFailure: startupSpawnFailure ?? null,
        stderrTruncated: startupTruncated,
        stderrComplete: child?.stderr?.readableEnded ?? false,
        sandboxHelper: sandbox
          ? {
              regular: sandbox.isFile(),
              rootOwned: sandbox.uid === 0,
              setuid: Boolean(sandbox.mode & 0o4000),
              executable: Boolean(sandbox.mode & 0o111),
            }
          : null,
      },
      phase,
      ...nativeEditorFailureDiagnostic(error),
      candidateSha256: get("vsix-sha"),
      coreArtifactSha256: get("core-sha"),
      ownedProcessStarted: Boolean(child?.pid),
      ownedProcessExitObserved: child
        ? child.exitCode !== null || child.signalCode !== null
        : null,
    };
    await writeFile(join(evidence, "failure.json"), JSON.stringify(failure), {
      mode: 0o600,
    });
    if (phase.startsWith("ui-"))
      await writeFile(
        join(evidence, "ui-failure.json"),
        JSON.stringify(failure),
        { mode: 0o600 },
      );
    throw error;
  } finally {
    // Reuse the maintained clean/dirty recovery decision, including clean failures.
    try {
      const finalized = JSON.parse(
        (await regular(resultPath, 256 * 1024)).toString(),
      );
      if (
        finalized.candidateSha256 === get("vsix-sha") &&
        finalized.coreArtifactSha256 === get("core-sha")
      )
        recoveryRequired = shouldRetainNativeEditor(finalized);
    } catch {
      /* Missing finalization retains unknown work. */
    }
    if (child && ownedProcessState(child) === "absent") closed = true;
    // Unknown/dirty work is retained, never force-closed just because a scenario failed.
    if (child && !recoveryRequired) {
      await retireOwnedProcessGroup({
        probe: () => ownedProcessState(child!),
        send: (signal) => process.kill(-child!.pid!, signal),
      });
      closed = true;
    }
    if (child && recoveryRequired && !closed)
      retainedObserver = unrefRetainedNativeEditorObserver(child);
    if (consumerBefore && !consumerAfter) {
      try {
        consumerAfter = await (
          await import("./verify-native-real-consumer.js")
        ).captureRealConsumerFiles(workspace, approved);
        consumerPreserved =
          JSON.stringify(consumerBefore) === JSON.stringify(consumerAfter);
      } catch {
        consumerPreserved = false;
      }
    }
    if (consumerBefore)
      await writeFile(
        join(evidence, "consumer-preservation.json"),
        JSON.stringify({
          before: consumerBefore,
          after: consumerAfter ?? null,
          preserved: consumerPreserved,
          scope:
            "Selected input files fully hashed; no plaintext, personal notes or physical volume-content proof.",
        }),
        { mode: 0o600 },
      );
    for (const name of [
      "consumer-overview.png",
      "consumer-setup.png",
      "consumer-migrations.png",
      "consumer-runtime.png",
      "consumer-data-auth.png",
      "consumer-configuration.png",
      "consumer-activity.png",
      "consumer-returned.png",
      "prisma-migrations.png",
      "prisma-native-sql.png",
      "drizzle-reviewed-input.png",
      "knex-reviewed-code.png",
      "knex-returned-overview.png",
      "prisma-failure.png",
      "phase.json",
      "ui-observations.json",
    ])
      await copyFile(join(root, name), join(evidence, name)).catch(() => {});
    await writeFile(
      join(evidence, "cleanup.json"),
      JSON.stringify({
        ownedProcessGroupClosed: closed,
        ...(scenario === "real-consumer" ? { consumerPreserved } : {}),
        recoveryRequired,
        profileRetained: true,
        ...(retainedObserver ? { retainedObserver } : {}),
        editorDatabaseMutationsRequested: 0,
      }),
      { mode: 0o600 },
    );
  }
}
if (process.argv[1] && resolve(process.argv[1]) === resolve(__filename))
  void runNativeEditorAcceptance().catch(() => {
    console.error(
      "Native Prisma editor acceptance failed; private output withheld. Inspect owned evidence and recovery state.",
    );
    process.exitCode = 1;
  });
