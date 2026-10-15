import type { ProjectSnapshot } from "./project_snapshot.js";

export const COMPARISON_LIMITS = {
  runtimeTargets: 32,
  baselineGenerations: 1000,
} as const;

export interface ComparisonSubject {
  readonly id: string;
  readonly label: string;
  readonly kind: "target" | "baseline";
  readonly provider: "supabase" | "postgresql" | null;
  readonly formatVersion: 1 | 2 | null;
  readonly baselineGenerationId: string | null;
  readonly migrationCutoff: string | null;
  readonly migrationHistorySha256: string | null;
  readonly sourceSchemaSha256: string | null;
  readonly candidateSha256: string | null;
  readonly policySha256: string | null;
  readonly configurationSha256: string | null;
  readonly runtimeState: string | null;
  readonly rowCount: number | null;
  readonly tableCount: number | null;
  readonly storageAssetCount: number | null;
  readonly storageBytes: number | null;
}
const hash = (value: unknown): string | null =>
  typeof value === "string" && /^[a-f0-9]{64}$/u.test(value) ? value : null;
const count = (value: unknown): number | null =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= 0
    ? value
    : null;
const text = (value: unknown): string | null =>
  typeof value === "string" && /^[A-Za-z0-9_. -]{1,128}$/u.test(value)
    ? value
    : null;

export const comparisonSubjects = (
  snapshot: ProjectSnapshot,
): readonly ComparisonSubject[] => {
  const subjects: ComparisonSubject[] = [];
  const targets = (snapshot.runtime?.targets ?? []).slice(
    0,
    COMPARISON_LIMITS.runtimeTargets,
  );
  for (const target of targets) {
    const evidence = snapshot.reviewTargets?.find(
      (item) => item.name === target.name,
    );
    const baseline = evidence?.baseline;
    const name = text(target.name);
    if (name === null) continue;
    subjects.push({
      id: `target:${name}`,
      label: `${name} environment`,
      kind: "target",
      provider: target.runtimeTarget,
      formatVersion: baseline?.formatVersion ?? null,
      baselineGenerationId: text(
        baseline?.generationId ?? target.baselineGenerationId,
      ),
      migrationCutoff: text(baseline?.migrationCutoff),
      migrationHistorySha256: hash(baseline?.migrationHistorySha256),
      sourceSchemaSha256: hash(baseline?.sourceSchemaSha256),
      candidateSha256: hash(
        target.candidateSha256 ??
          snapshot.candidates?.targets.find(
            (candidate) => candidate.name === name,
          )?.digest,
      ),
      policySha256: hash(baseline?.sanitizationPolicySha256),
      configurationSha256: hash(evidence?.configurationSha256),
      runtimeState: target.state,
      rowCount: count(baseline?.rowCount),
      tableCount: count(baseline?.tableCount),
      storageAssetCount: count(baseline?.storageAssetCount),
      storageBytes: count(baseline?.storageBytes),
    });
  }
  const primaryProvider =
    targets.find((target) => target.name === "primary")?.runtimeTarget ?? null;
  for (const baseline of (snapshot.baseline?.generations ?? []).slice(
    0,
    COMPARISON_LIMITS.baselineGenerations,
  )) {
    const generationId = text(baseline.generationId);
    if (generationId === null) continue;
    const active = generationId === snapshot.baseline?.generationId;
    subjects.push({
      id: `baseline:${generationId}`,
      label: `${generationId}${baseline.active ? " (active baseline)" : " (retained baseline)"}`,
      kind: "baseline",
      provider: primaryProvider,
      formatVersion: baseline.formatVersion,
      baselineGenerationId: generationId,
      migrationCutoff: text(baseline.migrationCutoff),
      migrationHistorySha256: active
        ? hash(snapshot.baseline?.migrationHistorySha256)
        : null,
      sourceSchemaSha256: active
        ? hash(snapshot.baseline?.sourceSchemaSha256)
        : null,
      candidateSha256: null,
      policySha256: active
        ? hash(snapshot.baseline?.sanitizationPolicySha256)
        : null,
      configurationSha256: null,
      runtimeState: null,
      rowCount: count(baseline.rowCount),
      tableCount: count(baseline.tableCount),
      storageAssetCount: count(baseline.storageAssetCount),
      storageBytes: active
        ? count(snapshot.baseline?.review?.storage.bytes)
        : null,
    });
  }
  return subjects;
};

const fields = [
  ["provider", "Database provider"],
  ["formatVersion", "Baseline format"],
  ["baselineGenerationId", "Baseline identity"],
  ["migrationCutoff", "Migration boundary"],
  ["migrationHistorySha256", "Exact migration history"],
  ["sourceSchemaSha256", "Reviewed source-column schema"],
  ["candidateSha256", "Candidate migration digest"],
  ["policySha256", "Privacy policy identity"],
  ["configurationSha256", "Reviewed configuration identity"],
  ["runtimeState", "Runtime state"],
  ["rowCount", "Database rows"],
  ["tableCount", "Database tables"],
  ["storageAssetCount", "Storage assets"],
  ["storageBytes", "Storage bytes"],
] as const;

export const compareEnvironmentEvidence = (
  left: ComparisonSubject,
  right: ComparisonSubject,
) => {
  const incompatibleProvider =
    left.provider !== null &&
    right.provider !== null &&
    left.provider !== right.provider;
  const incompatibleFormat =
    left.formatVersion !== null &&
    right.formatVersion !== null &&
    left.formatVersion !== right.formatVersion;
  return {
    schemaVersion: 1 as const,
    leftId: left.id,
    rightId: right.id,
    compatible: !(incompatibleProvider || incompatibleFormat),
    facts: fields.map(([key, label]) => {
      const leftValue = left[key],
        rightValue = right[key];
      const state =
        leftValue === null || rightValue === null
          ? ("unavailable" as const)
          : (key === "provider" && incompatibleProvider) ||
              (key !== "provider" &&
                key !== "runtimeState" &&
                (incompatibleProvider || incompatibleFormat))
            ? ("incompatible" as const)
            : leftValue === rightValue
              ? ("equal" as const)
              : ("different" as const);
      return { key, label, state, left: leftValue, right: rightValue };
    }),
    limitations: [
      "Equal aggregate counts do not prove equal rows, schemas, relationships, or application behavior.",
      "Unavailable evidence is not treated as zero, equal, or passed.",
      "The source-schema digest identifies reviewed source-column metadata, not the complete current runtime DDL or application behavior.",
      "Retained generations expose only the metadata returned by the installed core; no hidden baseline values are inspected.",
    ],
  };
};
export type EnvironmentComparison = ReturnType<
  typeof compareEnvironmentEvidence
>;
