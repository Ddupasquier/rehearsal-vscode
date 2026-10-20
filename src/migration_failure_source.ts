/** Validate core's attempted-file provenance and read only those exact local bytes. */
import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { lstat, open, realpath } from "node:fs/promises";
import { isAbsolute, join, relative, sep } from "node:path";

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
    typeof data.kind !== "string" ||
    !["baseline", "candidate"].includes(data.kind) ||
    typeof data.filename !== "string" ||
    data.filename.length > 255 ||
    !/^\d{14}_[a-z0-9_]+\.sql$/u.test(data.filename) ||
    typeof data.sha256 !== "string" ||
    !/^[a-f0-9]{64}$/u.test(data.sha256) ||
    data.line !== null ||
    data.column !== null ||
    data.evidence !== "owned_execution_input"
  )
    return invalid();
  const path = data.workspaceRelativePath;
  if (
    path !== null &&
    (typeof path !== "string" ||
      Buffer.byteLength(path) < 1 ||
      Buffer.byteLength(path) > 1024 ||
      /[\\:%?#\x00-\x1f\x7f-\x9f\u061c\u200e\u200f\u2028\u2029\u202a-\u202e\u2066-\u2069]/u.test(
        path,
      ) ||
      path.split("/").some((part) => !part || part === "." || part === "..") ||
      path.split("/").at(-1) !== data.filename)
  )
    return invalid();
  return {
    schemaVersion: 1,
    kind: data.kind as MigrationFailureSource["kind"],
    filename: data.filename,
    sha256: data.sha256,
    workspaceRelativePath: path as string | null,
    line: null,
    column: null,
    evidence: "owned_execution_input",
  };
};

export const migrationSourceTextSha256 = (text: string): string =>
  createHash("sha256").update(text).digest("hex");

/** No symlink redirects, writes, SQL execution, inferred positions or stale-byte fallback. */
export const readExactMigrationSource = async (
  workspaceRoot: string,
  value: unknown,
): Promise<{
  readonly path: string;
  readonly text: string;
  readonly identity: string;
}> => {
  const source = parseMigrationFailureSource(value);
  if (!source.workspaceRelativePath || !isAbsolute(workspaceRoot))
    return invalid();
  const root = await realpath(workspaceRoot);
  let candidate = root;
  const parts = source.workspaceRelativePath.split("/");
  for (const [index, part] of parts.entries()) {
    candidate = join(candidate, part);
    const stat = await lstat(candidate);
    if (
      stat.isSymbolicLink() ||
      (index === parts.length - 1 ? !stat.isFile() : !stat.isDirectory())
    )
      return invalid();
  }
  const canonical = await realpath(candidate);
  const confined = relative(root, canonical);
  if (
    !confined ||
    confined === ".." ||
    confined.startsWith(`..${sep}`) ||
    isAbsolute(confined) ||
    canonical !== candidate
  )
    return invalid();
  const handle = await open(
    candidate,
    constants.O_RDONLY | constants.O_NONBLOCK | constants.O_NOFOLLOW,
  );
  try {
    const stat = await handle.stat();
    if (!stat.isFile() || stat.size > 2 * 1024 * 1024) return invalid();
    const bytes = Buffer.alloc(stat.size + 1);
    const { bytesRead } = await handle.read(bytes, 0, bytes.length, 0);
    const current = await lstat(candidate);
    if (
      bytesRead !== stat.size ||
      !current.isFile() ||
      current.dev !== stat.dev ||
      current.ino !== stat.ino ||
      current.size !== stat.size ||
      current.mtimeMs !== stat.mtimeMs ||
      current.ctimeMs !== stat.ctimeMs ||
      (await realpath(candidate)) !== canonical ||
      (await realpath(workspaceRoot)) !== root
    )
      return invalid();
    const exact = bytes.subarray(0, bytesRead);
    if (createHash("sha256").update(exact).digest("hex") !== source.sha256)
      return invalid();
    const text = exact.toString("utf8");
    if (!Buffer.from(text).equals(exact)) return invalid();
    return {
      path: canonical,
      text,
      identity: JSON.stringify([root, canonical, stat.dev, stat.ino]),
    };
  } finally {
    await handle.close();
  }
};
