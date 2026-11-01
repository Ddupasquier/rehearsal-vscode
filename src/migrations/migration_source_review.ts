/** Reviewed-source navigation is read-only and distinct from attempted SQL provenance. */
import { createHash } from "node:crypto";
import {
  parseNativeMigrationIdentity,
  sameNativeMigrationIdentity,
  type NativeMigrationIdentity,
} from "./native_migration_contract.js";
import {
  parseMigrationSourceInput,
  type MigrationSourceInput,
} from "./migration_source.js";
import type {
  MigrationReviewPlan,
  MigrationReviewEntry,
} from "./migration_review.js";
export interface ReviewedMigrationSource extends MigrationSourceInput {
  readonly schemaVersion: 2;
  readonly evidence: "reviewed_source_input";
  readonly target: string;
  readonly candidateSha256: string;
  readonly nativeIdentity: NativeMigrationIdentity;
  readonly line: null;
  readonly column: null;
}
export const migrationSourceReviewId = (
  plan: MigrationReviewPlan,
  entry: MigrationReviewEntry,
): string =>
  createHash("sha256")
    .update(JSON.stringify([plan.candidateSha256, entry.id, entry.sha256]))
    .digest("hex");
export const findReviewedMigration = (
  plan: MigrationReviewPlan,
  id: string,
): MigrationReviewEntry | null =>
  /^[a-f0-9]{64}$/u.test(id)
    ? (plan.targets
        .flatMap((t) => t.entries)
        .find(
          (e) => e.nativeIdentity && migrationSourceReviewId(plan, e) === id,
        ) ?? null)
    : null;
export const reviewedMigrationSourceCommand = (
  plan: MigrationReviewPlan,
  entry: MigrationReviewEntry,
): readonly string[] => {
  if (
    !entry.nativeIdentity ||
    !plan.targets.some(
      (t) =>
        (t.migrationTool?.kind === "drizzle" ||
          t.migrationTool?.kind === "knex") &&
        t.migrationTool.kind === entry.nativeIdentity?.kind &&
        t.entries.includes(entry),
    )
  )
    throw new Error("Migration review identity changed.");
  return [
    "inspect",
    "source",
    `--target=${entry.target}`,
    `--native-identity=${JSON.stringify(entry.nativeIdentity)}`,
    `--source-sha256=${entry.sha256}`,
    `--candidate-sha256=${plan.candidateSha256}`,
  ];
};
export const parseReviewedMigrationSource = (
  value: unknown,
  plan: MigrationReviewPlan,
  entry: MigrationReviewEntry,
): ReviewedMigrationSource => {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Reviewed migration source is unavailable.");
  const x = value as Record<string, unknown>;
  if (
    Object.keys(x).sort().join(",") !==
      "candidateSha256,column,evidence,filename,line,nativeIdentity,schemaVersion,sha256,target,workspaceRelativePath" ||
    x.schemaVersion !== 2 ||
    x.evidence !== "reviewed_source_input" ||
    x.target !== entry.target ||
    x.candidateSha256 !== plan.candidateSha256 ||
    !entry.nativeIdentity ||
    !sameNativeMigrationIdentity(x.nativeIdentity, entry.nativeIdentity) ||
    x.filename !== entry.filename ||
    x.sha256 !== entry.sha256 ||
    x.line !== null ||
    x.column !== null
  )
    throw new Error("Reviewed migration source changed or is unsupported.");
  const source = parseMigrationSourceInput(
    {
      filename: x.filename,
      sha256: x.sha256,
      workspaceRelativePath: x.workspaceRelativePath,
    },
    entry.nativeIdentity.kind === "knex" ? "knex" : true,
  );
  if (!source.workspaceRelativePath)
    throw new Error("Reviewed source is not project-local.");
  return {
    ...source,
    schemaVersion: 2,
    evidence: "reviewed_source_input",
    target: entry.target,
    candidateSha256: plan.candidateSha256,
    nativeIdentity: parseNativeMigrationIdentity(x.nativeIdentity),
    line: null,
    column: null,
  };
};
