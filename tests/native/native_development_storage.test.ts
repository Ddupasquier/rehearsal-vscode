import {
  mkdtemp,
  mkdir,
  readdir,
  realpath,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  nativeStorageRoot,
  createNativeTemporaryDirectory,
} from "../../scripts/native/native-development-storage.js";

describe("native fixture placement", () => {
  let approved: string;
  beforeEach(async () => {
    approved = await realpath(await mkdtemp(join(tmpdir(), "editor-storage-")));
  });
  afterEach(async () => {
    await rm(approved, { recursive: true, force: true });
  });
  const environment = (root: string) => ({
    REHEARSAL_DEVELOPMENT_ROOT: root,
    REHEARSAL_EDITOR_TEST_ROOT: join(root, "profiles"),
    TMPDIR: root,
    NODE_COMPILE_CACHE: root,
    NPM_CONFIG_CACHE: root,
    NPM_CONFIG_LOGS_DIR: root,
  });

  it("refuses missing overrides before creating profiles or a fallback", async () => {
    await expect(nativeStorageRoot({})).rejects.toThrow(
      "no temporary fallback",
    );
    await expect(
      nativeStorageRoot({
        ...environment(approved),
        REHEARSAL_EDITOR_TEST_ROOT: "relative",
      }),
    ).rejects.toThrow();
    expect(await readdir(approved)).toEqual([]);
  });
  it("refuses a complete profile selection with implicit or internal child caches", async () => {
    const env = environment(approved);
    await expect(
      nativeStorageRoot({ ...env, TMPDIR: undefined }),
    ).rejects.toThrow("explicit approved");
    await expect(
      nativeStorageRoot({ ...env, NPM_CONFIG_CACHE: "/tmp" }),
    ).rejects.toThrow("explicit approved");
    expect(await readdir(approved)).toEqual([]);
  });
  it("creates one owned short run beneath the selected root and preserves other runs", async () => {
    const env = environment(approved);
    expect(await nativeStorageRoot(env)).toBe(env.REHEARSAL_EDITOR_TEST_ROOT);
    expect(await readdir(approved)).toEqual([]);
    const first = await createNativeTemporaryDirectory("c-", env);
    await writeFile(join(first, "retained.json"), "{}");
    const second = await createNativeTemporaryDirectory("m-", env);
    expect(first.startsWith(join(approved, "profiles", "c-"))).toBe(true);
    expect(second).not.toBe(first);
    expect(await readdir(first)).toEqual(["retained.json"]);
  });
  it("refuses escape paths, symlinks, unavailable parents and non-directory roots", async () => {
    const env = environment(approved);
    await expect(
      nativeStorageRoot({
        ...env,
        REHEARSAL_EDITOR_TEST_ROOT: join(approved, "..", "escaped"),
      }),
    ).rejects.toThrow();
    await mkdir(join(approved, "target"));
    await symlink(join(approved, "target"), env.REHEARSAL_EDITOR_TEST_ROOT);
    await expect(createNativeTemporaryDirectory("c-", env)).rejects.toThrow(
      "regular directory",
    );
    expect(await readdir(join(approved, "target"))).toEqual([]);
    await expect(
      nativeStorageRoot({
        ...env,
        REHEARSAL_EDITOR_TEST_ROOT: join(approved, "missing", "profiles"),
      }),
    ).rejects.toThrow();
    await writeFile(join(approved, "file"), "owned");
    await expect(
      nativeStorageRoot({
        ...env,
        REHEARSAL_EDITOR_TEST_ROOT: join(approved, "file"),
      }),
    ).rejects.toThrow("regular directory");
  });
});
