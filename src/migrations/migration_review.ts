import {
  parseKnexMigrationToolBinding,
  matchingKnexReviewedPrefix,
  type KnexMigrationToolBinding,
} from "./knex_migration_contract.js";
import {
  parseDrizzleMigrationToolBinding,
  parseNativeMigrationIdentity,
  migrationIdentityKey,
  sameDrizzleIdentity,
  sameNativeMigrationIdentity,
  type NativeMigrationIdentity,
  type DrizzleMigrationToolBinding,
} from "./native_migration_contract.js";
/** Strict bounded public migration plan; filenames never grant SQL safety. */
import { ContractError } from "../contracts.js";
import {
  isSafeMigrationFilename,
  isSafeNativeMigrationFilename,
} from "./migration_source.js";
export interface PrismaMigrationToolBinding {
  readonly schemaVersion: 1;
  readonly kind: "prisma";
  readonly version: "7.10.1";
  readonly provider: "postgresql";
  readonly lockSha256: string;
  readonly toolchainSha256: string;
}
export const parsePrismaMigrationToolBinding = (
  value: unknown,
): PrismaMigrationToolBinding => {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new ContractError("Invalid native migration tool binding.");
  const input = value as Record<string, unknown>;
  if (
    Object.keys(input).sort().join(",") !==
      "kind,lockSha256,provider,schemaVersion,toolchainSha256,version" ||
    input.schemaVersion !== 1 ||
    input.kind !== "prisma" ||
    input.version !== "7.10.1" ||
    input.provider !== "postgresql" ||
    typeof input.lockSha256 !== "string" ||
    !/^[a-f0-9]{64}$/u.test(input.lockSha256) ||
    typeof input.toolchainSha256 !== "string" ||
    !/^[a-f0-9]{64}$/u.test(input.toolchainSha256)
  )
    throw new ContractError("Invalid native migration tool binding.");
  return {
    schemaVersion: 1,
    kind: "prisma",
    version: "7.10.1",
    provider: "postgresql",
    lockSha256: input.lockSha256,
    toolchainSha256: input.toolchainSha256,
  };
};
export type NativeMigrationToolBinding =
  | PrismaMigrationToolBinding
  | DrizzleMigrationToolBinding
  | KnexMigrationToolBinding;
export const parseNativeMigrationToolBinding = (
  value: unknown,
): NativeMigrationToolBinding =>
  value &&
  typeof value === "object" &&
  (value as { kind?: unknown }).kind === "knex"
    ? parseKnexMigrationToolBinding(value)
    : value &&
        typeof value === "object" &&
        (value as { kind?: unknown }).kind === "drizzle"
      ? parseDrizzleMigrationToolBinding(value)
      : parsePrismaMigrationToolBinding(value);
