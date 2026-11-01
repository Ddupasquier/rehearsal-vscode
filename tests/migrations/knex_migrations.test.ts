import { describe, it, expect } from "vitest";
import { createHash } from "node:crypto";
import {
  mkdtemp,
  mkdir,
  writeFile,
  symlink,
  truncate,
  rm,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  parseKnexMigrationIdentity,
  parseKnexMigrationToolBinding,
  matchingKnexReviewedPrefix,
} from "../../src/migrations/knex_migration_contract.js";
import {
  parseMigrationReviewPlan,
  assertMatchingMigrationCandidates,
  matchingKnexBaselineReview,
} from "../../src/migrations/migration_review.js";
import { parseBaselineInspectionData } from "../../src/review/review_contract.js";
import {
  migrationSourceReviewId,
  findReviewedMigration,
  parseReviewedMigrationSource,
  reviewedMigrationSourceCommand,
} from "../../src/migrations/migration_source_review.js";
import {
  parseMigrationSourceInput,
  readExactMigrationInput,
} from "../../src/migrations/migration_source.js";
import { parseMigrationInsights } from "../../src/migrations/migration_insights.js";
import { migrationReviewMarkup } from "../../src/migrations/migration_view.js";
import { selectMigrationView } from "../../src/migrations/migration_filter.js";
import { DEFAULT_WORKSPACE_PREFERENCES } from "../../src/workspace/workspace_preferences.js";
import { buildVerificationReport } from "../../src/runtime/verification_report.js";
import { insightReport } from "./migration_insights_fixture.js";
import {
  knexSha,
  knexIdentity,
  knexFiles,
  knexBinding,
  knexBaseline,
  knexPlan,
} from "./knex_fixture.js";

