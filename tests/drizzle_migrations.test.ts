import { migrationReviewMarkup } from "../src/migration_view.js";
import { DEFAULT_WORKSPACE_PREFERENCES } from "../src/workspace_preferences.js";
import { buildVerificationReport } from "../src/verification_report.js";
import { selectMigrationView } from "../src/migration_filter.js";
import { describe, it, expect } from "vitest";
import { mkdtemp, mkdir, writeFile, symlink, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import {
  parseMigrationReviewPlan,
  assertMatchingMigrationCandidates,
  matchingNativeMigrationHistory,
} from "../src/migration_review.js";
import {
  parseDrizzleMigrationToolBinding,
  parseDrizzleMigrationIdentity,
} from "../src/native_migration_contract.js";
import { parseBaselineInspectionData } from "../src/review_contract.js";
import {
  parseMigrationSourceInput,
  readExactMigrationInput,
} from "../src/migration_source.js";
import {
  parseReviewedMigrationSource,
  reviewedMigrationSourceCommand,
  migrationSourceReviewId,
  findReviewedMigration,
} from "../src/migration_source_review.js";
import {
  parseMigrationInsights,
  migrationInsightIndex,
} from "../src/migration_insights.js";
import { insightReport } from "./migration_insights_fixture.js";
import { parseWorkspaceMessage } from "../src/workspace_preferences.js";
import {
  sha,
  identity,
  binding,
  rawPlan,
  baseline,
} from "./drizzle_fixture.js";
describe("explicit Drizzle public migration contracts", () => {
  it("preserves journal idx/when/tag without legacy timestamp fields", () => {
    const plan = parseMigrationReviewPlan(rawPlan());
    expect(plan.targets[0]!.entries[1]).toMatchObject({
      nativeIdentity: identity(1),
      order: 1,
    });
    expect(plan.targets[0]!.entries[1]).not.toHaveProperty("version");
    expect(plan.targets[0]!.entries[1]).not.toHaveProperty("timestamp");
    expect(
      parseBaselineInspectionData(baseline(), "postgresql").migrationCutoff,
    ).toEqual(identity());
  });
  it.each([
    "kitVersion",
    "ormVersion",
    "driverVersion",
    "journalVersion",
    "dialect",
    "toolchainSha256",
    "journalSha256",
  ])("refuses unsupported/malformed %s", (key) =>
    expect(() =>
      parseDrizzleMigrationToolBinding({ ...binding(), [key]: "unknown" }),
    ).toThrow(),
  );
  it.each([
    { ...identity(), kind: "unknown" },
    { ...identity(), idx: -1 },
    { ...identity(), when: 0 },
    { ...identity(), tag: "../escape" },
    { ...identity(), extra: true },
  ])("refuses malformed identity %#", (value) =>
    expect(() => parseDrizzleMigrationIdentity(value)).toThrow(),
  );
  it("requires binding, correct provider/order/dependency and absence of fabricated version", () => {
    for (const mutate of [
      (p: any) => delete p.targets[0].migrationTool,
      (p: any) => (p.targets[0].provider = "supabase"),
      (p: any) => (p.targets[0].entries[1].nativeIdentity.idx = 5),
      (p: any) => (p.targets[0].entries[1].dependsOn = []),
      (p: any) => (p.targets[0].entries[1].version = "20260101000000"),
      (p: any) => (p.targets[0].entries[1].filename = "../change.sql"),
    ]) {
      const raw = rawPlan();
      mutate(raw);
      expect(() => parseMigrationReviewPlan(raw)).toThrow();
    }
  });
  it("rejects format/tool/cutoff mismatch and unknown future formats", () => {
    for (const value of [
      { ...baseline(), formatVersion: 3 },
      { ...baseline(), migrationCutoff: "20260101000000" },
      { ...baseline(), formatVersion: 5 },
      { ...baseline(), nativeMigrations: undefined },
    ])
      expect(() => parseBaselineInspectionData(value)).toThrow();
  });
  it("binds structured candidates and rejects filename-only/native identity drift", () => {
    const plan = parseMigrationReviewPlan(rawPlan()),
      entry = plan.targets[0]!.entries[1]!,
      candidate = {
        nativeIdentity: entry.nativeIdentity,
        name: entry.name,
        filename: entry.filename,
        sha256: entry.sha256,
        status: "candidate",
      };
    const evidence = {
      baselineGenerationId: "baseline-1",
      candidateSha256: sha,
      candidateCount: 1,
      candidates: [candidate],
      targets: [
        {
          name: "primary",
          candidateSha256: sha,
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
        candidates: [{ ...candidate, nativeIdentity: identity() }],
      }),
    ).toThrow();
  });
  it("allows producer platform/raw-journal change while retaining native tool pins", () => {
    const old = parseDrizzleMigrationToolBinding(binding()),
      fresh = parseDrizzleMigrationToolBinding({
        ...binding(),
        journalSha256: "b".repeat(64),
        toolchainSha256: "c".repeat(64),
      });
    expect(matchingNativeMigrationHistory(old, fresh)).toBe(true);
  });
  it("binds static findings and opaque IDs to exact native identity", () => {
    const plan = parseMigrationReviewPlan(rawPlan()),
      report: any = insightReport("2.2.0");
    delete report.targets[0].entries[0].version;
    Object.assign(report.targets[0].entries[0], {
      nativeIdentity: identity(1),
      filename: "0001_change.sql",
      sha256: sha,
      workspaceRelativePath: "drizzle/0001_change.sql",
    });
    const parsed = parseMigrationInsights(report, plan, "2.2.0");
    expect(
      [...migrationInsightIndex(parsed).values()][0]!.entry.nativeIdentity,
    ).toEqual(identity(1));
    report.targets[0].entries[0].nativeIdentity = identity();
    expect(() => parseMigrationInsights(report, plan, "2.2.0")).toThrow();
  });
});
describe("reviewed Drizzle source selection", () => {
  const plan = () => parseMigrationReviewPlan(rawPlan());
  const reference = () => ({
    schemaVersion: 2,
    evidence: "reviewed_source_input",
    target: "primary",
    candidateSha256: sha,
    nativeIdentity: identity(1),
    filename: "0001_change.sql",
    sha256: sha,
    workspaceRelativePath: "drizzle/0001_change.sql",
    line: null,
    column: null,
  });
  it("selects only opaque current-plan entries and emits public identity flags without a path", () => {
    const p = plan(),
      entry = p.targets[0]!.entries[1]!,
      id = migrationSourceReviewId(p, entry);
    expect(findReviewedMigration(p, id)).toBe(entry);
    expect(
      findReviewedMigration({ ...p, candidateSha256: "b".repeat(64) }, id),
    ).toBeNull();
    expect(reviewedMigrationSourceCommand(p, entry)).toEqual([
      "inspect",
      "source",
      "--target=primary",
      `--native-identity=${JSON.stringify(identity(1))}`,
      `--source-sha256=${sha}`,
      `--candidate-sha256=${sha}`,
    ]);
    expect(
      parseWorkspaceMessage({ type: "openReviewedMigration", sourceId: id }),
    ).not.toBeNull();
    expect(
      parseWorkspaceMessage({
        type: "openReviewedMigration",
        sourceId: id,
        path: "/elsewhere",
      }),
    ).toBeNull();
  });
  it("accepts exact schema2 file-top evidence without inventing failure position", () => {
    const p = plan();
    expect(
      parseReviewedMigrationSource(reference(), p, p.targets[0]!.entries[1]!),
    ).toMatchObject({
      evidence: "reviewed_source_input",
      line: null,
      column: null,
    });
  });
  it.each([
    { target: "secondary" },
    { candidateSha256: "b".repeat(64) },
    { nativeIdentity: identity() },
    { evidence: "attempted_input" },
    { schemaVersion: 3 },
    { line: 1 },
    { workspaceRelativePath: "file:///tmp/0001_change.sql" },
    { workspaceRelativePath: "../0001_change.sql" },
    { workspaceRelativePath: "drizzle/%2e%2e/0001_change.sql" },
    { filename: "other.sql" },
    { sha256: "b".repeat(64) },
    { extra: true },
  ])("rejects stale, unsafe or widened source evidence %#", (patch) => {
    const p = plan();
    expect(() =>
      parseReviewedMigrationSource(
        { ...reference(), ...patch },
        p,
        p.targets[0]!.entries[1]!,
      ),
    ).toThrow();
  });
  it("verifies raw local bytes, rejects drift and symlink ancestry", async () => {
    const root = await mkdtemp(join(tmpdir(), "drizzle-editor-"));
    try {
      await mkdir(join(root, "drizzle"));
      const text = "DROP TABLE old;\n",
        hash = createHash("sha256").update(text).digest("hex"),
        source = {
          filename: "0001_change.sql",
          sha256: hash,
          workspaceRelativePath: "drizzle/0001_change.sql",
        };
      await writeFile(join(root, source.workspaceRelativePath), text);
      expect((await readExactMigrationInput(root, source, true)).text).toBe(
        text,
      );
      await writeFile(
        join(root, source.workspaceRelativePath),
        text + "-- drift",
      );
      await expect(
        readExactMigrationInput(root, source, true),
      ).rejects.toThrow();
      await symlink(join(root, "drizzle"), join(root, "alias"));
      await expect(
        readExactMigrationInput(
          root,
          { ...source, workspaceRelativePath: "alias/0001_change.sql" },
          true,
        ),
      ).rejects.toThrow();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

it("filters Drizzle by journal milliseconds without fabricating version prefixes", () => {
  const entries = [
    {
      name: "0001_change.sql",
      target: "primary",
      status: "candidate",
      order: 1,
      hasWarning: true,
      nativeIdentity: identity(1),
    },
    {
      name: "legacy.sql",
      target: "primary",
      status: "candidate",
      order: 0,
      hasWarning: false,
      version: "20200101000000",
    },
  ];
  const result = selectMigrationView(entries, {
    query: "",
    targets: ["primary"],
    status: "all",
    sort: "date",
    from: "2023-11-14",
    to: "2023-11-14",
    warning: "all",
  });
  expect(result.ordered.map((e) => e.name)).toEqual([
    "legacy.sql",
    "0001_change.sql",
  ]);
  expect(result.visible.map((e) => e.name)).toEqual(["0001_change.sql"]);
  expect(entries[0]).not.toHaveProperty("version");
});

it("renders journal order and exact-source controls and exports a safe native boundary", () => {
  const plan = parseMigrationReviewPlan(rawPlan()),
    snapshot = {
      workspaceName: "fixture",
      workspaceRoot: "/workspace",
      availability: "ready" as const,
      version: "2.2.0",
      migrationReview: plan,
      baseline: (() => {
        const {
          review: _r,
          shape: _s,
          generations: _g,
          ...metadata
        } = parseBaselineInspectionData(baseline());
        return metadata;
      })(),
    };
  const html = migrationReviewMarkup(snapshot, DEFAULT_WORKSPACE_PREFERENCES)!;
  expect(html).toContain("Drizzle #1 (1700000000001, 0001_change)");
  expect(html).toContain('data-native-idx="1"');
  expect(html).toContain("data-open-reviewed-migration=");
  expect(html).toContain('<option value="date">Migration time</option>');
  expect(html).not.toContain("undefined");
  expect(html).not.toContain("[object Object]");
  expect(buildVerificationReport(snapshot).baseline?.migrationCutoff).toBe(
    "Drizzle #0 (1700000000000, 0000_change)",
  );
});