/** Producer bytes may differ across platforms; history identity must not. */
export const matchingNativeMigrationHistory = (
  baseline: NativeMigrationToolBinding | undefined,
  current: NativeMigrationToolBinding | undefined,
): boolean => {
  if (baseline === undefined || current === undefined)
    return baseline === current;
  if (baseline.kind !== current.kind) return false;
  if (baseline.kind === "knex" && current.kind === "knex")
    return matchingKnexReviewedPrefix(baseline, current);
  if (baseline.kind === "drizzle" && current.kind === "drizzle")
    return (
      baseline.kitVersion === current.kitVersion &&
      baseline.ormVersion === current.ormVersion &&
      baseline.driver === current.driver &&
      baseline.driverVersion === current.driverVersion &&
      baseline.dialect === current.dialect &&
      baseline.journalVersion === current.journalVersion
    );
  return (
    baseline.kind === "prisma" &&
    current.kind === "prisma" &&
    baseline.version === current.version &&
    baseline.provider === current.provider &&
    baseline.lockSha256 === current.lockSha256
  );
};
export interface MigrationReviewEntry {
  readonly id: string;
  readonly target: string;
  readonly version?: string;
  readonly nativeIdentity?: NativeMigrationIdentity;
  readonly name: string;
  readonly filename: string;
  readonly sha256: string;
  readonly order: number;
  readonly timestamp?: string;
  readonly status:
    "candidate" | "represented_by_baseline" | "applied_to_current_runtime";
  readonly required: boolean;
  readonly dependsOn: readonly string[];
  readonly warnings: readonly (
    | "sql_safety_not_inferred"
    | "historical_file_checksums_unavailable"
    | "native_javascript_isolated_execution_required"
  )[];
  readonly selectionReason: string;
}
export interface MigrationReviewPlan {
  readonly schemaVersion: 1;
  readonly candidateSha256: string;
  readonly candidateCount: number;
  readonly selection: "complete-ordered-suffix";
  readonly targets: readonly {
    readonly name: string;
    readonly provider: "supabase" | "postgresql";
    readonly baselineGenerationId: string;
    readonly candidateSha256: string;
    readonly migrationTool?: NativeMigrationToolBinding;
    readonly baselineHistorySha256?: string;
    readonly baselinePrefixVerification?:
      "exact-native-semantic-prefix" | "exact-reviewed-code-prefix";
    readonly entries: readonly MigrationReviewEntry[];
  }[];
}
const record = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Invalid migration review contract.");
  return value as Record<string, unknown>;
};
const text = (value: unknown, maximum = 300): string => {
  if (
    typeof value !== "string" ||
    !value ||
    value.length > maximum ||
    /[\x00-\x1f\x7f]/u.test(value)
  )
    throw new Error("Invalid migration review text.");
  return value;
};
const digest = (value: unknown): string => {
  const v = text(value, 64);
  if (!/^[a-f0-9]{64}$/u.test(v))
    throw new Error("Invalid migration review digest.");
  return v;
};
export const parseMigrationReviewPlan = (
  value: unknown,
): MigrationReviewPlan => {
  const data = record(value);
  const safety = record(data.safety);
  if (
    data.schemaVersion !== 1 ||
    data.selection !== "complete-ordered-suffix" ||
    safety.executesSql !== false ||
    safety.startsEngine !== false ||
    safety.readsSqlBodiesForSafety !== false ||
    !Array.isArray(data.targets) ||
    !data.targets.length ||
    data.targets.length > 32
  )
    throw new Error("Unsafe or unsupported migration review contract.");
  const names = new Set<string>();
  let total = 0;
  let count = 0;
  const targets = data.targets.map((raw) => {
    const target = record(raw);
    const name = text(target.name, 120);
    if (
      names.has(name) ||
      !["postgresql", "supabase"].includes(String(target.provider)) ||
      !Array.isArray(target.entries)
    )
      throw new Error("Invalid migration review target.");
    const migrationTool =
      target.migrationTool === undefined
        ? undefined
        : parseNativeMigrationToolBinding(target.migrationTool);
    if (migrationTool && target.provider !== "postgresql")
      throw new ContractError(
        "Native migration provider does not match its target.",
      );
    if (
      (migrationTool?.kind === "drizzle" || migrationTool?.kind === "knex") &&
      (target.baselinePrefixVerification !==
        (migrationTool.kind === "knex"
          ? "exact-reviewed-code-prefix"
          : "exact-native-semantic-prefix") ||
        typeof target.baselineHistorySha256 !== "string" ||
        !/^[a-f0-9]{64}$/u.test(target.baselineHistorySha256))
    )
      throw new ContractError(
        "Native baseline prefix verification is unavailable.",
      );
    if (
      migrationTool?.kind !== "drizzle" &&
      migrationTool?.kind !== "knex" &&
      (target.baselinePrefixVerification !== undefined ||
        target.baselineHistorySha256 !== undefined)
    )
      throw new ContractError("Unexpected native prefix metadata.");
    const rawEntries = target.entries;
    names.add(name);
    total += rawEntries.length;
    if (total > 10000)
      throw new Error("Migration review exceeds its bounded size.");
    let suffix: "candidate" | "applied_to_current_runtime" | null = null;
    const entries = rawEntries.map((rawEntry, index): MigrationReviewEntry => {
      const entry = record(rawEntry);
      const nativeIdentity =
        migrationTool?.kind === "drizzle" || migrationTool?.kind === "knex"
          ? parseNativeMigrationIdentity(entry.nativeIdentity)
          : undefined;
      const version = nativeIdentity ? undefined : text(entry.version, 14);
      if (
        nativeIdentity
          ? Object.hasOwn(entry, "version") ||
            Object.hasOwn(entry, "timestamp") ||
            nativeIdentity.kind !== migrationTool?.kind ||
            (nativeIdentity.kind === "drizzle" && nativeIdentity.idx !== index)
          : entry.nativeIdentity !== undefined
      )
        throw new ContractError(
          "Migration identity contradicts its tool binding.",
        );
      const identity = { version, nativeIdentity };
      const id = text(entry.id, 400);
      const status = entry.status as MigrationReviewEntry["status"];
      if (
        (!nativeIdentity && !/^\d{14}$/u.test(version!)) ||
        id !== `${name}:${migrationIdentityKey(identity)}` ||
        entry.target !== name ||
        entry.order !== index ||
        (!nativeIdentity && entry.timestamp !== version) ||
        ![
          "candidate",
          "represented_by_baseline",
          "applied_to_current_runtime",
        ].includes(status) ||
        entry.required !== (status === "candidate") ||
        !Array.isArray(entry.dependsOn) ||
        entry.dependsOn.length !== (index ? 1 : 0) ||
        (index &&
          entry.dependsOn[0] !==
            `${name}:${migrationIdentityKey(record(rawEntries[index - 1]) as { version?: string; nativeIdentity?: NativeMigrationIdentity })}`) ||
        !Array.isArray(entry.warnings) ||
        (migrationTool?.kind === "knex"
          ? JSON.stringify(entry.warnings) !==
            JSON.stringify([
              "historical_file_checksums_unavailable",
              "native_javascript_isolated_execution_required",
            ])
          : entry.warnings.some((w) => w !== "sql_safety_not_inferred"))
      )
        throw new Error(
          "Inconsistent migration dependency or safety evidence.",
        );
      if (status === "candidate") count++;
      if (
        (status === "represented_by_baseline" && suffix !== null) ||
        (status !== "represented_by_baseline" &&
          suffix !== null &&
          status !== suffix)
      )
        throw new ContractError(
          "Migration history contradicts the complete ordered suffix.",
        );
      if (status !== "represented_by_baseline") suffix = status;
      const migrationName = text(entry.name);
      const filename = text(entry.filename);
      if (
        (migrationTool?.kind === "knex"
          ? nativeIdentity?.kind !== "knex" ||
            filename !== nativeIdentity.name ||
            migrationName !== nativeIdentity.name ||
            !migrationTool.codeFiles.some(
              (f) => f.filename === filename && f.fileSha256 === entry.sha256,
            )
          : migrationTool?.kind === "drizzle"
            ? filename !==
                `${(nativeIdentity as Extract<NativeMigrationIdentity, { kind: "drizzle" }>).tag}.sql` ||
              migrationName !==
                (
                  nativeIdentity as Extract<
                    NativeMigrationIdentity,
                    { kind: "drizzle" }
                  >
                ).tag
            : migrationTool
              ? !isSafeNativeMigrationFilename(filename) ||
                filename !== `${version}_${migrationName}/migration.sql`
              : !isSafeMigrationFilename(filename) ||
                filename !== `${version}_${migrationName}.sql`) ||
        (migrationTool?.kind !== "knex" &&
          (status === "candidate"
            ? entry.warnings.length !== 1
            : entry.warnings.length !== 0))
      )
        throw new Error(
          "Migration filename or review warnings contradict its history.",
        );
      return {
        id,
        target: name,
        ...(nativeIdentity ? { nativeIdentity } : { version: version! }),
        name: text(entry.name),
        filename: text(entry.filename),
        sha256: digest(entry.sha256),
        order: index,
        ...(!nativeIdentity ? { timestamp: version! } : {}),
        status,
        required: status === "candidate",
        dependsOn: entry.dependsOn as string[],
        warnings: entry.warnings as MigrationReviewEntry["warnings"],
        selectionReason: text(entry.selectionReason, 500),
      };
    });
    if (
      entries.some(
        (e, i) =>
          i > 0 &&
          (e.nativeIdentity
            ? e.nativeIdentity.kind === "knex"
              ? e.filename <= entries[i - 1]!.filename
              : e.nativeIdentity.when <=
                (
                  entries[i - 1]!.nativeIdentity as Extract<
                    NativeMigrationIdentity,
                    { kind: "drizzle" }
                  >
                ).when
            : e.version! <= entries[i - 1]!.version!),
      )
    )
      throw new Error("Migration history is not strictly ordered.");
    return {
      name,
      provider: target.provider as "supabase" | "postgresql",
      baselineGenerationId: text(target.baselineGenerationId),
      candidateSha256: digest(target.candidateSha256),
      ...(migrationTool ? { migrationTool } : {}),
      ...(migrationTool?.kind === "drizzle" || migrationTool?.kind === "knex"
        ? {
            baselineHistorySha256: digest(target.baselineHistorySha256),
            baselinePrefixVerification:
              migrationTool.kind === "knex"
                ? ("exact-reviewed-code-prefix" as const)
                : ("exact-native-semantic-prefix" as const),
          }
        : {}),
      entries,
    };
  });
  if (data.candidateCount !== count)
    throw new Error("Migration review candidate counts disagree.");
  return {
    schemaVersion: 1,
    candidateSha256: digest(data.candidateSha256),
    candidateCount: count,
    selection: "complete-ordered-suffix",
    targets,
  };
};

