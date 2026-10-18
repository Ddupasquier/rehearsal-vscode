import { beforeEach, describe, expect, it, vi } from "vitest";
import { updateAdvisoryStorageKey } from "../src/update_advisory.js";
const mocks = vi.hoisted(() => ({
  trusted: true,
  scheme: "file",
  message: vi.fn(),
  external: vi.fn(),
  identity: vi.fn(),
  progress: vi.fn(),
}));
vi.mock("vscode", () => ({
  workspace: {
    get isTrusted() {
      return mocks.trusted;
    },
    get workspaceFolders() {
      return [
        {
          uri: {
            get scheme() {
              return mocks.scheme;
            },
            fsPath: "/private/never-send",
            toString: () => "file:///private/never-send",
          },
        },
      ];
    },
  },
  window: {
    showInformationMessage: mocks.message,
    withProgress: mocks.progress,
  },
  ProgressLocation: { Notification: 15 },
  env: { openExternal: mocks.external },
  Uri: { parse: (value: string) => value },
}));
vi.mock("../src/update_identity.js", () => ({
  readUpdateProjectIdentity: mocks.identity,
}));
import { createUpdateAdvisory } from "../src/update_advisory_host.js";
const key = "file:///private/never-send";
function fixture() {
  const onExtensionRelease = vi.fn();
  const stored = new Map<string, unknown>();
  const update = vi.fn(
    async (
      _key: string,
      _installed: string,
      _version: string,
      _guard: () => Promise<boolean>,
      _group: import("../src/update_advisory.js").DependencyGroup,
    ) => {},
  );
  const request = vi.fn(async (kind: string) =>
    kind === "extension"
      ? [
          {
            tag_name: "v0.1.8",
            draft: false,
            prerelease: true,
            html_url:
              "https://github.com/Ddupasquier/rehearsal-vscode/releases/tag/v0.1.8",
            assets: [{ name: "rehearsal-0.1.8.vsix" }, { name: "SHA256SUMS" }],
          },
        ]
      : {
          name: "@rehearsal-db/core",
          version: "0.1.0-rc.8",
          dist: {
            tarball:
              "https://registry.npmjs.org/@rehearsal-db/core/-/core-0.1.0-rc.8.tgz",
            integrity: `sha512-${"a".repeat(86)}==`,
          },
        },
  );
  const controller = createUpdateAdvisory({
    projects: { snapshotFor: () => ({ version: "0.1.0-rc.7" }) } as never,
    actions: { updatePackageVersion: update },
    state: {
      get: (name: string) => stored.get(name),
      update: async (name: string, value: unknown) => {
        stored.set(name, value);
      },
    } as never,
    version: "0.1.7",
    preview: true,
    onExtensionRelease,
    request,
  });
  return { controller, request, update, stored, onExtensionRelease };
}
beforeEach(() => {
  vi.clearAllMocks();
  mocks.trusted = true;
  mocks.scheme = "file";
  mocks.progress.mockImplementation(async (_options, action) => action());
  mocks.identity.mockResolvedValue({
    version: "0.1.0-rc.7",
    origin: "registry",
    fingerprint: "safe",
    dependencyGroup: "devDependencies",
  });
  mocks.message.mockImplementation(async (message: string) =>
    message.includes("Allow optional")
      ? "Enable Daily Checks"
      : "Review Core Update",
  );
});
describe("native update consent and review host", () => {
  it("forwards only confirmed extension release evidence through the native host", async () => {
    const f = fixture();
    mocks.message.mockImplementation(async (message: string) =>
      message.includes("Allow optional") ? "Check Once" : "Later",
    );
    await f.controller.check(key);
    expect(f.onExtensionRelease).toHaveBeenNthCalledWith(1, key, {
      status: "checking",
      latestVersion: null,
      checkedAt: null,
      channel: "preview",
    });
    expect(f.onExtensionRelease).toHaveBeenLastCalledWith(key, {
      status: "checked",
      latestVersion: "0.1.8",
      checkedAt: expect.any(Number),
      channel: "preview",
    });
    expect(f.onExtensionRelease).toHaveBeenCalledTimes(2);
    expect(f.request).toHaveBeenCalledTimes(3);
    expect(f.update).not.toHaveBeenCalled();
    f.controller.dispose();
  });
  it.each(["current", "offline", "declined"])(
    "closes native metadata progress for %s without installing",
    async (mode) => {
      const f = fixture();
      let active = 0;
      mocks.progress.mockImplementation(async (_options, action) => {
        active++;
        try {
          return await action();
        } finally {
          active--;
        }
      });
      if (mode === "declined")
        mocks.message.mockResolvedValue("Don't Ask Again");
      else
        f.request.mockImplementation(async (kind) => {
          expect(active).toBe(1);
          if (mode === "offline") throw new Error("Synthetic offline");
          return kind === "extension"
            ? []
            : {
                name: "@rehearsal-db/core",
                version: "0.1.0-rc.7",
                dist: {
                  tarball:
                    "https://registry.npmjs.org/@rehearsal-db/core/-/core-0.1.0-rc.7.tgz",
                  integrity: `sha512-${"a".repeat(86)}==`,
                },
              };
        });
      await f.controller.open(key);
      expect(active).toBe(0);
      expect(mocks.progress).toHaveBeenCalledTimes(mode === "declined" ? 0 : 1);
      if (mode === "declined") {
        expect(f.request).not.toHaveBeenCalled();
        expect(f.onExtensionRelease).not.toHaveBeenCalled();
      } else
        expect(mocks.progress).toHaveBeenCalledWith(
          {
            location: 15,
            title: "Checking public Rehearsal release metadata…",
            cancellable: false,
          },
          expect.any(Function),
        );
      expect(f.update).not.toHaveBeenCalled();
      f.controller.dispose();
    },
  );
  it("names the network disclosure, stores hashed workspace flags, and delegates only a checked exact version", async () => {
    const f = fixture();
    await f.controller.open(key);
    const consent = mocks.message.mock.calls[0];
    expect(consent?.[1]).toMatchObject({
      modal: true,
      detail: expect.stringContaining("registry.npmjs.org and api.github.com"),
    });
    expect(consent?.[1].detail).toContain("IP address");
    expect(JSON.stringify(consent)).not.toContain("never-send");
    expect([...f.stored.keys()]).toEqual([updateAdvisoryStorageKey(key)]);
    expect(f.update).toHaveBeenCalledWith(
      key,
      "0.1.0-rc.7",
      "0.1.0-rc.8",
      expect.any(Function),
      "devDependencies",
    );
    const authorize = f.update.mock
      .calls[0]?.[3] as unknown as () => Promise<boolean>;
    expect(await authorize()).toBe(true);
    const before = f.stored.get(updateAdvisoryStorageKey(key)) as Record<
      string,
      unknown
    >;
    f.stored.set(updateAdvisoryStorageKey(key), { ...before, enabled: false });
    expect(await authorize()).toBe(false);
    f.stored.set(updateAdvisoryStorageKey(key), before);
    mocks.identity.mockResolvedValue({
      version: "0.1.0-rc.8",
      origin: "registry",
      fingerprint: "changed",
    });
    expect(await authorize()).toBe(false);
    expect(mocks.external).not.toHaveBeenCalled();
    f.controller.dispose();
  });
  it("shows installed to available identities and sends a new compatibility series only to manual release review", async () => {
    const f = fixture();
    f.request.mockImplementation(async (kind) =>
      kind === "extension"
        ? []
        : {
            name: "@rehearsal-db/core",
            version: "1.0.0",
            dist: {
              tarball:
                "https://registry.npmjs.org/@rehearsal-db/core/-/core-1.0.0.tgz",
              integrity: `sha512-${"a".repeat(86)}==`,
            },
          },
    );
    mocks.message.mockImplementation(async (message: string) =>
      message.includes("Allow optional")
        ? "Enable Daily Checks"
        : "Review Core Release",
    );
    await f.controller.open(key);
    expect(mocks.message).toHaveBeenCalledWith(
      expect.stringContaining("core 0.1.0-rc.7 → 1.0.0"),
      "Review Core Release",
      "Later",
      "Skip These Versions",
      "Disable Checks",
    );
    expect(mocks.external).toHaveBeenCalledWith(
      "https://www.npmjs.com/package/@rehearsal-db/core/v/1.0.0",
    );
    expect(f.update).not.toHaveBeenCalled();
    f.controller.dispose();
  });
  it.each(["untrusted", "remote"])(
    "refuses %s before a consent dialog or request",
    async (mode) => {
      const f = fixture();
      if (mode === "untrusted") mocks.trusted = false;
      else mocks.scheme = "vscode-remote";
      await f.controller.check(key);
      expect(mocks.message).not.toHaveBeenCalled();
      expect(f.request).not.toHaveBeenCalled();
      expect(f.onExtensionRelease).not.toHaveBeenCalled();
      f.controller.dispose();
    },
  );
  it("opens only the fixed reviewed release and never installs an extension", async () => {
    const f = fixture();
    mocks.message.mockImplementation(async (message: string) =>
      message.includes("Allow optional")
        ? "Check Once"
        : "Review Extension Release",
    );
    await f.controller.check(key);
    expect(mocks.external).toHaveBeenCalledWith(
      "https://github.com/Ddupasquier/rehearsal-vscode/releases/tag/v0.1.8",
    );
    expect(f.update).not.toHaveBeenCalled();
    f.controller.dispose();
  });
  it("labels stable core promotion independently from the preview extension channel", async () => {
    const f = fixture();
    f.request.mockImplementation(async (kind) =>
      kind === "extension"
        ? []
        : {
            name: "@rehearsal-db/core",
            version: "0.1.0",
            dist: {
              tarball:
                "https://registry.npmjs.org/@rehearsal-db/core/-/core-0.1.0.tgz",
              integrity: `sha512-${"a".repeat(86)}==`,
            },
          },
    );
    mocks.message.mockImplementation(async (message: string) =>
      message.includes("Allow optional") ? "Enable Daily Checks" : "Later",
    );
    await f.controller.open(key);
    expect(mocks.message).toHaveBeenCalledWith(
      expect.stringContaining("core 0.1.0-rc.7 → 0.1.0 (stable release)"),
      "Review Core Update",
      "Later",
      "Skip These Versions",
      "Disable Checks",
    );
    f.controller.dispose();
  });
  it("can disable automatic checks explicitly without contacting a registry", async () => {
    const f = fixture();
    mocks.message.mockResolvedValue("Disable Automatic Checks");
    await f.controller.configure(key);
    expect(f.request).not.toHaveBeenCalled();
    expect(f.stored.get(updateAdvisoryStorageKey(key))).toMatchObject({
      offered: true,
      enabled: false,
    });
    f.controller.dispose();
  });
});
