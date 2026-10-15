/** Activity-only observation during one explicitly editor-started action. No daemon. */
import { parseActivityData, type ActivityData } from "./contracts.js";

export type ActiveOperationMonitorState =
  | "idle"
  | "stale"
  | "invalid"
  | "unavailable"
  | "timeout"
  | "not_observed"
  | "operation_changed"
  | "aborted";
export interface ActiveOperationMonitorResult {
  readonly state: ActiveOperationMonitorState;
  readonly observedBusy: boolean;
  readonly elapsedMs: number;
}

export const createActiveOperationMonitor = ({
  intervalMs = 2000,
  maximumMs = 300_000,
  startupGraceMs = 30_000,
  now = () => Date.now(),
}: {
  readonly intervalMs?: number;
  readonly maximumMs?: number;
  readonly startupGraceMs?: number;
  readonly now?: () => number;
} = {}) => {
  if (
    !Number.isSafeInteger(intervalMs) ||
    intervalMs < 1 ||
    intervalMs > 5000 ||
    !Number.isSafeInteger(maximumMs) ||
    maximumMs < 1 ||
    maximumMs > 300_000 ||
    !Number.isSafeInteger(startupGraceMs) ||
    startupGraceMs < 1 ||
    startupGraceMs > 30_000
  )
    throw new Error(
      "Active operation monitoring requires bounded intervals and lifetimes.",
    );
  let disposed = false;
  let controller: AbortController | undefined;
  let pending: Promise<ActiveOperationMonitorResult> | undefined;
  const observe = ({
    readActivity,
    publish,
    allowed,
  }: {
    readonly readActivity: (signal: AbortSignal) => Promise<unknown>;
    readonly publish: (activity: ActivityData) => void;
    readonly allowed: () => boolean;
  }): Promise<ActiveOperationMonitorResult> => {
    if (pending) return pending;
    if (disposed || !allowed())
      return Promise.resolve({
        state: "aborted",
        observedBusy: false,
        elapsedMs: 0,
      });
    const owned = new AbortController();
    controller = owned;
    const started = now();
    let observedBusy = false;
    let identity: string | null = null;
    let progressId: string | null = null;
    let stoppedReason: "aborted" | "timeout" | "not_observed" = "aborted";
    const limit = setInterval(
      () => {
        if (!allowed()) {
          stoppedReason = "aborted";
          owned.abort();
        }
      },
      Math.min(intervalMs, 1000),
    );
    const deadline = setTimeout(() => {
      stoppedReason = "timeout";
      owned.abort();
    }, maximumMs);
    const startupDeadline = setTimeout(() => {
      if (!observedBusy) {
        stoppedReason = "not_observed";
        owned.abort();
      }
    }, startupGraceMs);
    const result = (
      state: ActiveOperationMonitorState,
    ): ActiveOperationMonitorResult => ({
      state,
      observedBusy,
      elapsedMs: Math.max(0, Math.min(maximumMs, Math.round(now() - started))),
    });
    const untilAbort = <Value>(task: Promise<Value>): Promise<Value> =>
      new Promise((resolve, reject) => {
        const abort = () =>
          reject(new Error("Owned activity observation ended."));
        if (owned.signal.aborted) {
          task.catch(() => undefined);
          abort();
          return;
        }
        owned.signal.addEventListener("abort", abort, { once: true });
        task
          .then(resolve, reject)
          .finally(() => owned.signal.removeEventListener("abort", abort))
          .catch(() => undefined);
      });
    const pause = (): Promise<void> =>
      new Promise((resolve, reject) => {
        const abort = () => {
          clearTimeout(timer);
          owned.signal.removeEventListener("abort", abort);
          reject(new Error("Owned activity observation ended."));
        };
        const timer = setTimeout(() => {
          owned.signal.removeEventListener("abort", abort);
          resolve();
        }, intervalMs);
        owned.signal.addEventListener("abort", abort, { once: true });
        if (owned.signal.aborted) abort();
      });
    pending = (async () => {
      try {
        while (!owned.signal.aborted && allowed()) {
          let raw: unknown;
          try {
            raw = await untilAbort(
              Promise.resolve().then(() => {
                if (owned.signal.aborted || !allowed())
                  throw new Error("Owned activity observation ended.");
                return readActivity(owned.signal);
              }),
            );
          } catch {
            return result(
              owned.signal.aborted || !allowed()
                ? stoppedReason
                : "unavailable",
            );
          }
          if (owned.signal.aborted || !allowed()) return result(stoppedReason);
          let activity: ActivityData;
          try {
            activity = parseActivityData(raw);
          } catch {
            return result("invalid");
          }
          if (activity.state === "busy") {
            const currentIdentity = `${activity.operation!.kind}\0${activity.operation!.startedAt}`;
            const currentProgressId =
              activity.operation?.progress?.operationId ?? null;
            if (
              (identity !== null && identity !== currentIdentity) ||
              (progressId !== null &&
                currentProgressId !== null &&
                progressId !== currentProgressId)
            )
              return result("operation_changed");
            identity = currentIdentity;
            progressId ??= currentProgressId;
            observedBusy = true;
            publish(activity);
          } else if (activity.state === "idle") {
            if (observedBusy) return result("idle");
          } else {
            publish(activity);
            return result(activity.state);
          }
          await pause();
        }
        return result(stoppedReason);
      } catch {
        return result(
          owned.signal.aborted || !allowed() ? stoppedReason : "unavailable",
        );
      } finally {
        clearInterval(limit);
        clearTimeout(deadline);
        clearTimeout(startupDeadline);
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
