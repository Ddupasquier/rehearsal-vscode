/** Closed, target-scoped database capabilities. A package flag alone grants no operation. */
import { ContractError } from "../../contracts.js";

export const DATABASE_FEATURES = [
  "snapshot",
  "restore",
  "schema",
  "migrations",
  "privacy",
  "applicationConnection",
  "recovery",
  "persistence",
  "cleanup",
  "transactionalDdl",
  "auth",
  "storage",
] as const;

export type DatabaseFeature = (typeof DATABASE_FEATURES)[number];
export type DatabaseFeatureState =
  "supported" | "unsupported" | "unknown" | "not-applicable";
export type DatabaseFeatureReason =
  | "qualified"
  | "feature_unsupported"
  | "qualification_missing"
  | "not_applicable"
  | "version_unqualified"
  | "backend_unavailable"
  | "observation_missing"
  | "ownership_unproven"
  | "consent_stale"
  | "resource_insufficient";

export interface DatabaseCapabilities {
  readonly schemaVersion: 1;
  readonly target: string;
  readonly engine: {
    readonly family: "sqlite" | "postgresql";
    readonly service: "sqlite" | "postgresql" | "supabase";
    readonly version: string | null;
  };
  readonly backend: "native" | "container";
  readonly availability: "available" | "unavailable" | "unknown";
  readonly assurance: "inspection" | "partial" | "full";
  readonly capabilities: Readonly<
    Record<
      DatabaseFeature,
      {
        readonly state: DatabaseFeatureState;
        readonly reason: DatabaseFeatureReason;
        readonly scope: string;
      }
    >
  >;
}

const object = (value: unknown, label: string): Record<string, unknown> => {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new ContractError(`${label} is not an object.`);
  return value as Record<string, unknown>;
};
const keys = (
  value: Record<string, unknown>,
  expected: readonly string[],
  label: string,
) => {
  if (
    Object.keys(value).length !== expected.length ||
    expected.some((key) => !Object.hasOwn(value, key))
  )
    throw new ContractError(`${label} does not match its closed schema.`);
};
const choice = <Value extends string>(
  value: unknown,
  expected: readonly Value[],
  label: string,
): Value => {
  if (typeof value !== "string" || !expected.includes(value as Value))
    throw new ContractError(`${label} is unsupported.`);
  return value as Value;
};

export const parseDatabaseCapabilities = (
  value: unknown,
): DatabaseCapabilities => {
  const input = object(value, "Database capabilities");
  keys(
    input,
    [
      "schemaVersion",
      "target",
      "engine",
      "backend",
      "availability",
      "assurance",
      "capabilities",
    ],
    "Database capabilities",
  );
  if (input.schemaVersion !== 1)
    throw new ContractError("Database capability schema is unsupported.");
  if (
    typeof input.target !== "string" ||
    !/^[A-Za-z0-9_-]{1,120}$/u.test(input.target)
  )
    throw new ContractError("Database capability target is invalid.");
  const engine = object(input.engine, "Database capability engine");
  keys(engine, ["family", "service", "version"], "Database capability engine");
  const family = choice(
    engine.family,
    ["sqlite", "postgresql"],
    "Database family",
  );
  const service = choice(
    engine.service,
    ["sqlite", "postgresql", "supabase"],
    "Database service",
  );
  const backend = choice(
    input.backend,
    ["native", "container"],
    "Database backend",
  );
  if (
    (family === "sqlite") !== (service === "sqlite") ||
    (family === "sqlite") !== (backend === "native")
  )
    throw new ContractError("Database family, service and backend disagree.");
  if (
    engine.version !== null &&
    (typeof engine.version !== "string" ||
      !/^\d{1,3}(?:\.\d{1,3}){1,3}$/u.test(engine.version))
  )
    throw new ContractError("Database engine version is invalid.");
  const rawFeatures = object(
    input.capabilities,
    "Database feature capabilities",
  );
  keys(rawFeatures, DATABASE_FEATURES, "Database feature capabilities");
  const capabilities = Object.fromEntries(
    DATABASE_FEATURES.map((name) => {
      const feature = object(rawFeatures[name], "Database feature capability");
      keys(
        feature,
        ["state", "reason", "scope"],
        "Database feature capability",
      );
      const state = choice(
        feature.state,
        ["supported", "unsupported", "unknown", "not-applicable"],
        "Database feature state",
      );
      const reason = choice(
        feature.reason,
        [
          "qualified",
          "feature_unsupported",
          "qualification_missing",
          "not_applicable",
          "version_unqualified",
          "backend_unavailable",
          "observation_missing",
          "ownership_unproven",
          "consent_stale",
          "resource_insufficient",
        ],
        "Database feature reason",
      );
      if (
        (state === "supported") !== (reason === "qualified") ||
        (state === "not-applicable") !== (reason === "not_applicable") ||
        (state === "unknown" && reason === "feature_unsupported") ||
        typeof feature.scope !== "string" ||
        !/^[A-Za-z0-9][A-Za-z0-9_.:/ -]{0,127}$/u.test(feature.scope)
      )
        throw new ContractError("Database feature evidence is contradictory.");
      if (
        family === "sqlite" &&
        (name === "auth" || name === "storage") &&
        state !== "not-applicable"
      )
        throw new ContractError(
          "SQLite cannot advertise native Auth or Storage.",
        );
      return [name, { state, reason, scope: feature.scope }];
    }),
  ) as unknown as DatabaseCapabilities["capabilities"];
  return {
    schemaVersion: 1,
    target: input.target,
    engine: { family, service, version: engine.version as string | null },
    backend,
    availability: choice(
      input.availability,
      ["available", "unavailable", "unknown"],
      "Database availability",
    ),
    assurance: choice(
      input.assurance,
      ["inspection", "partial", "full"],
      "Database assurance",
    ),
    capabilities,
  };
};

export const supportsDatabaseFeature = (
  report: DatabaseCapabilities | undefined,
  feature: DatabaseFeature,
): boolean => report?.capabilities[feature].state === "supported";
