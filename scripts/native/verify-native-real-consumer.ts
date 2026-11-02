/** Read-only exact installed consumer acceptance. No artifact download, fixture or engine setup. */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { lstat, open, readdir, readlink, realpath } from "node:fs/promises";
import { isAbsolute, join, relative, resolve } from "node:path";
import {
  runNativeEditorAcceptance,
  parseNativeEditorAcceptanceArguments,
} from "./verify-native-prisma-editor.js";

const selectedInputs = Object.freeze([
  "package.json",
  "package-lock.json",
  "rehearsal.config.mjs",
  "infrastructure/rehearsal",
  ".rehearsal-native",
  ".rehearsal-publication",
  ".rehearsal",
  ".env.rehearsal-auth.local",
  ".env.rehearsal-source.local",
  ".git/HEAD",
  ".git/index",
  ".git/config",
  ".git/packed-refs",
  ".git/refs",
]);
export const realConsumerInputPaths = selectedInputs;
export interface ConsumerInputReceipt {
  readonly schemaVersion: 1;
  readonly files: number;
  readonly bytes: number;
  readonly sha256: string;
}
const inside = (root: string, path: string) => {
  const part = relative(root, path);
  return !isAbsolute(part) && part !== ".." && !part.startsWith("../");
};
/** Full selected-input hashes, stable no-follow regular reads; never plaintext or a disk/DB snapshot. */
export async function captureRealConsumerFiles(
  workspace: string,
  approvedRoot: string,
): Promise<ConsumerInputReceipt> {
  assert.ok(
    isAbsolute(workspace) &&
      isAbsolute(approvedRoot) &&
      workspace !== approvedRoot &&
      inside(approvedRoot, workspace),
  );
  assert.equal(await realpath(workspace), workspace);
  assert.equal(await realpath(approvedRoot), approvedRoot);
  const digest = createHash("sha256");
  let files = 0,
    bytes = 0,
    entries = 0;
  const walk = async (
    path: string,
    label: string,
    ancestors: readonly string[] = [],
  ) => {
    assert.ok(
      !label.split("/").includes("notes") &&
        !path.split("/").includes("notes") &&
        ancestors.length < 32 &&
        !ancestors.includes(path) &&
        inside(approvedRoot, path),
    );
    assert.ok(++entries <= 16384);
    let before;
    try {
      before = await lstat(path, { bigint: true });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        digest.update(JSON.stringify([label, "absent"]));
        return;
      }
      throw error;
    }
    const identity = () => [
      String(before.dev),
      String(before.ino),
      String(before.mode),
      String(before.uid),
      String(before.size),
      String(before.mtimeNs),
      String(before.ctimeNs),
    ];
    if (before.isSymbolicLink()) {
      const link = await readlink(path),
        target = await realpath(path);
      assert.ok(
        target !== workspace && inside(workspace, target),
        "Consumer input links must remain in the owned workspace.",
      );
      digest.update(JSON.stringify([label, "link", identity(), link]));
      await walk(target, label + "/@target", [...ancestors, path]);
      const after = await lstat(path, { bigint: true });
      assert.ok(
        after.ino === before.ino &&
          after.ctimeNs === before.ctimeNs &&
          (await readlink(path)) === link,
      );
      return;
    }
    assert.equal(await realpath(path), path);
    if (before.isDirectory()) {
      const names = (await readdir(path)).sort();
      digest.update(JSON.stringify([label, "directory", identity(), names]));
      for (const name of names)
        await walk(join(path, name), label + "/" + name, [...ancestors, path]);
      const after = await lstat(path, { bigint: true });
      assert.ok(
        after.dev === before.dev &&
          after.ino === before.ino &&
          after.mtimeNs === before.mtimeNs &&
          after.ctimeNs === before.ctimeNs,
      );
      return;
    }
    assert.ok(
      before.isFile() && ++files <= 8192 && before.size <= 4n * 1024n ** 3n,
    );
    bytes += Number(before.size);
    assert.ok(Number.isSafeInteger(bytes) && bytes <= 8 * 1024 ** 3);
    const fileHash = createHash("sha256"),
      handle = await open(
        path,
        constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
      );
    try {
      const held = await handle.stat({ bigint: true });
      assert.ok(
        held.isFile() &&
          held.dev === before.dev &&
          held.ino === before.ino &&
          held.size === before.size,
      );
      let read = 0;
      for await (const chunk of handle.createReadStream({ autoClose: false })) {
        read += chunk.length;
        assert.ok(read <= Number(before.size));
        fileHash.update(chunk);
      }
      const after = await handle.stat({ bigint: true }),
        named = await lstat(path, { bigint: true });
      assert.ok(
        read === Number(before.size) &&
          after.dev === before.dev &&
          after.ino === before.ino &&
          after.size === before.size &&
          after.mtimeNs === before.mtimeNs &&
          after.ctimeNs === before.ctimeNs &&
          named.dev === before.dev &&
          named.ino === before.ino &&
          named.mtimeNs === before.mtimeNs &&
          named.ctimeNs === before.ctimeNs,
      );
      digest.update(
        JSON.stringify([label, "file", identity(), fileHash.digest("hex")]),
      );
    } finally {
      await handle.close();
    }
  };
  for (const name of selectedInputs) await walk(join(workspace, name), name);
  return { schemaVersion: 1, files, bytes, sha256: digest.digest("hex") };
}
export const parseRealConsumerAcceptanceArguments = (args: readonly string[]) =>
  parseNativeEditorAcceptanceArguments(args, "real-consumer");
export const verifyNativeRealConsumer = (
  args: readonly string[] = process.argv.slice(2),
) => runNativeEditorAcceptance(args, "real-consumer");
if (process.argv[1] && resolve(process.argv[1]) === resolve(__filename))
  void verifyNativeRealConsumer().catch(() => {
    console.error(
      "Native real-consumer acceptance failed; private output withheld. Inspect owned evidence and recovery state.",
    );
    process.exitCode = 1;
  });
