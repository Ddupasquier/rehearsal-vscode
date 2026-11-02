import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AutomaticUpdateScheduler } from "../../src/updates/automatic_update_scheduler.js";

const owners: AutomaticUpdateScheduler[] = [];
const create = (callback: () => Promise<void>, intervalMs?: number) => {
  const owner = new AutomaticUpdateScheduler(callback, intervalMs);
  owners.push(owner);
  return owner;
};
const deferred = () => {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
};

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  owners.splice(0).forEach((owner) => owner.dispose());
  vi.useRealTimers();
});

describe("automatic update scheduling", () => {
  it("has no constructor or disabled-state effects", async () => {
    const callback = vi.fn(async () => {});
    const owner = create(callback);
    owner.setEnabled(false);
    await vi.advanceTimersByTimeAsync(7 * 86_400_000);
    expect(callback).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("checks on opt-in and once daily afterward by default", async () => {
    const callback = vi.fn(async () => {});
    const owner = create(callback);
    owner.setEnabled(true);
    expect(callback).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(86_399_999);
    expect(callback).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(1);
    expect(callback).toHaveBeenCalledTimes(2);
    expect(vi.getTimerCount()).toBe(1);
  });

  it("coalesces repeated enables without resetting or duplicating the timer", async () => {
    const callback = vi.fn(async () => {});
    const owner = create(callback, 100);
    owner.setEnabled(true);
    owner.setEnabled(true);
    await vi.advanceTimersByTimeAsync(50);
    owner.setEnabled(true);
    await vi.advanceTimersByTimeAsync(50);
    expect(callback).toHaveBeenCalledTimes(2);
    expect(vi.getTimerCount()).toBe(1);
  });

  it("does not overlap slow checks and measures the interval from completion", async () => {
    const work = deferred();
    const callback = vi
      .fn()
      .mockReturnValueOnce(work.promise)
      .mockResolvedValue(undefined);
    create(callback, 100).setEnabled(true);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(callback).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
    work.resolve();
    await vi.advanceTimersByTimeAsync(99);
    expect(callback).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(1);
    expect(callback).toHaveBeenCalledTimes(2);
  });

  it("clears a scheduled check when permission is disabled", async () => {
    const callback = vi.fn(async () => {});
    const owner = create(callback, 100);
    owner.setEnabled(true);
    await vi.advanceTimersByTimeAsync(0);
    expect(vi.getTimerCount()).toBe(1);
    owner.setEnabled(false);
    expect(vi.getTimerCount()).toBe(0);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(callback).toHaveBeenCalledOnce();
    owner.setEnabled(true);
    expect(callback).toHaveBeenCalledTimes(2);
  });

  it("does not reschedule a running check after permission is disabled", async () => {
    const work = deferred();
    const callback = vi.fn(() => work.promise);
    const owner = create(callback, 100);
    owner.setEnabled(true);
    owner.setEnabled(false);
    work.resolve();
    await vi.advanceTimersByTimeAsync(1_000);
    expect(callback).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("does not overlap a check if permission is re-enabled before it finishes", async () => {
    const work = deferred();
    const callback = vi
      .fn()
      .mockReturnValueOnce(work.promise)
      .mockResolvedValue(undefined);
    const owner = create(callback, 100);
    owner.setEnabled(true);
    owner.setEnabled(false);
    owner.setEnabled(true);
    expect(callback).toHaveBeenCalledOnce();
    work.resolve();
    await vi.advanceTimersByTimeAsync(100);
    expect(callback).toHaveBeenCalledTimes(2);
    expect(vi.getTimerCount()).toBe(1);
  });

  it("permanently retires a scheduled timer on disposal", async () => {
    const callback = vi.fn(async () => {});
    const owner = create(callback, 100);
    owner.setEnabled(true);
    await vi.advanceTimersByTimeAsync(0);
    owner.dispose();
    owner.dispose();
    owner.setEnabled(true);
    expect(vi.getTimerCount()).toBe(0);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(callback).toHaveBeenCalledOnce();
  });

  it("does not reschedule after disposal during a check", async () => {
    const work = deferred();
    const callback = vi.fn(() => work.promise);
    const owner = create(callback, 100);
    owner.setEnabled(true);
    owner.dispose();
    work.resolve();
    await vi.advanceTimersByTimeAsync(1_000);
    expect(callback).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each(["throw", "reject"] as const)(
    "swallows a callback %s and retries only after the next interval",
    async (failure) => {
      const callback = vi.fn(() => {
        if (failure === "throw") throw new Error("Synthetic advisory failure");
        return Promise.reject(new Error("Synthetic advisory failure"));
      });
      const owner = create(callback, 100);
      expect(() => owner.setEnabled(true)).not.toThrow();
      await vi.advanceTimersByTimeAsync(99);
      expect(callback).toHaveBeenCalledOnce();
      await vi.advanceTimersByTimeAsync(1);
      expect(callback).toHaveBeenCalledTimes(2);
      expect(vi.getTimerCount()).toBe(1);
    },
  );

  it.each([0, -1, NaN, Infinity, 2_147_483_648])(
    "refuses an interval that could become a tight timer loop (%s)",
    (intervalMs) => {
      const callback = vi.fn(async () => {});
      expect(() => new AutomaticUpdateScheduler(callback, intervalMs)).toThrow(
        RangeError,
      );
      expect(callback).not.toHaveBeenCalled();
      expect(vi.getTimerCount()).toBe(0);
    },
  );
});
