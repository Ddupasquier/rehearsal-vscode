/** Bounded post-cancellation observation. A receipt never grants process ownership. */
import { parseActivityData, type ActivityData } from "./contracts.js";

export interface OperationCompletionResult {
  readonly state:
    "idle" | "stale" | "invalid" | "unavailable" | "timeout" | "aborted";
  readonly elapsedMs: number;
  readonly activity?: ActivityData;
}
export type ReadOperationActivity = (signal: AbortSignal) => Promise<unknown>;

/** One instance belongs to one workspace; duplicate requests share one bounded observation. */
export const createOperationCompletionObserver = ({
  timeoutMs = 30_000,
  intervalMs = 500,
  now = () => Date.now(),
}: {
  readonly timeoutMs?: number;
  readonly intervalMs?: number;
  readonly now?: () => number;
} = {}) => {
  if (
    !Number.isSafeInteger(timeoutMs) ||
    timeoutMs < 1 ||
    timeoutMs > 30_000 ||
    !Number.isSafeInteger(intervalMs) ||
    intervalMs < 1 ||
    intervalMs > 1000
  )
    throw new Error(
      "Operation completion requires bounded observation intervals.",
    );
  let disposed = false;
  let controller: AbortController | undefined;
  let pending: Promise<OperationCompletionResult> | undefined;

  const observe = (
    readActivity: ReadOperationActivity,
    signal?: AbortSignal,
  ): Promise<OperationCompletionResult> => {
    if (pending) return pending;
    if (disposed || signal?.aborted)
      return Promise.resolve({ state: "aborted", elapsedMs: 0 });
    const owned = new AbortController();
    controller = owned;
    const startedAt = now();
    let timedOut = false;
    const deadline = setTimeout(() => {
      timedOut = true;
      owned.abort();
    }, timeoutMs);
    const onAbort = () => owned.abort();
    signal?.addEventListener("abort", onAbort, { once: true });
    const result = (
      state: OperationCompletionResult["state"],
      activity?: ActivityData,
    ): OperationCompletionResult => ({
      state,
      elapsedMs: Math.max(
        0,
        Math.min(timeoutMs, Math.round(now() - startedAt)),
      ),
      ...(activity ? { activity } : {}),
    });
    const untilAbort = <Value>(task: Promise<Value>): Promise<Value> =>
      new Promise((resolve, reject) => {
        const aborted = () => reject(new Error("Observation ended."));
        if (owned.signal.aborted) {
          task.catch(() => undefined);
          aborted();
          return;
        }
        owned.signal.addEventListener("abort", aborted, { once: true });
        task
          .then(resolve, reject)
          .finally(() => owned.signal.removeEventListener("abort", aborted))
          .catch(() => undefined);
      });
    const pause = (): Promise<void> =>
      new Promise((resolve, reject) => {
        const stop = () => {
          clearTimeout(timer);
          owned.signal.removeEventListener("abort", stop);
          reject(new Error("Observation ended."));
        };
        const timer = setTimeout(() => {
          owned.signal.removeEventListener("abort", stop);
          resolve();
        }, intervalMs);
        owned.signal.addEventListener("abort", stop, { once: true });
        if (owned.signal.aborted) stop();
      });
    pending = (async (): Promise<OperationCompletionResult> => {
      try {
        while (!owned.signal.aborted) {
          if (now() - startedAt >= timeoutMs) {
            timedOut = true;
            owned.abort();
            break;
          }
          let raw: unknown;
          try {
            raw = await untilAbort(
              Promise.resolve().then(() => {
                if (owned.signal.aborted) throw new Error("Observation ended.");
                return readActivity(owned.signal);
              }),
            );
          } catch {
            return result(
              owned.signal.aborted
                ? timedOut
                  ? "timeout"
                  : "aborted"
                : "unavailable",
            );
          }
          let activity: ActivityData;
          try {
            activity = parseActivityData(raw);
          } catch {
            return result("invalid");
          }
          if (
            activity.operation &&
            (activity.operation.kind.length > 200 ||
              /[\x00-\x1f\x7f]/u.test(activity.operation.kind) ||
              activity.operation.startedAt.length > 50 ||
              (activity.operation.rehearsalVersion?.length ?? 0) > 120 ||
              (activity.operation.rehearsalVersion !== null &&
                !/^\d+\.\d+\.\d+(?:-[A-Za-z0-9.-]+)?$/u.test(
                  activity.operation.rehearsalVersion,
                )))
          )
            return result("invalid");
          if (activity.state !== "busy")
            return result(activity.state, activity);
          await pause();
        }
        return result(timedOut ? "timeout" : "aborted");
      } catch {
        return result(
          owned.signal.aborted
            ? timedOut
              ? "timeout"
              : "aborted"
            : "unavailable",
        );
      } finally {
        clearTimeout(deadline);
        signal?.removeEventListener("abort", onAbort);
        if (controller === owned) controller = undefined;
        pending = undefined;
      }
    })();
    return pending;
  };
  return {
    observe,
    dispose: () => {
      disposed = true;
      controller?.abort();
    },
  };
};
