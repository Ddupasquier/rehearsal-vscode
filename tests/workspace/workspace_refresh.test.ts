import { afterEach, describe, expect, it, vi } from "vitest";
import {
  PROJECT_REFRESH_PATHS,
  projectRefreshPatterns,
  WorkspaceRefreshScheduler,
} from "../../src/workspace/workspace_refresh.js";

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

  it("adds one normalized explicit configuration without duplicating known files", () => {
    expect(
      projectRefreshPatterns(" ./infrastructure/../rehearsal.host.config.mjs "),
    ).toEqual([...PROJECT_REFRESH_PATHS, "rehearsal.host.config.mjs"]);
    expect(projectRefreshPatterns("./rehearsal.config.mjs")).toEqual(
      PROJECT_REFRESH_PATHS,
    );
    expect(
      projectRefreshPatterns(
        "infrastructure//rehearsal/./rehearsal.config.mjs",
      ),
    ).toEqual(PROJECT_REFRESH_PATHS);
  });

  it("escapes glob syntax instead of watching other filenames or directories", () => {
    expect(
      projectRefreshPatterns("configs/[team]/{local,qa}*?.config.mjs"),
    ).toEqual([
      ...PROJECT_REFRESH_PATHS,
      "configs/[[]team[]]/[{]local,qa[}][*][?].config.mjs",
    ]);
  });

  it.each([
    undefined,
    null,
    12,
    {},
    "",
    "   ",
    ".",
    "folder/..",
    "../another-project/rehearsal.config.mjs",
    "folder/../../another-project/rehearsal.config.mjs",
    "/another-project/rehearsal.config.mjs",
    "C:/another-project/rehearsal.config.mjs",
    "C:rehearsal.config.mjs",
    "file:///another-project/rehearsal.config.mjs",
    "\\\\server\\share\\rehearsal.config.mjs",
    "folder\\rehearsal.config.mjs",
    "folder/rehearsal.config.mjs/",
    "rehearsal\u0000.config.mjs",
    "rehearsal\n.config.mjs",
    "rehearsal\u007f.config.mjs",
    "a".repeat(501),
  ])("keeps only known files for an unsafe explicit path: %j", (path) => {
    expect(projectRefreshPatterns(path)).toEqual(PROJECT_REFRESH_PATHS);
  });

  it("accepts a bounded path at the 500-character limit", () => {
    const path = `${"folder/".repeat(68)}rehearsal.config.mjs`;
    expect(path.length).toBeLessThan(500);
    const bounded = `${"x".repeat(500 - path.length)}${path}`;
    expect(bounded.length).toBe(500);
    expect(projectRefreshPatterns(bounded)).toContain(bounded);
    expect(projectRefreshPatterns(`x${bounded}`)).toEqual(
      PROJECT_REFRESH_PATHS,
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
