import { afterEach, describe, expect, it, vi } from "vitest";
import { spawn, type ChildProcess } from "node:child_process";
import { basename } from "node:path";
import { realpath } from "node:fs/promises";
import { setTimeout as delay } from "node:timers/promises";
import {
  createNativeEditorTracker,
  type NativeProcessIdentity,
} from "../../scripts/native/verify-native-cancellation.js";

const helper = require("../../scripts/native/native-editor-reads.cjs") as {
  processes(): Promise<Map<number, NativeProcessIdentity>>;
};
const children: { child: ChildProcess; closed: Promise<void> }[] = [];
function child(program = "setInterval(()=>{},1000)", ipc = false) {
  const process = spawn(globalThis.process.execPath, ["-e", program], {
    detached: true,
    stdio: ipc ? ["ignore", "ignore", "ignore", "ipc"] : "ignore",
  });
  const closed = new Promise<void>((done) =>
    process.once("close", () => done()),
  );
  process.on("error", () => {});
  children.push({ child: process, closed });
  expect(process.pid).toBeDefined();
  return { process, closed, pid: process.pid! };
}
async function absent(pid: number) {
  expect((await helper.processes()).has(pid)).toBe(false);
}
afterEach(async () => {
  for (const { child, closed } of children.splice(0)) {
    if (child.exitCode === null && child.signalCode === null)
      child.kill("SIGKILL");
    await Promise.race([
      closed,
      delay(2000).then(() => {
        throw new Error("Harmless test child close was not observed.");
      }),
    ]);
  }
});