/** Bind independently read public views before their plan may supply editor controls. */
export const assertMatchingMigrationCandidates = (
  plan: MigrationReviewPlan,
  value: unknown,
): void => {
  const candidates = record(value);
  const mismatch = (): never => {
    throw new ContractError(
      "Migration plan and candidate evidence changed or disagree. Refresh and review the complete set again.",
    );
  };
  const rawTargets = candidates.targets;
  const rawCandidates = candidates.candidates;
  if (!Array.isArray(rawTargets) || !Array.isArray(rawCandidates))
    return mismatch();
  if (
    candidates.candidateSha256 !== plan.candidateSha256 ||
    candidates.candidateCount !== plan.candidateCount ||
    candidates.baselineGenerationId !== plan.targets[0]!.baselineGenerationId ||
    rawTargets.length !== plan.targets.length ||
    rawCandidates.length !== plan.candidateCount
  )
    mismatch();
  const matches = (
    raw: unknown,
    entry: MigrationReviewEntry,
    requireTarget = false,
  ): boolean => {
    if (typeof raw === "string")
      return !entry.nativeIdentity && raw === entry.filename;
    const candidate = record(raw);
    return (
      (entry.nativeIdentity
        ? candidate.version === undefined &&
          sameNativeMigrationIdentity(
            candidate.nativeIdentity,
            entry.nativeIdentity,
          )
        : candidate.nativeIdentity === undefined &&
          candidate.version === entry.version) &&
      candidate.name === entry.name &&
      candidate.filename === entry.filename &&
      candidate.sha256 === entry.sha256 &&
      candidate.status === "candidate" &&
      (candidate.target === undefined
        ? !requireTarget
        : candidate.target === entry.target)
    );
  };
  const expected: MigrationReviewEntry[] = [];
  for (const [index, target] of plan.targets.entries()) {
    const observed = record(rawTargets[index]);
    const entries = target.entries.filter(
      (entry) => entry.status === "candidate",
    );
    if (
      observed.name !== target.name ||
      observed.candidateSha256 !== target.candidateSha256 ||
      observed.candidateCount !== entries.length ||
      (observed.baselineGenerationId !== undefined &&
        observed.baselineGenerationId !== target.baselineGenerationId) ||
      !Array.isArray(observed.candidates) ||
      observed.candidates.length !== entries.length ||
      observed.candidates.some(
        (entry, entryIndex) => !matches(entry, entries[entryIndex]!),
      )
    )
      mismatch();
    expected.push(...entries);
  }
  if (
    rawCandidates.some(
      (entry, index) =>
        !matches(entry, expected[index]!, plan.targets.length > 1),
    )
  )
    mismatch();
};

