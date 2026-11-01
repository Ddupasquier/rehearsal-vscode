import { afterEach, describe, expect, it, vi } from "vitest";
import { createActiveOperationMonitor } from "../../src/runtime/active_operation_monitor.js";

const activity = (
  state: "idle" | "busy" | "stale" | "invalid",
  startedAt = "2026-10-13T12:00:00Z",
) => ({
  schemaVersion: 1,
  state,
  operation:
    state === "busy" || state === "stale"
      ? { kind: "run", startedAt, rehearsalVersion: "0.1.0-rc.4" }
      : null,
});
afterEach(() => vi.useRealTimers());

describe("bounded explicit-action activity monitoring", () => {
  it("waits through startup idle, publishes actual busy phases and ends once idle without further reads", async () => {
    vi.useFakeTimers();
    const read = vi
      .fn()
      .mockResolvedValueOnce(activity("idle"))
      .mockResolvedValueOnce(activity("busy"))
      .mockResolvedValue(activity("idle"));
    const publish = vi.fn();
    const monitor = createActiveOperationMonitor({
      intervalMs: 100,
      startupGraceMs: 500,
    });
    const pending = monitor.observe({
      readActivity: read,
      publish,
      allowed: () => true,
    });
    await vi.advanceTimersByTimeAsync(200);
    expect(await pending).toMatchObject({
      state: "idle",
      observedBusy: true,
      elapsedMs: 200,
    });
    expect(publish).toHaveBeenCalledOnce();
    expect(publish).toHaveBeenCalledWith(activity("busy"));
    await vi.advanceTimersByTimeAsync(300_000);
    expect(read).toHaveBeenCalledTimes(3);
    expect(vi.getTimerCount()).toBe(0);
    monitor.dispose();
  });

  it("does not equate an absent operation or a long busy session with success", async () => {
    vi.useFakeTimers();
    const idleMonitor = createActiveOperationMonitor({
      intervalMs: 50,
      startupGraceMs: 100,
    });
    const initialIdle = idleMonitor.observe({
      readActivity: async () => activity("idle"),
      publish: vi.fn(),
      allowed: () => true,
    });
    await vi.advanceTimersByTimeAsync(100);
    expect(await initialIdle).toMatchObject({
      state: "not_observed",
      observedBusy: false,
    });
    const busyMonitor = createActiveOperationMonitor({
      intervalMs: 50,
      maximumMs: 201,
    });
    const busy = busyMonitor.observe({
      readActivity: async () => activity("busy"),
      publish: vi.fn(),
      allowed: () => true,
    });
    await vi.advanceTimersByTimeAsync(201);
    expect(await busy).toMatchObject({
      state: "timeout",
      observedBusy: true,
      elapsedMs: 201,
    });
    expect(vi.getTimerCount()).toBe(0);
    idleMonitor.dispose();
    busyMonitor.dispose();
  });

  it("serializes reads, coalesces duplicates and aborts a hung owned read on disposal", async () => {
    vi.useFakeTimers();
    let signal: AbortSignal | undefined;
    const read = vi.fn(async (owned: AbortSignal) => {
      signal = owned;
      return new Promise(() => {});
    });
    const monitor = createActiveOperationMonitor();
    const options = {
      readActivity: read,
      publish: vi.fn(),
      allowed: () => true,
    };
    const first = monitor.observe(options);
    expect(monitor.observe(options)).toBe(first);
    await vi.advanceTimersByTimeAsync(4000);
    expect(read).toHaveBeenCalledOnce();
    monitor.dispose();
    expect(await first).toMatchObject({ state: "aborted" });
    expect(signal?.aborted).toBe(true);
    await vi.advanceTimersByTimeAsync(300_000);
    expect(read).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("aborts on trust/folder/owned-terminal guard loss even during an unresponsive read", async () => {
    vi.useFakeTimers();
    let allowed = true;
    let signal: AbortSignal | undefined;
    const monitor = createActiveOperationMonitor({ intervalMs: 100 });
    const pending = monitor.observe({
      readActivity: async (owned) => {
        signal = owned;
        return new Promise(() => {});
      },
      publish: vi.fn(),
      allowed: () => allowed,
    });
    await vi.advanceTimersByTimeAsync(1);
    allowed = false;
    await vi.advanceTimersByTimeAsync(100);
    expect(await pending).toMatchObject({ state: "aborted" });
    expect(signal?.aborted).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
    monitor.dispose();
  });

  it.each(["stale", "invalid"] as const)(
    "publishes safe %s state without repairing or claiming completion",
    async (state) => {
      const monitor = createActiveOperationMonitor();
      const publish = vi.fn();
      expect(
        await monitor.observe({
          readActivity: async () => activity(state),
          publish,
          allowed: () => true,
        }),
      ).toMatchObject({ state });
      expect(publish).toHaveBeenCalledWith(activity(state));
      monitor.dispose();
    },
  );

  it("does not borrow a changed operation or leak raw read errors/malformed contracts", async () => {
    vi.useFakeTimers();
    const monitor = createActiveOperationMonitor({ intervalMs: 100 });
    const read = vi
      .fn()
      .mockResolvedValueOnce(activity("busy"))
      .mockResolvedValue(activity("busy", "2026-10-13T12:01:00Z"));
    const publish = vi.fn();
    const pending = monitor.observe({
      readActivity: read,
      publish,
      allowed: () => true,
    });
    await vi.advanceTimersByTimeAsync(100);
    expect(await pending).toMatchObject({ state: "operation_changed" });
    expect(publish).toHaveBeenCalledOnce();
    const failed = await monitor.observe({
      readActivity: async () => {
        throw new Error("PRIVATE_CANARY");
      },
      publish,
      allowed: () => true,
    });
    expect(failed.state).toBe("unavailable");
    expect(JSON.stringify(failed)).not.toContain("PRIVATE_CANARY");
    expect(
      (
        await monitor.observe({
          readActivity: async () => ({
            schemaVersion: 99,
            private: "PRIVATE_CANARY",
          }),
          publish,
          allowed: () => true,
        })
      ).state,
    ).toBe("invalid");
    monitor.dispose();
  });

  it("does not queue a read after immediate disposal and refuses unlimited budgets", async () => {
    const monitor = createActiveOperationMonitor();
    const read = vi.fn();
    const pending = monitor.observe({
      readActivity: read,
      publish: vi.fn(),
      allowed: () => true,
    });
    monitor.dispose();
    expect(await pending).toMatchObject({ state: "aborted" });
    expect(read).not.toHaveBeenCalled();
    for (const options of [
      { maximumMs: 300001 },
      { startupGraceMs: 30001 },
      { intervalMs: 0 },
    ])
      expect(() => createActiveOperationMonitor(options)).toThrow("bounded");
  });
});
