import { ContractError } from "./contracts.js";
import type { BaselineData, ExplainData } from "./contracts.js";

type ObjectValue = Record<string, unknown>;
const object = (value: unknown, label: string): ObjectValue => {
  if (value === null || typeof value !== "object" || Array.isArray(value))
    throw new ContractError(`${label} is not an object.`);
  return value as ObjectValue;
};
const enumValue = <Value extends string>(
  value: unknown,
  choices: readonly Value[],
  label: string,
): Value => {
  if (typeof value !== "string" || !choices.includes(value as Value))
    throw new ContractError(`${label} is unsupported.`);
  return value as Value;
};
const count = (value: unknown, label: string): number => {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0)
    throw new ContractError(`${label} is not a nonnegative safe integer.`);
  return value;
};
const boolean = (value: unknown, label: string): boolean => {
  if (typeof value !== "boolean")
    throw new ContractError(`${label} is not a boolean.`);
  return value;
};
const nullableBoolean = (value: unknown, label: string): boolean | null =>
  value === null ? null : boolean(value, label);
const list = (value: unknown, maximum: number, label: string): unknown[] => {
  if (!Array.isArray(value) || value.length > maximum)
    throw new ContractError(`${label} exceeds its bounded array contract.`);
  return value;
};
const identifier = (value: unknown, label: string): string => {
  if (typeof value !== "string" || !/^[a-z][a-z0-9_]{0,62}$/u.test(value))
    throw new ContractError(`${label} is not a PostgreSQL identifier.`);
  return value;
};
const digest = (value: unknown, label: string): string => {
  if (typeof value !== "string" || !/^[a-f0-9]{64}$/u.test(value))
    throw new ContractError(`${label} is not a SHA-256 digest.`);
  return value;
};
const noDisclosure = (
  value: unknown,
  keys: readonly string[],
  label: string,
) => {
  const input = object(value, label);
  for (const key of keys)
    if (input[key] !== false)
      throw new ContractError(
        `${label} reports an unsafe disclosure or side effect.`,
      );
};

