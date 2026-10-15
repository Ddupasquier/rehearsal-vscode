import { afterEach, describe, expect, it, vi } from "vitest";
import { createOperationCompletionObserver } from "../src/operation_completion.js";
const activity = (state: "idle" | "busy" | "stale" | "invalid") => ({
  schemaVersion: 1,
  state,
  operation:
    state === "busy" || state === "stale"
      ? {
          kind: "run",
          startedAt: "2026-10-13T12:00:00Z",
          rehearsalVersion: "0.1.0-rc.4",
        }
      : null,
});
afterEach(() => vi.useRealTimers());
describe("bounded owned-cancellation completion observation", () => {
  it("reads only until the public operation becomes idle", async () => {
    vi.useFakeTimers();
    const read = vi
      .fn()
      .mockResolvedValueOnce(activity("busy"))
      .mockResolvedValue(activity("idle"));
    const observer = createOperationCompletionObserver({ intervalMs: 100 });
    const pending = observer.observe(read);
    await vi.advanceTimersByTimeAsync(100);
    expect(await pending).toMatchObject({
      state: "idle",
      elapsedMs: 100,
      activity: activity("idle"),
    });
    expect(read).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(read).toHaveBeenCalledTimes(2);
    observer.dispose();
  });
  it.each(["stale", "invalid"] as const)(
    "reports %s without repairing or signaling a discovered operation",
    async (state) => {
      const read = vi.fn().mockResolvedValue(activity(state));
      const observer = createOperationCompletionObserver();
      expect(await observer.observe(read)).toMatchObject({
        state,
        activity: activity(state),
      });
      expect(read).toHaveBeenCalledOnce();
      observer.dispose();
    },
  );
  it("distinguishes malformed contracts from unavailable reads and never exposes error detail", async () => {
    const observer = createOperationCompletionObserver();
    expect(
      await observer.observe(async () => ({
        schemaVersion: 99,
        state: "idle",
      })),
    ).toMatchObject({ state: "invalid" });
    const result = await observer.observe(async () => {
      throw new Error("PRIVATE_CANARY");
    });
    expect(result.state).toBe("unavailable");
    expect(JSON.stringify(result)).not.toContain("PRIVATE_CANARY");
    observer.dispose();
  });
  it("coalesces duplicate requests and bounds busy or unresponsive readers", async () => {
    vi.useFakeTimers();
    const observer = createOperationCompletionObserver({
      timeoutMs: 200,
      intervalMs: 50,
    });
    const read = vi.fn().mockResolvedValue(activity("busy"));
    const first = observer.observe(read);
    const duplicate = observer.observe(read);
    expect(duplicate).toBe(first);
    await vi.advanceTimersByTimeAsync(200);
    expect(await first).toMatchObject({ state: "timeout", elapsedMs: 200 });
    expect(read).toHaveBeenCalledTimes(4);
    const hung = vi.fn((signal: AbortSignal) => {
      signal.addEventListener("abort", () => undefined);
      return new Promise(() => {});
    });
    const pending = observer.observe(hung);
    await vi.advanceTimersByTimeAsync(200);
    expect(await pending).toMatchObject({ state: "timeout", elapsedMs: 200 });
    expect(hung.mock.calls[0]?.[0].aborted).toBe(true);
    observer.dispose();
  });
  it("aborts only its owned read on external cancellation or disposal", async () => {
    const observer = createOperationCompletionObserver();
    const abort = new AbortController();
    let observed: AbortSignal | undefined;
    const pending = observer.observe(async (signal) => {
      observed = signal;
      return new Promise(() => {});
    }, abort.signal);
    await Promise.resolve();
    abort.abort();
    expect(await pending).toMatchObject({ state: "aborted" });
    expect(observed?.aborted).toBe(true);
    const second = observer.observe(async () => new Promise(() => {}));
    observer.dispose();
    expect(await second).toMatchObject({ state: "aborted" });
    const neverRead = vi.fn();
    expect(await observer.observe(neverRead)).toMatchObject({
      state: "aborted",
    });
    expect(neverRead).not.toHaveBeenCalled();
  });
  it("refuses observation settings beyond the fixed 30-second budget", () => {
    for (const settings of [
      { timeoutMs: 30001 },
      { timeoutMs: 0 },
      { intervalMs: 0 },
      { intervalMs: 1001 },
    ])
      expect(() => createOperationCompletionObserver(settings)).toThrow(
        "bounded",
      );
  });

  it("does not launch a queued read after immediate disposal and rejects unsafe activity metadata", async () => {
    const observer = createOperationCompletionObserver();
    const read = vi.fn().mockResolvedValue(activity("idle"));
    const pending = observer.observe(read);
    observer.dispose();
    expect(await pending).toMatchObject({ state: "aborted" });
    expect(read).not.toHaveBeenCalled();
    const another = createOperationCompletionObserver();
    for (const operation of [
      { ...activity("busy").operation, kind: "x".repeat(201) },
      { ...activity("busy").operation, kind: "run\nPRIVATE_CANARY" },
      { ...activity("busy").operation, rehearsalVersion: "PRIVATE_CANARY" },
    ]) {
      const result = await another.observe(async () => ({
        ...activity("busy"),
        operation,
      }));
      expect(result.state).toBe("invalid");
      expect(JSON.stringify(result)).not.toContain("PRIVATE_CANARY");
    }
    another.dispose();
  });
});
