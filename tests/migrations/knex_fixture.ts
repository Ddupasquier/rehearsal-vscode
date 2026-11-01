import { createHash } from "node:crypto";
export const knexSha = "a".repeat(64);
export const knexIdentity = (name = "100_base.cjs") => ({
  kind: "knex" as const,
  name,
});
export const knexFiles = () => [
  { filename: "100_base.cjs", fileSha256: "b".repeat(64), bytes: 32 },
  { filename: "200_change.cjs", fileSha256: "c".repeat(64), bytes: 33 },
  { filename: "helpers/common.cjs", fileSha256: "d".repeat(64), bytes: 34 },
];
export const knexBinding = (files = knexFiles()) => ({
  schemaVersion: 1 as const,
  kind: "knex" as const,
  version: "3.3.0" as const,
  driver: "pg" as const,
  driverVersion: "8.23.1" as const,
  provider: "postgresql" as const,
  bundleSha256: createHash("sha256")
    .update(JSON.stringify(files))
    .digest("hex"),
  toolchainSha256: knexSha,
  isolationPolicySha256: knexSha,
  historicalFileChecksums: "unavailable" as const,
  codeFiles: files,
  ledger: { schema: "public" as const, table: "knex_migrations" as const },
});
export const knexBaseline = () => ({
  generationId: "baseline-1",
  createdAt: "2026-10-26T00:00:00Z",
  formatVersion: 5 as const,
  nativeMigrations: knexBinding(
    knexFiles().filter((f) => f.filename !== "200_change.cjs"),
  ),
  historicalFileChecksums: "unavailable" as const,
  migrationCutoff: knexIdentity(),
  rowCount: 3,
  tableCount: 1,
  migrationCount: 1,
  verification: "checksums_verified",
  migrationHistorySha256: knexSha,
});
export const knexPlan = () => ({
  schemaVersion: 1,
  candidateSha256: knexSha,
  candidateCount: 1,
  selection: "complete-ordered-suffix",
  safety: {
    executesSql: false,
    startsEngine: false,
    readsSqlBodiesForSafety: false,
  },
  targets: [
    {
      name: "primary",
      provider: "postgresql",
      baselineGenerationId: "baseline-1",
      candidateSha256: knexSha,
      migrationTool: knexBinding(),
      baselineHistorySha256: knexSha,
      baselinePrefixVerification: "exact-reviewed-code-prefix",
      entries: knexFiles()
        .filter((f) => !f.filename.includes("/"))
        .map((f, index) => ({
          id: `primary:knex:${f.filename}`,
          target: "primary",
          nativeIdentity: knexIdentity(f.filename),
          filename: f.filename,
          name: f.filename,
          sha256: f.fileSha256,
          order: index,
          status: index ? "candidate" : "represented_by_baseline",
          required: !!index,
          dependsOn: index ? ["primary:knex:100_base.cjs"] : [],
          warnings: [
            "historical_file_checksums_unavailable",
            "native_javascript_isolated_execution_required",
          ],
          selectionReason: "Complete ordered suffix.",
        })),
    },
  ],
});