export const parseBaselineScopeReview = (value: unknown) => {
  const input = object(value, "Baseline scope review");
  if (input.schemaVersion !== 1)
    throw new ContractError("Baseline scope review schema is unsupported.");
  noDisclosure(
    input.privacy,
    ["rowValuesIncluded", "credentialsIncluded", "sourceContacted"],
    "Baseline scope privacy",
  );
  const policy = object(input.policy, "Baseline policy");
  if (policy.version !== 1 && policy.version !== 2)
    throw new ContractError("Baseline policy version is unsupported.");
  const seen = new Set<string>();
  const tables = list(input.tables, 10_000, "Baseline tables").map((value) => {
    const table = object(value, "Baseline table");
    const schema = identifier(table.schema, "Table schema");
    const name = identifier(table.name, "Table name");
    const key = `${schema}.${name}`;
    if (seen.has(key)) throw new ContractError("Baseline table is duplicated.");
    seen.add(key);
    const transformations = object(table.transformations, "Transformations");
    const result = {
      schema,
      name,
      included: boolean(table.included, "Table included"),
      rowCount: count(table.rowCount, "Table rows"),
      columnCount: count(table.columnCount, "Table columns"),
      relationshipCount: count(table.relationshipCount, "Table relationships"),
      identityColumnCount: count(table.identityColumnCount, "Identity columns"),
      transformations: {
        KEEP: count(transformations.KEEP, "Kept columns"),
        PSEUDONYMIZE: count(
          transformations.PSEUDONYMIZE,
          "Pseudonymous columns",
        ),
        REPLACE: count(transformations.REPLACE, "Replaced columns"),
        EXCLUDE: count(transformations.EXCLUDE, "Excluded columns"),
        DERIVE: count(transformations.DERIVE, "Derived columns"),
      },
    };
    if (
      Object.values(result.transformations).reduce(
        (total, entry) => total + entry,
        0,
      ) !== result.columnCount ||
      result.relationshipCount > result.columnCount ||
      result.identityColumnCount > result.columnCount ||
      (!result.included && result.rowCount !== 0)
    )
      throw new ContractError(
        "Baseline table aggregates contradict its policy.",
      );
    return result;
  });
  const relationships = object(input.relationships, "Relationship review");
  const storage = object(input.storage, "Storage review");
  const bucketNames = new Set<string>();
  const buckets = list(storage.buckets, 10_000, "Storage buckets").map(
    (value) => {
      const bucket = object(value, "Storage bucket");
      if (
        typeof bucket.name !== "string" ||
        !/^[a-z0-9][a-z0-9.-]{0,99}$/u.test(bucket.name) ||
        bucketNames.has(bucket.name)
      )
        throw new ContractError("Storage bucket is invalid or duplicated.");
      bucketNames.add(bucket.name);
      return {
        name: bucket.name,
        assetCount: count(bucket.assetCount, "Bucket assets"),
        bytes: count(bucket.bytes, "Bucket bytes"),
      };
    },
  );
  const assetCount = count(storage.assetCount, "Storage assets");
  const bytes = count(storage.bytes, "Storage bytes");
  if (
    buckets.reduce((total, bucket) => total + bucket.assetCount, 0) !==
      assetCount ||
    buckets.reduce((total, bucket) => total + bucket.bytes, 0) !== bytes
  )
    throw new ContractError("Storage aggregates contradict bucket evidence.");
  const declaredCount = count(
    relationships.declaredCount,
    "Declared relationships",
  );
  const excludedReferenceCount = count(
    relationships.excludedReferenceCount,
    "Excluded references",
  );
  if (
    declaredCount !==
      tables.reduce((total, table) => total + table.relationshipCount, 0) ||
    excludedReferenceCount > declaredCount
  )
    throw new ContractError(
      "Relationship aggregates contradict table evidence.",
    );
  const decisions = object(input.decisions, "Scope decisions");
  return {
    schemaVersion: 1 as const,
    provider: enumValue(
      input.provider,
      ["postgresql", "supabase"],
      "Scope provider",
    ),
    policy: {
      version: policy.version as 1 | 2,
      sha256: digest(policy.sha256, "Policy hash"),
      state: enumValue(policy.state, ["baseline-bound"], "Policy state"),
    },
    tables,
    relationships: {
      declaredCount,
      excludedReferenceCount,
      verification: enumValue(
        relationships.verification,
        ["declared-not-runtime-verified"],
        "Relationship verification",
      ),
    },
    storage: { assetCount, bytes, buckets },
    decisions: {
      sourcePermission: enumValue(
        decisions.sourcePermission,
        ["configured-not-contacted", "local-inputs-only"],
        "Source permission",
      ),
      identityHandling: enumValue(
        decisions.identityHandling,
        ["reviewed-policy-configured", "no-association-policy"],
        "Identity handling",
      ),
      replacement: enumValue(
        decisions.replacement,
        ["separate-core-confirmation"],
        "Baseline replacement",
      ),
    },
    privacy: {
      rowValuesIncluded: false as const,
      credentialsIncluded: false as const,
      sourceContacted: false as const,
    },
  };
};
export type BaselineScopeReview = ReturnType<typeof parseBaselineScopeReview>;

