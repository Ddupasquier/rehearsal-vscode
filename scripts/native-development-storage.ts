/** Explicit developer-owned storage; no checkout-sibling or system-temp fallback. */
import assert from "node:assert/strict";
import { lstat, mkdir, mkdtemp, realpath } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, sep } from "node:path";
import { storageEnvironment } from "../src/platform_runtime.js";

const within = (root: string, path: string) => {
  const part = relative(root, path);
  return (
    part !== "" &&
    part !== ".." &&
    !part.startsWith(`..${sep}`) &&
    !isAbsolute(part)
  );
};

/** Check before evidence/profile allocation; caller supplies a mounted approved root. */
export async function nativeStorageRoot(
  environment: NodeJS.ProcessEnv = process.env,
) {
  const approved = environment.REHEARSAL_DEVELOPMENT_ROOT;
  const selected = environment.REHEARSAL_EDITOR_TEST_ROOT;
  assert.ok(
    approved && selected && isAbsolute(approved) && isAbsolute(selected),
    "Set REHEARSAL_DEVELOPMENT_ROOT and REHEARSAL_EDITOR_TEST_ROOT through the development launcher; no temporary fallback is allowed.",
  );
  assert.equal(
    await realpath(approved),
    approved,
    "Development root must be canonical and available.",
  );
  const storage = storageEnvironment(environment);
  for (const key of [
    "TMPDIR",
    "NODE_COMPILE_CACHE",
    "NPM_CONFIG_CACHE",
    "NPM_CONFIG_LOGS_DIR",
  ]) {
    const path = storage[key];
    assert.ok(
      path && (path === approved || within(approved, path)),
      "Temporary files and caches require explicit approved development storage.",
    );
    assert.equal(
      await realpath(path),
      path,
      "Temporary/cache storage must be canonical and available before startup.",
    );
  }
  const parent = dirname(selected);
  assert.equal(
    await realpath(parent),
    parent,
    "Editor storage parent must be canonical.",
  );
  assert.ok(
    (parent === approved || within(approved, parent)) &&
      within(approved, selected),
    "Editor storage must remain inside the approved development root.",
  );
  try {
    const entry = await lstat(selected);
    assert.ok(
      entry.isDirectory() && !entry.isSymbolicLink(),
      "Editor storage must be a regular directory.",
    );
    assert.equal(await realpath(selected), selected);
  } catch (error) {
    if (!(
      error &&
      typeof error === "object" &&
      "code" in error &&
      error.code === "ENOENT"
    ))
      throw error;
  }
  return selected;
}

export async function createNativeTemporaryDirectory(
  prefix: string,
  environment: NodeJS.ProcessEnv = process.env,
) {
  assert.match(prefix, /^[a-z-]{1,24}-$/u);
  const root = await nativeStorageRoot(environment);
  await mkdir(root, { mode: 0o700 }).catch((error: NodeJS.ErrnoException) => {
    if (error.code !== "EEXIST") throw error;
  });
  // Recheck after mkdir so a pre-existing or replaced link is never accepted.
  await nativeStorageRoot(environment);
  return mkdtemp(join(root, prefix));
}
