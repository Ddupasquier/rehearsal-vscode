/** Validate a private, synthetic Lab handoff before copying it into an owned editor. */
import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { open } from "node:fs/promises";
import type { ProjectSnapshot } from "../src/project_snapshot.js";
import { parseMigrationReviewPlan } from "../src/migration_review.js";
import { parseMigrationInsights } from "../src/migration_insights.js";
import { parseMigrationSourceInput } from "../src/migration_source.js";

const fail = (): never => {
  throw new Error(
    "Native Insights fixture is invalid; private input withheld.",
  );
};
const shape = (value: unknown, keys: string): Record<string, unknown> => {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.keys(value).sort().join(",") !== keys
  )
    return fail();
  return value as Record<string, unknown>;
};
const sha = (bytes: Uint8Array): string =>
  createHash("sha256").update(bytes).digest("hex");

export function parseNativeInsightsFixture(value: unknown) {
  try {
    if (Buffer.byteLength(JSON.stringify(value) ?? "") > 256 * 1024)
      return fail();
    const data = shape(
      value,
      "coreArtifactSha256,coreVersion,files,insights,kind,plan,schemaVersion",
    );
    if (
      data.schemaVersion !== 1 ||
      data.kind !== "migration-insights-native-fixture" ||
      typeof data.coreVersion !== "string" ||
      !/^\d+\.\d+\.\d+(?:-[A-Za-z0-9.-]+)?$/u.test(data.coreVersion) ||
      typeof data.coreArtifactSha256 !== "string" ||
      !/^[a-f0-9]{64}$/u.test(data.coreArtifactSha256) ||
      !Array.isArray(data.files) ||
      !data.files.length ||
      data.files.length > 20
    )
      return fail();
    const plan = parseMigrationReviewPlan(data.plan);
    const report = parseMigrationInsights(
      data.insights,
      plan,
      data.coreVersion,
    );
    const paths = new Set<string>();
    const files = data.files.map((raw) => {
      const file = shape(raw, "base64,path,sha256");
      if (
        typeof file.path !== "string" ||
        !/^database\/migrations\/\d{14}_[A-Za-z0-9_-]+\.sql$/u.test(
          file.path,
        ) ||
        paths.has(file.path) ||
        typeof file.base64 !== "string" ||
        file.base64.length > 350000 ||
        typeof file.sha256 !== "string"
      )
        return fail();
      paths.add(file.path);
      const source = parseMigrationSourceInput({
        filename: file.path.split("/").at(-1),
        sha256: file.sha256,
        workspaceRelativePath: file.path,
      });
      const bytes = Buffer.from(file.base64, "base64");
      if (
        bytes.toString("base64") !== file.base64 ||
        bytes.length > 256 * 1024 ||
        !Buffer.from(bytes.toString("utf8")).equals(bytes) ||
        sha(bytes) !== source.sha256
      )
        return fail();
      return { path: file.path, sha256: source.sha256, bytes };
    });
    const entries = report.targets.flatMap((target) => target.entries);
    if (
      entries.length !== files.length ||
      entries.some(
        (entry) =>
          !files.some(
            (file) =>
              file.path === entry.workspaceRelativePath &&
              file.sha256 === entry.sha256,
          ),
      )
    )
      return fail();
    return {
      coreVersion: data.coreVersion,
      coreArtifactSha256: data.coreArtifactSha256,
      plan,
      report,
      files,
    };
  } catch {
    return fail();
  }
}

/** Explicit developer input only; never serve the SQL-bearing handoff itself. */
export async function readNativeInsightsFixture(path: string) {
  const handle = await open(
    path,
    constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
  ).catch(fail);
  try {
    const before = await handle.stat();
    if (!before.isFile() || before.size > 256 * 1024) return fail();
    const bytes = Buffer.alloc(before.size + 1);
    const { bytesRead } = await handle.read(bytes, 0, bytes.length, 0);
    const after = await handle.stat();
    if (
      bytesRead !== before.size ||
      after.size !== before.size ||
      after.mtimeMs !== before.mtimeMs
    )
      return fail();
    return parseNativeInsightsFixture(
      JSON.parse(bytes.subarray(0, bytesRead).toString("utf8")),
    );
  } catch {
    return fail();
  } finally {
    await handle.close();
  }
}

/** The visual preview gets only the same closed metadata the product renders. */
export function insightsPreviewSnapshot(
  fixture: ReturnType<typeof parseNativeInsightsFixture>,
  unavailable = false,
): ProjectSnapshot {
  return {
    workspaceName: "Synthetic Migration Insights preview · no operations",
    workspaceRoot: "/preview-only",
    availability: "ready",
    version: fixture.coreVersion,
    activity: { schemaVersion: 1, state: "idle", operation: null, recent: [] },
    migrationReview: fixture.plan,
    migrationInsights: unavailable
      ? { state: "unavailable" }
      : { state: "available", report: fixture.report },
    candidates: {
      count: fixture.plan.candidateCount,
      digest: fixture.plan.candidateSha256,
      files: fixture.plan.targets.flatMap((target) =>
        target.entries
          .filter((entry) => entry.status === "candidate")
          .map((entry) => ({ ...entry, target: target.name })),
      ),
      targets: fixture.plan.targets.map((target) => ({
        name: target.name,
        configPath: "rehearsal.config.mjs",
        count: target.entries.filter((entry) => entry.status === "candidate")
          .length,
        digest: target.candidateSha256,
      })),
    },
  };
}