export const parseAuthenticationReview = (value: unknown) => {
  const input = object(value, "Authentication review");
  if (input.schemaVersion !== 1)
    throw new ContractError("Authentication review schema is unsupported.");
  noDisclosure(
    input.privacy,
    ["credentialsIncluded", "environmentFilesRead", "authenticationAttempted"],
    "Authentication privacy",
  );
  const target = enumValue(
    input.target,
    ["postgresql", "supabase"],
    "Authentication target",
  );
  const names = new Set<string>();
  const providers = list(input.providers, 100, "Providers").map((value) => {
    const provider = object(value, "Provider");
    if (
      typeof provider.name !== "string" ||
      !/^[a-z][a-z0-9_-]{0,62}$/u.test(provider.name) ||
      names.has(provider.name)
    )
      throw new ContractError("Provider name is invalid or duplicated.");
    names.add(provider.name);
    const source = enumValue(
      provider.source,
      ["declarative", "template", "unavailable"],
      "Provider source",
    );
    const enabled = nullableBoolean(provider.enabled, "Provider enabled");
    if (
      (source === "declarative" && enabled !== true) ||
      (source === "unavailable" && enabled !== null) ||
      (source === "template" && enabled === null)
    )
      throw new ContractError("Provider state contradicts its evidence.");
    const supported = boolean(provider.supported, "Provider supported");
    if (supported !== ["email", "google", "github"].includes(provider.name))
      throw new ContractError(
        "Provider support contradicts the reviewed support boundary.",
      );
    return { name: provider.name, enabled, source, supported };
  });
  if (target === "postgresql" && providers.length)
    throw new ContractError(
      "PostgreSQL does not expose a native Auth provider.",
    );
  let callback: string | null = null;
  if (input.callback !== null) {
    if (typeof input.callback !== "string" || input.callback.length > 2048)
      throw new ContractError("Auth callback is invalid.");
    let url: URL;
    try {
      url = new URL(input.callback);
    } catch {
      throw new ContractError("Auth callback is invalid.");
    }
    if (
      url.protocol !== "http:" ||
      !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) ||
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      url.pathname !== "/auth/v1/callback" ||
      target !== "supabase"
    )
      throw new ContractError("Auth callback must be a local public callback.");
    callback = url.href;
  }
  const mfa = object(input.mfa, "MFA review");
  return {
    schemaVersion: 1 as const,
    target,
    providers,
    callback,
    identityAssociation: enumValue(
      input.identityAssociation,
      ["reviewed-policy-configured", "not-configured"],
      "Identity association",
    ),
    mfa: {
      totpEnrollment: nullableBoolean(mfa.totpEnrollment, "TOTP enrollment"),
      totpVerification: nullableBoolean(
        mfa.totpVerification,
        "TOTP verification",
      ),
      enforcement: enumValue(
        mfa.enforcement,
        ["application-owned-not-verified"],
        "MFA enforcement",
      ),
    },
    verification: enumValue(
      input.verification,
      ["configuration-only"],
      "Authentication verification",
    ),
    privacy: {
      credentialsIncluded: false as const,
      environmentFilesRead: false as const,
      authenticationAttempted: false as const,
    },
  };
};
export type AuthenticationReview = ReturnType<typeof parseAuthenticationReview>;

