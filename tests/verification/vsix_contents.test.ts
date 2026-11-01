import { describe, expect, it } from "vitest";
import {
  assertArchiveContents,
  createInstallationCommandRunner,
  canRemoveInstallationProfile,
  resolveVerificationVsCodeCli,
} from "../../scripts/verification/verify-private-vsix.js";

const publicArchive = [
  "[Content_Types].xml",
  "extension.vsixmanifest",
  "extension/package.json",
  "extension/dist/src/extension.js",
  "extension/dist/src/workspace_view.js",
  "extension/readme.md",
  "extension/LICENSE.txt",
  "extension/PRIVACY.md",
  "extension/SECURITY.md",
  "extension/SUPPORT.md",
  "extension/changelog.md",
  "extension/media/rehearsal.svg",
  "extension/media/rehearsal-readme.png",
  "extension/media/workspace.css",
];

describe("public VSIX archive boundary", () => {
  it("accepts approved public documents, assets and direct compiled runtime modules", () => {
    expect(() => assertArchiveContents(publicArchive)).not.toThrow();
  });

  it.each([
    "extension/test-results/PRIVATE_CANARY/result.json",
    "extension/coverage/index.html",
    "extension/.env",
    "extension/docs/internal.md",
    "extension/src/extension.ts",
    "extension/tests/example.test.ts",
    "extension/scripts/private.js",
    "extension/dist/src/extension.js.map",
    "extension/dist/src/extension.d.ts",
    "extension/dist/src/nested/extra.js",
    "extension/dist/src/../private.js",
    "extension/media/unreviewed.png",
    "extension/unknown.txt",
    "unknown.txt",
    " extension/package.json",
    "extension/package.json ",
  ])(
    "rejects unexpected archive entry %s without echoing its path",
    (entry) => {
      const check = () => assertArchiveContents([...publicArchive, entry]);
      expect(check).toThrow("outside the public runtime allowlist");
      try {
        check();
      } catch (error) {
        expect(String(error)).not.toContain(entry);
        expect(String(error)).not.toContain("PRIVATE_CANARY");
      }
    },
  );

  it("refuses duplicate entries even when the path is public", () => {
    expect(() =>
      assertArchiveContents([...publicArchive, "extension/package.json"]),
    ).toThrow("duplicate");
  });

  it.each([
    "[Content_Types].xml",
    "extension/SECURITY.md",
    "extension/LICENSE.txt",
    "extension/dist/src/extension.js",
  ])("requires reviewed delivery file %s", (entry) => {
    expect(() =>
      assertArchiveContents(publicArchive.filter((path) => path !== entry)),
    ).toThrow("Packaged extension is missing");
  });
});

describe("private VSIX verifier CLI selection", () => {
  it.each([undefined, "", "1"])(
    "ignores inherited marker/default %s",
    (value) => {
      expect(resolveVerificationVsCodeCli(value)).toBe("code");
    },
  );
  it.each([
    "/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code",
    "/owned/code-wrapper",
    "code-insiders",
  ])("preserves explicit executable override %s", (value) => {
    expect(resolveVerificationVsCodeCli(value)).toBe(value);
  });
});

