/** Explicit opt-in Ubuntu hosted acceptance. Never installs/downloads Code or starts databases. */
import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { constants } from "node:fs";
import {
  copyFile,
  lstat,
  mkdir,
  open,
  readFile,
  readdir,
  realpath,
  writeFile,
} from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
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
async function sameFiles(
  expected: string,
  installed: string,
  exclude: string[] = [],
) {
  const a = await inventory(expected),
    b = (await inventory(installed)).filter((name) => !exclude.includes(name));
  assert.deepEqual(b, a);
  for (const name of a)
    assert.equal(
      sha(await regular(join(expected, name))),
      sha(await regular(join(installed, name))),
    );
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
async function drive(profile: string, root: string, signal: AbortSignal) {
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
  const ws = new WebSocket(`ws://127.0.0.1:${port}${endpoint}`);
  await new Promise<void>((yes, no) => {
    ws.addEventListener("open", () => yes(), { once: true });
    ws.addEventListener("error", () => no(Error("Owned CDP unavailable.")), {
      once: true,
    });
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
  const find = async (selector: string) =>
    waitOwned(async () => {
      await discover();
      for (const context of contexts.values())
        if (
          await evaluate(
            context,
            `(()=>{if(document.title!==${JSON.stringify(workspaceName + " · Rehearsal")}||document.readyState!=='complete')return false;const node=document.querySelector(${JSON.stringify(selector)}),rect=node?.getBoundingClientRect();return !!rect&&rect.width>0&&rect.height>0;})()`,
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
    const context = await find(selector);
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
            functionDeclaration: `function(){return Function.prototype.toString.call(this).includes(${JSON.stringify(selector.startsWith("[data-rehearsal-page") ? "data-rehearsal-page" : "data-open-migration-insight")});}`,
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
        `(()=>{const node=document.querySelector(${JSON.stringify(selector)});if(node.disabled)return false;node.focus();return document.activeElement===node;})()`,
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
    // First-use consent is a real isolated-user choice, never a fabricated Memento value.
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
    });
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
    const selector = '[data-rehearsal-page="migrations"]';
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
      evaluate(context, "!document.getElementById('migrations').hidden"),
    );
    await screenshot("prisma-migrations");
    assert.match(phase.findingId, /^[a-f0-9]{64}$/);
    await activate(`[data-open-migration-insight="${phase.findingId}"]`);
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
    await screenshot("prisma-native-sql");
    await writeFile(
      join(root, "ui-done.json"),
      JSON.stringify({ complete: true }),
      { mode: 0o600 },
    );
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
async function main() {
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
  for (const raw of process.argv.slice(2)) {
    const match = /^--([a-z-]+)=(.+)$/u.exec(raw);
    assert.ok(match && names.includes(match[1]!) && !args.has(match[1]!));
    args.set(match[1]!, match[2]!);
  }
  assert.equal(args.size, names.length);
  const get = (name: string) => args.get(name)!;
  for (const name of ["vsix-sha", "core-sha", "electron-sha"])
    assert.match(get(name), /^[a-f0-9]{64}$/u);
  assert.match(get("code-version"), /^\d+\.\d+\.\d+$/u);
  for (const name of [
    "vsix",
    "core-tar",
    "workspace",
    "code",
    "electron",
    "evidence",
  ])
    assert.ok(isAbsolute(get(name)));
  const approved = await realpath(process.env.REHEARSAL_DEVELOPMENT_ROOT!);
  await nativeStorageRoot();
  const workspace = await realpath(get("workspace"));
  assert.equal(workspace, get("workspace"));
  within(approved, workspace);
  within(approved, get("evidence"));
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
  const resultPath = join(evidence, "result.json");
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
    const coreFiles = await sameFiles(join(coreFrozen, "package"), coreRoot);
    const coreManifest = JSON.parse(
      (await regular(join(coreRoot, "package.json"), 1024 * 1024)).toString(),
    );
    assert.equal(coreManifest.name, "@rehearsal-db/core");
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
    await run(get("code"), [...isolated, "--install-extension", get("vsix")]);
    const installed = join(
      extensions,
      `rehearsal-db.rehearsal-db-${manifest.version}`,
    );
    assert.equal(
      sha(await regular(join(installed, ".vsixmanifest"))),
      sha(await regular(join(frozen, "extension.vsixmanifest"))),
    );
    const extensionFiles = await sameFiles(
      join(frozen, "extension"),
      installed,
      [".vsixmanifest"],
    );
    for (const name of [
      "native-editor-driver.cjs",
      "native-editor-recovery.cjs",
      "native-editor-reads.cjs",
      "native-prisma-review-test.cjs",
    ])
      await copyFile(resolve(__dirname, name), join(harness, name));
    await writeFile(
      join(harness, "package.json"),
      JSON.stringify({
        name: "owned-native-prisma-review",
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
        scenario: "prisma-review",
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
        stdio: ["ignore", "ignore", "ignore"],
      },
    );
    assert.ok(child.pid);
    // The maintained companion finalizes only after observing no dirty documents.
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 180000);
    try {
      await drive(profile, root, controller.signal);
    } finally {
      clearTimeout(timer);
      controller.abort();
    }
    const result = await wait(async () => {
      try {
        const value = JSON.parse(
          (await regular(resultPath, 256 * 1024)).toString(),
        );
        return value.driverFinalized ? value : false;
      } catch {
        return false;
      }
    });
    assert.equal(result.status, "passed");
    assert.equal(result.driverFinalized, true);
    assert.equal(result.recoveryRequired, false);
    recoveryRequired = false;
    await retireOwnedProcessGroup({
      probe: () => ownedProcessState(child!),
      send: (signal) => process.kill(-child!.pid!, signal),
    });
    closed = true;
    assert.equal(
      await sameFiles(join(coreFrozen, "package"), coreRoot),
      coreFiles,
    );
    assert.equal(
      await sameFiles(join(frozen, "extension"), installed, [".vsixmanifest"]),
      extensionFiles,
    );
    assert.equal(sha(await regular(get("vsix"))), get("vsix-sha"));
    assert.equal(sha(await regular(get("core-tar"))), get("core-sha"));
    assert.equal(
      sha(await regular(get("electron"), 256 * 1024 * 1024)),
      get("electron-sha"),
    );
    await writeFile(
      join(evidence, "verification.json"),
      JSON.stringify({
        status: "passed",
        candidateSha256: get("vsix-sha"),
        coreArtifactSha256: get("core-sha"),
        electronSha256: get("electron-sha"),
        codeVersion: get("code-version"),
        coreFiles,
        extensionFiles,
        ownedProcessGroupClosed: closed,
      }),
      { mode: 0o600 },
    );
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
    for (const name of [
      "prisma-migrations.png",
      "prisma-native-sql.png",
      "prisma-failure.png",
      "phase.json",
      "ui-observations.json",
    ])
      await copyFile(join(root, name), join(evidence, name)).catch(() => {});
    await writeFile(
      join(evidence, "cleanup.json"),
      JSON.stringify({
        ownedProcessGroupClosed: closed,
        recoveryRequired,
        profileRetained: true,
        editorDatabaseMutationsRequested: 0,
      }),
      { mode: 0o600 },
    );
  }
}
if (process.argv[1] && resolve(process.argv[1]) === resolve(__filename))
  void main().catch(() => {
    console.error(
      "Native Prisma editor acceptance failed; private output withheld. Inspect owned evidence and recovery state.",
    );
    process.exitCode = 1;
  });
