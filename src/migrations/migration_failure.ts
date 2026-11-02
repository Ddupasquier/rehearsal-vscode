/** Public fixed diagnosis contract; classification and SQL analysis remain core-owned. */
import { ContractError } from "../contracts.js";
import {
  parseMigrationFailureSource,
  type MigrationFailureSource,
} from "./migration_failure_source.js";

export interface MigrationFailureDiagnostic {
  readonly schemaVersion: 1;
  readonly provider: "postgresql" | "supabase";
  readonly classification:
    | "syntax"
    | "schema"
    | "constraint"
    | "permission"
    | "connectivity"
    | "timeout_or_cancel"
    | "unknown";
  readonly sqlState: string | null;
  readonly evidence: "provider_sqlstate" | "unavailable" | "ambiguous";
  readonly summary: string;
  readonly suggestions: readonly string[];
  readonly source?: MigrationFailureSource;
}
const explanations: Readonly<
  Record<
    string,
    readonly [MigrationFailureDiagnostic["classification"], string, string]
  >
> = {
  "42601": [
    "syntax",
    "The database reported a SQL syntax error.",
    "Review the candidate SQL for missing keywords, punctuation or malformed statements; then review the new exact plan before retrying.",
  ],
  "23502": [
    "constraint",
    "Rows do not satisfy a NOT NULL requirement.",
    "Review existing NULL values and any new writes. Backfill or transform incompatible rows before enforcing NOT NULL.",
  ],
  "23503": [
    "constraint",
    "Rows do not satisfy a foreign-key constraint.",
    "Review missing referenced rows and migration ordering before enforcing the foreign key.",
  ],
  "23505": [
    "constraint",
    "Rows do not satisfy a uniqueness requirement.",
    "Review duplicate values and choose a data-preserving resolution before adding the unique constraint or index.",
  ],
  "23514": [
    "constraint",
    "Rows do not satisfy a CHECK constraint.",
    "Existing rows may not satisfy the new constraint. Review and backfill incompatible rows before enforcing it; also check values written by the migration.",
  ],
  "23P01": [
    "constraint",
    "Rows conflict with an exclusion constraint.",
    "Review overlapping or conflicting values before enforcing the exclusion constraint.",
  ],
  "42P01": [
    "schema",
    "The migration references a table that is unavailable in this schema.",
    "Review table names, schema qualification and migration ordering; this is not a confirmed syntax error.",
  ],
  "42703": [
    "schema",
    "The migration references a column that is unavailable in this schema.",
    "Review column names and migration ordering; this is not a confirmed syntax error.",
  ],
  "42704": [
    "schema",
    "The migration references a database object that is unavailable.",
    "Review object names, schema qualification and migration ordering.",
  ],
  "42804": [
    "schema",
    "The migration uses incompatible data types.",
    "Review the column types and any required explicit, data-preserving conversion.",
  ],
  "42P07": [
    "schema",
    "The migration attempts to create a table that already exists.",
    "Review baseline history and candidate ordering instead of deleting migration history.",
  ],
  "42701": [
    "schema",
    "The migration attempts to create a column that already exists.",
    "Review baseline history and candidate ordering instead of deleting migration history.",
  ],
  "42501": [
    "permission",
    "The database denied permission for a migration operation.",
    "Review the intended local role and required privileges; do not switch to hosted credentials or bypass permissions.",
  ],
  "28P01": [
    "permission",
    "The database rejected authentication.",
    "Review the disposable local runtime credentials without printing or sharing them.",
  ],
  "57014": [
    "timeout_or_cancel",
    "The database reported a cancelled statement, possibly from a timeout.",
    "Review statement timeout and cancellation evidence. No automatic retry or successful rollback is implied.",
  ],
};
const finalSuggestion =
  "No automatic SQL change or retry was performed. The failure itself does not prove rollback or cleanup; inspect runtime status before retrying.";

export const parseMigrationFailureDiagnostic = (
  value: unknown,
): MigrationFailureDiagnostic => {
  const invalid = (): never => {
    throw new ContractError(
      "Migration failure diagnosis is not the supported fixed safe contract.",
    );
  };
  if (!value || typeof value !== "object" || Array.isArray(value))
    return invalid();
  const data = value as Record<string, unknown>;
  if (
    Object.keys(data)
      .filter((key) => key !== "source")
      .sort()
      .join("\0") !==
      [
        "schemaVersion",
        "provider",
        "classification",
        "sqlState",
        "evidence",
        "summary",
        "suggestions",
      ]
        .sort()
        .join("\0") ||
    data.schemaVersion !== 1 ||
    typeof data.provider !== "string" ||
    !["postgresql", "supabase"].includes(String(data.provider)) ||
    (data.sqlState !== null &&
      (typeof data.sqlState !== "string" ||
        !/^[0-9A-Z]{5}$/u.test(data.sqlState) ||
        /^(?:00|01|02)/u.test(data.sqlState)))
  )
    return invalid();
  const sqlState = data.sqlState as string | null;
  const explanation = sqlState === null ? undefined : explanations[sqlState];
  const connectivity = sqlState?.startsWith("08");
  const classification =
    explanation?.[0] ?? (connectivity ? "connectivity" : "unknown");
  const summary =
    explanation?.[1] ??
    (connectivity
      ? "The database reported a connection failure."
      : "The failure could not be classified from recognized provider SQLSTATE evidence. It is not a confirmed syntax error.");
  const suggestions = [
    explanation?.[2] ??
      (connectivity
        ? "Check the disposable local database connection and runtime status before retrying."
        : "Review the exact candidate locally and its database requirements. Do not assume syntax, data or permissions are the cause."),
    finalSuggestion,
  ];
  if (
    data.classification !== classification ||
    data.summary !== summary ||
    (sqlState === null
      ? typeof data.evidence !== "string" ||
        !["unavailable", "ambiguous"].includes(data.evidence)
      : data.evidence !== "provider_sqlstate") ||
    !Array.isArray(data.suggestions) ||
    data.suggestions.length !== suggestions.length ||
    !suggestions.every(
      (suggestion, index) =>
        data.suggestions instanceof Array &&
        data.suggestions[index] === suggestion,
    )
  )
    return invalid();
  let source: MigrationFailureSource | undefined;
  if (Object.hasOwn(data, "source")) {
    try {
      source = parseMigrationFailureSource(data.source);
    } catch {
      return invalid();
    }
  }
  return {
    schemaVersion: 1,
    provider: data.provider as MigrationFailureDiagnostic["provider"],
    classification,
    sqlState,
    evidence: data.evidence as MigrationFailureDiagnostic["evidence"],
    summary,
    suggestions,
    ...(source === undefined ? {} : { source }),
  };
};