describe.skipIf(process.platform === "win32")(
  "bounded CLI verifier lifecycle",
  () => {
    it("persists direct ownership before completion and records a real clean exit", async () => {
      const snapshots: unknown[] = [];
      const runner = createInstallationCommandRunner({
        cwd: process.cwd(),
        environment: process.env,
        persist: async (receipts) => {
          snapshots.push(structuredClone(receipts));
        },
      });
      const result = await runner
        .run(process.execPath, ["-e", "process.stdout.write('safe')"])
        .catch(() => {
          throw new Error(JSON.stringify(runner.receipts));
        });
      expect(result.stdout).toBe("safe");
      expect(snapshots[0]).toEqual([
        expect.objectContaining({
          pid: expect.any(Number),
          pgid: expect.any(Number),
          phase: "spawned",
        }),
      ]);
      expect(runner.receipts).toEqual([
        expect.objectContaining({
          phase: "finished",
          exited: true,
          closed: true,
          exitCode: 0,
          signal: null,
          group: "absent",
          reason: "exit",
        }),
      ]);
    });
    it("allows a transient unknown sample to converge to real absence without extending the budget", async () => {
      const actual =
        require("../../scripts/native/native-editor-reads.cjs").processes;
      let calls = 0;
      const runner = createInstallationCommandRunner({
        cwd: process.cwd(),
        environment: process.env,
        persist: async () => {},
        observe: async () => {
          if (++calls === 1) throw Error("Unknown first sample");
          return actual();
        },
      });
      await expect(
        runner.run(process.execPath, ["-e", "setTimeout(()=>{},50)"]),
      ).resolves.toMatchObject({ stdout: "" });
      expect(calls).toBeGreaterThan(1);
      expect(runner.receipts[0]).toMatchObject({
        reason: "exit",
        exited: true,
        closed: true,
        group: "absent",
      });
    });
    it("retains a nonzero exit receipt without exposing child output in its failure", async () => {
      const runner = createInstallationCommandRunner({
        cwd: process.cwd(),
        environment: process.env,
        persist: async () => {},
      });
      await expect(
        runner.run(process.execPath, [
          "-e",
          "console.error('PRIVATE_CANARY');process.exit(7)",
        ]),
      ).rejects.toThrow(/private profile and lifecycle receipt are retained/);
      expect(runner.receipts[0]).toMatchObject({
        exitCode: 7,
        closed: true,
        group: "absent",
      });
      expect(JSON.stringify(runner.receipts)).not.toContain("PRIVATE_CANARY");
    });
    it("bounds a harmless sleeping child without signalling an unrelated process", async () => {
      const runner = createInstallationCommandRunner({
        cwd: process.cwd(),
        environment: process.env,
        timeoutMs: 100,
        persist: async () => {},
      });
      await expect(
        runner.run(process.execPath, ["-e", "setInterval(()=>{},1000)"]),
      ).rejects.toThrow(/retained/);
      expect(runner.receipts[0]).toMatchObject({
        reason: "deadline",
        closed: true,
        group: "absent",
      });
    });
    it("escalates only its still-live direct child when TERM is ignored", async () => {
      const runner = createInstallationCommandRunner({
        cwd: process.cwd(),
        environment: process.env,
        timeoutMs: 1000,
        persist: async () => {},
      });
      await expect(
        runner.run(process.execPath, [
          "-e",
          "process.on('SIGTERM',()=>{});setInterval(()=>{},1000)",
        ]),
      ).rejects.toThrow(/retained/);
      expect(runner.receipts[0]).toMatchObject({
        reason: "deadline",
        signal: "SIGKILL",
        exited: true,
        closed: true,
        group: "absent",
      });
    });
    it("cleans up its spawned child even when the initial receipt write fails", async () => {
      let calls = 0;
      const runner = createInstallationCommandRunner({
        cwd: process.cwd(),
        environment: process.env,
        persist: async () => {
          if (++calls === 1) throw Error("PRIVATE_PERSIST_CANARY");
        },
      });
      await expect(
        runner.run(process.execPath, ["-e", "setInterval(()=>{},1000)"]),
      ).rejects.toThrow(/retained/);
      expect(runner.receipts[0]).toMatchObject({
        reason: "observation-failed",
        exited: true,
        closed: true,
        group: "absent",
      });
      expect(calls).toBe(2);
      expect(JSON.stringify(runner.receipts)).not.toContain(
        "PRIVATE_PERSIST_CANARY",
      );
    });
    it("still reaps its direct child when process observation fails throughout cancellation", async () => {
      const runner = createInstallationCommandRunner({
        cwd: process.cwd(),
        environment: process.env,
        timeoutMs: 1000,
        persist: async () => {},
        observe: async () => {
          throw Error("PRIVATE_OBSERVER_CANARY");
        },
      });
      await expect(
        runner.run(process.execPath, [
          "-e",
          "process.on('SIGTERM',()=>{});setInterval(()=>{},1000)",
        ]),
      ).rejects.toThrow(/retained/);
      expect(runner.receipts[0]).toMatchObject({
        reason: "deadline",
        signal: "SIGKILL",
        exited: true,
        closed: true,
        group: "unknown",
      });
    });
    it("does not let a hung process observer delay exact-child cleanup", async () => {
      let samples = 0;
      const runner = createInstallationCommandRunner({
        cwd: process.cwd(),
        environment: process.env,
        timeoutMs: 100,
        persist: async () => {},
        observe: () => {
          samples++;
          return new Promise(() => {});
        },
      });
      const started = performance.now();
      await expect(
        runner.run(process.execPath, ["-e", "setInterval(()=>{},1000)"]),
      ).rejects.toThrow(/retained/);
      expect(performance.now() - started).toBeLessThan(4000);
      expect(samples).toBe(1);
      expect(runner.receipts[0]).toMatchObject({
        reason: "deadline",
        exited: true,
        closed: true,
        group: "unknown",
      });
    });
    it("bounds persistence waiting without claiming stalled filesystem completion", async () => {
      let writes = 0;
      const runner = createInstallationCommandRunner({
        cwd: process.cwd(),
        environment: process.env,
        timeoutMs: 100,
        persist: () => {
          writes++;
          return new Promise(() => {});
        },
      });
      const started = performance.now();
      await expect(
        runner.run(process.execPath, ["-e", "setInterval(()=>{},1000)"]),
      ).rejects.toThrow(/retained/);
      expect(performance.now() - started).toBeLessThan(4000);
      expect(writes).toBe(1);
      expect(runner.receipts[0]).toMatchObject({ exited: true, closed: true });
      expect(canRemoveInstallationProfile(false, runner.receipts)).toBe(false);
    });
    it("bounds output and preserves an explicit output-limit result", async () => {
      const runner = createInstallationCommandRunner({
        cwd: process.cwd(),
        environment: process.env,
        maximumBytes: 64,
        persist: async () => {},
      });
      await expect(
        runner.run(process.execPath, [
          "-e",
          "process.stdout.write('x'.repeat(1000))",
        ]),
      ).rejects.toThrow(/retained/);
      expect(runner.receipts[0]).toMatchObject({
        reason: "output-limit",
        closed: true,
      });
    });
    it("does not certify closure when process observation remains unknown", async () => {
      const runner = createInstallationCommandRunner({
        cwd: process.cwd(),
        environment: process.env,
        persist: async () => {},
        observe: async () => {
          throw Error("PRIVATE_OBSERVATION");
        },
      });
      await expect(
        runner.run(process.execPath, ["-e", "setTimeout(()=>{},20)"]),
      ).rejects.toThrow(/retained/);
      expect(runner.receipts[0]).toMatchObject({
        reason: "observation-failed",
        group: "unknown",
      });
    });
  },
);