/** Cross-view assertion, never a replacement for Core's native history verification. */
export const matchingDrizzleBaselineReview = (
  baseline:
    | {
        readonly nativeMigrations?: NativeMigrationToolBinding;
        readonly migrationHistorySha256?: string | null;
        readonly migrationCutoff?: unknown;
        readonly migrationCount: number;
      }
    | null
    | undefined,
  target: MigrationReviewPlan["targets"][number],
): boolean => {
  if (target.migrationTool?.kind !== "drizzle") return true;
  const represented = target.entries.filter(
    (e) => e.status === "represented_by_baseline",
  );
  return (
    !!baseline &&
    baseline.nativeMigrations?.kind === "drizzle" &&
    matchingNativeMigrationHistory(
      baseline.nativeMigrations,
      target.migrationTool,
    ) &&
    target.baselinePrefixVerification === "exact-native-semantic-prefix" &&
    target.baselineHistorySha256 === baseline.migrationHistorySha256 &&
    represented.length === baseline.migrationCount &&
    represented.length > 0 &&
    sameDrizzleIdentity(
      baseline.migrationCutoff,
      represented.at(-1)!.nativeIdentity,
    )
  );
};

export const matchingKnexBaselineReview = (
  baseline:
    | {
        readonly nativeMigrations?: NativeMigrationToolBinding;
        readonly migrationHistorySha256?: string | null;
        readonly migrationCutoff?: unknown;
        readonly migrationCount: number;
        readonly historicalFileChecksums?: "unavailable";
      }
    | null
    | undefined,
  target: MigrationReviewPlan["targets"][number],
): boolean => {
  if (target.migrationTool?.kind !== "knex") return true;
  const represented = target.entries.filter(
    (e) => e.status === "represented_by_baseline",
  );
  return (
    !!baseline &&
    baseline.nativeMigrations?.kind === "knex" &&
    baseline.historicalFileChecksums === "unavailable" &&
    matchingKnexReviewedPrefix(
      baseline.nativeMigrations,
      target.migrationTool,
    ) &&
    target.baselinePrefixVerification === "exact-reviewed-code-prefix" &&
    target.baselineHistorySha256 === baseline.migrationHistorySha256 &&
    represented.length === baseline.migrationCount &&
    represented.length > 0 &&
    sameNativeMigrationIdentity(
      baseline.migrationCutoff,
      represented.at(-1)!.nativeIdentity,
    )
  );
};
