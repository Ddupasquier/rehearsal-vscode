import { afterEach, describe, expect, it, vi } from "vitest";
import {
  comparePublishedVersions,
  fetchUpdateMetadata,
  isPublishedVersion,
  isEligibleCoreUpdate,
  parseCoreUpdate,
  parseExtensionUpdate,
  UpdateAdvisoryController,
  UPDATE_METADATA_URLS,
  UPDATE_RELEASES_URL,
  updateAdvisoryStorageKey,
  type AdvisoryState,
  type UpdateAdvisoryHost,
} from "../../src/updates/update_advisory.js";

const integrity = `sha512-${"a".repeat(86)}==`;
function metadataResponse(
  body: string,
  options: ResponseInit = {},
  url = UPDATE_METADATA_URLS.core,
): Response {
  const response = new Response(body, {
    headers: { "content-type": "application/json" },
    ...options,
  });
  Object.defineProperty(response, "url", { value: url, configurable: true });
  return response;
}
const core = (version = "0.1.0-rc.8") => ({
  name: "@rehearsal-db/core",
  version,
  dist: {
    tarball: `https://registry.npmjs.org/@rehearsal-db/core/-/core-${version}.tgz`,
    integrity,
  },
});
const release = (version = "0.1.8", preview = true) => ({
  draft: false,
  prerelease: preview,
  tag_name: `v${version}`,
  html_url: `${UPDATE_RELEASES_URL}/tag/v${version}`,
  assets: [{ name: `rehearsal-db-${version}.vsix` }, { name: "SHA256SUMS" }],
});
const state = (changes: Partial<AdvisoryState> = {}): AdvisoryState => ({
  offered: true,
  enabled: true,
  checkedAt: 0,
  deferredUntil: 0,
  skippedCore: null,
  skippedExtension: null,
  ...changes,
});
function fixture(initial: unknown = state()) {
  let saved = initial,
    allowed = true,
    now = 1_800_000_000_000;
  const identity = {
    version: "0.1.0-rc.7",
    origin: "registry" as const,
    fingerprint: "a".repeat(64),
    dependencyGroup: "devDependencies" as const,
  };
  const host: UpdateAdvisoryHost = {
    extensionRelease: vi.fn(),
    checking: async (action) => action(),
    allowed: vi.fn(() => allowed),
    identify: vi.fn(async () => identity),
    load: vi.fn(() => saved),
    save: vi.fn(async (_key, next) => {
      saved = next;
    }),
    consent: vi.fn(async () => "enable" as const),
    notify: vi.fn(async () => "later" as const),
    information: vi.fn(),
    updateCore: vi.fn(async () => {}),
    openRelease: vi.fn(async () => {}),
    openCoreRelease: vi.fn(async () => {}),
  };
  const request = vi.fn(
    async (
      kind: keyof typeof UPDATE_METADATA_URLS,
      _signal: AbortSignal,
    ): Promise<unknown> => (kind === "extension" ? [release()] : core()),
  );
  const create = () =>
    new UpdateAdvisoryController(host, "0.1.7", true, request, () => now);
  return {
    host,
    request,
    identity,
    create,
    saved: () => saved as AdvisoryState,
    trust: (value: boolean) => {
      allowed = value;
    },
    advance: (milliseconds: number) => {
      now += milliseconds;
    },
  };
}
afterEach(() => vi.useRealTimers());