describe.skipIf(process.platform === "win32")(
  "native launcher identity cleanup",
  () => {
    it.each(["?Es", "SE", "ZEs"])(
      "waits for a captured macOS %s exit row without adopting its changed comm or signalling it",
      async (state) => {
        const root: NativeProcessIdentity = {
          pid: 100001,
          ppid: process.pid,
          pgid: 100001,
          state: "S",
          started: "Thu Oct 22 14:47:10 2026",
          executable: "Code",
        };
        const rows = new Map([[root.pid, root]]);
        const tracker = createNativeEditorTracker(
          root.pid,
          "/Applications/Visual Studio Code.app/Contents/MacOS/Code",
          async () => new Map(rows),
          "darwin",
        );
        await tracker.observe();
        const exiting = { ...root, state, executable: "(Code)" };
        rows.set(root.pid, exiting);
        const signal = vi.spyOn(process, "kill").mockImplementation(() => true);
        try {
          expect(await tracker.cleanup()).toMatchObject({
            rootObserved: true,
            identityUncertain: false,
            fallbackUsed: false,
            remaining: [],
            unknown: [],
            awaitingReap: [exiting],
            execTransitions: [],
            uncertaintyHistory: [],
          });
          expect(signal).not.toHaveBeenCalled();
          rows.clear();
          expect(await tracker.observe()).toMatchObject({
            awaitingReap: [],
            remaining: [],
            unknown: [],
            identityUncertain: false,
          });
        } finally {
          signal.mockRestore();
        }
      },
    );
    it.each(["linux", "darwin"] as const)(
      "refuses unverified or changed-birth E rows on %s without new cleanup authority",
      async (platform) => {
        const root: NativeProcessIdentity = {
          pid: 100001,
          ppid: process.pid,
          pgid: 100001,
          state: "S",
          started: "Thu Oct 22 14:47:10 2026",
          executable: "Code",
        };
        const rows = new Map([[root.pid, root]]);
        const tracker = createNativeEditorTracker(
          root.pid,
          "Code",
          async () => new Map(rows),
          platform,
        );
        await tracker.observe();
        rows.set(root.pid, {
          ...root,
          state: "?Es",
          executable: "(Code)",
          ...(platform === "darwin" ? { started: "different birth" } : {}),
        });
        const signal = vi.spyOn(process, "kill").mockImplementation(() => true);
        try {
          expect(await tracker.cleanup()).toMatchObject({
            identityUncertain: true,
            fallbackUsed: false,
            awaitingReap: [],
          });
          expect(signal).not.toHaveBeenCalled();
        } finally {
          signal.mockRestore();
        }
      },
    );
    it("does not establish root ownership from a first-seen macOS exit row", async () => {
      const root: NativeProcessIdentity = {
        pid: 100001,
        ppid: process.pid,
        pgid: 100001,
        state: "?Es",
        started: "Thu Oct 22 14:47:10 2026",
        executable: "Code",
      };
      const tracker = createNativeEditorTracker(
        root.pid,
        "Code",
        async () => new Map([[root.pid, root]]),
        "darwin",
      );
      const signal = vi.spyOn(process, "kill").mockImplementation(() => true);
      try {
        expect(await tracker.cleanup()).toMatchObject({
          rootObserved: false,
          identityUncertain: true,
          fallbackUsed: false,
          awaitingReap: [],
          unknown: [root],
        });
        expect(signal).not.toHaveBeenCalled();
      } finally {
        signal.mockRestore();
      }
    });
    it.each(["MainThread", "-"])(
      "refuses an unverified %s root without granting signal authority",
      async (executable) => {
        const root: NativeProcessIdentity = {
          pid: 100001,
          ppid: process.pid,
          pgid: 100001,
          state: "S",
          started: "Tue Oct 20 22:47:35 2026",
          executable,
        };
        const tracker = createNativeEditorTracker(
          root.pid,
          process.execPath,
          async () => new Map([[root.pid, root]]),
        );
        const signal = vi.spyOn(process, "kill").mockImplementation(() => true);
        try {
          expect(await tracker.cleanup()).toMatchObject({
            rootObserved: false,
            identityUncertain: true,
            fallbackUsed: false,
            unknown: [root],
          });
          expect(signal).not.toHaveBeenCalled();
        } finally {
          signal.mockRestore();
        }
      },
    );
    it.skipIf(process.platform !== "linux")(
      "observes the actual Linux executable even when its thread title is changed",
      async () => {
        const owned = child(
          "process.title='not-node-title';process.send('title-set');setInterval(()=>{},1000)",
          true,
        );
        await Promise.race([
          new Promise<void>((done) =>
            owned.process.once("message", () => done()),
          ),
          delay(2000).then(() => {
            throw new Error("Owned Linux title fixture was not ready.");
          }),
        ]);
        const row = (await helper.processes()).get(owned.pid);
        expect(row).toMatchObject({
          pid: owned.pid,
          ppid: process.pid,
          pgid: owned.pid,
          executable: basename(process.execPath),
        });
        const tracker = createNativeEditorTracker(owned.pid, process.execPath);
        expect(await tracker.observe()).toMatchObject({
          rootObserved: true,
          identityUncertain: false,
        });
        expect(await tracker.cleanup()).toMatchObject({
          fallbackUsed: true,
          identityUncertain: false,
          remaining: [],
          unknown: [],
        });
        await owned.closed;
      },
    );
    it("awaits a first-seen zombie under a currently verified parent chain without adopting it", async () => {
      const root: NativeProcessIdentity = {
        pid: 100001,
        ppid: process.pid,
        pgid: 100001,
        state: "S",
        started: "Tue Oct 20 22:47:35 2026",
        executable: basename(process.execPath),
      };
      const parent = {
        ...root,
        pid: 100002,
        ppid: root.pid,
        executable: "helper",
      };
      const zombie = {
        ...root,
        pid: 100003,
        ppid: parent.pid,
        state: "Z",
        executable: "<defunct>",
      };
      const rows = new Map([[root.pid, root]]);
      const tracker = createNativeEditorTracker(
        root.pid,
        process.execPath,
        async () => new Map(rows),
      );
      await tracker.observe();
      // The parent and zombie appear together; row order is not ancestry proof.
      rows.set(zombie.pid, zombie);
      rows.set(parent.pid, parent);
      expect(await tracker.observe()).toMatchObject({
        identityUncertain: false,
        awaitingReap: [zombie],
        remaining: [root, parent],
        execTransitions: [],
        unknown: [],
      });
      rows.delete(root.pid);
      rows.delete(parent.pid);
      rows.set(zombie.pid, { ...zombie, ppid: 1 });
      const signal = vi.spyOn(process, "kill").mockImplementation(() => true);
      try {
        expect(await tracker.cleanup()).toMatchObject({
          identityUncertain: false,
          fallbackUsed: false,
          awaitingReap: [{ ...zombie, ppid: 1 }],
          remaining: [],
          unknown: [],
        });
        expect(signal).not.toHaveBeenCalled();
      } finally {
        signal.mockRestore();
      }
      rows.delete(zombie.pid);
      expect(await tracker.observe()).toMatchObject({
        identityUncertain: false,
        awaitingReap: [],
        remaining: [],
        unknown: [],
      });
    });
    it("does not accept a first-seen zombie from a formerly owned but absent parent", async () => {
      const root: NativeProcessIdentity = {
        pid: 100001,
        ppid: process.pid,
        pgid: 100001,
        state: "S",
        started: "Tue Oct 20 22:47:35 2026",
        executable: basename(process.execPath),
      };
      const parent = {
        ...root,
        pid: 100002,
        ppid: root.pid,
        executable: "helper",
      };
      const zombie = {
        ...parent,
        pid: 100003,
        ppid: parent.pid,
        state: "Z",
        executable: "<defunct>",
      };
      const rows = new Map([
        [root.pid, root],
        [parent.pid, parent],
      ]);
      const tracker = createNativeEditorTracker(
        root.pid,
        process.execPath,
        async () => new Map(rows),
      );
      await tracker.observe();
      rows.delete(parent.pid);
      rows.set(zombie.pid, zombie);
      const signal = vi.spyOn(process, "kill").mockImplementation(() => true);
      try {
        expect(await tracker.cleanup()).toMatchObject({
          identityUncertain: true,
          fallbackUsed: false,
          awaitingReap: [],
          unknown: [zombie],
          uncertaintyHistory: [{ reason: "unobserved-group-member" }],
        });
        expect(signal).not.toHaveBeenCalled();
      } finally {
        signal.mockRestore();
      }
    });
    it("never promotes a wait-only zombie identity into a live signal target", async () => {
      const root: NativeProcessIdentity = {
        pid: 100001,
        ppid: process.pid,
        pgid: 100001,
        state: "S",
        started: "Tue Oct 20 22:47:35 2026",
        executable: basename(process.execPath),
      };
      const zombie = {
        ...root,
        pid: 100002,
        ppid: root.pid,
        state: "Z",
        executable: "<defunct>",
      };
      const rows = new Map([
        [root.pid, root],
        [zombie.pid, zombie],
      ]);
      const tracker = createNativeEditorTracker(
        root.pid,
        process.execPath,
        async () => new Map(rows),
      );
      expect((await tracker.observe()).awaitingReap).toEqual([zombie]);
      const live = { ...zombie, state: "S", executable: "node" };
      rows.set(live.pid, live);
      const signal = vi.spyOn(process, "kill").mockImplementation(() => true);
      try {
        expect(await tracker.cleanup()).toMatchObject({
          identityUncertain: true,
          fallbackUsed: false,
          awaitingReap: [],
          remaining: [root],
          unknown: [live],
          execTransitions: [],
          uncertaintyHistory: [{ reason: "descendant-identity-drift" }],
        });
        expect(signal).not.toHaveBeenCalled();
      } finally {
        signal.mockRestore();
      }
    });
    it.each(["<defunct>", "(node)"])(
      "waits for an observed STAT Z %s child to be reaped without granting signal authority",
      async (executable) => {
        const owned = child();
        let exiting = false;
        const tracker = createNativeEditorTracker(
          owned.pid,
          process.execPath,
          async () => {
            const rows = await helper.processes();
            const row = rows.get(owned.pid);
            if (exiting && row)
              rows.set(row.pid, { ...row, state: "Z", executable });
            return rows;
          },
        );
        await tracker.observe();
        exiting = true;
        const signal = vi.spyOn(process, "kill");
        try {
          expect(await tracker.cleanup()).toMatchObject({
            identityUncertain: false,
            fallbackUsed: false,
            remaining: [],
            unknown: [],
            awaitingReap: [
              expect.objectContaining({
                pid: owned.pid,
                state: "Z",
                executable,
              }),
            ],
          });
          expect(signal).not.toHaveBeenCalled();
        } finally {
          signal.mockRestore();
        }
        owned.process.kill("SIGTERM");
        await owned.closed;
        expect(await tracker.observe()).toMatchObject({
          awaitingReap: [],
          remaining: [],
          unknown: [],
        });
      },
    );
    it.each(["<defunct>", "(node)", "node"])(
      "does not adopt or signal a captured STAT Z %s descendant while its parent is live",
      async (executable) => {
        const owned = child(),
          descendant = child();
        let exiting = false;
        const tracker = createNativeEditorTracker(
          owned.pid,
          process.execPath,
          async () => {
            const rows = await helper.processes(),
              row = rows.get(descendant.pid);
            // Model the observed descendant ancestry and later unreaped ps row.
            if (row)
              rows.set(row.pid, {
                ...row,
                ppid: owned.pid,
                ...(exiting ? { state: "Z+", executable } : {}),
              });
            return rows;
          },
        );
        expect(
          (await tracker.observe()).remaining.map((row) => row.pid),
        ).toContain(descendant.pid);
        exiting = true;
        expect(await tracker.observe()).toMatchObject({
          identityUncertain: false,
          remaining: [expect.objectContaining({ pid: owned.pid })],
          awaitingReap: [
            expect.objectContaining({
              pid: descendant.pid,
              state: "Z+",
              executable,
            }),
          ],
          execTransitions: [],
        });
        const signal = vi.spyOn(process, "kill");
        try {
          expect(await tracker.cleanup()).toMatchObject({
            identityUncertain: false,
            remaining: [],
            unknown: [],
            awaitingReap: [expect.objectContaining({ pid: descendant.pid })],
            execTransitions: [],
          });
          expect(
            signal.mock.calls.some(([pid]) => pid === descendant.pid),
          ).toBe(false);
          await owned.closed;
          expect((await helper.processes()).has(descendant.pid)).toBe(true);
        } finally {
          signal.mockRestore();
        }
      },
    );
    it("does not excuse an executable change from live STAT based on parentheses", async () => {
      const owned = child();
      let changed = false;
      const tracker = createNativeEditorTracker(
        owned.pid,
        process.execPath,
        async () => {
          const rows = await helper.processes(),
            row = rows.get(owned.pid);
          if (changed && row)
            rows.set(row.pid, { ...row, state: "S", executable: "(node)" });
          return rows;
        },
      );
      await tracker.observe();
      changed = true;
      const signal = vi.spyOn(process, "kill");
      try {
        expect(await tracker.cleanup()).toMatchObject({
          identityUncertain: true,
          fallbackUsed: false,
          awaitingReap: [],
          uncertaintyHistory: [{ reason: "root-identity-drift" }],
        });
        expect(signal).not.toHaveBeenCalled();
      } finally {
        signal.mockRestore();
      }
    });
    it("accepts observed normal exit via actual close and ps absence, with no signal probe", async () => {
      const owned = child();
      const tracker = createNativeEditorTracker(owned.pid, process.execPath);
      expect(await tracker.observe()).toMatchObject({
        rootObserved: true,
        identityUncertain: false,
      });
      owned.process.kill("SIGTERM");
      await owned.closed;
      const signal = vi.spyOn(process, "kill");
      try {
        expect(await tracker.cleanup()).toMatchObject({
          rootObserved: true,
          fallbackUsed: false,
          observationFailed: false,
          identityUncertain: false,
          signalFailed: false,
          remaining: [],
          unknown: [],
        });
        expect(signal).not.toHaveBeenCalled();
      } finally {
        signal.mockRestore();
      }
      await absent(owned.pid);
    });
    it("terminates only the captured actual native root and leaves an unrelated sentinel alive", async () => {
      const owned = child(),
        sentinel = child();
      const sentinelBefore = (await helper.processes()).get(sentinel.pid);
      const tracker = createNativeEditorTracker(owned.pid, process.execPath);
      await tracker.observe();
      expect(await tracker.cleanup()).toMatchObject({
        rootObserved: true,
        fallbackUsed: true,
        observationFailed: false,
        identityUncertain: false,
        signalFailed: false,
        remaining: [],
        unknown: [],
      });
      await owned.closed;
      await absent(owned.pid);
      expect((await helper.processes()).get(sentinel.pid)).toMatchObject({
        pid: sentinelBefore!.pid,
        ppid: sentinelBefore!.ppid,
        pgid: sentinelBefore!.pgid,
        started: sentinelBefore!.started,
        executable: sentinelBefore!.executable,
      });
    });
    it("captures a real descendant while alive and reaps it after its root closes", async () => {
      const owned = child(
        "const {spawn}=require('node:child_process');spawn(process.execPath,['-e','setTimeout(()=>{},5000)'],{stdio:'ignore'}).unref();setInterval(()=>{},1000)",
      );
      const tracker = createNativeEditorTracker(owned.pid, process.execPath);
      try {
        let observation = await tracker.observe();
        const until = Date.now() + 2000;
        while (observation.remaining.length < 2 && Date.now() < until) {
          await delay(50);
          observation = await tracker.observe();
        }
        expect(observation.remaining).toHaveLength(2);
        const descendant = observation.remaining.find(
          (row) => row.pid !== owned.pid,
        )!;
        owned.process.kill("SIGTERM");
        await owned.closed;
        const cleanup = await tracker.cleanup();
        expect(cleanup).toMatchObject({
          fallbackUsed: true,
          observationFailed: false,
          identityUncertain: false,
          remaining: [],
          unknown: [],
        });
        expect(
          cleanup.observedRemainingBeforeFallback.map((row) => row.pid),
        ).toContain(descendant.pid);
        await absent(descendant.pid);
      } finally {
        await tracker.cleanup();
      }
    });
    it("accepts an actual descendant shell-to-sleep exec only with current verified ancestry", async () => {
      const shellExecutable =
        process.platform === "linux"
          ? basename(await realpath("/bin/sh"))
          : "sh";
      const owned = child(
        "const {spawn}=require('node:child_process');const c=spawn('/bin/sh',['-c','read ready; exec /bin/sleep 5'],{stdio:['pipe','ignore','ignore']});process.on('message',()=>c.stdin.end('ready\\n'));setInterval(()=>{},1000)",
        true,
      );
      const tracker = createNativeEditorTracker(owned.pid, process.execPath);
      try {
        let observation = await tracker.observe();
        let until = Date.now() + 2000;
        while (
          !observation.remaining.some(
            (row) => row.executable === shellExecutable,
          ) &&
          Date.now() < until
        ) {
          await delay(50);
          observation = await tracker.observe();
        }
        const before = observation.remaining.find(
          (row) => row.executable === shellExecutable,
        )!;
        expect(before).toBeDefined();
        owned.process.send!("exec");
        until = Date.now() + 2000;
        while (!observation.execTransitions.length && Date.now() < until) {
          await delay(50);
          observation = await tracker.observe();
        }
        expect(observation).toMatchObject({
          identityUncertain: false,
          uncertaintyHistory: [],
        });
        expect(observation.execTransitions).toHaveLength(1);
        expect(observation.execTransitions[0]).toMatchObject({
          before,
          after: {
            pid: before.pid,
            started: before.started,
            pgid: before.pgid,
            executable: "sleep",
          },
          verifiedParent: { pid: owned.pid },
        });
        expect(await tracker.cleanup()).toMatchObject({
          identityUncertain: false,
          observationFailed: false,
          remaining: [],
          unknown: [],
        });
        await absent(before.pid);
      } finally {
        await tracker.cleanup();
      }
    });
    it.each(["started", "executable", "pgid"] as const)(
      "refuses %s identity drift without signalling the actual child",
      async (field) => {
        const owned = child();
        let drift = false;
        const tracker = createNativeEditorTracker(
          owned.pid,
          process.execPath,
          async () => {
            const rows = await helper.processes(),
              row = rows.get(owned.pid);
            if (drift && row)
              rows.set(row.pid, {
                ...row,
                [field]:
                  field === "pgid" ? row.pgid + 1 : "not-the-captured-identity",
              });
            return rows;
          },
        );
        await tracker.observe();
        drift = true;
        expect(await tracker.observe()).toMatchObject({
          fallbackUsed: false,
          identityUncertain: true,
          uncertaintyHistory: [{ reason: "root-identity-drift" }],
        });
        drift = false;
        expect(await tracker.observe()).toMatchObject({
          identityUncertain: true,
          unknown: [],
          uncertaintyHistory: [{ reason: "root-identity-drift" }],
        });
        expect((await helper.processes()).has(owned.pid)).toBe(true);
      },
    );
    it("refuses descendant exec drift when its current ancestry is no longer proven", async () => {
      const owned = child(),
        descendant = child();
      let detached = false;
      const tracker = createNativeEditorTracker(
        owned.pid,
        process.execPath,
        async () => {
          const rows = await helper.processes(),
            row = rows.get(descendant.pid);
          if (row)
            rows.set(row.pid, {
              ...row,
              ppid: detached ? 1 : owned.pid,
              executable: detached ? "unproven-exec" : row.executable,
            });
          return rows;
        },
      );
      expect(
        (await tracker.observe()).remaining.map((row) => row.pid),
      ).toContain(descendant.pid);
      detached = true;
      expect(await tracker.cleanup()).toMatchObject({
        identityUncertain: true,
        fallbackUsed: false,
        execTransitions: [],
        uncertaintyHistory: [
          {
            reason: "descendant-identity-drift",
            expected: { pid: descendant.pid },
            observed: { ppid: 1, executable: "unproven-exec" },
          },
        ],
      });
      expect((await helper.processes()).has(owned.pid)).toBe(true);
      expect((await helper.processes()).has(descendant.pid)).toBe(true);
    });
    it("does not acquire authority over an unobserved member just because its group matches", async () => {
      const owned = child(),
        sentinel = child();
      let extra = false;
      const tracker = createNativeEditorTracker(
        owned.pid,
        process.execPath,
        async () => {
          const rows = await helper.processes(),
            row = rows.get(sentinel.pid);
          if (extra && row)
            rows.set(row.pid, { ...row, ppid: 1, pgid: owned.pid });
          return rows;
        },
      );
      await tracker.observe();
      extra = true;
      const cleanup = await tracker.cleanup();
      expect(cleanup).toMatchObject({
        fallbackUsed: false,
        identityUncertain: true,
      });
      expect(cleanup.unknown.map((row) => row.pid)).toContain(sentinel.pid);
      extra = false;
      expect(await tracker.observe()).toMatchObject({
        identityUncertain: true,
        unknown: [],
        uncertaintyHistory: [{ reason: "unobserved-group-member" }],
      });
      expect((await helper.processes()).has(sentinel.pid)).toBe(true);
      expect((await helper.processes()).has(owned.pid)).toBe(true);
    });
    it("fails closed on ps failure and does not turn a later empty snapshot into a pass", async () => {
      const owned = child();
      let unavailable = false;
      const tracker = createNativeEditorTracker(
        owned.pid,
        process.execPath,
        () => {
          if (unavailable)
            throw new Error("PRIVATE_CANARY process observation unavailable");
          return helper.processes();
        },
      );
      await tracker.observe();
      unavailable = true;
      const cleanup = await tracker.cleanup();
      expect(cleanup).toMatchObject({
        observationFailed: true,
        fallbackUsed: false,
      });
      expect(JSON.stringify(cleanup)).not.toContain("PRIVATE_CANARY");
      expect((await helper.processes()).has(owned.pid)).toBe(true);
      owned.process.kill("SIGTERM");
      await owned.closed;
      unavailable = false;
      expect(await tracker.cleanup()).toMatchObject({
        observationFailed: true,
        remaining: [],
      });
    });
    it("rejects a root executable mismatch before granting cleanup authority", async () => {
      const owned = child();
      const tracker = createNativeEditorTracker(
        owned.pid,
        `${basename(process.execPath)}-not-the-root`,
      );
      expect(await tracker.cleanup()).toMatchObject({
        rootObserved: false,
        identityUncertain: true,
        fallbackUsed: false,
      });
      expect((await helper.processes()).has(owned.pid)).toBe(true);
    });
  },
);
