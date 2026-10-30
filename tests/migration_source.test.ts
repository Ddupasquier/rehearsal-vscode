import { afterEach, describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { join, resolve } from "node:path";
import {
  migrationSourceTextSha256,
  migrationSourceDocumentMatches,
  parseMigrationSourceInput,
  readExactMigrationInput,
} from "../src/migration_source.js";
import { parseMigrationFailureSource } from "../src/migration_failure_source.js";
import { parseMigrationReviewPlan } from "../src/migration_review.js";
import { parseMigrationInsights } from "../src/migration_insights.js";
import { insightPlan, insightReport } from "./migration_insights_fixture.js";
const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0))
    await rm(root, { recursive: true, force: true });
});
const filename = "20261009000100_add_index.sql",
  text =
    "-- static input λ\r\nALTER TABLE example ALTER COLUMN title SET NOT NULL;\r\n";
const input = () => ({
  filename,
  sha256: migrationSourceTextSha256(text),
  workspaceRelativePath: `migrations/${filename}`,
});
const temporary = async () => {
  const parent = resolve(__dirname, "../test-results");
  await mkdir(parent, { recursive: true });
  const root = await mkdtemp(join(parent, "static-source-"));
  roots.push(root);
  return root;
};
describe("exact static input without execution provenance", () => {
  it.each([
    ["\ufeffSELECT 1;\r\n", "SELECT 1;\n", true],
    ["a\r\nb\nc\r", "a\r\nb\r\nc\r\n", true],
    ["a\rb\r", "a\nb\n", true],
    ["\ufeffa\r\nb\rc\n", "a\nb\nc\n", true],
    ["\ufeff\ufeffSELECT 1;", "\ufeffSELECT 1;", true],
    ["\ufeff\ufeffSELECT 1;", "SELECT 1;", false],
    ["\ufeffSELECT 1;", "\ufeffSELECT 1;", false],
    ["SELECT 1;", "\ufeffSELECT 1;", false],
    ["a\ufeffb", "ab", false],
    ["\ufeffSELECT 1;\r\n", "SELECT 2;\n", false],
  ] as const)(
    "projects exactly one raw BOM and line endings without hiding content changes",
    (raw, model, matches) => {
      expect(migrationSourceDocumentMatches(raw, model)).toBe(matches);
    },
  );
  it.each(["DropWidgets", "ajouter_étiquette", "约束"])(
    "reads safe inventory name %s without widening failure-v1 attribution",
    async (name) => {
      const root = await temporary(),
        named = `20261009000100_${name}.sql`,
        source = {
          ...input(),
          filename: named,
          workspaceRelativePath: `migrations/${named}`,
        };
      await mkdir(join(root, "migrations"));
      await writeFile(join(root, source.workspaceRelativePath), text);
      const planned = insightPlan(),
        raw = insightReport();
      const plan = parseMigrationReviewPlan({
        ...planned,
        safety: {
          readsSqlBodiesForSafety: false,
          executesSql: false,
          startsEngine: false,
        },
        targets: planned.targets.map((target) => ({
          ...target,
          entries: target.entries.map((entry) => ({
            ...entry,
            name,
            filename: named,
            sha256: source.sha256,
          })),
        })),
      });
      Object.assign(raw.targets[0]!.entries[0]!, source);
      const entry = parseMigrationInsights(raw, plan, raw.inspectorVersion)
        .targets[0]!.entries[0]!;
      expect(
        (
          await readExactMigrationInput(root, {
            filename: entry.filename,
            sha256: entry.sha256,
            workspaceRelativePath: entry.workspaceRelativePath,
          })
        ).text,
      ).toBe(text);
      expect(() =>
        parseMigrationFailureSource({
          schemaVersion: 1,
          kind: "candidate",
          ...source,
          line: null,
          column: null,
          evidence: "owned_execution_input",
        }),
      ).toThrow();
    },
  );
  it.each([
    "bad/name",
    "bad\\name",
    "bad%name",
    "bad:name",
    "bad?name",
    "bad#name",
    "bad\u202ename",
    "bad\nname",
    "字".repeat(90),
  ])("refuses unsafe or over-byte-bound inventory name %s", (name) => {
    const named = `20261009000100_${name}.sql`;
    expect(() =>
      parseMigrationSourceInput({
        ...input(),
        filename: named,
        workspaceRelativePath: `migrations/${named}`,
      }),
    ).toThrow();
  });
  it("reads exact bytes without turning a static input into a failed execution receipt", async () => {
    const root = await temporary();
    await mkdir(join(root, "migrations"));
    await writeFile(join(root, input().workspaceRelativePath), text);
    expect((await readExactMigrationInput(root, input())).text).toBe(text);
    expect(() => parseMigrationFailureSource(input())).toThrow();
    await writeFile(
      join(root, input().workspaceRelativePath),
      text + "-- edited",
    );
    await expect(readExactMigrationInput(root, input())).rejects.toThrow();
    expect(
      await readFile(join(root, input().workspaceRelativePath), "utf8"),
    ).toContain("-- edited");
  });
  it("keeps raw BOM/EOL SHA checks even when different raw bytes have the same native-model projection", async () => {
    const root = await temporary(),
      raw = "\ufeff-- λ\r\nSELECT 1;\r-- end\n",
      model = "-- λ\nSELECT 1;\n-- end\n";
    const source = { ...input(), sha256: migrationSourceTextSha256(raw) };
    await mkdir(join(root, "migrations"));
    await writeFile(join(root, source.workspaceRelativePath), raw);
    const first = await readExactMigrationInput(root, source),
      second = await readExactMigrationInput(root, source);
    expect(first.text).toBe(raw);
    expect(second.identity).toBe(first.identity);
    expect(migrationSourceDocumentMatches(first.text, model)).toBe(true);
    await writeFile(join(root, source.workspaceRelativePath), model);
    expect(migrationSourceDocumentMatches(raw, model)).toBe(true);
    await expect(readExactMigrationInput(root, source)).rejects.toThrow();
  });
  it("refuses leaf and ancestor aliases without modifying their targets", async () => {
    const root = await temporary(),
      outside = await temporary();
    await mkdir(join(root, "migrations"));
    await writeFile(join(outside, filename), text);
    await symlink(
      join(outside, filename),
      join(root, input().workspaceRelativePath),
    );
    await expect(readExactMigrationInput(root, input())).rejects.toThrow();
    await rm(join(root, "migrations"), { recursive: true });
    await symlink(outside, join(root, "migrations"));
    await expect(readExactMigrationInput(root, input())).rejects.toThrow();
    expect(await readFile(join(outside, filename), "utf8")).toBe(text);
  });
  it("rejects extra execution fields, injected paths, invalid bytes and oversized input", async () => {
    expect(() =>
      parseMigrationSourceInput({
        ...input(),
        evidence: "owned_execution_input",
      }),
    ).toThrow();
    expect(() =>
      parseMigrationSourceInput({
        ...input(),
        workspaceRelativePath: `../${filename}`,
      }),
    ).toThrow();
    const root = await temporary();
    await mkdir(join(root, "migrations"));
    const invalidUtf8 = Buffer.from([0xff]);
    await writeFile(join(root, input().workspaceRelativePath), invalidUtf8);
    await expect(
      readExactMigrationInput(root, {
        ...input(),
        sha256: createHash("sha256").update(invalidUtf8).digest("hex"),
      }),
    ).rejects.toThrow();
    await writeFile(
      join(root, input().workspaceRelativePath),
      "x".repeat(2097153),
    );
    await expect(readExactMigrationInput(root, input())).rejects.toThrow();
  });
});