it("keeps Windows direct-child success usable without claiming descendant absence", async () => {
  const runner = createInstallationCommandRunner({
    cwd: process.cwd(),
    environment: process.env,
    platform: "win32",
    persist: async () => {},
    observe: async () => {
      throw Error("Windows must not use POSIX observation");
    },
  });
  await expect(
    runner.run(process.execPath, ["-e", "process.stdout.write('safe')"]),
  ).resolves.toMatchObject({ stdout: "safe" });
  expect(runner.receipts[0]).toMatchObject({
    scope: "windows-direct-child",
    pgid: null,
    reason: "exit",
    exited: true,
    closed: true,
    group: "unknown",
  });
  expect(canRemoveInstallationProfile(true, runner.receipts)).toBe(false);
});
describe("private installation recovery preservation", () => {
  const confirmed = {
    index: 0,
    scope: "observed-posix-group" as const,
    pid: 1,
    pgid: 1,
    phase: "finished" as const,
    exitCode: 0,
    signal: null,
    exited: true,
    closed: true,
    group: "absent" as const,
    reason: "exit" as const,
  };
  it("removes a profile only after uninstall and every successful known closure", () => {
    expect(canRemoveInstallationProfile(true, [confirmed])).toBe(true);
    expect(canRemoveInstallationProfile(false, [confirmed])).toBe(false);
    expect(canRemoveInstallationProfile(true, [])).toBe(false);
    for (const changed of [
      { group: "unknown" as const },
      { group: "present" as const },
      { exited: false },
      { closed: false },
      { exitCode: 7 },
      { reason: "deadline" as const },
    ])
      expect(
        canRemoveInstallationProfile(true, [
          confirmed,
          { ...confirmed, ...changed },
        ]),
      ).toBe(false);
  });
});
