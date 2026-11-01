export const sha = "a".repeat(64);
export const identity = (idx = 0) => ({
  kind: "drizzle" as const,
  idx,
  when: 1700000000000 + idx,
  tag: `000${idx}_change`,
});
export const binding = () => ({
  schemaVersion: 1,
  kind: "drizzle",
  kitVersion: "0.31.11",
  ormVersion: "0.45.4",
  driver: "pg",
  driverVersion: "8.23.1",
  journalVersion: "7",
  dialect: "postgresql",
  journalSha256: sha,
  toolchainSha256: sha,
  ledger: { schema: "drizzle", table: "__drizzle_migrations" },
});
export const rawPlan = () => ({
  schemaVersion: 1,
  candidateSha256: sha,
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
      candidateSha256: sha,
      migrationTool: binding(),
      baselineHistorySha256: sha,
      baselinePrefixVerification: "exact-native-semantic-prefix",
      entries: [0, 1].map((i) => ({
        id: `primary:drizzle:${i}:${identity(i).when}:${identity(i).tag}`,
        target: "primary",
        nativeIdentity: identity(i),
        name: identity(i).tag,
        filename: `${identity(i).tag}.sql`,
        sha256: sha,
        order: i,
        status: i ? "candidate" : "represented_by_baseline",
        required: !!i,
        dependsOn: i
          ? [`primary:drizzle:0:${identity().when}:${identity().tag}`]
          : [],
        warnings: i ? ["sql_safety_not_inferred"] : [],
        selectionReason: "Complete ordered suffix.",
      })),
    },
  ],
});
export const baseline = () => ({
  formatVersion: 4,
  nativeMigrations: binding(),
  generationId: "baseline-1",
  createdAt: "2026-10-01T00:00:00Z",
  migrationCutoff: identity(),
  migrationCount: 1,
  rowCount: 3,
  tableCount: 1,
  verification: "checksums_verified",
  migrationHistorySha256: sha,
});