describe("explicit Knex reviewed code contracts", () => {
  it("preserves native names/order/notice without fabricated version or historical checksum", () => {
    const plan = parseMigrationReviewPlan(knexPlan()),
      baseline = parseBaselineInspectionData(knexBaseline(), "postgresql");
    expect(plan.targets[0]!.entries[1]).toMatchObject({
      nativeIdentity: knexIdentity("200_change.cjs"),
      order: 1,
    });
    expect(plan.targets[0]!.entries[1]).not.toHaveProperty("version");
    expect(plan.targets[0]!.entries[1]).not.toHaveProperty("timestamp");
    expect(baseline.historicalFileChecksums).toBe("unavailable");
    expect(matchingKnexBaselineReview(baseline, plan.targets[0]!)).toBe(true);
  });
  it.each([
    "version",
    "driverVersion",
    "provider",
    "bundleSha256",
    "toolchainSha256",
    "isolationPolicySha256",
    "historicalFileChecksums",
  ])("refuses unsupported/bad %s", (key) =>
    expect(() =>
      parseKnexMigrationToolBinding({ ...knexBinding(), [key]: "unknown" }),
    ).toThrow(),
  );
  it.each([
    { kind: "other", name: "100_base.cjs" },
    { ...knexIdentity(), extra: true },
    { kind: "knex", name: "../escape.cjs" },
    { kind: "knex", name: "nested/migration.cjs" },
    { kind: "knex", name: "100_base.ts" },
    { kind: "knex", name: "100_base.mjs" },
    { kind: "knex", name: "100_base%2f.cjs" },
  ])("refuses widened/traversing/executable-source identity %#", (identity) =>
    expect(() => parseKnexMigrationIdentity(identity)).toThrow(),
  );
  it("validates whole canonical code bundle including helper receipts", () => {
    expect(() => parseKnexMigrationToolBinding(knexBinding())).not.toThrow();
    for (const files of [
      [...knexFiles()].reverse(),
      [knexFiles()[0]!, knexFiles()[0]!],
      [{ ...knexFiles()[0]!, filename: "helpers/../escape.cjs" }],
      [{ ...knexFiles()[0]!, filename: "helpers/notes/a.cjs" }],
      [{ ...knexFiles()[0]!, bytes: 8 * 1024 ** 2 + 1 }],
      Array(1),
    ])
      expect(() => parseKnexMigrationToolBinding(knexBinding(files))).toThrow();
  });
  it("allows exact reviewed-code append with changed whole bundle/platform hash, refuses helper drift/deletion/policy drift", () => {
    const baseline = parseKnexMigrationToolBinding(
        knexBaseline().nativeMigrations,
      ),
      current = parseKnexMigrationToolBinding({
        ...knexBinding(),
        toolchainSha256: "e".repeat(64),
      });
    expect(matchingKnexReviewedPrefix(baseline, current)).toBe(true);
    const changed = knexFiles().map((f) =>
      f.filename.startsWith("helpers/")
        ? { ...f, fileSha256: "e".repeat(64) }
        : f,
    );
    for (const binding of [
      knexBinding(changed),
      knexBinding(
        knexFiles().filter((f) => !f.filename.startsWith("helpers/")),
      ),
      { ...knexBinding(), isolationPolicySha256: "e".repeat(64) },
    ])
      expect(
        matchingKnexReviewedPrefix(
          baseline,
          parseKnexMigrationToolBinding(binding),
        ),
      ).toBe(false);
  });
  it("refuses malformed binding/provider/row order/warnings/hash associations", () => {
    for (const change of [
      (p: any) => delete p.targets[0].migrationTool,
      (p: any) => (p.targets[0].provider = "supabase"),
      (p: any) => p.targets[0].entries.reverse(),
      (p: any) => (p.targets[0].entries[1].version = "20260101000000"),
      (p: any) => (p.targets[0].entries[0].warnings = []),
      (p: any) =>
        p.targets[0].entries[1].warnings.push("sql_safety_not_inferred"),
      (p: any) => (p.targets[0].entries[1].sha256 = "e".repeat(64)),
      (p: any) =>
        (p.targets[0].baselinePrefixVerification =
          "exact-native-semantic-prefix"),
    ]) {
      const raw = knexPlan();
      change(raw);
      expect(() => parseMigrationReviewPlan(raw)).toThrow();
    }
  });
  it("binds independently read candidates to exact native identities and rejects filename-only fallback", () => {
    const plan = parseMigrationReviewPlan(knexPlan()),
      entry = plan.targets[0]!.entries[1]!,
      candidate = {
        nativeIdentity: entry.nativeIdentity,
        name: entry.name,
        filename: entry.filename,
        sha256: entry.sha256,
        status: "candidate",
      },
      evidence = {
        baselineGenerationId: "baseline-1",
        candidateSha256: knexSha,
        candidateCount: 1,
        candidates: [candidate],
        targets: [
          {
            name: "primary",
            candidateSha256: knexSha,
            candidateCount: 1,
            candidates: [candidate],
          },
        ],
      };
    expect(() =>
      assertMatchingMigrationCandidates(plan, evidence),
    ).not.toThrow();
    expect(() =>
      assertMatchingMigrationCandidates(plan, {
        ...evidence,
        candidates: [entry.filename],
      }),
    ).toThrow();
    expect(() =>
      assertMatchingMigrationCandidates(plan, {
        ...evidence,
        candidates: [{ ...candidate, nativeIdentity: knexIdentity() }],
      }),
    ).toThrow();
  });
  it("requires format5 notice/kind/cutoff while retained summaries do not invent a notice field", () => {
    for (const input of [
      { ...knexBaseline(), historicalFileChecksums: undefined },
      { ...knexBaseline(), historicalFileChecksums: "verified" },
      { ...knexBaseline(), formatVersion: 4 },
      { ...knexBaseline(), migrationCutoff: "20260101000000" },
      { ...knexBaseline(), nativeMigrations: undefined },
      { ...knexBaseline(), formatVersion: 6 },
    ])
      expect(() => parseBaselineInspectionData(input)).toThrow();
    const generation = {
      ...knexBaseline(),
      active: true,
      storageAssetCount: 0,
    };
    delete (generation as { historicalFileChecksums?: unknown })
      .historicalFileChecksums;
    const result = parseBaselineInspectionData({
      ...knexBaseline(),
      generations: [generation],
    });
    expect(result.generations![0]).not.toHaveProperty(
      "historicalFileChecksums",
    );
  });
  it("renders explicit checksum/isolation limits, no SQL Insights claim or fake timestamp, and safe exported cutoff", () => {
    const plan = parseMigrationReviewPlan(knexPlan()),
      {
        review: _r,
        shape: _s,
        generations: _g,
        ...baseline
      } = parseBaselineInspectionData(knexBaseline()),
      snapshot = {
        workspaceName: "fixture",
        workspaceRoot: "/workspace",
        availability: "ready" as const,
        version: "2.3.0-dev.1",
        migrationReview: plan,
        baseline,
      };
    const html = migrationReviewMarkup(
      snapshot,
      DEFAULT_WORKSPACE_PREFERENCES,
    )!;
    expect(html).toContain("historical applied-file checksums are unavailable");
    expect(html).toContain("never executes it on the host");
    expect(html).toContain(
      "Static SQL Insights does not analyze Knex JavaScript",
    );
    expect(html).toContain('data-native-kind="knex"');
    expect(html).toContain("Time unavailable for Knex");
    expect(html).toContain("Open exact migration input");
    expect(html).not.toContain("undefined");
    expect(html).not.toContain("[object Object]");
    expect(buildVerificationReport(snapshot).baseline?.migrationCutoff).toBe(
      "Knex 100_base.cjs",
    );
    expect(
      buildVerificationReport(snapshot).baseline?.historicalFileChecksums,
    ).toBe("unavailable");
    expect(() =>
      parseMigrationInsights(insightReport(), plan, "2.3.0-dev.1"),
    ).toThrow();
  });
  it("never filters .cjs filename prefixes as migration dates", () => {
    const entry = {
      name: "20260101000000_change.cjs",
      target: "primary",
      status: "candidate",
      order: 0,
      hasWarning: true,
      nativeIdentity: knexIdentity("20260101000000_change.cjs"),
    };
    const result = selectMigrationView([entry], {
      query: "",
      targets: ["primary"],
      status: "all",
      sort: "order",
      from: "",
      to: "2026-12-31",
      warning: "all",
    });
    expect(result.visible).toEqual([]);
  });
});
describe("read-only exact Knex source navigation", () => {
  const plan = () => parseMigrationReviewPlan(knexPlan()),
    reference = () => ({
      schemaVersion: 2,
      evidence: "reviewed_source_input",
      target: "primary",
      candidateSha256: knexSha,
      nativeIdentity: knexIdentity("200_change.cjs"),
      filename: "200_change.cjs",
      sha256: "c".repeat(64),
      workspaceRelativePath: "database/migrations/200_change.cjs",
      line: null,
      column: null,
    });
  it("uses only current opaque row ID and public target/native/hash/root binding", () => {
    const p = plan(),
      entry = p.targets[0]!.entries[1]!,
      id = migrationSourceReviewId(p, entry);
    expect(findReviewedMigration(p, id)).toBe(entry);
    expect(
      findReviewedMigration({ ...p, candidateSha256: "e".repeat(64) }, id),
    ).toBeNull();
    expect(reviewedMigrationSourceCommand(p, entry)).toEqual([
      "inspect",
      "source",
      "--target=primary",
      `--native-identity=${JSON.stringify(knexIdentity("200_change.cjs"))}`,
      `--source-sha256=${"c".repeat(64)}`,
      `--candidate-sha256=${knexSha}`,
    ]);
    expect(parseReviewedMigrationSource(reference(), p, entry)).toMatchObject({
      nativeIdentity: knexIdentity("200_change.cjs"),
      line: null,
      column: null,
    });
    expect(() =>
      parseMigrationSourceInput(
        {
          filename: entry.filename,
          sha256: entry.sha256,
          workspaceRelativePath: reference().workspaceRelativePath,
        },
        true,
      ),
    ).toThrow();
  });
  it.each([
    { schemaVersion: 3 },
    { evidence: "attempted_input" },
    { target: "other" },
    { candidateSha256: "e".repeat(64) },
    { nativeIdentity: knexIdentity() },
    { nativeIdentity: { kind: "drizzle", idx: 1, when: 1, tag: "200_change" } },
    { filename: "nested/200_change.cjs" },
    { workspaceRelativePath: "file:///tmp/200_change.cjs" },
    { workspaceRelativePath: "../200_change.cjs" },
    { workspaceRelativePath: "database/%2e%2e/200_change.cjs" },
    { line: 1 },
    { column: 1 },
    { extra: true },
  ])("refuses stale/unsafe/fabricated source %#", (patch) => {
    const p = plan();
    expect(() =>
      parseReviewedMigrationSource(
        { ...reference(), ...patch },
        p,
        p.targets[0]!.entries[1]!,
      ),
    ).toThrow();
  });
  it("reads .cjs bytes without evaluation, rejects drift and symlink ancestry", async () => {
    const root = await mkdtemp(join(tmpdir(), "knex-editor-source-"));
    try {
      await mkdir(join(root, "migrations"));
      const text = 'throw new Error("MUST_NOT_EXECUTE");\n',
        filename = "200_change.cjs",
        sha256 = createHash("sha256").update(text).digest("hex"),
        source = {
          filename,
          sha256,
          workspaceRelativePath: `migrations/${filename}`,
        };
      await writeFile(join(root, source.workspaceRelativePath), text);
      expect((await readExactMigrationInput(root, source, "knex")).text).toBe(
        text,
      );
      await writeFile(
        join(root, source.workspaceRelativePath),
        text + "// drift",
      );
      await expect(
        readExactMigrationInput(root, source, "knex"),
      ).rejects.toThrow();
      await symlink(join(root, "migrations"), join(root, "alias"));
      await expect(
        readExactMigrationInput(
          root,
          { ...source, workspaceRelativePath: `alias/${filename}` },
          "knex",
        ),
      ).rejects.toThrow();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
  it("permits a reviewed .cjs above2MiB only in the explicit8MiB Knex path; SQL remains2MiB", async () => {
    const root = await mkdtemp(join(tmpdir(), "knex-editor-bound-"));
    try {
      const text = "//" + "x".repeat(3 * 1024 ** 2),
        sha256 = createHash("sha256").update(text).digest("hex"),
        source = {
          filename: "200_change.cjs",
          sha256,
          workspaceRelativePath: "200_change.cjs",
        };
      await writeFile(join(root, source.filename), text);
      expect((await readExactMigrationInput(root, source, "knex")).text).toBe(
        text,
      );
      const sql = {
        filename: "20260101000000_change.sql",
        sha256,
        workspaceRelativePath: "20260101000000_change.sql",
      };
      await writeFile(join(root, sql.filename), text);
      await expect(
        readExactMigrationInput(root, sql, "knex"),
      ).rejects.toThrow();
      await truncate(join(root, source.filename), 8 * 1024 ** 2 + 1);
      await expect(
        readExactMigrationInput(root, source, "knex"),
      ).rejects.toThrow();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

it("allows only Knex reviewed source paths through the Core 3072-byte boundary", () => {
  const filename = "200_change.cjs";
  const sized = (size: number) =>
    "a/".repeat(Math.floor((size - filename.length - 2) / 2)) +
    "x".repeat((size - filename.length - 2) % 2) +
    "a/" +
    filename;
  for (const size of [1024, 1025, 3072]) {
    const value = {
      filename,
      sha256: knexSha,
      workspaceRelativePath: sized(size),
    };
    expect(Buffer.byteLength(value.workspaceRelativePath)).toBe(size);
    expect(parseMigrationSourceInput(value, "knex").workspaceRelativePath).toBe(
      value.workspaceRelativePath,
    );
  }
  expect(() =>
    parseMigrationSourceInput(
      { filename, sha256: knexSha, workspaceRelativePath: sized(3073) },
      "knex",
    ),
  ).toThrow();
  const sql = "20261027000000_change.sql";
  for (const size of [1024, 1025]) {
    const input = {
      filename: sql,
      sha256: knexSha,
      workspaceRelativePath:
        "a/".repeat(Math.floor((size - sql.length - 2) / 2)) +
        "x".repeat((size - sql.length - 2) % 2) +
        "a/" +
        sql,
    };
    expect(Buffer.byteLength(input.workspaceRelativePath)).toBe(size);
    if (size === 1024)
      expect(parseMigrationSourceInput(input).workspaceRelativePath).toBe(
        input.workspaceRelativePath,
      );
    else {
      expect(() => parseMigrationSourceInput(input)).toThrow();
      expect(() => parseMigrationSourceInput(input, "knex")).toThrow();
    }
  }
});