describe("bounded public update metadata", () => {
  it.each([
    ["1.3.0", "2.0.0", false],
    ["1.3.0", "2.0.0-beta.1", false],
    ["2.0.0", "2.0.1", true],
    ["2.0.0", "3.0.0", false],
  ] as const)(
    "keeps automatic update boundaries for %s → %s",
    (installed, available, eligible) => {
      expect(isEligibleCoreUpdate(installed, available)).toBe(eligible);
    },
  );

  it.each([
    ["0.1.0-rc.10", "0.1.0-rc.2", 1],
    ["0.1.0", "0.1.0-rc.9", 1],
    ["0.1.7", "0.1.7", 0],
    ["1.0.0", "2.0.0", -1],
    ["1.0.0-alpha-test.2", "1.0.0-alpha-test.10", -1],
  ])(
    "compares %s and %s without confusing compatibility and freshness",
    (left, right, expected) => {
      expect(comparePublishedVersions(String(left), String(right))).toBe(
        expected,
      );
    },
  );
  it.each([
    "file:local",
    "workspace:*",
    "0.1.7+candidate",
    "01.1.0",
    "1.0.0-rc.01",
    "1.0.0;echo secret",
    "1.0.0\n",
    "99999999999999999.0.0",
  ])("does not treat %s as a published install selector", (value) => {
    expect(isPublishedVersion(value)).toBe(false);
    expect(comparePublishedVersions(value, "1.0.0")).toBeNull();
  });
  it("requires the exact public package/tarball identity and checksum shape", () => {
    expect(parseCoreUpdate(core())).toBe("0.1.0-rc.8");
    for (const value of [
      { ...core(), name: "other" },
      {
        ...core(),
        dist: { ...core().dist, tarball: "https://private.example/secret" },
      },
      { ...core(), version: "0.1.8+candidate" },
      { ...core(), dist: {} },
    ])
      expect(() => parseCoreUpdate(value)).toThrow();
  });
  it("separates preview/stable releases and requires fixed release plus VSIX/checksum assets", () => {
    expect(
      parseExtensionUpdate([release("0.1.8"), release("0.1.6", false)], true),
    ).toBe("0.1.8");
    expect(
      parseExtensionUpdate([release("0.1.8"), release("0.1.6", false)], false),
    ).toBe("0.1.6");
    expect(
      parseExtensionUpdate(
        [{ ...release(), assets: [{ name: "rehearsal-db-0.1.8.vsix" }] }],
        true,
      ),
    ).toBeNull();
    expect(() =>
      parseExtensionUpdate(
        [{ ...release(), html_url: "https://private.example/token" }],
        true,
      ),
    ).toThrow();
    expect(() =>
      parseExtensionUpdate(Array(6).fill(release()), true),
    ).toThrow();
  });
  it("selects only the canonical asset family from mixed legacy and current releases", () => {
    const legacy = {
      ...release("0.1.18"),
      assets: [{ name: "rehearsal-0.1.18.vsix" }, { name: "SHA256SUMS" }],
    };
    expect(parseExtensionUpdate([legacy], true)).toBeNull();
    expect(parseExtensionUpdate([legacy, release("0.1.19")], true)).toBe(
      "0.1.19",
    );
    expect(
      parseExtensionUpdate(
        [
          {
            ...release("0.1.99"),
            assets: [{ name: "rehearsal-0.1.99.vsix" }, { name: "SHA256SUMS" }],
          },
          release("0.1.19"),
        ],
        true,
      ),
    ).toBe("0.1.19");
  });
  it("fetches fixed endpoints without credentials, redirects, installed versions or project data", async () => {
    const request = vi.fn(async () => metadataResponse(JSON.stringify(core())));
    expect(
      await fetchUpdateMetadata(
        "core",
        new AbortController().signal,
        request as typeof fetch,
      ),
    ).toEqual(core());
    expect(request).toHaveBeenCalledWith(
      UPDATE_METADATA_URLS.core,
      expect.objectContaining({
        credentials: "omit",
        redirect: "error",
        cache: "no-store",
        referrerPolicy: "no-referrer",
        headers: { Accept: "application/json" },
      }),
    );
    expect(JSON.stringify(request.mock.calls)).not.toMatch(
      /Authorization|Bearer|workspace|password|installedVersion/u,
    );
    const oversized = vi.fn(async () =>
      metadataResponse("a".repeat(128 * 1024 + 1)),
    );
    await expect(
      fetchUpdateMetadata(
        "core",
        new AbortController().signal,
        oversized as typeof fetch,
      ),
    ).rejects.toThrow();
  });
  it.each(["mime", "status", "redirect", "url", "empty-url"])(
    "rejects %s transport metadata before parsing",
    async (mode) => {
      const response = metadataResponse(
        JSON.stringify(core()),
        mode === "status" ? { status: 201 } : {},
      );
      if (mode === "mime") response.headers.set("content-type", "text/html");
      if (mode === "redirect")
        Object.defineProperty(response, "redirected", { value: true });
      if (mode === "url" || mode === "empty-url")
        Object.defineProperty(response, "url", {
          value: mode === "url" ? "https://private.invalid/" : "",
          configurable: true,
        });
      await expect(
        fetchUpdateMetadata(
          "core",
          new AbortController().signal,
          vi.fn(async () => response) as typeof fetch,
        ),
      ).rejects.toThrow();
    },
  );
});

