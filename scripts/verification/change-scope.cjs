/** Select the prose-only verification lane; uncertain changes always use full checks. */
const { execFileSync } = require("node:child_process");
const { appendFileSync } = require("node:fs");

const rootDocuments = new Set([
  "README.md",
  "BENCHMARKS.md",
  "CHANGELOG.md",
  "CODE_OF_CONDUCT.md",
  "COMPATIBILITY.md",
  "CONTRIBUTING.md",
  "PRIVACY.md",
  "SECURITY.md",
  "SUPPORT.md",
]);
const full = (reason) => ({ docsOnly: false, reason });
const commit = (value) =>
  typeof value === "string" &&
  /^[a-f0-9]{40}$/u.test(value) &&
  !/^0+$/u.test(value);

const isDocumentationPath = (path) => {
  if (typeof path !== "string" || /[\u0000-\u001f\u007f\\]/u.test(path))
    return false;
  const parts = path.split("/");
  if (
    parts.some(
      (part) => !part || part === "." || part === ".." || part === "notes",
    ) ||
    (parts[0] === "docs" && parts[1] === "workspace")
  )
    return false;
  return (
    rootDocuments.has(path) ||
    (parts[0] === "docs" && parts.length > 1 && path.endsWith(".md"))
  );
};

function classifyChanges(diff) {
  if (typeof diff !== "string" || !diff.endsWith("\0"))
    return full("empty or malformed change inventory");
  const fields = diff.slice(0, -1).split("\0");
  if (!fields.length || fields.length % 2 !== 0)
    return full("incomplete change inventory");
  for (let index = 0; index < fields.length; index += 2) {
    // Raw metadata also excludes added symlinks, executable files and submodules.
    const metadata =
      /^:(000000|100644) 100644 ([a-f0-9]{40}) ([a-f0-9]{40}) ([AM])$/u.exec(
        fields[index],
      );
    if (!metadata || !commit(metadata[3]))
      return full("non-regular, non-additive or unknown change status");
    const [, previousMode, previousHash, , status] = metadata;
    if (
      status === "A"
        ? previousMode !== "000000" || !/^0+$/u.test(previousHash)
        : previousMode !== "100644" || !commit(previousHash)
    )
      return full("inconsistent change metadata");
    if (!isDocumentationPath(fields[index + 1]))
      return full("changes outside the prose allowlist");
  }
  return { docsOnly: true, reason: "only added or modified public Markdown" };
}

const readChanges = (base, head) =>
  execFileSync(
    "git",
    [
      "-c",
      "core.fsmonitor=false",
      "diff",
      "--no-ext-diff",
      "--no-textconv",
      "--raw",
      "--no-abbrev",
      "--find-renames",
      "-z",
      base,
      head,
      "--",
    ],
    {
      encoding: "utf8",
      maxBuffer: 1024 * 1024,
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, GIT_OPTIONAL_LOCKS: "0" },
    },
  );

function verificationScope(environment, readDiff = readChanges) {
  if (!["pull_request", "push"].includes(environment.REHEARSAL_VERIFY_EVENT))
    return full("manual, release or unknown event");
  const base = environment.REHEARSAL_VERIFY_BASE;
  const head = environment.REHEARSAL_VERIFY_HEAD;
  if (!commit(base) || !commit(head) || base === head)
    return full("missing or uncertain comparison commits");
  try {
    return classifyChanges(readDiff(base, head));
  } catch {
    return full("change inventory unavailable");
  }
}

module.exports = { classifyChanges, isDocumentationPath, verificationScope };

if (require.main === module) {
  const scope = verificationScope(process.env);
  // A failed output write fails the job; it must never select an empty fast lane.
  if (process.env.GITHUB_OUTPUT)
    appendFileSync(process.env.GITHUB_OUTPUT, `docs_only=${scope.docsOnly}\n`);
  console.log(
    JSON.stringify({
      verification: scope.docsOnly ? "docs" : "full",
      ...scope,
    }),
  );
}