describe("exact native SQL source confinement", () => {
  const nativeInput = () => ({
    ...input(),
    filename: "20261009000100_Add_Index/migration.sql",
    workspaceRelativePath:
      "prisma/migrations/20261009000100_Add_Index/migration.sql",
  });
  it("reads the full native suffix and retains raw hash/model checks", async () => {
    const root = await temporary(),
      source = nativeInput();
    await mkdir(join(root, "prisma/migrations/20261009000100_Add_Index"), {
      recursive: true,
    });
    await writeFile(join(root, source.workspaceRelativePath), text);
    expect((await readExactMigrationInput(root, source)).text).toBe(text);
    expect(
      migrationSourceDocumentMatches(text, text.replaceAll("\r\n", "\n")),
    ).toBe(true);
    await writeFile(
      join(root, source.workspaceRelativePath),
      text + "-- changed",
    );
    await expect(readExactMigrationInput(root, source)).rejects.toThrow();
  });
  it("rejects basename-only matches, traversal and noncanonical native segments", () => {
    for (const patch of [
      {
        workspaceRelativePath:
          "prisma/migrations/20261009000100_Other/migration.sql",
      },
      {
        workspaceRelativePath:
          "prisma/../20261009000100_Add_Index/migration.sql",
      },
      { filename: "20261009000100_é/migration.sql" },
      { filename: "20261009000100_Add_Index/nested/migration.sql" },
      { filename: "20261009000100_Add_Index/other.sql" },
    ])
      expect(() =>
        parseMigrationSourceInput({ ...nativeInput(), ...patch }),
      ).toThrow();
  });
  it("refuses a symlinked native directory and preserves its target", async () => {
    const root = await temporary(),
      outside = await temporary(),
      source = nativeInput();
    await mkdir(join(root, "prisma/migrations"), { recursive: true });
    await writeFile(join(outside, "migration.sql"), text);
    await symlink(
      outside,
      join(root, "prisma/migrations/20261009000100_Add_Index"),
    );
    await expect(readExactMigrationInput(root, source)).rejects.toThrow();
    expect(await readFile(join(outside, "migration.sql"), "utf8")).toBe(text);
  });
});

describe("native insight full identity", () => {
  it("binds native source paths to the complete reviewed plan rather than migration.sql basename", () => {
    const base = insightPlan(),
      binding = {
        schemaVersion: 1,
        kind: "prisma",
        version: "7.10.1",
        provider: "postgresql",
        lockSha256: "a".repeat(64),
        toolchainSha256: "b".repeat(64),
      };
    const native = "20261009000100_add_index/migration.sql";
    const plan = parseMigrationReviewPlan({
      ...base,
      safety: {
        readsSqlBodiesForSafety: false,
        executesSql: false,
        startsEngine: false,
      },
      targets: base.targets.map((target) => ({
        ...target,
        migrationTool: binding,
        entries: target.entries.map((entry) => ({
          ...entry,
          filename: native,
        })),
      })),
    });
    const raw = insightReport();
    Object.assign(raw.targets[0]!.entries[0]!, {
      filename: native,
      workspaceRelativePath: `prisma/migrations/${native}`,
    });
    expect(
      parseMigrationInsights(raw, plan, raw.inspectorVersion).targets[0]!
        .entries[0]!.filename,
    ).toBe(native);
    raw.targets[0]!.entries[0]!.workspaceRelativePath =
      "prisma/migrations/20261009000100_other/migration.sql";
    expect(() =>
      parseMigrationInsights(raw, plan, raw.inspectorVersion),
    ).toThrow();
  });
});
