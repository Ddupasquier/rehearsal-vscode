import { afterEach, describe, expect, it, vi } from "vitest";
import {
  PROJECT_REFRESH_PATHS,
  WorkspaceRefreshScheduler,
} from "../src/workspace_refresh.js";

afterEach(() => {
  vi.useRealTimers();
});

describe("project refresh inputs", () => {
  it("watches manifests, package-manager locks, installed core, and configuration", () => {
    expect(PROJECT_REFRESH_PATHS).toEqual(
      expect.arrayContaining([
        "package.json",
        "package-lock.json",
        "pnpm-lock.yaml",
        "yarn.lock",
        "bun.lock",
        "node_modules/@rehearsal-db/core/package.json",
        "rehearsal.config.mjs",
        "infrastructure/rehearsal/rehearsal.config.mjs",
      ]),
    );
  });
});

describe("WorkspaceRefreshScheduler", () => {
  it("coalesces an install's related writes into one trailing refresh", async () => {
    vi.useFakeTimers();
    const refresh = vi
      .fn<(workspaceKey: string) => Promise<void>>()
      .mockResolvedValue(undefined);
    const scheduler = new WorkspaceRefreshScheduler(refresh, 900);

    scheduler.schedule("blendcalc");
    await vi.advanceTimersByTimeAsync(600);
    scheduler.schedule("blendcalc");
    await vi.advanceTimersByTimeAsync(899);
    expect(refresh).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);

    expect(refresh).toHaveBeenCalledOnce();
    expect(refresh).toHaveBeenCalledWith("blendcalc");
    scheduler.dispose();
  });

  it("refreshes independent workspaces independently", async () => {
    vi.useFakeTimers();
    const refreshed: string[] = [];
    const scheduler = new WorkspaceRefreshScheduler((workspaceKey) => {
      refreshed.push(workspaceKey);
    }, 100);

    scheduler.schedule("one");
    scheduler.schedule("two");
    await vi.advanceTimersByTimeAsync(100);

    expect(refreshed).toEqual(["one", "two"]);
    scheduler.dispose();
  });

  it("cancels pending work when a workspace closes or the extension disposes", async () => {
    vi.useFakeTimers();
    const refresh = vi.fn();
    const scheduler = new WorkspaceRefreshScheduler(refresh, 100);

    scheduler.schedule("removed");
    scheduler.cancel("removed");
    scheduler.schedule("shutdown");
    scheduler.dispose();
    await vi.advanceTimersByTimeAsync(100);

    expect(refresh).not.toHaveBeenCalled();
  });
});