const metadataText = (value: unknown, label: string, maximum = 128): string => {
  if (
    typeof value !== "string" ||
    !/^[A-Za-z0-9_. -]+$/u.test(value) ||
    value.length > maximum
  )
    throw new ContractError(`${label} is not bounded public metadata.`);
  return value;
};
const createdAt = (value: unknown): string | null => {
  if (value === null) return null;
  if (
    typeof value !== "string" ||
    !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,3})?Z$/u.test(value) ||
    !Number.isFinite(Date.parse(value))
  )
    throw new ContractError("Baseline creation time is invalid.");
  return value;
};
const cutoff = (value: unknown): string => {
  if (typeof value !== "string" || !/^\d{14}$/u.test(value))
    throw new ContractError("Baseline migration boundary is invalid.");
  return value;
};
const formatVersion = (value: unknown): 1 | 2 => {
  if (value !== 1 && value !== 2)
    throw new ContractError("Baseline format is unsupported.");
  return value;
};
export const parseBaselineInspectionData = (value: unknown): BaselineData => {
  const input = object(value, "Baseline inspection");
  const review =
    input.review === undefined
      ? undefined
      : parseBaselineScopeReview(input.review);
  const result: BaselineData = {
    generationId: metadataText(input.generationId, "Baseline generation"),
    createdAt: createdAt(input.createdAt),
    migrationCutoff: cutoff(input.migrationCutoff),
    rowCount: count(input.rowCount, "Baseline rows"),
    tableCount: count(input.tableCount, "Baseline tables"),
    migrationCount: count(input.migrationCount, "Baseline migrations"),
    verification: enumValue(
      input.verification,
      ["checksums_verified"],
      "Baseline verification",
    ),
    ...(input.formatVersion !== undefined
      ? { formatVersion: formatVersion(input.formatVersion) }
      : {}),
    ...(input.migrationHistorySha256 !== undefined
      ? {
          migrationHistorySha256:
            input.migrationHistorySha256 === null
              ? null
              : digest(input.migrationHistorySha256, "Migration history hash"),
        }
      : {}),
    ...(input.sourceSchemaSha256 !== undefined
      ? {
          sourceSchemaSha256:
            input.sourceSchemaSha256 === null
              ? null
              : digest(input.sourceSchemaSha256, "Source schema hash"),
        }
      : {}),
    ...(input.sanitizationPolicySha256 !== undefined
      ? {
          sanitizationPolicySha256: digest(
            input.sanitizationPolicySha256,
            "Sanitization policy hash",
          ),
        }
      : {}),
    ...(input.dataSha256 !== undefined
      ? { dataSha256: digest(input.dataSha256, "Baseline data hash") }
      : {}),
    ...(review !== undefined ? { review } : {}),
    ...(input.shape !== undefined ? { shape: input.shape } : {}),
    ...(input.generations !== undefined
      ? {
          generations: list(
            input.generations,
            1000,
            "Baseline generations",
          ).map((value) => {
            const generation = object(value, "Retained baseline");
            return {
              generationId: metadataText(
                generation.generationId,
                "Retained generation",
              ),
              createdAt: createdAt(generation.createdAt),
              active: boolean(generation.active, "Active generation"),
              formatVersion: formatVersion(generation.formatVersion),
              rowCount: count(generation.rowCount, "Retained rows"),
              tableCount: count(generation.tableCount, "Retained tables"),
              migrationCount: count(
                generation.migrationCount,
                "Retained migrations",
              ),
              migrationCutoff: cutoff(generation.migrationCutoff),
              storageAssetCount: count(
                generation.storageAssetCount,
                "Retained Storage assets",
              ),
            };
          }),
        }
      : {}),
  };
  const ids = new Set(
    result.generations?.map((generation) => generation.generationId),
  );
  if (
    result.generations &&
    (ids.size !== result.generations.length ||
      result.generations.filter((generation) => generation.active).length !==
        1 ||
      result.generations.find((generation) => generation.active)
        ?.generationId !== result.generationId)
  )
    throw new ContractError(
      "Retained generation identities contradict the active baseline.",
    );
  if (review !== undefined) {
    if (
      review.policy.sha256 !== result.sanitizationPolicySha256 ||
      review.tables
        .filter((table) => table.included)
        .reduce((total, table) => total + table.rowCount, 0) !== result.rowCount
    )
      throw new ContractError(
        "Scope policy or rows contradict the active baseline.",
      );
  }
  return result;
};

export const parseReviewTargets = (data: ExplainData) => {
  const entries = data.targets ?? [{ name: "primary", plan: data }];
  if (!Array.isArray(entries) || entries.length < 1 || entries.length > 32)
    throw new ContractError("Target review exceeds its bounded contract.");
  const names = new Set<string>();
  return entries.map(({ name, plan }) => {
    const label = metadataText(name, "Reviewed target");
    if (names.has(label))
      throw new ContractError("Reviewed target is duplicated.");
    names.add(label);
    const provider = enumValue(
      plan.environment.target,
      ["supabase", "postgresql"],
      "Reviewed provider",
    );
    const baseline = plan.baseline
      ? parseBaselineInspectionData(plan.baseline)
      : null;
    const review =
      plan.baselineReview === undefined
        ? null
        : parseBaselineScopeReview(plan.baselineReview);
    if (
      review &&
      baseline &&
      review.policy.sha256 !== baseline.sanitizationPolicySha256
    )
      throw new ContractError(
        "Target policy identity contradicts its baseline.",
      );
    return {
      name: label,
      provider,
      configurationSha256:
        plan.config.sha256 === undefined
          ? null
          : digest(plan.config.sha256, "Reviewed config hash"),
      baseline: baseline
        ? {
            generationId: baseline.generationId,
            formatVersion: baseline.formatVersion ?? null,
            migrationCutoff: baseline.migrationCutoff,
            migrationHistorySha256: baseline.migrationHistorySha256 ?? null,
            sourceSchemaSha256: baseline.sourceSchemaSha256 ?? null,
            sanitizationPolicySha256: baseline.sanitizationPolicySha256 ?? null,
            dataSha256: baseline.dataSha256 ?? null,
            rowCount: baseline.rowCount,
            tableCount: baseline.tableCount,
            migrationCount: baseline.migrationCount,
            storageAssetCount: review?.storage.assetCount ?? null,
            storageBytes: review?.storage.bytes ?? null,
          }
        : null,
    };
  });
};
