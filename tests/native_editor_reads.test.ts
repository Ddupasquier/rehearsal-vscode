import { afterEach, describe, expect, it } from "vitest";
import { spawn } from "node:child_process";
import {
  mkdir,
  mkdtemp,
  rm,
  writeFile,
  access,
  symlink,
  readFile,
} from "node:fs/promises";
import { resolve, join } from "node:path";

interface Identity {
  pid: number;
  ppid: number;
  pgid: number;
  state?: string;
  started: string;
  executable: string;
}
interface Cleanup {
  observedRemainingBeforeFallback: Identity[];
  remaining: Identity[];
  fallbackUsed: boolean;
  observationFailed: boolean;
  closeObservationFailed: boolean;
  failedReads: number;
}
interface Client {
  publicJson(command: string[]): Promise<unknown>;
  cleanup(): Promise<Cleanup>;
}
const helper = require("../scripts/native-editor-reads.cjs") as {
  readRegular(
    file: string,
    maximumBytes?: number,
  ): Promise<{
    bytes: Buffer;
    stat: { size: number; mode: number; isFile(): boolean };
  }>;
  processArguments(platform: string): string[];
  parseProcessRows(stdout: string): Map<number, Identity>;
  processes(): Promise<Map<number, Identity>>;
  same(left: Identity, right: Identity | undefined): boolean;
  createReadClient(options: Record<string, unknown>): Client;
};
const clients: Client[] = [],
  directories: string[] = [];
