import { describe, it, expect } from "vitest";
import { runInNewContext } from "node:vm";
import { mkdtemp, mkdir, writeFile, symlink, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  captureRealConsumerFiles,
  parseRealConsumerAcceptanceArguments,
} from "../scripts/verify-native-real-consumer.js";
import {
  nativeControlProbe,
  assertNativeEditorNamespace,
  parseNativeEditorAcceptanceArguments,
  assertInstalledPrismaEditorManifest,
} from "../scripts/verify-native-prisma-editor.js";
const args = () => [
  "--vsix=/approved/input/editor.vsix",
  `--vsix-sha=${"a".repeat(64)}`,
  "--core-tar=/approved/input/core.tgz",
  `--core-sha=${"b".repeat(64)}`,
  "--workspace=/approved/consumer",
  "--code=/approved/code/bin/code",
  "--electron=/approved/code/code",
  `--electron-sha=${"c".repeat(64)}`,
  "--code-version=1.143.0",
  "--evidence=/approved/evidence",
];
describe("closed real-consumer native protocol", () => {
  it("retains the explicit Drizzle selector only in the existing migration-review scenario", () => {
    expect(
      parseNativeEditorAcceptanceArguments([
        ...args(),
        "--migration-kind=drizzle",
      ]).get("migration-kind"),
    ).toBe("drizzle");
    expect(
      parseNativeEditorAcceptanceArguments(args()).has("migration-kind"),
    ).toBe(false);
    for (const values of [
      [...args(), "--migration-kind=knex"],
      [...args(), "--migration-kind=drizzle", "--migration-kind=prisma"],
    ])
      expect(() => parseNativeEditorAcceptanceArguments(values)).toThrow();
    expect(() =>
      parseRealConsumerAcceptanceArguments([
        ...args(),
        "--migration-kind=drizzle",
      ]),
    ).toThrow();
  });

  it("reuses the exact default Prisma argument protocol without arbitrary scenario/script inputs", () => {
    expect([...parseRealConsumerAcceptanceArguments(args())]).toEqual([
      ...parseNativeEditorAcceptanceArguments(args()),
    ]);
    expect(() =>
      parseNativeEditorAcceptanceArguments(
        args(),
        "arbitrary" as "prisma-review",
      ),
    ).toThrow();
  });
  it.each(
    [
      [],
      [...args(), "--scenario=other"],
      [...args(), "--companion=/elsewhere/script.cjs"],
      [...args(), args()[0]!],
      args().filter((a) => !a.startsWith("--core-sha=")),
      args().map((a) =>
        a.startsWith("--vsix-sha=") ? "--vsix-sha=unknown" : a,
      ),
      args().map((a) =>
        a.startsWith("--workspace=") ? "--workspace=relative" : a,
      ),
    ].map((values) => ({ values })),
  )("refuses missing/unknown/duplicate/unsafe arguments %#", ({ values }) =>
    expect(() => parseRealConsumerAcceptanceArguments(values)).toThrow(),
  );
  it("confines evidence and workspace to separate owned namespaces", () => {
    expect(() =>
      assertNativeEditorNamespace(
        "/approved",
        "/approved/consumer",
        "/approved/evidence",
      ),
    ).not.toThrow();
    for (const [workspace, evidence] of [
      ["/elsewhere/consumer", "/approved/evidence"],
      ["/approved", "/approved/evidence"],
      ["/approved/consumer", "/approved/consumer/evidence"],
      ["/approved/consumer", "/approved"],
      ["/approved/notes/consumer", "/approved/evidence"],
      ["/approved/consumer", "/approved/x/../evidence"],
    ])
      expect(() =>
        assertNativeEditorNamespace("/approved", workspace!, evidence!),
      ).toThrow();
  });
  it("permits only installer __metadata while preserving every product manifest field", () => {
    const manifest = {
        name: "rehearsal-db",
        publisher: "rehearsal-db",
        version: "0.1.26",
        main: "./dist/src/extension.js",
      },
      bytes = (value: unknown) => Buffer.from(JSON.stringify(value));
    expect(() =>
      assertInstalledPrismaEditorManifest(
        bytes(manifest),
        bytes({ ...manifest, __metadata: { installedTimestamp: 1 } }),
      ),
    ).not.toThrow();
    for (const patch of [
      { version: "0.1.25" },
      { main: "elsewhere.js" },
      { unreviewed: true },
    ])
      expect(() =>
        assertInstalledPrismaEditorManifest(
          bytes(manifest),
          bytes({ ...manifest, ...patch, __metadata: {} }),
        ),
      ).toThrow();
  });
});
describe("real-consumer selected-input preservation", () => {
  const fixture = async (
    run: (root: string, workspace: string) => Promise<void>,
  ) => {
    const root = await mkdtemp(join(tmpdir(), "consumer-native-input-")),
      workspace = join(root, "consumer");
    try {
      await mkdir(workspace);
      await writeFile(
        join(workspace, "package.json"),
        JSON.stringify({ private: true }),
      );
      await writeFile(
        join(workspace, "rehearsal.config.mjs"),
        "export default {};\n",
      );
      await run(root, workspace);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  };
  it("fully hashes selected files including synthetic credentials without retaining contents or paths", async () =>
    fixture(async (root, workspace) => {
      await writeFile(
        join(workspace, ".env.rehearsal-auth.local"),
        "SYNTHETIC_SECRET=never-report\n",
      );
      const before = await captureRealConsumerFiles(workspace, root);
      expect(await captureRealConsumerFiles(workspace, root)).toEqual(before);
      expect(Object.keys(before).sort()).toEqual([
        "bytes",
        "files",
        "schemaVersion",
        "sha256",
      ]);
      expect(JSON.stringify(before)).not.toContain("SYNTHETIC");
      expect(JSON.stringify(before)).not.toContain(workspace);
      await writeFile(
        join(workspace, ".env.rehearsal-auth.local"),
        "SYNTHETIC_SECRET=changed\n",
      );
      expect(await captureRealConsumerFiles(workspace, root)).not.toEqual(
        before,
      );
    }));
  it("binds config and baseline raw files and identity across observations", async () =>
    fixture(async (root, workspace) => {
      const base = join(workspace, ".rehearsal-native");
      await mkdir(base);
      await writeFile(join(base, "baseline.ndjson"), "{}\n");
      const before = await captureRealConsumerFiles(workspace, root);
      await writeFile(join(base, "baseline.ndjson"), "{}\n{}\n");
      expect(await captureRealConsumerFiles(workspace, root)).not.toEqual(
        before,
      );
    }));
  it("excludes personal-note namespaces from selected input capture", async () =>
    fixture(async (root, workspace) => {
      await mkdir(join(workspace, "notes"));
      await writeFile(
        join(workspace, "notes/private.txt"),
        "SYNTHETIC_PRIVATE_NOTE",
      );
      const before = await captureRealConsumerFiles(workspace, root);
      await writeFile(
        join(workspace, "notes/private.txt"),
        "SYNTHETIC_CHANGED_NOTE",
      );
      expect(await captureRealConsumerFiles(workspace, root)).toEqual(before);
    }));
  it("accepts exact baseline pointer links confined inside the owned workspace", async () =>
    fixture(async (root, workspace) => {
      const base = join(workspace, ".rehearsal-native");
      await mkdir(base);
      await mkdir(join(base, "generation"));
      await writeFile(join(base, "generation/manifest.json"), "{}");
      await symlink("generation", join(base, "current"));
      expect((await captureRealConsumerFiles(workspace, root)).files).toBe(4);
    }));
  it("refuses external input links even elsewhere under approved storage", async () =>
    fixture(async (root, workspace) => {
      const external = join(root, "outside.env");
      await writeFile(external, "SYNTHETIC_OTHER_OWNER");
      await symlink(external, join(workspace, ".env.rehearsal-auth.local"));
      await expect(captureRealConsumerFiles(workspace, root)).rejects.toThrow();
    }));
});

describe("native disclosure control discovery", () => {
  it("discovers a collapsed DETAILS finding before keyboard opening while preserving the default visible-only probe", () => {
    const node = {
      parentElement: { tagName: "DETAILS", open: false, parentElement: null },
      getBoundingClientRect: () => ({ width: 0, height: 0 }),
      closest: () => null,
    };
    const document = {
      title: "Example · Rehearsal",
      readyState: "complete",
      querySelector: () => node,
    };
    expect(
      runInNewContext(nativeControlProbe("button", "Example"), { document }),
    ).toBe(false);
    expect(
      runInNewContext(nativeControlProbe("button", "Example", true), {
        document,
      }),
    ).toBe(true);
    node.parentElement.open = true;
    expect(
      runInNewContext(nativeControlProbe("button", "Example", true), {
        document,
      }),
    ).toBe(false);
    node.getBoundingClientRect = () => ({ width: 80, height: 24 });
    expect(
      runInNewContext(nativeControlProbe("button", "Example"), { document }),
    ).toBe(true);
  });
  it("refuses hidden pages, missing controls, wrong workspaces and incomplete documents", () => {
    const node = {
      parentElement: { tagName: "DETAILS", open: false, parentElement: null },
      getBoundingClientRect: () => ({ width: 0, height: 0 }),
      closest: (): unknown => ({ hidden: true }),
    };
    const document = {
      title: "Example · Rehearsal",
      readyState: "complete",
      querySelector: (): unknown => node,
    };
    const check = () =>
      runInNewContext(nativeControlProbe("button", "Example", true), {
        document,
      });
    expect(check()).toBe(false);
    node.closest = () => null;
    expect(check()).toBe(true);
    document.querySelector = () => null;
    expect(check()).toBe(false);
    document.querySelector = () => node;
    document.title = "Other · Rehearsal";
    expect(check()).toBe(false);
    document.title = "Example · Rehearsal";
    document.readyState = "loading";
    expect(check()).toBe(false);
  });
});
