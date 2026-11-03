import { describe, expect, it } from "vitest";
import {
  cleanupAutomaticUpdateNativeHost,
  automaticUpdateObserver,
} from "../../scripts/native/verify-automatic-updates.js";

const clean = {
  driverFinalized: true,
  status: "passed",
  recoveryRequired: false,
  editorRecovery: {
    schemaVersion: 1,
    retainEditor: false,
    dirtyDocumentCount: 0,
    dirtyDocumentCountTruncated: false,
    reason: "clean",
  },
};
const observation = { identityUncertain: false, remaining: [] } as never;
function fixture(closeAt = Infinity) {
  let now = 0,
    calls = 0,
    sampled = false;
  const tracker = {
    observe: async () => {
      sampled = true;
      return observation;
    },
    cleanup: async () => {
      calls++;
      expect(now >= Math.min(closeAt, 15000)).toBe(true);
      return observation;
    },
  };
  return {
    tracker,
    closed: () => now >= closeAt,
    now: () => now,
    pause: async (ms: number) => {
      now += ms;
    },
    calls: () => calls,
    sampled: () => sampled,
  };
}
describe("native updater shutdown ordering", () => {
  it("gives delayed natural closure its existing budget before ownership cleanup", async () => {
    const f = fixture(700);
    const result = await cleanupAutomaticUpdateNativeHost(
      clean,
      f.tracker,
      f.closed,
      f,
    );
    expect(f.now()).toBe(700);
    expect(f.calls()).toBe(1);
    expect(result.observation).toBe(observation);
  });
  it("does not wait when the owned child is already closed", async () => {
    const f = fixture(0);
    await cleanupAutomaticUpdateNativeHost(clean, f.tracker, f.closed, f);
    expect(f.now()).toBe(0);
    expect(f.calls()).toBe(1);
  });
  it("uses one absolute fifteen-second deadline then existing guarded fallback", async () => {
    const f = fixture();
    await cleanupAutomaticUpdateNativeHost(clean, f.tracker, f.closed, f);
    expect(f.now()).toBe(15000);
    expect(f.calls()).toBe(1);
  });
  it("cancellation stops the wait without granting fallback signalling authority", async () => {
    const f = fixture(),
      controller = new AbortController();
    const reason = Error("cancel");
    await expect(
      cleanupAutomaticUpdateNativeHost(clean, f.tracker, f.closed, {
        ...f,
        signal: controller.signal,
        pause: async (ms) => {
          await f.pause(ms);
          controller.abort(reason);
        },
      }),
    ).rejects.toBe(reason);
    expect(f.now()).toBe(100);
    expect(f.calls()).toBe(0);
  });
  it("retains dirty or unknown reports immediately without cleanup", async () => {
    for (const report of [undefined, { ...clean, recoveryRequired: true }]) {
      const f = fixture();
      const result = await cleanupAutomaticUpdateNativeHost(
        report,
        f.tracker,
        f.closed,
        f,
      );
      expect(f.now()).toBe(0);
      expect(f.calls()).toBe(0);
      expect(f.sampled()).toBe(true);
      expect(result.cleanupSkippedForRecovery).toBe(true);
    }
  });
  it("keeps tracker uncertainty and cleanup failure after natural exit", async () => {
    const f = fixture(100),
      uncertain = {
        identityUncertain: true,
        remaining: [{ pid: 123 }],
      } as never;
    const result = await cleanupAutomaticUpdateNativeHost(
      clean,
      { ...f.tracker, cleanup: async () => uncertain },
      f.closed,
      f,
    );
    expect(result.observation).toBe(uncertain);
    const failure = Error("owned cleanup refused");
    await expect(
      cleanupAutomaticUpdateNativeHost(
        clean,
        {
          ...f.tracker,
          cleanup: async () => {
            throw failure;
          },
        },
        f.closed,
        f,
      ),
    ).rejects.toBe(failure);
  });
});

describe("native updater ancestry sampler drain", () => {
  it("keeps sampling during natural shutdown and drains the actual in-flight sample before cleanup", async () => {
    let release!: () => void,
      calls = 0,
      cleanup = false;
    const observer = automaticUpdateObserver(async () => {
      calls++;
      await new Promise<void>((done) => {
        release = done;
      });
    });
    observer.poll();
    observer.poll();
    await Promise.resolve();
    expect(calls).toBe(1);
    const f = fixture(0);
    const completion = cleanupAutomaticUpdateNativeHost(
      clean,
      {
        ...f.tracker,
        cleanup: async () => {
          cleanup = true;
          return observation;
        },
      },
      f.closed,
      { ...f, stopObserving: () => observer.stop() },
    );
    await Promise.resolve();
    expect(cleanup).toBe(false);
    release();
    await completion;
    expect(cleanup).toBe(true);
    observer.poll();
    await Promise.resolve();
    expect(calls).toBe(1);
  });
  it("captures a background observer rejection and refuses cleanup even if a later stop is attempted", async () => {
    const failure = Error("ancestry unknown"),
      observer = automaticUpdateObserver(async () => {
        throw failure;
      });
    observer.poll();
    const f = fixture(0);
    await expect(
      cleanupAutomaticUpdateNativeHost(clean, f.tracker, f.closed, {
        ...f,
        stopObserving: () => observer.stop(),
      }),
    ).rejects.toBe(failure);
    expect(f.calls()).toBe(0);
    await expect(observer.stop()).rejects.toBe(failure);
  });
});