describe("shared native scenario file boundary", () => {
  it("reads only bounded regular bytes and preserves its observed metadata", async () => {
    const base = resolve(__dirname, "../test-results");
    await mkdir(base, { recursive: true });
    const root = await mkdtemp(join(base, "native-file-unit."));
    directories.push(root);
    const file = join(root, "report.json");
    await writeFile(file, "café", { mode: 0o600 });
    const result = await helper.readRegular(file, 5);
    expect(result.bytes.toString("utf8")).toBe("café");
    expect(result.stat.size).toBe(5);
    expect(result.stat.isFile()).toBe(true);
    await expect(helper.readRegular(file, 4)).rejects.toThrow();
    await expect(helper.readRegular(root)).rejects.toThrow();
    for (const limit of [0, -1, NaN, Infinity, 8 * 1024 * 1024 + 1])
      await expect(helper.readRegular(file, limit)).rejects.toThrow();
    await expect(helper.readRegular("relative.json")).rejects.toThrow();
  });
  it.skipIf(process.platform === "win32")(
    "refuses a symlink instead of reading or modifying its target",
    async () => {
      const base = resolve(__dirname, "../test-results");
      await mkdir(base, { recursive: true });
      const root = await mkdtemp(join(base, "native-file-unit."));
      directories.push(root);
      const file = join(root, "source.json"),
        link = join(root, "report.json");
      await writeFile(file, "preserved synthetic source", { mode: 0o600 });
      await symlink(file, link);
      await expect(helper.readRegular(link)).rejects.toThrow();
      expect(await readFile(file, "utf8")).toBe("preserved synthetic source");
      const directoryLink = join(root, "redirect");
      await symlink(root, directoryLink, "dir");
      await expect(
        helper.readRegular(join(directoryLink, "source.json")),
      ).rejects.toThrow();
      expect(await readFile(file, "utf8")).toBe("preserved synthetic source");
    },
  );
});
describe("native process-state parsing", () => {
  it("reads executable paths instead of mutable Linux thread names", () => {
    expect(helper.processArguments("linux")).toEqual([
      "-axo",
      "pid=,ppid=,pgid=,stat=,lstart=,exe=",
    ]);
    expect(helper.processArguments("darwin")).toEqual([
      "-axo",
      "pid=,ppid=,pgid=,stat=,lstart=,comm=",
    ]);
    expect(() => helper.processArguments("win32")).toThrow(
      "requires macOS or Linux",
    );
  });
  it("preserves real STAT zombie evidence independently of the executable spelling", () => {
    const rows = helper.parseProcessRows(
      [
        " 41 1 40 Z Tue Oct 20 22:47:35 2026 (node)",
        " 42 1 40 Z+ Tue Oct 20 22:47:35 2026 node <defunct>",
        " 43 1 40 S+ Tue Oct 20 22:47:35 2026 (node)",
        " 44 1 40 Ss Tue Oct 20 22:47:35 2026 /usr/local/bin/node",
      ].join("\n"),
    );
    expect([...rows.values()]).toEqual([
      expect.objectContaining({ pid: 41, state: "Z", executable: "(node)" }),
      expect.objectContaining({
        pid: 42,
        state: "Z+",
        executable: "node <defunct>",
      }),
      expect.objectContaining({ pid: 43, state: "S+", executable: "(node)" }),
      expect.objectContaining({ pid: 44, state: "Ss", executable: "node" }),
    ]);
    expect(rows.get(41)?.started).toBe("Tue Oct 20 22:47:35 2026");
  });
  it("does not treat the volatile STAT field as process identity", () => {
    const row: Identity = {
      pid: 41,
      ppid: 1,
      pgid: 40,
      started: "Tue Oct 20 22:47:35 2026",
      executable: "node",
    };
    expect(helper.same(row, { ...row, state: "S+" })).toBe(true);
    expect(helper.same({ ...row, state: "S+" }, { ...row, state: "R+" })).toBe(
      true,
    );
  });
});
const fixtureProgram = `
import { spawn } from 'node:child_process';
import { writeFile } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';
await writeFile(process.env.NATIVE_READ_MARKER, 'executed');
const mode = process.env.NATIVE_READ_CASE;
const envelope = { schemaVersion:1, rehearsalVersion:'1.0.2', command:process.argv[2], status:'success', data:{ok:true,label:'café'} };
if (mode === 'stdout') { process.stdout.write('PRIVATE_CANARY'.repeat(1000)); setTimeout(()=>{}, 5000); }
else if (mode === 'stderr') { process.stderr.write('PRIVATE_CANARY'.repeat(1000)); setTimeout(()=>{}, 5000); }
else if (mode === 'invalid') process.stdout.write('PRIVATE_CANARY invalid JSON');
else if (mode === 'exit') { process.stderr.write('PRIVATE_CANARY'); process.exitCode=2; }
else if (mode === 'hang') setTimeout(()=>{}, 5000);
else if (mode === 'orphan') {
  spawn(process.execPath,['-e','setTimeout(()=>{}, 3000)'],{stdio:'ignore'}).unref();
  await delay(600);
  process.stdout.write(JSON.stringify(envelope));
} else if (mode === 'unicode') {
  const bytes=Buffer.from(JSON.stringify(envelope)),index=bytes.indexOf(0xc3);
  process.stdout.write(bytes.subarray(0,index+1)); await delay(20); process.stdout.write(bytes.subarray(index+1));
} else process.stdout.write(JSON.stringify(envelope));
`;
async function fixture(
  mode = "success",
  overrides: Record<string, unknown> = {},
) {
  const base = resolve(__dirname, "../test-results");
  await mkdir(base, { recursive: true });
  const root = await mkdtemp(join(base, "native-reads-unit."));
  directories.push(root);
  const bin = join(root, "owned-cli.mjs"),
    marker = join(root, "executed.txt"),
    readChildren = new Map<number, Identity>();
  await writeFile(bin, fixtureProgram, { mode: 0o600 });
  const options = {
    config: {
      coreBin: bin,
      fixture: {
        projectRoot: root,
        configRelativePath: "rehearsal.config.mjs",
      },
    },
    environment: {
      PATH: process.env.PATH ?? "",
      NATIVE_READ_CASE: mode,
      NATIVE_READ_MARKER: marker,
    },
    parseEnvelope: (value: { command: string }, expected: string) => {
      expect(value.command).toBe(expected);
      return value;
    },
    readChildren,
    timeoutMs: 5000,
    maximumBytes: 256,
    ...overrides,
  };
  const client = helper.createReadClient(options);
  clients.push(client);
  return { client, readChildren, marker, options };
}
afterEach(async () => {
  for (const client of clients.splice(0)) {
    const result = await client.cleanup();
    expect(result.remaining).toHaveLength(0);
    expect(result.closeObservationFailed).toBe(false);
  }
  for (const directory of directories.splice(0))
    await rm(directory, { recursive: true, force: true });
});
describe.skipIf(process.platform === "win32")(
  "native read-only child boundary",
  () => {
    it.each(["success", "unicode"])(
      "accepts actual closed %s children without cleanup fallback",
      async (mode) => {
        const { client } = await fixture(mode);
        await expect(client.publicJson(["activity"])).resolves.toEqual({
          ok: true,
          label: "café",
        });
        expect(await client.cleanup()).toMatchObject({
          fallbackUsed: false,
          observationFailed: false,
          closeObservationFailed: false,
          failedReads: 0,
          remaining: [],
        });
      },
    );
    it.each(["stdout", "stderr", "invalid", "exit"])(
      "refuses %s failure without retaining raw output",
      async (mode) => {
        const { client } = await fixture(mode);
        await expect(client.publicJson(["activity"])).rejects.toThrow(
          "raw output withheld",
        );
        const result = await client.cleanup();
        expect(result.failedReads).toBe(1);
        expect(result.remaining).toHaveLength(0);
        expect(JSON.stringify(result)).not.toContain("PRIVATE_CANARY");
      },
    );
    it("times out a real owned child and requires its actual close", async () => {
      const { client } = await fixture("hang", { timeoutMs: 200 });
      await expect(client.publicJson(["activity"])).rejects.toThrow(
        "raw output withheld",
      );
      expect(await client.cleanup()).toMatchObject({
        fallbackUsed: true,
        observationFailed: false,
        closeObservationFailed: false,
        failedReads: 1,
        remaining: [],
      });
    });
    it("reaps a captured descendant after its CLI parent closed and does not call that clean acceptance", async () => {
      const { client } = await fixture("orphan");
      await client.publicJson(["activity"]);
      const result = await client.cleanup();
      expect(result.observedRemainingBeforeFallback.length).toBeGreaterThan(0);
      expect(result).toMatchObject({
        fallbackUsed: true,
        observationFailed: false,
        closeObservationFailed: false,
        remaining: [],
      });
    });
    it("does not signal a PID whose captured start identity differs", async () => {
      const sentinel = spawn(
        process.execPath,
        ["-e", "setTimeout(()=>{},5000)"],
        { stdio: "ignore" },
      );
      const closed = new Promise<void>((done) =>
        sentinel.once("close", () => done()),
      );
      sentinel.on("error", () => {});
      try {
        expect(sentinel.pid).toBeDefined();
        const row = (await helper.processes()).get(sentinel.pid!);
        expect(row).toBeDefined();
        const { client, readChildren } = await fixture();
        readChildren.set(row!.pid, {
          ...row!,
          started: "Thu Jan 1 00:00:00 1970",
        });
        expect(await client.cleanup()).toMatchObject({
          fallbackUsed: false,
          observationFailed: false,
          remaining: [],
        });
        expect(
          helper.same(row!, (await helper.processes()).get(row!.pid)),
        ).toBe(true);
      } finally {
        sentinel.kill("SIGTERM");
        await closed;
      }
    });
    it("refuses mutation commands before a child is launched", async () => {
      const { client, marker } = await fixture();
      await expect(client.publicJson(["run"])).rejects.toThrow(
        "not allowlisted",
      );
      await expect(access(marker)).rejects.toThrow();
    });
    it("allows test limits to tighten but never loosen production bounds", async () => {
      const { options } = await fixture();
      expect(() =>
        helper.createReadClient({ ...options, timeoutMs: 30001 }),
      ).toThrow();
      expect(() =>
        helper.createReadClient({ ...options, maximumBytes: 512 * 1024 + 1 }),
      ).toThrow();
    });
  },
);
