/** One exact project-local input boundary shared by static and execution evidence. */
import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { lstat, open, realpath } from "node:fs/promises";
import { isAbsolute, join, relative, sep } from "node:path";

export interface MigrationSourceInput {
  readonly filename: string;
  readonly sha256: string;
  readonly workspaceRelativePath: string | null;
}
const invalid = (): never => {
  throw new Error(
    "Migration source evidence is unavailable or no longer exact. Refresh and review the local migration manually.",
  );
};
/** Public inventory names may be uppercase/Unicode; they never supply a path. */
export const isSafeDrizzleMigrationFilename = (
  value: unknown,
): value is string =>
  typeof value === "string" &&
  /^[A-Za-z0-9][A-Za-z0-9_-]{0,190}\.sql$/u.test(value);
export const isSafeMigrationFilename = (value: unknown): value is string =>
  typeof value === "string" &&
  Buffer.byteLength(value) <= 255 &&
  /^\d{14}_.+\.sql$/u.test(value) &&
  !/[\\/%:#?\x00-\x1f\x7f-\x9f\u061c\u200e\u200f\u2028\u2029\u202a-\u202e\u2066-\u2069]/u.test(
    value,
  );
/** Prisma's public identity has exactly one ASCII directory and its fixed SQL leaf. */
export const isSafeNativeMigrationFilename = (
  value: unknown,
): value is string =>
  typeof value === "string" &&
  Buffer.byteLength(value) <= 255 &&
  /^\d{14}_[A-Za-z0-9_-]+\/migration\.sql$/u.test(value);
export const parseMigrationSourceInput = (
  value: unknown,
  allowDrizzle = false,
): MigrationSourceInput => {
  if (!value || typeof value !== "object" || Array.isArray(value))
    return invalid();
  const data = value as Record<string, unknown>;
  if (
    Object.keys(data).sort().join(",") !==
      "filename,sha256,workspaceRelativePath" ||
    (!isSafeMigrationFilename(data.filename) &&
      !(allowDrizzle && isSafeDrizzleMigrationFilename(data.filename)) &&
      !isSafeNativeMigrationFilename(data.filename)) ||
    typeof data.sha256 !== "string" ||
    !/^[a-f0-9]{64}$/u.test(data.sha256)
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
      !(path === data.filename || path.endsWith(`/${data.filename}`)))
  )
    return invalid();
  return {
    filename: data.filename,
    sha256: data.sha256,
    workspaceRelativePath: path as string | null,
  };
};
export const migrationSourceTextSha256 = (text: string): string =>
  createHash("sha256").update(text).digest("hex");

/**
 * Compare a clean native model only after exact raw-file verification.
 * VS Code separates one leading BOM and normalizes model line endings. Neither
 * this projection nor document text replaces either raw disk SHA/identity read.
 * Any further BOM removal or actual text change remains a refusal.
 */
export const migrationSourceDocumentMatches = (
  rawText: string,
  documentText: string,
): boolean => {
  const lf = (text: string) => text.replace(/\r\n?|\n/gu, "\n");
  const projected = rawText.startsWith("\ufeff") ? rawText.slice(1) : rawText;
  return lf(projected) === lf(documentText);
};

/** Reads exact bytes only; this establishes no execution, SQL or position claim. */
export const readExactMigrationInput = async (
  workspaceRoot: string,
  value: unknown,
  allowDrizzle = false,
): Promise<{
  readonly path: string;
  readonly text: string;
  readonly identity: string;
}> => {
  const source = parseMigrationSourceInput(value, allowDrizzle);
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
  const canonical = await realpath(candidate),
    confined = relative(root, canonical);
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
