/** Execution-input provenance stays distinct from static input observation. */
import {
  parseMigrationSourceInput,
  readExactMigrationInput,
} from "./migration_source.js";
export { migrationSourceTextSha256 } from "./migration_source.js";

export interface MigrationFailureSource {
  readonly schemaVersion: 1;
  readonly kind: "baseline" | "candidate";
  readonly filename: string;
  readonly sha256: string;
  readonly workspaceRelativePath: string | null;
  readonly line: null;
  readonly column: null;
  readonly evidence: "owned_execution_input";
}

const invalid = (): never => {
  throw new Error(
    "Migration source evidence is unavailable or no longer exact. Refresh and review the local migration manually.",
  );
};
export const parseMigrationFailureSource = (
  value: unknown,
): MigrationFailureSource => {
  if (!value || typeof value !== "object" || Array.isArray(value))
    return invalid();
  const data = value as Record<string, unknown>;
  if (
    Object.keys(data).sort().join(",") !==
      "column,evidence,filename,kind,line,schemaVersion,sha256,workspaceRelativePath" ||
    data.schemaVersion !== 1 ||
    typeof data.filename !== "string" ||
    data.filename.length > 255 ||
    !/^\d{14}_[a-z0-9_]+\.sql$/u.test(data.filename) ||
    typeof data.kind !== "string" ||
    !["baseline", "candidate"].includes(data.kind) ||
    data.line !== null ||
    data.column !== null ||
    data.evidence !== "owned_execution_input"
  )
    return invalid();
  const input = parseMigrationSourceInput({
    filename: data.filename,
    sha256: data.sha256,
    workspaceRelativePath: data.workspaceRelativePath,
  });
  return {
    schemaVersion: 1,
    kind: data.kind as MigrationFailureSource["kind"],
    ...input,
    line: null,
    column: null,
    evidence: "owned_execution_input",
  };
};

/** Existing failure provenance is validated before using the common byte reader. */
export const readExactMigrationSource = async (
  workspaceRoot: string,
  value: unknown,
): Promise<{
  readonly path: string;
  readonly text: string;
  readonly identity: string;
}> => {
  const source = parseMigrationFailureSource(value);
  return readExactMigrationInput(workspaceRoot, {
    filename: source.filename,
    sha256: source.sha256,
    workspaceRelativePath: source.workspaceRelativePath,
  });
};
