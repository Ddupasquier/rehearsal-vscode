/** Public Knex reviewed-code receipts; never execution or historical checksum attestation. */
import { createHash } from "node:crypto";
import { ContractError } from "../contracts.js";
export interface KnexMigrationIdentity {
  readonly kind: "knex";
  readonly name: string;
}
export interface KnexCodeFile {
  readonly filename: string;
  readonly fileSha256: string;
  readonly bytes: number;
}
export interface KnexMigrationToolBinding {
  readonly schemaVersion: 1;
  readonly kind: "knex";
  readonly version: "3.3.0";
  readonly driver: "pg";
  readonly driverVersion: "8.23.1";
  readonly provider: "postgresql";
  readonly bundleSha256: string;
  readonly toolchainSha256: string;
  readonly isolationPolicySha256: string;
  readonly historicalFileChecksums: "unavailable";
  readonly codeFiles: readonly KnexCodeFile[];
  readonly ledger: {
    readonly schema: "public";
    readonly table: "knex_migrations";
  };
}
const invalid = (): never => {
  throw new ContractError(
    "Unsupported or invalid Knex reviewed-code contract.",
  );
};
export const isSafeKnexMigrationFilename = (value: unknown): value is string =>
  typeof value === "string" &&
  /^[A-Za-z0-9][A-Za-z0-9_-]{0,185}\.cjs$/u.test(value);
export const parseKnexMigrationIdentity = (
  value: unknown,
): KnexMigrationIdentity => {
  if (!value || typeof value !== "object" || Array.isArray(value))
    return invalid();
  const x = value as Record<string, unknown>;
  if (
    Object.keys(x).sort().join(",") !== "kind,name" ||
    x.kind !== "knex" ||
    !isSafeKnexMigrationFilename(x.name)
  )
    return invalid();
  return { kind: "knex", name: x.name };
};
export const parseKnexMigrationToolBinding = (
  value: unknown,
): KnexMigrationToolBinding => {
  if (!value || typeof value !== "object" || Array.isArray(value))
    return invalid();
  const x = value as Record<string, unknown>,
    ledger = x.ledger as Record<string, unknown> | undefined;
  if (
    Object.keys(x).sort().join(",") !==
      "bundleSha256,codeFiles,driver,driverVersion,historicalFileChecksums,isolationPolicySha256,kind,ledger,provider,schemaVersion,toolchainSha256,version" ||
    x.schemaVersion !== 1 ||
    x.kind !== "knex" ||
    x.version !== "3.3.0" ||
    x.driver !== "pg" ||
    x.driverVersion !== "8.23.1" ||
    x.provider !== "postgresql" ||
    x.historicalFileChecksums !== "unavailable" ||
    ![x.bundleSha256, x.toolchainSha256, x.isolationPolicySha256].every(
      (v) => typeof v === "string" && /^[a-f0-9]{64}$/u.test(v),
    ) ||
    !ledger ||
    typeof ledger !== "object" ||
    Array.isArray(ledger) ||
    Object.keys(ledger).sort().join(",") !== "schema,table" ||
    ledger.schema !== "public" ||
    ledger.table !== "knex_migrations" ||
    !Array.isArray(x.codeFiles) ||
    !x.codeFiles.length ||
    x.codeFiles.length > 16000
  )
    return invalid();
  let previous = "",
    total = 0;
  const codeFiles = Array.from(x.codeFiles, (raw: unknown): KnexCodeFile => {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return invalid();
    const f = raw as Record<string, unknown>;
    if (
      Object.keys(f).sort().join(",") !== "bytes,fileSha256,filename" ||
      typeof f.filename !== "string" ||
      f.filename.length > 3072 ||
      f.filename.split("/").length > 17 ||
      (!f.filename.includes("/") && !isSafeKnexMigrationFilename(f.filename)) ||
      f.filename <= previous ||
      f.filename
        .split("/")
        .some(
          (p) =>
            !/^[A-Za-z0-9][A-Za-z0-9_.-]{0,190}$/u.test(p) ||
            ["node_modules", "notes", "package.json"].includes(p),
        ) ||
      typeof f.fileSha256 !== "string" ||
      !/^[a-f0-9]{64}$/u.test(f.fileSha256) ||
      typeof f.bytes !== "number" ||
      !Number.isSafeInteger(f.bytes) ||
      f.bytes < 0 ||
      f.bytes > 8 * 1024 ** 2 ||
      (total += f.bytes) > 64 * 1024 ** 2
    )
      return invalid();
    previous = f.filename;
    return { filename: f.filename, fileSha256: f.fileSha256, bytes: f.bytes };
  });
  if (
    createHash("sha256").update(JSON.stringify(codeFiles)).digest("hex") !==
    x.bundleSha256
  )
    return invalid();
  return {
    schemaVersion: 1,
    kind: "knex",
    version: "3.3.0",
    driver: "pg",
    driverVersion: "8.23.1",
    provider: "postgresql",
    bundleSha256: x.bundleSha256 as string,
    toolchainSha256: x.toolchainSha256 as string,
    isolationPolicySha256: x.isolationPolicySha256 as string,
    historicalFileChecksums: "unavailable",
    codeFiles,
    ledger: { schema: "public", table: "knex_migrations" },
  };
};
/** Baseline code is immutable; current append bundle/platform bytes have separate candidate binding. */
export const matchingKnexReviewedPrefix = (
  baseline: KnexMigrationToolBinding,
  current: KnexMigrationToolBinding,
): boolean => {
  const files = new Map(current.codeFiles.map((f) => [f.filename, f]));
  return (
    baseline.version === current.version &&
    baseline.driver === current.driver &&
    baseline.driverVersion === current.driverVersion &&
    baseline.provider === current.provider &&
    baseline.isolationPolicySha256 === current.isolationPolicySha256 &&
    baseline.codeFiles.every((f) => {
      const actual = files.get(f.filename);
      return actual?.fileSha256 === f.fileSha256 && actual.bytes === f.bytes;
    })
  );
};
