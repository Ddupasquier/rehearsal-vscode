import {
  parseKnexMigrationIdentity,
  type KnexMigrationIdentity,
} from "./knex_migration_contract.js";
/** Public native identities: journal order is never a timestamp-file version. */
import { ContractError } from "./contracts.js";
export interface DrizzleMigrationIdentity {
  readonly kind: "drizzle";
  readonly idx: number;
  readonly when: number;
  readonly tag: string;
}
export type NativeMigrationIdentity =
  DrizzleMigrationIdentity | KnexMigrationIdentity;
export type MigrationCutoff = string | NativeMigrationIdentity;
export interface DrizzleMigrationToolBinding {
  readonly schemaVersion: 1;
  readonly kind: "drizzle";
  readonly kitVersion: "0.31.11";
  readonly ormVersion: "0.45.4";
  readonly driver: "pg";
  readonly driverVersion: "8.23.1";
  readonly journalVersion: "7";
  readonly dialect: "postgresql";
  readonly journalSha256: string;
  readonly toolchainSha256: string;
  readonly ledger: {
    readonly schema: "drizzle";
    readonly table: "__drizzle_migrations";
  };
}
export const parseDrizzleMigrationIdentity = (
  value: unknown,
): DrizzleMigrationIdentity => {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new ContractError("Invalid Drizzle journal identity.");
  const x = value as Record<string, unknown>;
  if (
    Object.keys(x).sort().join(",") !== "idx,kind,tag,when" ||
    x.kind !== "drizzle" ||
    typeof x.idx !== "number" ||
    !Number.isSafeInteger(x.idx) ||
    x.idx < 0 ||
    x.idx >= 10000 ||
    typeof x.when !== "number" ||
    !Number.isSafeInteger(x.when) ||
    x.when <= 0 ||
    typeof x.tag !== "string" ||
    !/^[A-Za-z0-9][A-Za-z0-9_-]{0,190}$/u.test(x.tag)
  )
    throw new ContractError("Invalid Drizzle journal identity.");
  return { kind: "drizzle", idx: x.idx, when: x.when, tag: x.tag };
};
export const parseDrizzleMigrationToolBinding = (
  value: unknown,
): DrizzleMigrationToolBinding => {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new ContractError("Invalid Drizzle tool binding.");
  const x = value as Record<string, unknown>,
    l = x.ledger as Record<string, unknown> | undefined;
  if (
    Object.keys(x).sort().join(",") !==
      "dialect,driver,driverVersion,journalSha256,journalVersion,kind,kitVersion,ledger,ormVersion,schemaVersion,toolchainSha256" ||
    x.schemaVersion !== 1 ||
    x.kind !== "drizzle" ||
    x.kitVersion !== "0.31.11" ||
    x.ormVersion !== "0.45.4" ||
    x.driver !== "pg" ||
    x.driverVersion !== "8.23.1" ||
    x.journalVersion !== "7" ||
    x.dialect !== "postgresql" ||
    typeof x.journalSha256 !== "string" ||
    !/^[a-f0-9]{64}$/u.test(x.journalSha256) ||
    typeof x.toolchainSha256 !== "string" ||
    !/^[a-f0-9]{64}$/u.test(x.toolchainSha256) ||
    !l ||
    typeof l !== "object" ||
    Array.isArray(l) ||
    Object.keys(l).sort().join(",") !== "schema,table" ||
    l.schema !== "drizzle" ||
    l.table !== "__drizzle_migrations"
  )
    throw new ContractError("Unsupported or invalid Drizzle tool binding.");
  return {
    schemaVersion: 1,
    kind: "drizzle",
    kitVersion: "0.31.11",
    ormVersion: "0.45.4",
    driver: "pg",
    driverVersion: "8.23.1",
    journalVersion: "7",
    dialect: "postgresql",
    journalSha256: x.journalSha256,
    toolchainSha256: x.toolchainSha256,
    ledger: { schema: "drizzle", table: "__drizzle_migrations" },
  };
};
export const migrationIdentityKey = (entry: {
  readonly version?: string | undefined;
  readonly nativeIdentity?: NativeMigrationIdentity | undefined;
}): string =>
  entry.nativeIdentity
    ? entry.nativeIdentity.kind === "knex"
      ? `knex:${entry.nativeIdentity.name}`
      : `drizzle:${entry.nativeIdentity.idx}:${entry.nativeIdentity.when}:${entry.nativeIdentity.tag}`
    : (entry.version ?? "");
export const describeMigrationCutoff = (
  value: MigrationCutoff | string | undefined | null,
): string =>
  typeof value === "string"
    ? value
    : value
      ? value.kind === "knex"
        ? `Knex ${value.name}`
        : `Drizzle #${value.idx} (${value.when}, ${value.tag})`
      : "Unavailable";
export const sameDrizzleIdentity = (a: unknown, b: unknown): boolean => {
  try {
    return (
      JSON.stringify(parseDrizzleMigrationIdentity(a)) ===
      JSON.stringify(parseDrizzleMigrationIdentity(b))
    );
  } catch {
    return false;
  }
};

export const parseNativeMigrationIdentity = (
  value: unknown,
): NativeMigrationIdentity =>
  value &&
  typeof value === "object" &&
  (value as { kind?: unknown }).kind === "knex"
    ? parseKnexMigrationIdentity(value)
    : parseDrizzleMigrationIdentity(value);
export const sameNativeMigrationIdentity = (
  a: unknown,
  b: unknown,
): boolean => {
  try {
    return (
      JSON.stringify(parseNativeMigrationIdentity(a)) ===
      JSON.stringify(parseNativeMigrationIdentity(b))
    );
  } catch {
    return false;
  }
};
