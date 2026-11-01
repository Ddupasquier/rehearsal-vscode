import { afterEach, describe, expect, it } from "vitest";
import {
  mkdtemp,
  mkdir,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { join, resolve } from "node:path";
import {
  migrationSourceTextSha256,
  parseMigrationFailureSource,
  readExactMigrationSource,
} from "../../src/migrations/migration_failure_source.js";

const roots: string[] = [];
const temporary = async (prefix: string) => {
  const parent = resolve(__dirname, "../../test-results");
  await mkdir(parent, { recursive: true });
  return mkdtemp(join(parent, prefix));
};
afterEach(async () => {
  for (const root of roots.splice(0))
    await rm(root, { recursive: true, force: true });
});
const filename = "20261020000100_broken_migration.sql";
const sql =
  "-- quoted ; and Unicode λ\r\nselect ';';\r\nDO $$ BEGIN PERFORM 'a;b'; END $$;\r\nSELEC 1;\r\n";
const source = () => ({
  schemaVersion: 1,
  kind: "candidate",
  filename,
  sha256: migrationSourceTextSha256(sql),
  workspaceRelativePath: `database/migrations/${filename}`,
  line: null,
  column: null,
  evidence: "owned_execution_input",
});

describe("exact attempted migration input", () => {
  it("keeps byte-exact multiline input without inventing statement offsets or SQL positions", async () => {
    const root = await temporary("migration-source-");
    roots.push(root);
    await mkdir(join(root, "database/migrations"), { recursive: true });
    await writeFile(join(root, source().workspaceRelativePath), sql);
    expect(parseMigrationFailureSource(source())).toEqual(source());
    const actual = await readExactMigrationSource(root, source());
    expect(actual.text).toBe(sql);
    expect(actual.path.endsWith(source().workspaceRelativePath)).toBe(true);
    expect(await readFile(actual.path, "utf8")).toBe(sql);
    await writeFile(actual.path, sql + "-- later edit\n");
    await expect(readExactMigrationSource(root, source())).rejects.toThrow();
    expect(await readFile(actual.path, "utf8")).toBe(sql + "-- later edit\n");
  });

  it("rejects a symlink in either the file or its parent, including an outside redirect", async () => {
    const root = await temporary("migration-source-");
    roots.push(root);
    const outside = await temporary("migration-outside-");
    roots.push(outside);
    await mkdir(join(root, "database/migrations"), { recursive: true });
    await writeFile(join(outside, filename), sql);
    await symlink(
      join(outside, filename),
      join(root, source().workspaceRelativePath),
    );
    await expect(readExactMigrationSource(root, source())).rejects.toThrow();
    await rm(join(root, "database/migrations"), { recursive: true });
    await symlink(outside, join(root, "database/migrations"));
    await expect(readExactMigrationSource(root, source())).rejects.toThrow();
    expect(await readFile(join(outside, filename), "utf8")).toBe(sql);
  });

  it("does not turn unsupported names, paths, extra fields or provider offsets into authority", () => {
    for (const bad of [
      { ...source(), kind: ["candidate"] },
      { ...source(), line: 5 },
      { ...source(), column: 2 },
      { ...source(), statement: 3 },
      { ...source(), evidence: "provider_caret" },
      ...[
        "../",
        "/",
        "./",
        "database//",
        "database/../",
        "C:/",
        "database\\",
        "database/%2e%2e/",
        "database/?/",
        "database/#/",
        "database/\u202e/",
        "database/\u0085/",
        "database/\u2028/",
      ].map((prefix) => ({
        ...source(),
        workspaceRelativePath: prefix + filename,
      })),
      { ...source(), workspaceRelativePath: "a/another.sql" },
      { ...source(), sha256: "x".repeat(64) },
      { ...source(), filename: "not-a-reviewed-migration.sql" },
    ])
      expect(() => parseMigrationFailureSource(bad)).toThrow();
    expect(
      parseMigrationFailureSource({
        ...source(),
        kind: "baseline",
        workspaceRelativePath: null,
      }).workspaceRelativePath,
    ).toBeNull();
  });
});