describe("opt-in opening-session update controller", () => {
  it("publishes confirmed extension evidence before notification choices, even when skipped", async () => {
    const f = fixture();
    f.host.notify = vi.fn(async () => {
      expect(f.host.extensionRelease).toHaveBeenLastCalledWith("a", {
        status: "checked",
        latestVersion: "0.1.8",
        checkedAt: 1_800_000_000_000,
        channel: "preview",
      });
      return "skip" as const;
    });
    await f.create().check("a");
    expect(f.host.extensionRelease).toHaveBeenNthCalledWith(
      1,
      "a",
      expect.objectContaining({ status: "checking" }),
    );
    expect(f.request).toHaveBeenCalledTimes(3);
    expect(f.saved().skippedExtension).toBe("0.1.8");
  });
  it("keeps failed extension metadata unknown without hiding an independent core update", async () => {
    const f = fixture();
    f.request.mockImplementation(async (kind) =>
      kind === "extension" ? [] : core(),
    );
    await f.create().check("a");
    expect(f.host.extensionRelease).toHaveBeenLastCalledWith("a", {
      status: "unknown",
      latestVersion: null,
      checkedAt: null,
      channel: "preview",
    });
    expect(f.host.notify).toHaveBeenCalledWith(
      "a",
      { core: "0.1.0-rc.8", extension: null },
      true,
      expect.anything(),
    );
  });
  it("clears checking without publishing latest after consent changes during the request", async () => {
    const f = fixture();
    f.request.mockImplementation(async (kind) => {
      await f.host.save("a", state({ enabled: false }));
      return kind === "extension" ? [release()] : core();
    });
    await f.create().check("a");
    expect(f.host.extensionRelease).toHaveBeenLastCalledWith(
      "a",
      expect.objectContaining({ status: "unknown" }),
    );
    expect(
      vi
        .mocked(f.host.extensionRelease!)
        .mock.calls.some(([, evidence]) => evidence.status === "checked"),
    ).toBe(false);
    expect(f.host.notify).not.toHaveBeenCalled();
  });
  it("does not publish latest after the project fingerprint changes", async () => {
    const f = fixture();
    vi.mocked(f.host.identify)
      .mockResolvedValueOnce(f.identity)
      .mockResolvedValue({ ...f.identity, fingerprint: "changed" });
    await f.create().check("a");
    expect(f.host.extensionRelease).toHaveBeenLastCalledWith(
      "a",
      expect.objectContaining({ status: "unknown" }),
    );
    expect(
      vi
        .mocked(f.host.extensionRelease!)
        .mock.calls.some(([, evidence]) => evidence.status === "checked"),
    ).toBe(false);
  });
  it("aborts owned requests when native progress rejects after starting its action", async () => {
    vi.useFakeTimers();
    const f = fixture();
    const signals: AbortSignal[] = [];
    let requestsFinished = 0;
    let actionResult: Promise<unknown> | undefined;
    f.request.mockImplementation(async (_kind, signal) => {
      signals.push(signal);
      return new Promise((_resolve, reject) =>
        signal.addEventListener(
          "abort",
          () => {
            requestsFinished++;
            reject(new Error("Private request failure"));
          },
          { once: true },
        ),
      );
    });
    f.host.checking = async (action) => {
      actionResult = action();
      throw new Error("Private progress failure");
    };
    await f.create().check("a");
    expect(signals).toHaveLength(3);
    expect(signals.every((signal) => signal.aborted)).toBe(true);
    await actionResult;
    expect(requestsFinished).toBe(3);
    expect(vi.getTimerCount()).toBe(0);
    expect(f.host.notify).not.toHaveBeenCalled();
    expect(f.host.updateCore).not.toHaveBeenCalled();
    expect(f.host.information).toHaveBeenCalledWith(
      expect.stringContaining("unknown"),
    );
    expect(
      JSON.stringify(vi.mocked(f.host.information).mock.calls),
    ).not.toContain("Private");
  });
  it("expires a progress task delayed past its deadline without a request or unhandled rejection", async () => {
    vi.useFakeTimers();
    const f = fixture();
    f.host.checking = async (action) => {
      await new Promise((resolve) => setTimeout(resolve, 6_000));
      return action();
    };
    const pending = f.create().check("a");
    await vi.advanceTimersByTimeAsync(6_001);
    await pending;
    expect(f.request).not.toHaveBeenCalled();
    expect(f.host.notify).not.toHaveBeenCalled();
    expect(f.host.information).toHaveBeenCalledWith(
      expect.stringContaining("unknown"),
    );
    expect(vi.getTimerCount()).toBe(0);
  });
  it.each(["remove", "dispose"] as const)(
    "cancels %s before a delayed progress callback without a rejection or stale notification",
    async (mode) => {
      vi.useFakeTimers();
      const f = fixture();
      f.host.checking = async (action) => {
        await new Promise((resolve) => setTimeout(resolve, 6_000));
        return action();
      };
      const controller = f.create(),
        pending = controller.check("a");
      await vi.advanceTimersByTimeAsync(1);
      if (mode === "remove") controller.remove("a");
      else controller.dispose();
      await vi.advanceTimersByTimeAsync(6_001);
      await pending;
      expect(f.request).not.toHaveBeenCalled();
      expect(f.host.notify).not.toHaveBeenCalled();
      expect(f.host.information).not.toHaveBeenCalled();
      expect(vi.getTimerCount()).toBe(0);
    },
  );
  it.each(["corePreview", "extension"] as const)(
    "retains confirmed core metadata when %s alone times out",
    async (stalled) => {
      vi.useFakeTimers();
      const f = fixture();
      f.request.mockImplementation(async (kind) =>
        kind === stalled
          ? new Promise(() => {})
          : kind === "extension"
            ? [release("0.1.7")]
            : core("0.1.0"),
      );
      const pending = f.create().check("a");
      await vi.advanceTimersByTimeAsync(5_001);
      await pending;
      expect(f.host.notify).toHaveBeenCalledWith(
        "a",
        { core: "0.1.0", extension: null },
        true,
        { core: "0.1.0-rc.7", extension: "0.1.7", channel: "preview" },
      );
      expect(f.request).toHaveBeenCalledTimes(3);
      expect(f.host.updateCore).not.toHaveBeenCalled();
      expect(vi.getTimerCount()).toBe(0);
    },
  );
  it("retains a confirmed extension release when core metadata times out", async () => {
    vi.useFakeTimers();
    const f = fixture();
    f.request.mockImplementation(async (kind) =>
      kind === "extension" ? [release()] : new Promise(() => {}),
    );
    const pending = f.create().check("a");
    await vi.advanceTimersByTimeAsync(5_001);
    await pending;
    expect(f.host.notify).toHaveBeenCalledWith(
      "a",
      { core: null, extension: "0.1.8" },
      false,
      { core: "0.1.0-rc.7", extension: "0.1.7", channel: "preview" },
    );
    expect(f.host.updateCore).not.toHaveBeenCalled();
  });
  it.each(["offline", "malformed"])(
    "keeps an invalid %s channel unknown while other channels are current",
    async (mode) => {
      const f = fixture();
      f.request.mockImplementation(async (kind) => {
        if (kind === "corePreview") {
          if (mode === "offline")
            throw new Error("Private synthetic request failure");
          return { version: "0.1.0-rc.9" };
        }
        return kind === "extension" ? [release("0.1.7")] : core("0.1.0-rc.7");
      });
      await f.create().check("a");
      expect(f.host.notify).not.toHaveBeenCalled();
      expect(f.host.information).toHaveBeenCalledWith(
        expect.stringContaining("remains unknown"),
      );
      expect(
        JSON.stringify(vi.mocked(f.host.information).mock.calls),
      ).not.toContain("Private synthetic");
    },
  );
  it.each(["corePreview", "extension"] as const)(
    "does not claim all releases are current when %s is unknown",
    async (stalled) => {
      vi.useFakeTimers();
      const f = fixture();
      f.request.mockImplementation(async (kind) =>
        kind === stalled
          ? new Promise(() => {})
          : kind === "extension"
            ? [release("0.1.7")]
            : core("0.1.0-rc.7"),
      );
      const pending = f.create().check("a");
      await vi.advanceTimersByTimeAsync(5_001);
      await pending;
      expect(f.host.notify).not.toHaveBeenCalled();
      expect(f.host.information).toHaveBeenCalledWith(
        expect.stringContaining("remains unknown"),
      );
      expect(f.host.information).not.toHaveBeenCalledWith(
        expect.stringContaining("No newer eligible"),
      );
    },
  );
  it.each(["remove", "dispose", "state", "identity"] as const)(
    "never publishes a valid partial result after %s changes",
    async (mode) => {
      vi.useFakeTimers();
      const f = fixture();
      f.request.mockImplementation(async (kind) =>
        kind === "corePreview"
          ? new Promise(() => {})
          : kind === "extension"
            ? [release("0.1.7")]
            : core("0.1.0"),
      );
      const controller = f.create(),
        pending = controller.check("a");
      await vi.advanceTimersByTimeAsync(1);
      if (mode === "remove") controller.remove("a");
      else if (mode === "dispose") controller.dispose();
      else if (mode === "state")
        await f.host.save("a", state({ enabled: false }));
      else
        vi.mocked(f.host.identify).mockResolvedValue({
          ...f.identity,
          fingerprint: "changed",
        });
      await vi.advanceTimersByTimeAsync(5_001);
      await pending;
      expect(f.host.notify).not.toHaveBeenCalled();
      expect(f.host.updateCore).not.toHaveBeenCalled();
      expect(f.host.openRelease).not.toHaveBeenCalled();
      expect(vi.getTimerCount()).toBe(0);
    },
  );
  it("does not publish a late response after the deadline or repeat its request", async () => {
    vi.useFakeTimers();
    const f = fixture();
    let complete: (value: unknown) => void = () => {};
    f.request.mockImplementation(async (kind) =>
      kind === "corePreview"
        ? new Promise((resolve) => {
            complete = resolve;
          })
        : kind === "extension"
          ? [release("0.1.7")]
          : core("0.1.0-rc.7"),
    );
    const pending = f.create().check("a");
    await vi.advanceTimersByTimeAsync(5_001);
    await pending;
    complete(core("0.1.0-rc.9"));
    await Promise.resolve();
    expect(f.host.notify).not.toHaveBeenCalled();
    expect(f.request).toHaveBeenCalledTimes(3);
    expect(f.host.information).toHaveBeenCalledWith(
      expect.stringContaining("unknown"),
    );
  });
  it("refuses a response fulfilled by the deadline abort before its result snapshot is taken", async () => {
    vi.useFakeTimers();
    const f = fixture();
    f.request.mockImplementation(async (kind, signal) =>
      kind === "corePreview"
        ? new Promise((resolve) =>
            signal.addEventListener(
              "abort",
              () => resolve(core("0.1.0-rc.9")),
              { once: true },
            ),
          )
        : kind === "extension"
          ? [release("0.1.7")]
          : core("0.1.0-rc.7"),
    );
    const pending = f.create().check("a");
    await vi.advanceTimersByTimeAsync(5_001);
    await pending;
    expect(f.host.notify).not.toHaveBeenCalled();
    expect(f.host.information).toHaveBeenCalledWith(
      expect.stringContaining("unknown"),
    );
  });
  it.each(["trust", "disable"])(
    "refuses requests when %s changes before the native progress callback starts",
    async (mode) => {
      const f = fixture();
      f.host.checking = async (action) => {
        await Promise.resolve();
        if (mode === "trust") f.trust(false);
        else await f.host.save("a", state({ enabled: false }));
        return action();
      };
      await f.create().check("a");
      expect(f.request).not.toHaveBeenCalled();
      expect(f.host.notify).not.toHaveBeenCalled();
      expect(f.host.updateCore).not.toHaveBeenCalled();
      if (mode === "disable") expect(f.saved().enabled).toBe(false);
    },
  );
  it("offers consent once and makes no request when declined, including another session", async () => {
    const f = fixture(undefined);
    vi.mocked(f.host.load).mockImplementation(() => undefined);
    vi.mocked(f.host.consent).mockResolvedValue("disable");
    const controller = f.create();
    await controller.open("private-workspace");
    await controller.open("private-workspace");
    expect(f.request).not.toHaveBeenCalled();
    expect(f.host.consent).toHaveBeenCalledOnce();
    vi.mocked(f.host.load).mockImplementation(() => f.saved());
    await f.create().open("private-workspace");
    expect(f.host.consent).toHaveBeenCalledOnce();
    expect(updateAdvisoryStorageKey("private-workspace")).not.toContain(
      "private-workspace",
    );
  });
  it("automatically checks after opt-in once per opening and coalesces simultaneous explicit requests", async () => {
    const f = fixture(state({ offered: false, enabled: false }));
    const c = f.create();
    const first = c.open("a");
    await Promise.all([first, c.check("a")]);
    await c.open("a");
    expect(f.host.consent).toHaveBeenCalledOnce();
    expect(f.request).toHaveBeenCalledTimes(3);
    expect(f.host.notify).toHaveBeenCalledOnce();
    expect(f.host.updateCore).not.toHaveBeenCalled();
  });
  it("checks at most daily on opening, never schedules an idle check, and permits explicit override", async () => {
    vi.useFakeTimers();
    const f = fixture();
    await f.create().open("a");
    const requests = f.request.mock.calls.length;
    f.advance(60_000);
    await f.create().open("a");
    expect(f.request).toHaveBeenCalledTimes(requests);
    expect(vi.getTimerCount()).toBe(0);
    await f.create().check("a");
    expect(f.request.mock.calls.length).toBe(requests + 3);
  });
  it.each(["skip", "disable", "later"] as const)(
    "persists %s without installing or repeatedly prompting",
    async (choice) => {
      const f = fixture();
      vi.mocked(f.host.notify).mockResolvedValue(choice);
      await f.create().open("a");
      if (choice === "skip") {
        expect(f.saved().skippedCore).toBe("0.1.0-rc.8");
        f.advance(25 * 60 * 60 * 1000);
      }
      await f.create().open("a");
      expect(f.host.notify).toHaveBeenCalledOnce();
      expect(f.host.updateCore).not.toHaveBeenCalled();
      if (choice === "disable") expect(f.saved().enabled).toBe(false);
    },
  );
  it("rechecks identity after metadata and again after the update choice", async () => {
    const f = fixture();
    vi.mocked(f.host.identify)
      .mockResolvedValueOnce(f.identity)
      .mockResolvedValue({ ...f.identity, fingerprint: "b".repeat(64) });
    await f.create().check("a");
    expect(f.host.notify).not.toHaveBeenCalled();
    expect(f.host.updateCore).not.toHaveBeenCalled();
    const g = fixture();
    vi.mocked(g.host.notify).mockResolvedValue("core");
    vi.mocked(g.host.identify)
      .mockResolvedValueOnce(g.identity)
      .mockResolvedValueOnce(g.identity)
      .mockResolvedValue({ ...g.identity, fingerprint: "changed" });
    await g.create().check("a");
    expect(g.host.updateCore).not.toHaveBeenCalled();
  });
  it("passes only a newer exact checked core version to the reviewed action owner", async () => {
    const f = fixture();
    vi.mocked(f.host.notify).mockResolvedValue("core");
    await f.create().check("a");
    expect(f.host.updateCore).toHaveBeenCalledWith(
      "a",
      f.identity,
      "0.1.0-rc.8",
      expect.any(Function),
    );
  });
  it.each(["1.0.0", "0.2.0"])(
    "offers %s only as manual compatibility review, not an install",
    async (version) => {
      const f = fixture();
      f.request.mockImplementation(async (kind) =>
        kind === "extension" ? [release("0.1.7")] : core(version),
      );
      vi.mocked(f.host.notify).mockResolvedValue("core");
      await f.create().check("a");
      expect(f.host.notify).toHaveBeenCalledWith(
        "a",
        { core: version, extension: null },
        false,
        { core: "0.1.0-rc.7", extension: "0.1.7", channel: "preview" },
      );
      expect(f.host.updateCore).not.toHaveBeenCalled();
      expect(f.host.openCoreRelease).toHaveBeenCalledWith(version);
    },
  );
  it.each(["metadata", "notification", "identity"])(
    "honors a saved disable during %s without reenabling or acting",
    async (phase) => {
      const f = fixture();
      const disable = async () => {
        await f.host.save("a", state({ enabled: false, checkedAt: 123 }));
      };
      if (phase === "metadata")
        f.request.mockImplementation(async (kind) => {
          await disable();
          return kind === "extension" ? [release()] : core();
        });
      if (phase === "notification")
        vi.mocked(f.host.notify).mockImplementation(async () => {
          await disable();
          return "core";
        });
      if (phase === "identity")
        vi.mocked(f.host.identify).mockImplementationOnce(async () => {
          await disable();
          return f.identity;
        });
      await f.create().check("a");
      expect(f.saved().enabled).toBe(false);
      expect(f.saved().checkedAt).toBe(123);
      expect(f.host.updateCore).not.toHaveBeenCalled();
      expect(f.host.openRelease).not.toHaveBeenCalled();
      if (phase !== "notification")
        expect(f.host.notify).not.toHaveBeenCalled();
    },
  );
  it("cancels a removed workspace immediately even when a requester ignores its signal", async () => {
    vi.useFakeTimers();
    const f = fixture();
    f.request.mockImplementation(async () => new Promise(() => {}));
    const controller = f.create(),
      pending = controller.check("a");
    await vi.advanceTimersByTimeAsync(1);
    controller.remove("a");
    await pending;
    expect(f.host.notify).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });
  it.each(["custom", "unknown"] as const)(
    "never offers overwriting %s core provenance",
    async (origin) => {
      const f = fixture();
      vi.mocked(f.host.identify).mockResolvedValue({ ...f.identity, origin });
      f.request.mockImplementation(async (kind) =>
        kind === "extension" ? [release("0.1.7")] : core(),
      );
      await f.create().check("a");
      expect(f.request).toHaveBeenCalledTimes(1);
      expect(f.host.notify).not.toHaveBeenCalled();
      expect(f.host.updateCore).not.toHaveBeenCalled();
    },
  );
  it("does not offer a prerelease to stable core or equal/ahead versions", async () => {
    const f = fixture();
    vi.mocked(f.host.identify).mockResolvedValue({
      ...f.identity,
      version: "0.1.0",
    });
    f.request.mockImplementation(async (kind) =>
      kind === "extension" ? [release("0.1.6")] : core("0.1.1-rc.1"),
    );
    await f.create().check("a");
    expect(f.host.notify).not.toHaveBeenCalled();
    expect(f.request).toHaveBeenCalledTimes(2);
  });
  it("opens a reviewed extension release without installing it", async () => {
    const f = fixture();
    vi.mocked(f.host.notify).mockResolvedValue("extension");
    await f.create().check("a");
    expect(f.host.openRelease).toHaveBeenCalledWith("0.1.8");
    expect(f.host.updateCore).not.toHaveBeenCalled();
  });
  it("refuses untrusted and trust-revoked consent without networking", async () => {
    const f = fixture();
    f.trust(false);
    await f.create().open("a");
    expect(f.request).not.toHaveBeenCalled();
    const g = fixture(state({ enabled: false, offered: false }));
    vi.mocked(g.host.consent).mockImplementation(async () => {
      g.trust(false);
      return "enable";
    });
    await g.create().open("a");
    expect(g.request).not.toHaveBeenCalled();
  });
  it("bounds a stalled request, aborts it, stays nonblocking and leaves no timer", async () => {
    vi.useFakeTimers();
    const f = fixture();
    let signal: AbortSignal | undefined;
    f.request.mockImplementation(async (_kind, supplied) => {
      signal = supplied;
      return new Promise(() => {});
    });
    const pending = f.create().check("a");
    await vi.advanceTimersByTimeAsync(5_001);
    await pending;
    expect(signal?.aborted).toBe(true);
    expect(f.host.information).toHaveBeenCalledWith(
      expect.stringContaining("unknown"),
    );
    expect(vi.getTimerCount()).toBe(0);
  });
  it("honors one-time configuration without asking twice or enabling automatic checks", async () => {
    const f = fixture(state({ enabled: false }));
    vi.mocked(f.host.consent).mockResolvedValue("once");
    await f.create().configure("a");
    expect(f.host.consent).toHaveBeenCalledOnce();
    expect(f.saved().enabled).toBe(false);
    expect(f.request).toHaveBeenCalledTimes(3);
  });
});
